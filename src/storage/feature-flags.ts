// FeelingWise — Feature flags (developer-facing switches)
//
// Why separate from settings.ts:
//   • FWSettings contains keys the user sees / toggles in the popup.
//     Feature flags are developer-facing switches used for gradual
//     rollout and mid-flight rollback. Mixing them invites accidental UI
//     exposure.
//   • Flag keys prefixed with `ff_` in chrome.storage to avoid any future
//     collision with FWSettings keys.
//
// Granularity: per-stage-capability rather than single big-bang booleans.
// Per-stage flags can be added incrementally. Rollback = flip the
// relevant flag; forward-compat is preserved because FWSettings isn't
// touched.

// ─────────────────────────────────────────────────────────────────────────────
// FLAG DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface FeatureFlags {
  /**
   * Capture per-stage v2 pipeline timings to
   * `feelingwise-pipeline-v2-metrics` IndexedDB store.
   *
   * Default: false. When false, the perf-trace module returns a no-op
   * tracer (`src/core/perf-trace.ts` `NOOP_TRACER`) — zero allocations on
   * the hot path. Flip via `setFeatureFlag('captureV2Metrics', true)` in
   * the dev console for an investigation session, then read the store
   * via `readRecords()` and aggregate.
   *
   * Why a flag rather than always-on: instrumentation is diagnostic, not
   * forensic. Users get no value from the records and we save ~5-10
   * `performance.now()` calls + an IDB write per processed post when off.
   */
  captureV2Metrics: boolean;

  /**
   * BEHAVIORAL capture hook gate. Companion to `capturePromptIO`. When
   * true, `src/content/queue.ts` writes (eventKind, postId, ts, ageMs,
   * state-at-event, kind, isDegenerate) tuples to
   * `feelingwise-behavior-capture` IDB at dispatch / classified /
   * cancelled-* / evicted / failed events. Joined with the prompt-IO
   * capture by postId, the two streams produce a Failure A vs Failure B
   * disentangle.
   *
   * Default: false. Same reversibility as `capturePromptIO` — flipping
   * false disables; module-deletion + flag-row-removal + call-site
   * removals in queue.ts restores prior state.
   */
  captureBehavior: boolean;

  /**
   * Prompt-IO capture hook gate.
   *
   * When true, `combinedDetectAndNeutralize` writes (slice prose, system
   * prompt, user prompt, raw response) tuples to
   * `feelingwise-prompt-io-capture` IDB store on every `callAI`
   * invocation (both triage stage when twoStageCascade is on, and
   * classify stage).
   *
   * Strict production-shape measurement input. Enable flag, scroll
   * through real feeds, export records via `readAllCapturedTuples()`,
   * hand-label the tuples → builds the production-shape labeled corpus
   * → re-run cascade against the labeled corpus for strict precision
   * number.
   *
   * Default: false. Reversible: flipping false re-disables capture
   * (existing IDB store retained for analysis).
   *
   * Toggle from the dev console:
   *   chrome.storage.local.set({ 'ff_capturePromptIO': true });
   * Reload the extension to ensure the cache invalidates.
   */
  capturePromptIO: boolean;

  /**
   * Gates the batch-flagged rewrite path. When TRUE, `flushBatch` in
   * `src/content/index.ts` calls `neutralizeText()` for every comment
   * classified as manipulative by the BATCH and stamps the rewrite onto
   * FORENSIC_LOG.neutralizedText. When FALSE, the legacy behavior holds
   * (empty `neutralizedText`, dashboard "WHAT YOUR CHILD SAW INSTEAD"
   * panel renders empty).
   *
   * Default: TRUE. Flip via:
   *   chrome.storage.local.set({ 'ff_batchRewriteEnabled': false });
   * Reload the extension; behavior reverts to empty-string. No data
   * loss in the chain — the FORENSIC_LOG records still write, just
   * without rewrites.
   *
   * Why a flag rather than always-on: per VISION §7.1 reversibility —
   * if the per-comment 2nd-call cost spikes in production OR the
   * voice-preservation validator rejects too many outputs, we need a
   * one-line revert without a code deploy.
   */
  batchRewriteEnabled: boolean;

  /**
   * Verify-session diagnostic. When true, `flushBatch` (post-bucket
   * routing) requests a chain-shape snapshot from the service worker
   * via `GET_CHAIN_DEBUG_STATS` and logs the response to the page
   * console as `[FW debug] chain stats: {...}`. The orchestrator's
   * Chrome MCP `read_console_messages` reads these lines to confirm
   * forensic-chain shape during Tier 9 verify cadence — the chain at
   * the extension origin is otherwise opaque to page-context MCP.
   *
   * Default: false. Off in production. Flip per session via:
   *   chrome.storage.local.set({ 'ff_chainDebugStats': true });
   * Reload the extension to ensure the cache invalidates.
   *
   * Cost when off: zero (the gate short-circuits before message
   * dispatch). Cost when on: one extra SW round-trip per flush, ~1ms.
   */
  chainDebugStats: boolean;

  /**
   * YouTube /watch comment capture (docs/history/2026-08/YOUTUBE-E1-BRIEF.md). When true,
   * `src/content/yt-watch-comments.ts` arms ONE scoped, debounced
   * MutationObserver on `ytd-comments#comments` and feeds extracted
   * comments into the existing comment-batch pipeline as the video-room
   * model (video record + comments under `parentVideoId = yt-vid-<v>`,
   * zero chain-schema change). When false the module is fully inert:
   * no observer, no listeners, no DOM reads.
   *
   * Default: TRUE since 2026-08-02 — the memory A/B gate cleared
   * (scripts/verify/yt-watch-memory-ab.mjs, artifacts
   * .verify/artifacts/yt-ab-2026-08-01T20-46-47-125Z: 5-min arms on a
   * real /watch page, flag-on heap ≤ flag-off, no renderer crash,
   * capture engaged 200/200 threads). The 2026-05 /watch renderer-OOM
   * mitigations (shouldSkipNodeAccumulation, the /watch extraction
   * gates) stay in place regardless of this flag. Kill switch:
   *   chrome.storage.local.set({ 'ff_ytWatchComments': false });
   * Reload the extension (flag is read once at content-script init).
   */
  ytWatchComments: boolean;

  /**
   * YouTube Shorts record (`src/content/platforms/yt-shorts.ts`): the Short on screen written down
   * once, as a video record with its title and channel, read from the page and never the network.
   * When false the module attaches nothing: no timer, no listener, no DOM read.
   *
   * Default: false. The element names come from YouTube's own script and have not been watched on a
   * live Short, and a record with a real anchor is judged like any other, so this goes on only after
   * a live look with the sound off. Turn it on with:
   *   chrome.storage.local.set({ 'ff_ytShorts': true });
   * Reload the extension (the flag is read once at content-script init).
   */
  ytShorts: boolean;

  /**
   * Metrics-scope discriminating probe (BOARD 2026-08-01 evening-9 open
   * hypothesis: recheck metrics extracted identical counts across posts —
   * suspected background-tab lazy-render resolving the scoping container to
   * page chrome). When true, the twitter/tiktok metric extractors log
   * `[FW probe] metrics-scope` lines with the matched count element, its
   * text, and whether the post root actually contains it — one live recheck
   * run then discriminates wrong-container vs wrong-element.
   *
   * Default: false. Diagnostic only; zero logging when off. Flip per session:
   *   chrome.storage.local.set({ 'ff_metricsScopeProbe': true });
   * Reload the extension (armed once at content-script init).
   */
  metricsScopeProbe: boolean;

  /**
   * Instagram blank-post probe (known issue M95: posts blank or "cut off" during fast scrolling).
   * When true, on instagram.com, each pause in scrolling logs `[FW probe] ig-blank` with every post
   * container in view that FeelingWise left blank and the marks and switches around it: style
   * values, attribute names and short codes, never a post's words or an account name.
   *
   * Default: false. Diagnostic only; nothing is read or logged when off. Turn on per session:
   *   chrome.storage.local.set({ 'ff_igBlankProbe': true });
   * Reload the extension (armed once at content-script init).
   */
  igBlankProbe: boolean;
}

const FEATURE_FLAGS_DEFAULTS: FeatureFlags = {
  captureV2Metrics: false,
  capturePromptIO: false,
  captureBehavior: false,
  // Default TRUE so batch-flagged comments get their rewrite. Flip false
  // for the empty-string fallback.
  batchRewriteEnabled: true,
  // Default FALSE — diagnostic only, off in production.
  chainDebugStats: false,
  // Default TRUE — the memory A/B gate cleared 2026-08-02 (see the
  // interface doc above); explicit false remains the kill switch.
  ytWatchComments: true,
  // Default FALSE until a live look at a Short with the sound off.
  ytShorts: false,
  // Default FALSE — diagnostic only, off in production.
  metricsScopeProbe: false,
  // Default FALSE — diagnostic only, off in production.
  igBlankProbe: false,
};

const FLAG_KEYS: (keyof FeatureFlags)[] = [
  'captureV2Metrics',
  'capturePromptIO',
  'captureBehavior',
  'batchRewriteEnabled',
  'chainDebugStats',
  'ytWatchComments',
  'ytShorts',
  'metricsScopeProbe',
  'igBlankProbe',
];

// Namespace prefix for chrome.storage to avoid collisions with FWSettings.
const FF_PREFIX = 'ff_';

function storageKey(flag: keyof FeatureFlags): string {
  return `${FF_PREFIX}${flag}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE
// ─────────────────────────────────────────────────────────────────────────────
//
// Flags are read on every pipeline entry (hot path). A short-lived cache
// avoids N chrome.storage round-trips per page. Cache is invalidated on:
//   - write (setFeatureFlag clears _cache locally in its own realm)
//   - TTL expiry (5s — bounded staleness in any realm)
//   - chrome.storage.onChanged event (wired below)
//
// In any realm that has already populated _cache, a subsequent
// chrome.storage.local.set on a `ff_*` key from ANY realm causes the
// listener to fire and invalidate _cache, so the NEXT getFeatureFlags()
// read re-reads from storage.
//
// What this does NOT do:
//   - It does NOT speed up the FIRST read in a fresh content script. A
//     fresh content script's _cache is null on init; the first read
//     goes to storage directly with no cache to invalidate.
//   - It does NOT fix scenarios where the chrome.runtime.sendMessage
//     from content script to SW is dropped (SW eviction race), since
//     that's a different layer.

let _cache: FeatureFlags | null = null;
let _cacheTimestamp = 0;
const CACHE_TTL_MS = 5_000;

// Cross-realm cache invalidation listener. Wires once at module load.
// chrome.storage.onChanged fires in EVERY realm where the chrome API
// is available (content scripts, SW, popup, dashboard) when ANY realm
// writes to chrome.storage.local. Filter to FF_PREFIX-keyed changes to
// avoid invalidating on unrelated writes (settings, keypair,
// capture-eviction timestamps, etc.).
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const key of Object.keys(changes)) {
      if (key.startsWith(FF_PREFIX)) {
        _cache = null;
        _cacheTimestamp = 0;
        return;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

async function getFeatureFlags(): Promise<FeatureFlags> {
  const now = Date.now();
  if (_cache && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cache;
  }

  try {
    const keys = FLAG_KEYS.map(storageKey);
    const raw = await chrome.storage.local.get(keys);
    const flags: FeatureFlags = { ...FEATURE_FLAGS_DEFAULTS };
    for (const flag of FLAG_KEYS) {
      const value = raw[storageKey(flag)];
      if (typeof value === 'boolean') {
        flags[flag] = value;
      }
    }
    _cache = flags;
    _cacheTimestamp = now;
    return flags;
  } catch {
    // chrome.storage unavailable (test env, detached context) — use defaults.
    return { ...FEATURE_FLAGS_DEFAULTS };
  }
}

export async function isFeatureEnabled(flag: keyof FeatureFlags): Promise<boolean> {
  const flags = await getFeatureFlags();
  return flags[flag];
}

export async function setFeatureFlag<K extends keyof FeatureFlags>(
  flag: K,
  value: FeatureFlags[K],
): Promise<void> {
  await chrome.storage.local.set({ [storageKey(flag)]: value });
  // Invalidate cache so next read picks up the new value.
  _cache = null;
  _cacheTimestamp = 0;
}

/**
 * True when the flag has an explicit stored value (someone set it), false
 * when a read would fall back to its compiled default. Lets auto-enable
 * logic respect an explicit opt-out: "unset" can be flipped, "false" stays.
 */
export async function isFlagExplicitlySet(flag: keyof FeatureFlags): Promise<boolean> {
  try {
    const raw = await chrome.storage.local.get(storageKey(flag));
    return raw[storageKey(flag)] !== undefined;
  } catch {
    // Storage unreadable — claim "set" so callers never auto-flip blind.
    return true;
  }
}

/**
 * Test-only hook to reset cache. Not used by production code.
 */
export function __resetFeatureFlagsCacheForTests(): void {
  _cache = null;
  _cacheTimestamp = 0;
}
