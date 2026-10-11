// FeelingWise selector-health counter.
//
// WHY: V1 ships on X + TikTok. Both platforms rewrite their DOM unannounced,
// often without breaking CSS selectors immediately (a silent drift: selector
// matches 80% of nodes, then 60%, then 30%). The operator has no signal until
// users report "nothing is working anymore". Classical approach (heavy DOM
// heuristics as primary path) costs CPU and false-matches on edge nodes;
// classical catch (snapshot tests) catches breakage in CI but misses
// production drift on the user's browser.
//
// APPROACH: record WHICH selector in a priority chain matched. The content
// script runs `queryWithFallback([primary, fallback1, fallback2, ...], label)`
// for every load-bearing DOM read. Each query is one of:
//   • primary-hit   — selector[0] matched.
//   • fallback-hit  — selector[i>0] matched. record which tier.
//   • miss          — nothing matched. record the label.
//
// Counts accumulate per session in a small in-memory map. Periodic flush
// (every 30s OR when the tab goes hidden) writes the aggregate to
// `chrome.storage.local.fw_selector_health` keyed by `YYYY-MM-DD`. The
// Dashboard diagnostics panel can read it and show drift.
//
// COST: one Map lookup + one integer increment per query call. The query
// was already executing — this adds ~20ns per call on a 1M call/day feed.
// Flush is O(keys) serialized once per 30s — negligible.
//
// NON-GOALS: this is NOT a forensic evidence record. It's an operational
// counter. Lives in chrome.storage.local, separate namespace from the
// signed ForensicRecord IDB. See docs/FORENSIC_COVERAGE.md for the
// separation contract.
//
// LABELING RULE (load-bearing only): only pass a `label` for a LOAD-BEARING
// read — one expected to match on the node it runs against, where a miss
// genuinely means the platform rotated its DOM. Do NOT label discovery scans
// (queries fired across arbitrary MutationObserver nodes to find content) or
// ad/legacy fallbacks where a miss is the normal outcome. Labeling those
// inflates miss% with structural misses and trips the per-platform "looks
// broken" verdict (assessPlatformDrift) on a healthy platform — exactly what
// `twitter.post-text` (discovery scan) and `facebook-text` (ad-only fallback)
// did before their labels were removed 2026-06-06. Total extraction breakage
// is the extraction-canary's job, not this counter's.

import type { ExtractionCanarySnapshot } from './extraction-canary';
import { utcDayKey } from '../storage/utc-day';

export type SelectorTier = 'primary' | 'fallback-1' | 'fallback-2' | 'fallback-3+' | 'miss';

export interface SelectorHealthCounter {
  label: string;
  primary: number;
  fallback1: number;
  fallback2: number;
  fallbackDeep: number;
  miss: number;
  lastSeenAt: string;
}

export interface SelectorHealthSnapshot {
  date: string;
  counters: Record<string, SelectorHealthCounter>;
}

const STORAGE_KEY = 'fw_selector_health';
const FLUSH_INTERVAL_MS = 30_000;

const counters: Map<string, SelectorHealthCounter> = new Map();
let flushScheduled = false;

function ensureCounter(label: string): SelectorHealthCounter {
  let c = counters.get(label);
  if (!c) {
    c = {
      label,
      primary: 0, fallback1: 0, fallback2: 0, fallbackDeep: 0, miss: 0,
      lastSeenAt: new Date().toISOString(),
    };
    counters.set(label, c);
  }
  return c;
}

function tierFromIndex(i: number): SelectorTier {
  if (i === 0) return 'primary';
  if (i === 1) return 'fallback-1';
  if (i === 2) return 'fallback-2';
  return 'fallback-3+';
}

/**
 * Record a selector-query outcome.
 *
 * @param label   Stable identifier for the query site, e.g.
 *                `"twitter.post-text"` or `"tiktok.comment-list"`. Never
 *                include selector contents — the label is a permanent site
 *                name, independent of which selector variants exist today.
 * @param tier    Which tier of the fallback chain actually returned a match,
 *                or `'miss'` when nothing matched.
 */
export function recordSelectorOutcome(label: string, tier: SelectorTier): void {
  const c = ensureCounter(label);
  c.lastSeenAt = new Date().toISOString();
  switch (tier) {
    case 'primary':     c.primary++;       break;
    case 'fallback-1':  c.fallback1++;     break;
    case 'fallback-2':  c.fallback2++;     break;
    case 'fallback-3+': c.fallbackDeep++;  break;
    case 'miss':        c.miss++;          break;
  }
  scheduleFlush();
}

/** Helper: translate a chain index (0 = primary, N = fallback-(N)) to a tier. */
export function recordSelectorHit(label: string, index: number): void {
  recordSelectorOutcome(label, tierFromIndex(index));
}

export function recordSelectorMiss(label: string): void {
  recordSelectorOutcome(label, 'miss');
}

/**
 * The same page-death guard `diagnostics.ts` grew on 2026-09-18, carried the
 * one file across on 19 September. A hard navigation, a tab close or an
 * extension reload kills the thirty-second timer below before it fires, and
 * every hit and miss recorded since the last flush goes with it.
 *
 * It matters more here than it does there. These counters are the only warning
 * that a platform has rotated its DOM and the adapters have gone blind, and
 * this file's own header says the alternative is no signal at all until users
 * report that nothing works. A miss counter that loses its last thirty seconds
 * under-reports exactly the event it exists to catch, and it under-reports it
 * worst on short visits, which is what a feed that has stopped working
 * produces. Best effort by nature: the storage round trip may not finish
 * before teardown, but an attempted write beats a cancelled timer.
 */
let pageDeathBound = false;
const onPageDeath = (): void => { void flushNow(); };
function bindPageDeath(): void {
  if (pageDeathBound) return;
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  pageDeathBound = true;
  window.addEventListener('pagehide', onPageDeath);
}

function scheduleFlush(): void {
  bindPageDeath();
  if (flushScheduled) return;
  flushScheduled = true;
  // setTimeout works in both content-script and jsdom test environments;
  // `chrome.storage.local.set` is the async boundary, so we don't need
  // microtask batching beyond this.
  setTimeout(() => {
    flushScheduled = false;
    void flushNow();
  }, FLUSH_INTERVAL_MS);
}

/**
 * Merge in-memory counters into chrome.storage.local. Best-effort — if
 * chrome.storage isn't available (non-extension test context) or the write
 * fails, we silently drop this flush. The in-memory counter keeps ticking
 * and the NEXT flush will catch up.
 */
export async function flushNow(): Promise<void> {
  if (counters.size === 0) return;
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;

  try {
    const existing = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = existing[STORAGE_KEY] as SelectorHealthSnapshot | undefined;
    const today = utcDayKey();
    const snap: SelectorHealthSnapshot =
      raw && raw.date === today
        ? raw
        : { date: today, counters: {} };

    for (const [label, c] of counters) {
      const prev = snap.counters[label] ?? {
        label,
        primary: 0, fallback1: 0, fallback2: 0, fallbackDeep: 0, miss: 0,
        lastSeenAt: c.lastSeenAt,
      };
      snap.counters[label] = {
        label,
        primary:      prev.primary      + c.primary,
        fallback1:    prev.fallback1    + c.fallback1,
        fallback2:    prev.fallback2    + c.fallback2,
        fallbackDeep: prev.fallbackDeep + c.fallbackDeep,
        miss:         prev.miss         + c.miss,
        lastSeenAt:   c.lastSeenAt,
      };
    }
    counters.clear();

    await chrome.storage.local.set({ [STORAGE_KEY]: snap });
  } catch {
    // Silent — counters will survive and next flush retries.
  }
}

/**
 * Best-effort read for the Dashboard diagnostics panel. Returns today's
 * snapshot or an empty shell. Never throws.
 */
export async function readSelectorHealth(): Promise<SelectorHealthSnapshot> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
    return { date: utcDayKey(), counters: {} };
  }
  try {
    const existing = await chrome.storage.local.get([STORAGE_KEY]);
    const raw = existing[STORAGE_KEY] as SelectorHealthSnapshot | undefined;
    if (raw && raw.date === utcDayKey()) return raw;
    return { date: utcDayKey(), counters: {} };
  } catch {
    return { date: utcDayKey(), counters: {} };
  }
}

// ─── Per-platform drift verdict (regression harness, 2026-06-05) ───────────
//
// The per-site counters above tell us WHICH query drifted; this rolls them up
// to a per-PLATFORM verdict a non-coder can act on ("Facebook is broken today")
// and — critically — names platforms that report NO data as 'not-monitored', so
// a silently-blind platform is itself a visible signal. Pure; the dashboard +
// tests consume it.

/** Platforms FeelingWise runs on. Labels are "<platform>.<site>", e.g. "twitter.post-text". */
export const MONITORED_PLATFORMS = ['twitter', 'facebook', 'instagram', 'tiktok', 'youtube'] as const;
type MonitoredPlatform = typeof MONITORED_PLATFORMS[number];

type PlatformDriftStatus =
  | 'healthy' | 'drifting' | 'broken'
  /** Instrumented, but no query was recorded today — most often "not visited". */
  | 'not-monitored'
  /** No selector-health label exists anywhere in the code for this platform, so
   *  it could not report even while the user browses it. Split from
   *  'not-monitored' on 2026-08-18 (RECON F3a): Facebook printed "no visit
   *  observed today" on a day the user browsed it for hours, because nothing
   *  Facebook-side ever recorded a label. Silence from an uninstrumented
   *  surface is ignorance, and must not be rendered as a quiet day. */
  | 'not-instrumented'
  /**
   * A platform with ZERO selector-health counters today, whose only signal is
   * the extraction-canary's positive heartbeat (a post/comment actually
   * extracted). Split from 'healthy' on 2026-08-24: the dashboard rendered
   * this identically to a counter-backed 'healthy' verdict — same green dot,
   * same "OK" text, same "no DOM drift detected" summary line directly below
   * it — for Facebook / Instagram / TikTok on a day their selector-health
   * counters held nothing at all. Green must mean "watched and matched [by
   * selector counters]"; a platform whose only evidence is the canary is
   * watched-and-extracting but has no selector-level drift measurement, and
   * must say so, not borrow the counter-backed verdict's color and copy.
   */
  | 'confirmed-by-canary';

/**
 * Platforms with at least one selector-health label registered in the code.
 * Hand-maintained, and kept honest by `selector-health-instrumentation.test.ts`,
 * which scans `src/` for label literals and fails if this list drifts from what
 * the code actually records.
 */
/**
 * A RESERVED KEY SHAPE, written down 2026-09-19 because it was not.
 *
 * A string literal of the form '<platform>.<site>' means a selector-health
 * label and nothing else. `tests/unit/diagnostics/selector-health-instrumentation.test.ts`
 * discovers which platforms are instrumented by scanning src/ for exactly that
 * shape and comparing it with the list below, so any other counter that borrows
 * the shape is read as instrumentation that does not exist.
 *
 * It was borrowed the same day, by four short-drop counters added to the
 * platform adapters. Three of them named platforms already on this list and
 * changed nothing visible; the fourth named Instagram, which is not on it, and
 * the guard failed. Three silent, one loud, from one mistake: the useful half
 * of that is how close the other three came to going unnoticed.
 *
 * Counters that are not selector-health labels take a prefix of their own
 * ('shortDrop.instagram.comment'), which cannot collide because it does not
 * begin with a platform name.
 */
export const INSTRUMENTED_PLATFORMS = ['twitter', 'facebook', 'tiktok', 'youtube'] as const;

export interface PlatformDrift {
  platform: MonitoredPlatform;
  status: PlatformDriftStatus;
  /** Total selector queries recorded for this platform today. */
  total: number;
  missPct: number;
  fallbackPct: number;
  /** Number of distinct query sites seen for this platform. */
  siteCount: number;
}

/** Drift thresholds. `broken` = at least half the platform's queries missed. */
const DRIFT_BROKEN_MISS_PCT = 50;
const DRIFT_FALLBACK_PCT = 20; // matches the dashboard's existing per-site flag
/**
 * Fewest observations a selector needs before a miss RATE means anything.
 * A selector that ran once and missed once is "100% miss" and no evidence at
 * all — the reading the owner's 2026-08-20 dump produced for
 * `facebook.count-chips` (primary 0, miss 1) while every other Facebook signal
 * was healthy. Five is deliberately low: a genuinely rotated selector racks up
 * misses on any real browsing (X logged 7,916 hits the same day), so the floor
 * costs at most a few observations of detection delay and buys immunity from
 * single-sample noise. Mirrors IDENTITY_MIN_DENOM in record-identity-health.
 */
export const SELECTOR_MIN_DENOM = 5;

/**
 * Roll the per-site selector-health counters up to a per-platform verdict.
 * Pure. Always returns an entry for every monitored platform. A platform with no
 * recorded queries reports 'not-monitored' when it HAS instrumentation (so the
 * silence probably means "not visited"), and 'not-instrumented' when it has none
 * (so the silence means FeelingWise could not have seen it either way). Both are
 * blind spots; only the second is a blind spot FeelingWise built itself.
 */
export function assessPlatformDrift(snapshot: SelectorHealthSnapshot): PlatformDrift[] {
  const agg = new Map<string, { primary: number; fb: number; miss: number; sites: Set<string> }>();
  for (const c of Object.values(snapshot.counters)) {
    const platform = c.label.split('.')[0];
    let a = agg.get(platform);
    if (!a) { a = { primary: 0, fb: 0, miss: 0, sites: new Set() }; agg.set(platform, a); }
    a.primary += c.primary;
    a.fb += c.fallback1 + c.fallback2 + c.fallbackDeep;
    a.miss += c.miss;
    a.sites.add(c.label);
  }
  return MONITORED_PLATFORMS.map((platform): PlatformDrift => {
    const a = agg.get(platform);
    const total = a ? a.primary + a.fb + a.miss : 0;
    if (!a || total === 0) {
      const status: PlatformDriftStatus =
        (INSTRUMENTED_PLATFORMS as readonly string[]).includes(platform)
          ? 'not-monitored'
          : 'not-instrumented';
      return { platform, status, total: 0, missPct: 0, fallbackPct: 0, siteCount: 0 };
    }
    const missPct = Math.round((a.miss / total) * 100);
    const fallbackPct = Math.round((a.fb / total) * 100);
    // The same thin-denominator guard the dashboard applies per selector: only
    // escalate to the red 'broken' verdict once the rate rests on real
    // observations. Below the floor a miss still shows as 'drifting' (amber) —
    // visible, but not asserting a break off one sample. RESIDUAL, logged not
    // hidden: 'drifting' off n=1 is still thinner evidence than the word
    // implies; a distinct 'too-few-to-rate' status would need a new enum
    // member across the UI and is not taken on in this sitting.
    const status: PlatformDriftStatus =
      missPct >= DRIFT_BROKEN_MISS_PCT && total >= SELECTOR_MIN_DENOM ? 'broken'
      : a.miss > 0 || fallbackPct >= DRIFT_FALLBACK_PCT ? 'drifting'
      : 'healthy';
    return { platform, status, total, missPct, fallbackPct, siteCount: a.sites.size };
  });
}

/**
 * Overlay BOTH canary signals (warnings AND positive success heartbeats) onto
 * the per-platform drift list — newest signal wins. Escalates to 'broken' on a
 * fresh warning and clears a stale cold-start warning once a platform warms up.
 *
 *  • A platform extracting more recently than any warning is lifted out of a
 *    pessimistic verdict — but NOT always to 'healthy'. 'broken' always came
 *    from real selector counters (assessPlatformDrift only returns 'broken'
 *    when total > 0), so a fresher success there is a genuine recovery on an
 *    already-instrumented platform: 'healthy' is earned. 'not-monitored' and
 *    'not-instrumented' mean zero selector counters exist at all — the canary
 *    is real evidence the platform IS extracting, but it is not the same
 *    instrument as a selector-counter-backed 'healthy', so it becomes
 *    'confirmed-by-canary' instead: visibly different from, not a copy of,
 *    the green "OK" that selector counters earn. Split 2026-08-24: the
 *    dashboard had been rendering Facebook / Instagram / TikTok with the
 *    exact same green dot and "OK" text as X on a day their selector-health
 *    counters held nothing at all, directly beneath a summary line about "no
 *    DOM drift detected" that could not possibly cover platforms it had no
 *    counters for.
 *  • A warning newer than the last success → 'broken'.
 *  • No canary signal at all → trust the selector-health verdict unchanged.
 *
 * Pure. A finer selector-health verdict ('drifting') is preserved when the
 * canary only says 'healthy'.
 */
export function overlayCanary(drift: PlatformDrift[], snap: ExtractionCanarySnapshot): PlatformDrift[] {
  return drift.map((d): PlatformDrift => {
    const warn = snap.warnings?.[d.platform];
    const succ = snap.successes?.[d.platform];
    const warnAt = warn ? Date.parse(warn.at) : Number.NEGATIVE_INFINITY;
    const succAt = succ ? Date.parse(succ.at) : Number.NEGATIVE_INFINITY;
    if (warnAt === Number.NEGATIVE_INFINITY && succAt === Number.NEGATIVE_INFINITY) {
      return d; // no canary signal — selector-health verdict stands
    }
    if (warnAt > succAt) {
      return { ...d, status: 'broken' };
    }
    if (d.status === 'broken') {
      // Real selector counters existed (total > 0) and are now recovering,
      // confirmed by a fresher canary success — a genuine 'healthy'.
      return { ...d, status: 'healthy' };
    }
    if (d.status === 'not-monitored' || d.status === 'not-instrumented') {
      // Zero selector counters. The canary is real positive evidence, but a
      // different, weaker instrument than a counter-backed match — never the
      // same verdict as 'healthy'.
      return { ...d, status: 'confirmed-by-canary' };
    }
    return d;
  });
}

/** Test-only: clears in-memory counters + cancels pending flush. */
export function _resetSelectorHealthForTesting(): void {
  counters.clear();
  flushScheduled = false;
  // The pagehide binding is one-way in production: one page, one listener. A
  // test file reuses one jsdom window across its cases, so clearing the flag
  // without removing the listener leaves the old one attached and the next
  // case flushes twice. A real unbind, found by the test that asserts one
  // pagehide writes once.
  if (pageDeathBound && typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener('pagehide', onPageDeath);
  }
  pageDeathBound = false;
}

/** Test-only: returns a snapshot of in-memory counters. */
export function _peekSelectorHealthForTesting(): Record<string, SelectorHealthCounter> {
  const out: Record<string, SelectorHealthCounter> = {};
  for (const [k, v] of counters) out[k] = { ...v };
  return out;
}
