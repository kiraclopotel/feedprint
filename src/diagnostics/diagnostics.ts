// FeelingWise — runtime diagnostics (heap + activity).
//
// Built 2026-06-06 to END the YouTube-OOM guessing. Two fixes (ec21573, the
// /watch _pendingNodes gate) failed to stop the crash, so instead of
// hypothesizing what leaks we now MEASURE: sample the JS heap over time + count
// FeelingWise's heavy operations, persist to chrome.storage, and surface it in
// the dashboard Debug section. A climbing heap + the counter that climbs with it
// names the culprit. `performance.memory` is Chrome-only + approximate, but
// perfect for spotting unbounded growth (the OOM signature).
//
// Cost: one sample every 30s (a property read) + cheap integer bumps from a few
// hot paths. Persistence is debounced to one write per 5s.

import { utcDayKey } from '../storage/utc-day';

const STORAGE_KEY = 'fw_diagnostics';
const MAX_SAMPLES = 120;          // ~1 hour at 30s — long enough to see a slow climb
const SAMPLE_INTERVAL_MS = 30_000;
const PERSIST_DEBOUNCE_MS = 5_000;
const MAX_HEAP_SESSIONS = 20;
const MAX_COUNTER_SESSIONS = 200;
const DIAGNOSTIC_SESSION_ID = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const RECENT_POST_INTERVENTION_TTL_MS = 60_000;
const MAX_RECENT_POST_INTERVENTIONS = 200;

export interface HeapSample {
  /** ISO timestamp. */
  t: string;
  /** usedJSHeapSize in MB (rounded). */
  usedMB: number;
  /** location.pathname at sample time — so a climb can be tied to a surface. */
  path: string;
}

export interface DiagnosticsSnapshot {
  date: string;
  host: string;
  samples: HeapSample[];
  peakMB: number;
  /** Cumulative counts of heavy operations (e.g. interceptor batches). */
  counters: Record<string, number>;
  /**
   * Epoch ms of each counter's FIRST bump in this session.
   *
   * A counter total is a whole-day figure, but a counter shipped at 21:15 has
   * only been able to count since 21:15. Reading the two against each other
   * invents defects: on 2026-08-02 a fresh reason counter reading 1 against a
   * day-old total reading 21 looked like a broken instrument, and a fresh queue
   * counter reading 1 against a day-old release counter reading 17 looked like
   * a broken queue. Neither was true, and neither was decidable. Stamping the
   * first bump lets a reader see that two counters do not cover the same window
   * BEFORE comparing them. Optional: sessions persisted before this existed
   * simply carry no stamps.
   */
  counterFirstSeen?: Record<string, number>;
  /** Peak values of point-in-time gauges (e.g. largest pending-node batch); `atPeak.*` entries are the registry sizes at the last heap peak, overwritten each time the peak rises. */
  gauges: Record<string, number>;
}

export interface DiagnosticCounterSession {
  observedAt: number;
  host: string;
  counters: Record<string, number>;
  counterFirstSeen?: Record<string, number>;
}

export interface DiagnosticsReadResult {
  snapshot: DiagnosticsSnapshot;
  counterTotals: Record<string, number>;
  /** Earliest first bump per counter across today's sessions (epoch ms). */
  counterFirstSeen: Record<string, number>;
}

/**
 * Per-content-script-session container persisted under STORAGE_KEY. The field
 * remains named `hosts` for storage compatibility, but current keys are opaque
 * session ids. This keeps two tabs on the same host independent and prevents a
 * calm tab from overwriting the tab that carries a failure counter or heap climb.
 */
export interface MultiHostDiagnostics {
  date: string;
  hosts: Record<string, DiagnosticsSnapshot>;
  counterSessions: Record<string, DiagnosticCounterSession>;
}

let snapshot: DiagnosticsSnapshot | null = null;
let persistScheduled = false;
let intervalId: number | null = null;
let nextPostInterventionAttemptId = 0;
const activePostInterventions = new Map<string, number>();
const recentPostInterventions = new Map<string, {
  attemptId: number;
  disposition: PostInterventionDisposition | 'requested';
  observedAt: number;
}>();

export type PostInterventionKind = 'hide' | 'collapse';
export type PostInterventionDisposition = 'applied' | 'suppressed' | 'failed';
export type PostInterventionReceipt =
  | 'accepted'
  | 'retry-buffered'
  | 'context-lost'
  | 'deduplicated'
  | 'not-sent';

export interface PostInterventionAttempt {
  key: string;
  kind: PostInterventionKind;
  label: string;
  attemptId: number;
  concurrent: boolean;
}

/** usedJSHeapSize in MB, or null when performance.memory is unavailable. */
function usedHeapMB(): number | null {
  if (typeof performance === 'undefined') return null;
  const mem = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory;
  if (!mem || typeof mem.usedJSHeapSize !== 'number') return null;
  return Math.round(mem.usedJSHeapSize / (1024 * 1024));
}

function ensureSnapshot(): DiagnosticsSnapshot {
  const host = typeof location !== 'undefined' ? location.hostname : '';
  if (!snapshot || snapshot.date !== utcDayKey()) {
    snapshot = {
      date: utcDayKey(), host, samples: [], peakMB: 0, counters: {}, counterFirstSeen: {}, gauges: {},
    };
  }
  return snapshot;
}

/**
 * Registries that can pin memory (observer sets, seen-key sets, pending-node
 * sets) report their live size here. At every new heap peak the sizes are
 * written into the gauges as `atPeak.<name>`, beside the page's DOM node count
 * and the count of nodes FeelingWise itself inserted, so a Copy Diagnostics
 * pasted after a climb names which registry grew with the heap, or that none
 * did. Added 2026-09-06 after a 4 GB heap on youtube.com whose samples said
 * only "climbing": the number was there and the culprit was not.
 */
const heapGauges = new Map<string, () => number>();

export function registerHeapGauge(name: string, read: () => number): void {
  heapGauges.set(name, read);
}

const FW_NODE_SELECTOR = '[class^="fw-"],[class*=" fw-"],[data-fw-neutralized],[data-fw-hard-hidden],[data-fw-ad-hidden]';

function recordRegistriesAtPeak(s: DiagnosticsSnapshot): void {
  for (const [name, read] of heapGauges) {
    try { s.gauges[`atPeak.${name}`] = read(); } catch { /* a gauge that throws is left out of this peak */ }
  }
  if (typeof document === 'undefined') return;
  try { s.gauges['atPeak.domNodes'] = document.getElementsByTagName('*').length; } catch { /* no DOM to count */ }
  try { s.gauges['atPeak.fwNodes'] = document.querySelectorAll(FW_NODE_SELECTOR).length; } catch { /* no DOM to count */ }
}

/**
 * The heap valve. When the sampled heap passes the threshold the content
 * script sheds the recorder's observers for the rest of the page's life: the
 * interceptor and the watch-comments module register handlers here and
 * disconnect on the call. It trips once per page load and never re-arms
 * without a navigation. The recorder cannot add to a crash it did not cause,
 * and the chain says it stopped (the interceptor's handler writes the gap).
 * 1.5 GB is far above any page this extension has been measured on with the
 * recorder alone (the watch-page probe peaks under 300 MB) and well below
 * where renderers die.
 */
export const HEAP_VALVE_MB = 1536;
const heapValveHandlers = new Set<(mb: number) => void>();
let heapValveTripped = false;

export function registerHeapValve(handler: (mb: number) => void): void {
  heapValveHandlers.add(handler);
}

export function unregisterHeapValve(handler: (mb: number) => void): void {
  heapValveHandlers.delete(handler);
}

function tripHeapValveIfDue(s: DiagnosticsSnapshot, mb: number): void {
  if (heapValveTripped || mb < HEAP_VALVE_MB) return;
  heapValveTripped = true;
  s.gauges['heap.valve.mb'] = mb;
  bumpCounter('heap.valve');
  for (const handler of heapValveHandlers) {
    try { handler(mb); } catch { /* one handler failing must not keep the next from shedding */ }
  }
}

/** Take one heap sample now (also called on the interval + on visibility change). */
function sampleHeapNow(): void {
  const mb = usedHeapMB();
  if (mb === null) return;
  const s = ensureSnapshot();
  s.samples.push({ t: new Date().toISOString(), usedMB: mb, path: typeof location !== 'undefined' ? location.pathname : '' });
  if (s.samples.length > MAX_SAMPLES) s.samples.splice(0, s.samples.length - MAX_SAMPLES);
  if (mb > s.peakMB) {
    s.peakMB = mb;
    recordRegistriesAtPeak(s);
  }
  tripHeapValveIfDue(s, mb);
  schedulePersist();
}

/** Increment a cumulative counter (e.g. number of interceptor batches drained). */
export function bumpCounter(name: string, n = 1): void {
  const s = ensureSnapshot();
  if (s.counters[name] === undefined) {
    (s.counterFirstSeen ??= {})[name] = Date.now();
  }
  s.counters[name] = (s.counters[name] ?? 0) + n;
  schedulePersist();
}

/** Record a point-in-time gauge; keeps the PEAK seen (e.g. largest node batch). */
export function setGaugePeak(name: string, value: number): void {
  const s = ensureSnapshot();
  s.gauges[name] = Math.max(s.gauges[name] ?? 0, value);
  schedulePersist();
}

function schedulePersist(): void {
  if (persistScheduled) return;
  persistScheduled = true;
  setTimeout(() => { persistScheduled = false; void persistNow(); }, PERSIST_DEBOUNCE_MS);
}

/**
 * Coerce whatever is in storage into today's multi-host doc. Migrates the old
 * flat single-snapshot shape (same-day) into a host slot; anything from a prior
 * day, or unrecognized, becomes a fresh empty doc. Pure.
 */
export function coerceMultiHost(raw: unknown, todayKey: string): MultiHostDiagnostics {
  if (raw && typeof raw === 'object') {
    const r = raw as Partial<MultiHostDiagnostics> & Partial<DiagnosticsSnapshot>;
    if (r.date === todayKey && r.hosts && typeof r.hosts === 'object') {
      const hosts = { ...r.hosts };
      const counterSessions = r.counterSessions && typeof r.counterSessions === 'object'
        ? { ...r.counterSessions }
        : Object.fromEntries(Object.entries(hosts).map(([key, item]) => [
            key,
            {
              observedAt: Date.parse(item.samples.at(-1)?.t ?? '') || 0,
              host: item.host,
              counters: { ...item.counters },
            },
          ]));
      return { date: todayKey, hosts, counterSessions };
    }
    // Legacy flat snapshot from the same day → migrate into a host slot.
    if (r.date === todayKey && Array.isArray(r.samples)) {
      const snap = raw as DiagnosticsSnapshot;
      const key = snap.host || 'unknown';
      return {
        date: todayKey,
        hosts: { [key]: snap },
        counterSessions: {
          [key]: {
            observedAt: Date.parse(snap.samples.at(-1)?.t ?? '') || 0,
            host: snap.host,
            counters: { ...snap.counters },
          },
        },
      };
    }
  }
  return { date: todayKey, hosts: {}, counterSessions: {} };
}

function rememberPostIntervention(
  key: string,
  attemptId: number,
  disposition: PostInterventionDisposition | 'requested',
): void {
  recentPostInterventions.delete(key);
  recentPostInterventions.set(key, { attemptId, disposition, observedAt: Date.now() });
  while (recentPostInterventions.size > MAX_RECENT_POST_INTERVENTIONS) {
    const oldest = recentPostInterventions.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    recentPostInterventions.delete(oldest);
  }
}

/** Start one post hide/collapse attempt without changing its outcome. */
export function beginPostIntervention(
  key: string,
  kind: PostInterventionKind,
  label: string,
): PostInterventionAttempt {
  const active = activePostInterventions.get(key) ?? 0;
  const attemptId = ++nextPostInterventionAttemptId;
  activePostInterventions.set(key, active + 1);
  rememberPostIntervention(key, attemptId, 'requested');
  bumpCounter('postInterventionRequested');
  if (active > 0) bumpCounter('postInterventionConcurrent');
  return { key, kind, label, attemptId, concurrent: active > 0 };
}

const RECEIPT_COUNTER: Record<PostInterventionReceipt, string> = {
  accepted: 'postInterventionReceiptAccepted',
  'retry-buffered': 'postInterventionReceiptRetryBuffered',
  'context-lost': 'postInterventionReceiptContextLost',
  deduplicated: 'postInterventionReceiptDeduplicated',
  'not-sent': 'postInterventionReceiptNotSent',
};

/** Persist and print the verified terminal result of one post intervention. */
export function finishPostIntervention(
  attempt: PostInterventionAttempt,
  disposition: PostInterventionDisposition,
  reason: string,
  receipt: PostInterventionReceipt,
): void {
  const active = activePostInterventions.get(attempt.key) ?? 0;
  if (active <= 1) activePostInterventions.delete(attempt.key);
  else activePostInterventions.set(attempt.key, active - 1);
  rememberPostIntervention(attempt.key, attempt.attemptId, disposition);
  bumpCounter(`postIntervention${disposition[0].toUpperCase()}${disposition.slice(1)}`);
  bumpCounter(RECEIPT_COUNTER[receipt]);
  console.log(
    `[FeelingWise] post intervention ${disposition}: ${attempt.kind} ${attempt.label} `
    + `(attempt ${attempt.attemptId}, reason ${reason}, record ${receipt})`,
  );
}

/** Correlate a PASS that follows a recent hide/collapse request for one post id. */
export function notePostPassAfterIntervention(key: string, label: string): boolean {
  const recent = recentPostInterventions.get(key);
  if (!recent || Date.now() - recent.observedAt > RECENT_POST_INTERVENTION_TTL_MS) return false;
  bumpCounter('postInterventionPassAfterRequest');
  console.log(
    `[FeelingWise] post reclassified as pass: ${label} after intervention attempt `
    + `${recent.attemptId} (${recent.disposition})`,
  );
  return true;
}

export function aggregateDiagnosticCounters(
  sessions: Record<string, DiagnosticCounterSession>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const session of Object.values(sessions)) {
    for (const [name, value] of Object.entries(session.counters)) {
      if (!Number.isFinite(value)) continue;
      totals[name] = (totals[name] ?? 0) + value;
    }
  }
  return totals;
}

/**
 * Earliest first bump per counter across sessions. The companion to the totals:
 * the total says how many, this says since when, and only the pair supports a
 * comparison between two counters of different ages.
 */
export function aggregateDiagnosticCounterFirstSeen(
  sessions: Record<string, DiagnosticCounterSession>,
): Record<string, number> {
  const firstSeen: Record<string, number> = {};
  for (const session of Object.values(sessions)) {
    for (const [name, value] of Object.entries(session.counterFirstSeen ?? {})) {
      if (!Number.isFinite(value) || value <= 0) continue;
      firstSeen[name] = Math.min(firstSeen[name] ?? value, value);
    }
  }
  return firstSeen;
}

function snapshotRisk(s: DiagnosticsSnapshot): number {
  const t = summarizeHeapTrend(s.samples, s.peakMB);
  // Climbing dominates; then how much it grew; then absolute peak.
  return (t.climbing ? 1_000_000 : 0) + t.deltaMB * 1000 + t.peakMB;
}

/**
 * Across all per-session snapshots, return the one most likely to be the problem:
 * a climbing host beats a stable one (so a YouTube leak surfaces past a calm
 * x.com tab), ties break on largest growth then peak. Pure. null when empty.
 */
export function pickWorstClimbingSnapshot(hosts: Record<string, DiagnosticsSnapshot>): DiagnosticsSnapshot | null {
  const snaps = Object.values(hosts);
  if (snaps.length === 0) return null;
  return snaps.reduce((best, s) => (snapshotRisk(s) > snapshotRisk(best) ? s : best));
}

/**
 * Keep bounded heap evidence without letting a run of calm recent tabs evict
 * the session that actually captured a climb. Half the slots are reserved for
 * highest risk; the rest preserve the most recently updated sessions.
 */
export function pruneDiagnosticHeapSessions(
  hosts: Record<string, DiagnosticsSnapshot>,
  counterSessions: Record<string, DiagnosticCounterSession>,
  limit = MAX_HEAP_SESSIONS,
): Record<string, DiagnosticsSnapshot> {
  const entries = Object.entries(hosts);
  if (entries.length <= limit) return { ...hosts };
  const byRisk = [...entries].sort(([, a], [, b]) => snapshotRisk(b) - snapshotRisk(a));
  const observedAt = (id: string, item: DiagnosticsSnapshot): number => {
    const stored = counterSessions[id]?.observedAt;
    if (typeof stored === 'number') return stored;
    return Date.parse(item.samples.at(-1)?.t ?? '') || 0;
  };
  const byRecency = [...entries].sort(
    ([idA, a], [idB, b]) => observedAt(idB, b) - observedAt(idA, a),
  );
  const keep = new Set<string>();
  const riskSlots = Math.max(1, Math.ceil(limit / 2));
  for (const [id] of byRisk.slice(0, riskSlots)) keep.add(id);
  for (const [id] of byRecency) {
    if (keep.size >= limit) break;
    keep.add(id);
  }
  for (const [id] of byRisk) {
    if (keep.size >= limit) break;
    keep.add(id);
  }
  return Object.fromEntries(entries.filter(([id]) => keep.has(id)));
}

async function persistNow(): Promise<void> {
  if (!snapshot) return;
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  try {
    // Per-session merge. Read-modify-write races self-heal: each active tab
    // keeps its own in-memory snapshot and re-merges on its next persistence.
    const got = await chrome.storage.local.get([STORAGE_KEY]);
    const doc = coerceMultiHost(got[STORAGE_KEY], utcDayKey());
    doc.hosts[DIAGNOSTIC_SESSION_ID] = snapshot;
    doc.counterSessions[DIAGNOSTIC_SESSION_ID] = {
      observedAt: Date.now(),
      host: snapshot.host,
      counters: { ...snapshot.counters },
      counterFirstSeen: { ...(snapshot.counterFirstSeen ?? {}) },
    };
    const recentCounterSessions = Object.entries(doc.counterSessions)
      .sort(([, a], [, b]) => b.observedAt - a.observedAt)
      .slice(0, MAX_COUNTER_SESSIONS);
    doc.counterSessions = Object.fromEntries(recentCounterSessions);
    doc.hosts = pruneDiagnosticHeapSessions(doc.hosts, doc.counterSessions);
    await chrome.storage.local.set({ [STORAGE_KEY]: doc });
  } catch { /* best-effort */ }
}

/** Dashboard reader: worst heap session plus all per-session counter totals. */
export async function readDiagnosticsResult(): Promise<DiagnosticsReadResult> {
  const empty: DiagnosticsSnapshot = { date: utcDayKey(), host: '', samples: [], peakMB: 0, counters: {}, gauges: {} };
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
    return { snapshot: empty, counterTotals: {}, counterFirstSeen: {} };
  }
  try {
    const got = await chrome.storage.local.get([STORAGE_KEY]);
    const doc = coerceMultiHost(got[STORAGE_KEY], utcDayKey());
    return {
      snapshot: pickWorstClimbingSnapshot(doc.hosts) ?? empty,
      counterTotals: aggregateDiagnosticCounters(doc.counterSessions),
      counterFirstSeen: aggregateDiagnosticCounterFirstSeen(doc.counterSessions),
    };
  } catch { /* best-effort */ }
  return { snapshot: empty, counterTotals: {}, counterFirstSeen: {} };
}

/** Start periodic heap sampling. Idempotent. Call once from the content script. */
/**
 * Write the current snapshot out immediately, bypassing the 5s debounce.
 *
 * Every counter bumped in the last five seconds of a page's life was being
 * discarded: `schedulePersist` is a debounced `setTimeout` and a hard
 * navigation kills the timer before it fires. That silently truncates every
 * counter on short visits and, worse, would have swallowed the unload
 * counters in `forensic-retry.ts` — an instrument dying of exactly the event
 * it was added to record. Best effort by nature: the storage round trip may
 * not finish before teardown, but an attempted write beats a cancelled timer.
 */
export function flushDiagnosticsNow(): Promise<void> {
  return persistNow();
}

export function startDiagnostics(): void {
  if (intervalId !== null) return;
  sampleHeapNow();
  if (typeof window !== 'undefined') {
    intervalId = window.setInterval(() => sampleHeapNow(), SAMPLE_INTERVAL_MS);
    window.addEventListener('pagehide', () => { void flushDiagnosticsNow(); });
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => sampleHeapNow());
  }
}

export interface HeapTrend {
  firstMB: number;
  lastMB: number;
  peakMB: number;
  deltaMB: number;
  /** True when the heap shows sustained unbounded-looking growth (a leak signal). */
  climbing: boolean;
  sampleCount: number;
  /**
   * Leading cold-start samples discarded before the verdict was computed.
   * Non-zero means `firstMB` is the settled baseline, not the very first read.
   */
  warmupDropped: number;
}

/**
 * A leading sample is cold-start noise only when it is BOTH absolutely tiny and
 * followed by a step change. The absolute floor is what separates the artifact
 * from a real leak: no loaded social feed occupies 32 MB, so a reading below it
 * means the reader's tick landed before the host page allocated anything — while
 * a genuine leak that opens at 200 MB and multiplies is left entirely alone.
 * (Learned the hard way: a ratio-only rule ate the baseline of the suite's
 * 200→1800 MB leak fixture, which is exactly the case that must survive.)
 */
const WARMUP_FLOOR_MB = 32;
const WARMUP_RATIO = 2;
/** Never discard more than this many leading samples, however odd the series. */
const WARMUP_MAX_DROP = 3;
/**
 * Fewest post-warmup samples required before `climbing` may fire at all.
 * Owner's 2026-08-24 01:07 capture: exactly two heap samples, 30s apart —
 * 3 MB at content-script init (before the host page had loaded its own
 * code), then 237 MB. `bigJump` had no sample-count floor and fired off
 * that pair alone: "CLIMBING (+234 MB): whole-page memory keeps growing"
 * from two points, one of them a cold-start artifact. The warm-up guard
 * above cannot rescue a series this short — it needs at least 3 samples
 * left over to drop anything (`samples.length - warmupDropped >= 3`), so a
 * 2- or 3-sample series never gets a chance to have its leading sample
 * filtered. 4 is the smallest count at which that guard can even engage
 * (drop 1, keep 3), so it is also the smallest count at which a `climbing`
 * verdict has had a chance to survive a cold-start check. Below it, the
 * honest answer is "too few samples yet", not a verdict either way.
 */
export const MIN_SAMPLES_FOR_CLIMBING = 4;

/**
 * Summarize the heap series into a trend a non-coder can read. Pure.
 * `climbing` (a likely-leak signal) fires on EITHER:
 *   • big jump — grew >150 MB AND ended ≥40% above the start (catches a sharp
 *     climb instantly, even on a short series); OR
 *   • sustained slope — with ≥6 samples, a positive least-squares trend
 *     (>0.8 MB/sample) AND >80 MB net growth (catches a slow leak that the old
 *     first-vs-last check missed, without firing on allocate-then-GC sawtooth).
 * Fewer than 6 samples can only trip via the big-jump path — too little data to
 * trust a slope (the premature "stable on 2 samples" verdict the debug tab gave).
 * Fewer than MIN_SAMPLES_FOR_CLIMBING samples (post-warmup-drop) can trip
 * NEITHER path — too little data for any verdict at all.
 *
 * BOTH paths anchor on `firstMB`, so a cold-start first sample poisons both at
 * once. Owner's 2026-08-20 dump: 59 samples on TikTok opening 3 MB (the tick
 * landed before the site allocated), then 175, then a noisy 120-310 band ending
 * at 239. Against the 3 MB anchor, bigJump AND slopeClimb both fired and the
 * panel said "CLIMBING (+236 MB)". Drop that one sample and BOTH go false:
 * delta 64 (under the 80 gate) and the last twenty samples slope DOWN
 * (-0.19 MB/sample). The verdict was an artifact of the baseline, not a leak —
 * so leading cold-start samples are discarded before anything is measured.
 */
export function summarizeHeapTrend(samples: HeapSample[], peakMB: number): HeapTrend {
  if (samples.length === 0) {
    return { firstMB: 0, lastMB: 0, peakMB, deltaMB: 0, climbing: false, sampleCount: 0, warmupDropped: 0 };
  }
  // Discard the warm-up run. Guarded four ways: the sample must be below the
  // absolute floor (so a real leak's baseline is never eaten), the next sample
  // must be a step change and not mere growth, at most WARMUP_MAX_DROP go, and
  // at least three samples must remain to measure.
  let warmupDropped = 0;
  while (
    warmupDropped < WARMUP_MAX_DROP
    && samples.length - warmupDropped >= 3
    && samples[warmupDropped].usedMB < WARMUP_FLOOR_MB
    && samples[warmupDropped + 1].usedMB >= samples[warmupDropped].usedMB * WARMUP_RATIO
  ) {
    warmupDropped++;
  }
  if (warmupDropped > 0) samples = samples.slice(warmupDropped);

  const firstMB = samples[0].usedMB;
  const lastMB = samples[samples.length - 1].usedMB;
  const deltaMB = lastMB - firstMB;

  const enoughSamples = samples.length >= MIN_SAMPLES_FOR_CLIMBING;
  const bigJump = enoughSamples && deltaMB > 150 && lastMB >= firstMB * 1.4;

  let slopePerSample = 0;
  if (samples.length >= 6) {
    const n = samples.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) {
      const y = samples[i].usedMB;
      sx += i; sy += y; sxy += i * y; sxx += i * i;
    }
    const denom = n * sxx - sx * sx;
    if (denom !== 0) slopePerSample = (n * sxy - sx * sy) / denom;
  }
  const slopeClimb = samples.length >= 6 && slopePerSample > 0.8 && deltaMB > 80;

  return { firstMB, lastMB, peakMB, deltaMB, climbing: bigJump || slopeClimb, sampleCount: samples.length, warmupDropped };
}

export function _resetDiagnosticsForTesting(): void {
  snapshot = null;
  persistScheduled = false;
  heapValveTripped = false;
  heapValveHandlers.clear();
  nextPostInterventionAttemptId = 0;
  activePostInterventions.clear();
  recentPostInterventions.clear();
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
}

export function _sampleHeapForTesting(): void {
  sampleHeapNow();
}

export function _getGaugesForTesting(): Record<string, number> {
  return { ...(snapshot?.gauges ?? {}) };
}

export function _getDiagnosticCountersForTesting(): Record<string, number> {
  return { ...(snapshot?.counters ?? {}) };
}

export function _getDiagnosticCounterFirstSeenForTesting(): Record<string, number> {
  return { ...(snapshot?.counterFirstSeen ?? {}) };
}
