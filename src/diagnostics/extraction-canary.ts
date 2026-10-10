// FeelingWise — extraction-rate canary.
//
// Catches DOM-rotation drift at the per-platform adapter level. When a
// platform's `extractPosts` returns 0 across many consecutive DOM-mutation
// batches AND mutations were actually present (so the page is alive but
// the adapter isn't matching anything), emit a single `console.warn`
// pointing at the likely-stale selector file. Operational signal — visible
// without the debug flag.
//
// Two signals fire once each per platform per session:
//
//   • COLD-START — the adapter has NEVER extracted a post this session and
//     has now processed N (default 30) zero-result batches with mutations.
//     Catches the "selector dictionary doesn't match this platform's
//     current DOM" case (TikTok 2026-05 lost data-e2e; IG permalink lost
//     `<article>`).
//
//   • REGRESSION — the adapter WAS extracting (≥1 non-zero call this
//     session) and has now stayed at 0 for M (default 20) consecutive
//     batches. Catches the "selector worked at page load but the platform
//     rotated mid-session" case — rarer but happens on long-lived tabs.
//
// One warning per platform per content-script lifetime. The flag clears
// when the script reloads (extension reload, navigation triggering
// reinjection). Per-platform: TT-rot doesn't suppress an X warning.

// Both thresholds and time gates are deliberately set well above routine
// SPA DOM churn. The canary's design assumes "MO batch with content UI
// present + 0 extractions = signal" — but on SPAs (X/TT/IG/FB) the MO
// fires continuously for reasons unrelated to content extraction (video
// player ticks, virtualizer remounts, sidebar updates, ad slots). With
// the count thresholds set to 30/20 + time gates of 15s/30s, idle dwell
// on a single TT video or IG home over a minute would still trip the
// canary as a false-positive. Bumped 2026-05-22 after live verification
// on a public test page showed cold-start + regression fires under those
// gentler bounds. The real signal — selectors broken for 1-2 minutes
// of active mutations — still fires at the larger thresholds.
const COLD_START_THRESHOLD = 100;
const REGRESSION_THRESHOLD = 80;
const COLD_START_TIME_GATE_MS = 60_000;
const REGRESSION_TIME_GATE_MS = 120_000;

interface CanaryState {
  totalCalls: number;
  zerosSinceNonZero: number;
  nonZeroEverSeen: boolean;
  warned: boolean;
  firstCallAt: number | null;
  lastNonZeroAt: number | null;
  /** The UTC day the last success was saved under; the dashboard reads only today's key. */
  successSavedDay: string | null;
}

const stateByPlatform = new Map<string, CanaryState>();

function getOrInit(platform: string): CanaryState {
  let s = stateByPlatform.get(platform);
  if (!s) {
    s = {
      totalCalls: 0,
      zerosSinceNonZero: 0,
      nonZeroEverSeen: false,
      warned: false,
      firstCallAt: null,
      lastNonZeroAt: null,
      successSavedDay: null,
    };
    stateByPlatform.set(platform, s);
  }
  return s;
}

/**
 * Record one `extractPosts` invocation outcome. Call from the content-script
 * interceptor right after the adapter returns.
 *
 * `mutationCount` is the NodeList size passed to extractPosts — zero
 * mutations mean "nothing to extract anyway".
 *
 * `contentUiPresent` is the discerning signal: true when the platform's
 * comment / post UI is actually rendered (comment panel open on TikTok,
 * `<article>` ancestors visible on FB home feed, etc.). The canary counts
 * a batch as a "real" zero-extract ONLY when the content UI is present
 * AND we still get zero. Without this gate the canary would false-alarm
 * on closed-comment-panel scrolls where 0 posts is the correct outcome.
 *
 * `rawCandidateCount`, when provided, is how many elements the adapter's own
 * post selector matches in the DOM right now — BEFORE the already-seen dedup.
 * It distinguishes the two reasons `postsLength` is 0: (a) the selector
 * matches nothing → real DOM-rotation drift (count it); (b) the selector
 * matches tweets/comments but they were all already stamped this session →
 * normal idle/dwell, NOT drift (skip it). Without this discriminator the
 * canary false-fires REGRESSION when a user simply dwells on a feed of
 * already-processed content while the SPA churns the DOM (autoplay, trends,
 * virtualizer) — observed on x.com/home 2026-05-30 (8 tweets matched, all
 * stamped, yet 80+ zero batches accrued). Omitted (undefined) preserves the
 * pre-discriminator behavior for callers that can't cheaply count candidates.
 */
export function recordExtractionResult(
  platform: string,
  postsLength: number,
  mutationCount: number,
  contentUiPresent: boolean = true,
  rawCandidateCount?: number,
): void {
  const state = getOrInit(platform);
  state.totalCalls++;
  const now = Date.now();
  if (state.firstCallAt === null) state.firstCallAt = now;

  if (postsLength > 0) {
    const firstSuccess = !state.nonZeroEverSeen;
    state.zerosSinceNonZero = 0;
    state.nonZeroEverSeen = true;
    state.lastNonZeroAt = now;
    // Positive heartbeat. Records that this platform IS extracting today —
    // drives an "OK" status for platforms without selector-health labels
    // (Facebook / Instagram / TikTok) AND clears a stale cold-start warning
    // once extraction actually starts (so X stops showing "looks broken" when
    // it has thousands of successful hits). Persisted once per UTC day per tab,
    // or when a prior warning needs clearing, to keep storage churn low. Once
    // per tab was not enough: a tab opened before midnight UTC spent its one
    // write on the old day's key, and the new day read "no visit" while it
    // went on extracting.
    const today = canaryTodayKey();
    if (firstSuccess || state.warned || state.successSavedDay !== today) {
      state.warned = false;
      state.successSavedDay = today;
      void persistCanarySuccess(platform);
    }
    return;
  }

  if (mutationCount === 0) return;

  // Only count toward the canary when the platform's content UI is
  // actually present. A TikTok video page with the comment panel closed
  // produces many mutation batches (ads, carousel, virtualizer churn)
  // but no comments — that's correct, not a regression.
  if (!contentUiPresent) return;

  // Selector still matches elements → the zero is "all already stamped"
  // (normal idle/dwell), not "selectors broke". Only a zero where the
  // adapter's own selector finds NOTHING is a drift signal. Undefined =
  // caller didn't measure → fall through to the legacy postsLength gate.
  if (typeof rawCandidateCount === 'number' && rawCandidateCount > 0) return;

  state.zerosSinceNonZero++;
  if (state.warned) return;

  if (!state.nonZeroEverSeen && state.zerosSinceNonZero >= COLD_START_THRESHOLD) {
    // Time gate: don't declare cold-start until the page has had genuine
    // wall-clock time to warm up. SPA hydration on X / TikTok mounts
    // tweets/comments through dozens of React MO batches before the
    // adapter-targeted nodes actually exist; counting those toward the
    // threshold without a time gate produces a guaranteed false-positive
    // on every page load.
    if (now - state.firstCallAt < COLD_START_TIME_GATE_MS) return;
    state.warned = true;
    void persistCanaryWarning(platform, 'cold-start');
    console.warn(
      `[FeelingWise] extraction-canary ${platform}: ${COLD_START_THRESHOLD}+ DOM ` +
        `mutation batches processed with comment UI visible, 0 posts extracted. ` +
        `Adapter selectors may be stale — check src/content/platforms/${platform}.ts ` +
        `against the current DOM.`,
    );
    return;
  }

  if (state.nonZeroEverSeen && state.zerosSinceNonZero >= REGRESSION_THRESHOLD) {
    // Time gate: don't declare regression unless the silence has actually
    // persisted. FB / IG virtualizers unmount + remount comment regions
    // during scroll, producing many MO batches in quick succession where
    // the adapter correctly returns 0 (the new mounts are already-stamped
    // re-emissions). Real regression means selectors stopped matching for
    // a sustained period, not for a 200ms scroll-churn window.
    if (state.lastNonZeroAt === null || now - state.lastNonZeroAt < REGRESSION_TIME_GATE_MS) return;
    state.warned = true;
    void persistCanaryWarning(platform, 'regression');
    console.warn(
      `[FeelingWise] extraction-canary ${platform}: extraction was working but has ` +
        `dropped to 0 for ${REGRESSION_THRESHOLD}+ consecutive batches. Platform DOM ` +
        `may have rotated mid-session — reload the tab and check console for re-canary.`,
    );
  }
}

// ─── Persistence + dashboard surface (2026-06-05) ──────────────────────────
//
// The canary detects per-platform drift for ALL platforms but its only output
// was a console.warn buried in the extension error log — invisible to the
// operator. Persist a warning to chrome.storage.local so the dashboard's
// per-platform extraction-health rollup can show "Facebook: extraction stalled"
// instead of nothing. Best-effort, dated, mirrors selector-health.

const CANARY_STORAGE_KEY = 'fw_extraction_canary';

type CanaryKind = 'cold-start' | 'regression';

export interface ExtractionCanarySnapshot {
  date: string;
  /**
   * WHY the warnings map is empty, when it is.
   *
   * One empty snapshot used to stand for four different facts — no warnings
   * today, storage unreadable, no storage at all, and a stored snapshot from a
   * previous UTC day — and the heartbeat turned every one of them into the
   * signed claim "canary clear". A recorder blind on a platform since 22:05
   * kept signing "canary clear" from 00:00 UTC onward, because the day key had
   * rolled and `recordExtractionResult` does not re-persist once it has warned.
   * For a reader in California that midnight is 17:00, mid-session.
   *
   * 'clear' is the only value that earns the words "canary clear". Absent on a
   * snapshot read back from storage that predates this field, which the reader
   * treats as 'clear' because that is what such a snapshot meant when written.
   */
  status?: 'clear' | 'warned' | 'unreadable' | 'stale';
  /** platform → the drift warning recorded today. */
  warnings: Record<string, { kind: CanaryKind; at: string }>;
  /** platform → last confirmed successful extraction today (positive heartbeat). */
  successes?: Record<string, { at: string }>;
}

function canaryTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Best-effort: record a fired canary warning so the dashboard can show it. */
async function persistCanaryWarning(platform: string, kind: CanaryKind): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  try {
    const existing = await chrome.storage.local.get([CANARY_STORAGE_KEY]);
    const raw = existing[CANARY_STORAGE_KEY] as ExtractionCanarySnapshot | undefined;
    const today = canaryTodayKey();
    const snap: ExtractionCanarySnapshot =
      raw && raw.date === today ? raw : { date: today, warnings: {} };
    snap.warnings[platform] = { kind, at: new Date().toISOString() };
    await chrome.storage.local.set({ [CANARY_STORAGE_KEY]: snap });
  } catch {
    // Silent — the in-memory warn already fired; persistence is a best-effort surface.
  }
}

/**
 * Best-effort: record a confirmed successful extraction (positive heartbeat) and
 * clear any stale breakage warning for this platform — a live extraction proves
 * the adapter works regardless of an earlier cold-start blip.
 */
async function persistCanarySuccess(platform: string): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  try {
    const existing = await chrome.storage.local.get([CANARY_STORAGE_KEY]);
    const raw = existing[CANARY_STORAGE_KEY] as ExtractionCanarySnapshot | undefined;
    const today = canaryTodayKey();
    const snap: ExtractionCanarySnapshot =
      raw && raw.date === today ? raw : { date: today, warnings: {} };
    if (!snap.successes) snap.successes = {};
    snap.successes[platform] = { at: new Date().toISOString() };
    delete snap.warnings[platform];
    await chrome.storage.local.set({ [CANARY_STORAGE_KEY]: snap });
  } catch {
    // Silent — the in-memory state already updated; persistence is best-effort.
  }
}

/** Best-effort read for the dashboard. Returns today's snapshot or an empty shell. */
export async function readExtractionCanary(): Promise<ExtractionCanarySnapshot> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
    return { date: canaryTodayKey(), warnings: {}, status: 'unreadable' };
  }
  try {
    const existing = await chrome.storage.local.get([CANARY_STORAGE_KEY]);
    const raw = existing[CANARY_STORAGE_KEY] as ExtractionCanarySnapshot | undefined;
    if (raw && raw.date === canaryTodayKey()) {
      return { ...raw, status: Object.keys(raw.warnings ?? {}).length > 0 ? 'warned' : 'clear' };
    }
    // A snapshot from a previous UTC day says nothing about today, and a
    // missing one says nothing either: neither is evidence the recorder is
    // seeing anything. 'stale' is the honest word for both, because a warned
    // adapter is not re-persisted after it has warned once, so yesterday's
    // silence can hide a platform that is still broken right now.
    return { date: canaryTodayKey(), warnings: {}, status: 'stale' };
  } catch {
    return { date: canaryTodayKey(), warnings: {}, status: 'unreadable' };
  }
}

export function _resetExtractionCanaryForTesting(): void {
  stateByPlatform.clear();
}

export const __CANARY_THRESHOLDS = {
  COLD_START_THRESHOLD,
  REGRESSION_THRESHOLD,
  COLD_START_TIME_GATE_MS,
  REGRESSION_TIME_GATE_MS,
} as const;
