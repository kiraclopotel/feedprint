// FeelingWise — what the record's own maintenance did last, where a parent can see it.
//
// Wiring audit 13 Sep, C28 and C29. The month rotation and the cap prune each
// have ways to refuse that keep the record safe (nothing is deleted unless the
// archive verifiably holds it), and both told only the service worker console:
// an archive that failed verification left the active chain over its cap with
// no signal, and a rotation that kept meeting pending deliveries refused every
// day, invisibly. This keeps one small entry per job in extension storage and
// turns a refusal that repeats, or one that needs a person, into an attention
// item on the dashboard.
//
// Nothing here is evidence. It is never hashed, never signed, never exported.

export const MAINTENANCE_HEALTH_KEY = 'fw-maintenance-health';

interface JobHealth {
  /** ISO time of the last run that reached a decision. */
  at: string;
  ok: boolean;
  reason?: string;
  /** The month the rotation was archiving, when it said. */
  month?: string;
  /** Refusals in a row, reset by the first run that succeeds. */
  refusedInARow: number;
}

/**
 * The six-hour time stamp (F68, 6 Oct 2026). Found on the owner's own export: eight days and
 * 12,000 entries with no stamp while every page said the record was stamped every few hours, and
 * the only trace was a console line naming the first authority's answer. The stamp leaves an entry
 * like the other two jobs, and keeps what every authority said, so the person can read why.
 */
interface StampHealth extends JobHealth {
  /** Every authority's answer on the last attempt, in the order they were asked; one line for a skip or a throw. */
  reasons?: string[];
  /** The chain position the attempt tried to stamp, or stamped. */
  headPosition?: number;
}

export interface MaintenanceHealth {
  rotation?: JobHealth;
  prune?: JobHealth;
  stamp?: StampHealth;
}

export type MaintenanceAttention =
  | { id: 'archive-needs-person'; month?: string }
  | { id: 'rotation-stuck'; reason: string; days: number }
  | { id: 'prune-stuck'; reason: string; runs: number }
  | { id: 'prune-stale'; days: number }
  | { id: 'stamp-stuck'; reason: string; reasons: string[]; attempts: number };

/** Rotation reasons that are the normal state of a month with nothing to do. */
const ROTATION_IDLE = new Set(['no-rotation-needed']);

/**
 * Every exit of the prune notes its outcome, ok or not, so a healthy install
 * gets a fresh entry each night whether or not the cap was ever hit. An entry
 * this old therefore means the job did not run or did not finish, and no
 * refusal count can say so, because nothing was written to count. Its own age
 * is the signal.
 */
const PRUNE_STALE_DAYS = 3;

/**
 * A daily job whose last entry is older than this runs again when the worker
 * next wakes, without waiting for its alarm. A daily alarm's first fire is a
 * full day after the alarm is created, and Chrome's alarms documentation says an
 * alarm lasts only until the extension updates, so an install that updates or
 * reloads more often than once a day can re-create the alarm each time and the
 * job never comes round. The extra
 * hour leaves a healthy alarm to fire first.
 */
const DAILY_JOB_OVERDUE_HOURS = 25;

/**
 * Stamp skips that are the normal state of a chain with nothing new to stamp. The alarm ticks every
 * six hours whether or not the record grew; an idle install or one whose head was stamped an hour ago
 * is healthy, not refused.
 */
const STAMP_IDLE = new Set(['no_chained_records', 'recent_anchor_covers_head', 'no_feed_entry_since_last_anchor']);

/** Four six-hour ticks: one day of refusals in a row before the dashboard says so. */
const STAMP_REFUSALS_BEFORE_ATTENTION = 4;

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (24 * 60 * 60 * 1000);
}

/**
 * True when a daily job last reported more than a day ago. A job that has never
 * reported is not overdue: a new install's first run is its alarm's, a day
 * after install, and nothing on it can have gone stale yet.
 */
export function dailyJobOverdue(job: { at: string } | undefined, now: Date = new Date()): boolean {
  if (!job) return false;
  const age = daysSince(job.at, now);
  return !Number.isFinite(age) || age * 24 >= DAILY_JOB_OVERDUE_HOURS;
}

type Storage = { get(key: string): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> };

function storage(): Storage | null {
  const local = typeof chrome !== 'undefined' ? chrome.storage?.local : undefined;
  return local ? (local as unknown as Storage) : null;
}

export async function readMaintenanceHealth(): Promise<MaintenanceHealth> {
  try {
    const s = storage();
    if (!s) return {};
    const got = await s.get(MAINTENANCE_HEALTH_KEY);
    const v = got[MAINTENANCE_HEALTH_KEY];
    return v && typeof v === 'object' ? (v as MaintenanceHealth) : {};
  } catch {
    return {};
  }
}

async function note(job: keyof MaintenanceHealth, outcome: { ok: boolean; reason?: string; month?: string }, now: string): Promise<void> {
  try {
    const s = storage();
    if (!s) return;
    const current = await readMaintenanceHealth();
    const prev = current[job];
    const next: JobHealth = {
      at: now,
      ok: outcome.ok,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      ...(outcome.month ? { month: outcome.month } : {}),
      refusedInARow: outcome.ok ? 0 : (prev?.refusedInARow ?? 0) + 1,
    };
    await s.set({ [MAINTENANCE_HEALTH_KEY]: { ...current, [job]: next } });
  } catch {
    /* health is a convenience; a failed write never touches the record */
  }
}

/** After a rotation run. An idle run (nothing to rotate) is a success. */
export function noteRotation(result: { rotated: boolean; reason?: string; archivedMonth?: string }, now: string = new Date().toISOString()): Promise<void> {
  const ok = result.rotated || (result.reason !== undefined && ROTATION_IDLE.has(result.reason));
  return note('rotation', { ok, reason: ok ? undefined : result.reason, month: result.archivedMonth }, now);
}

/** After a prune run: ok false when the overflow could not be archived and nothing was deleted. */
export function notePrune(outcome: { ok: boolean; reason?: string }, now: string = new Date().toISOString()): Promise<void> {
  return note('prune', outcome, now);
}

/** What the stamp tick hands over: anchorChainHead's result, or 'failed' with the message when it threw. */
export type StampOutcome =
  | { status: 'anchored'; anchoredChainPosition: number }
  | { status: 'skipped'; reason: string; reasons?: string[]; headPosition?: number; lastAnchoredPosition?: number }
  | { status: 'failed'; reason: string };

/** After a stamp tick. A tick with nothing to stamp is a success; every other skip, and a throw, is a refusal. */
export async function noteStamp(outcome: StampOutcome, now: string = new Date().toISOString()): Promise<void> {
  try {
    const s = storage();
    if (!s) return;
    const current = await readMaintenanceHealth();
    const prev = current.stamp;
    const ok = outcome.status === 'anchored' || (outcome.status === 'skipped' && STAMP_IDLE.has(outcome.reason));
    const next: StampHealth = {
      at: now,
      ok,
      refusedInARow: ok ? 0 : (prev?.refusedInARow ?? 0) + 1,
    };
    if (outcome.status === 'anchored') {
      next.headPosition = outcome.anchoredChainPosition;
    } else {
      next.reason = outcome.reason;
      next.reasons = outcome.status === 'skipped' && outcome.reasons && outcome.reasons.length > 0
        ? outcome.reasons
        : [outcome.reason];
      if (outcome.status === 'skipped' && outcome.headPosition !== undefined) next.headPosition = outcome.headPosition;
    }
    await s.set({ [MAINTENANCE_HEALTH_KEY]: { ...current, stamp: next } });
  } catch {
    /* health is a convenience; a failed write never touches the record */
  }
}

/**
 * What deserves the parent's attention. A pre-existing archive that failed
 * verification needs a person at once (rotation will not overwrite it). Any
 * other refusal is expected to clear on the next daily run, so it is raised
 * only when it repeats: three days for rotation, two runs for the prune. A
 * prune entry old enough that the nightly job cannot have left it standing on
 * purpose is raised too, whether its last recorded outcome was ok or not: that
 * covers the two exits that never call notePrune at all, and any other reason
 * the job simply stopped reporting (`now` is a parameter so a test can hold it
 * still; a caller reading live health omits it and gets the real time).
 */
export function maintenanceAttention(h: MaintenanceHealth, now: Date = new Date()): MaintenanceAttention[] {
  const out: MaintenanceAttention[] = [];
  const r = h.rotation;
  if (r && !r.ok) {
    if (r.reason === 'archive-already-exists') out.push({ id: 'archive-needs-person', month: r.month });
    else if (r.refusedInARow >= 3) out.push({ id: 'rotation-stuck', reason: r.reason ?? 'unknown', days: r.refusedInARow });
  }
  const p = h.prune;
  const pruneStale = p !== undefined && daysSince(p.at, now) >= PRUNE_STALE_DAYS;
  // A refusal that is also old did run, so it keeps the refusal's words rather than "has not run".
  if (p && !p.ok && (p.refusedInARow >= 2 || pruneStale)) {
    out.push({ id: 'prune-stuck', reason: p.reason ?? 'unknown', runs: Math.max(1, p.refusedInARow) });
  } else if (p && pruneStale) {
    // p.ok may still be true here: the entry is not lying, it is only older
    // than a nightly job should let it get. A stale entry is not a refusal and
    // has no reason or run count, so it is its own item with its own words.
    out.push({ id: 'prune-stale', days: Math.floor(daysSince(p.at, now)) });
  }
  const st = h.stamp;
  if (st && !st.ok && st.refusedInARow >= STAMP_REFUSALS_BEFORE_ATTENTION) {
    out.push({ id: 'stamp-stuck', reason: st.reason ?? 'unknown', reasons: st.reasons ?? [st.reason ?? 'unknown'], attempts: st.refusedInARow });
  }
  return out;
}
