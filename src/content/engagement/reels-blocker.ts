// FeelingWise — URL-gated reels / shorts blocker.
//
// Hides algorithmic short-form video surfaces (Instagram Reels, Facebook
// Reels, YouTube Shorts) at the page level. The decision is URL-based: when
// the current pathname matches a per-platform reel/short pattern, the
// platform's main page container is hidden via visibility:hidden +
// pointer-events:none, all <video>/<audio> elements inside it are paused +
// muted, and a BLOCKED_LOG forensic record is dispatched to the SW chain.
//
// Why URL-gate, not DOM-shape detection. Each platform routes its reels
// surface through a stable URL pattern (/reels/, /reel/, /shorts/) that
// pre-dates and outlives DOM rotations. URL-gate is also what users
// recognize as "the reels page" — bookmarks and shared links carry the
// same shape, so the blocker fires consistently on first paint regardless
// of DOM virtualizer state.
//
// Layout-preserving hide. visibility:hidden keeps the container's bounding
// box in layout so the platform's IntersectionObserver-driven auto-advance
// (TikTok-style player navigation, IG's swipe-up reel chain) doesn't see
// the container vanish and try to navigate around the hide. pointer-events
// is suppressed so taps fall through to nothing. Audio is silenced via
// pause()+muted on every media element inside the container, with a
// MutationObserver guarding against late-loaded media (the platform may
// inject the <video> element after first paint).
//
// Discipline:
//   - URL-gate first; DOM hide only fires on URL match. Cheap when off.
//   - Settings + feature toggle read once at start; runtime toggle is
//     handled by the engagement controller's storage listener.
//   - Forensic write uses the bounded high-stakes retry buffer; the SW handler
//     runs under the chain-write lock.
//   - No placeholder card. The blocked surface vanishes silently — same
//     pattern as ai-content-blocker.

import type { FWSettings } from '../../storage/settings';
import { isFeatureEnabled } from '../../storage/settings';
import { hideElement } from './mark-hidden';
import { registerHeapGauge } from '../../diagnostics/diagnostics';
import type { Platform } from '../../types/post';
import type { BlockedEventInput } from '../../types/logger-events';
import { recordBlocked } from './recorder-sink';
import { currentPageAddress } from '../record/post-url';
import { sharedSurfaceDetector, type SurfaceDescriptor } from '../post-path/surface-detector';
import { fwDebug } from '../fw-log';
import { ensureStyleTag, removeStyleTag } from './style-tag';
import { resolveUiLanguage } from '../../i18n';
import { COVER_STRINGS } from '../../i18n/cover-strings';

const BLOCKED_MARKER = 'data-fw-blocked';
const BLOCK_REASON_MARKER = 'data-fw-block-reason';
const BLOCKED_VALUE = 'reel-surface';
const STYLE_TAG_ID = 'fw-reels-blocker-css';

// ─── Per-platform extractors (consumer-specific selectors) ───────────────
//
// Caption / author selectors live here, keyed by platform, for forensic-
// context extraction at block time. The URL gate + container selectors are
// in the shared `SurfaceDescriptor` registrations below.

interface PlatformExtractors {
  /** Caption selector — best-effort, used only for forensic context. */
  caption?: string[];
  /** Author selector — best-effort, used only for forensic context. */
  author?: string[];
}

const PLATFORM_EXTRACTORS: Partial<Record<Platform, PlatformExtractors>> = {
  instagram: {
    caption: ['span[dir="auto"]', 'h1'],
    author: ['header a[role="link"]', 'a[href^="/"][role="link"]'],
  },
  facebook: {
    caption: ['[data-ad-preview="message"]', '[dir="auto"]'],
    author: ['h2 a[role="link"]', 'h3 a[role="link"]', 'strong a[role="link"]'],
  },
  youtube: {
    caption: ['#title yt-formatted-string', 'h2 yt-formatted-string'],
    author: ['ytd-channel-name a', '#channel-name a'],
  },
};

// ─── Shared SurfaceDescriptor registrations ───────────────────────────────
//
// One descriptor per platform — each carries the URL pathname pattern that
// gates the hide and the page-level container selectors that get hidden
// when the gate is open. The shared registry's `matchAndWalk` resolves URL
// + DOM in one call; `runOnce` consumes the result and applies the hide.

// Container selectors per surface — ORDERED. Surface-detector tries each
// and collects all matches; blockContainer is idempotent so multi-hits are
// safe. `body` is the ultimate fallback on EVERY platform: when the URL
// gate matches but the precise platform selectors are stale (DOM rotation,
// A/B experiment, layout variant), hiding `body` blacks out the whole page —
// the intended UX for a parent who toggled "block reels" ON. Per the FB
// descriptor's existing precedent (found 2026-05-10 ALPHA: `div[role="main"]`
// alone missed on FB /reel/<id>). Now applied uniformly to IG + YT after
// a 2026-05-24 report: "blocks nothing on any platform".
const REELS_BLOCKER_SURFACES: SurfaceDescriptor[] = [
  {
    id: 'reels-blocker:instagram:reels',
    platform: 'instagram',
    surfaceKind: 'reels',
    pathnamePattern: /^\/reels?\//,
    containerSelectors: [
      'main[role="main"]',
      '[role="main"]',
      'main',
      'body',
    ],
    dynamicContentRescan: true,
  },
  {
    id: 'reels-blocker:facebook:reels',
    platform: 'facebook',
    surfaceKind: 'reels',
    pathnamePattern: /^\/reels?\//,
    containerSelectors: [
      'div[role="main"]',
      '[role="main"]',
      'div[data-pagelet="root"]',
      '[data-pagelet*="Reel"]',
      '[data-pagelet*="VideoPlayer"]',
      'video',
      'body',
    ],
    dynamicContentRescan: true,
  },
  {
    id: 'reels-blocker:youtube:shorts',
    platform: 'youtube',
    surfaceKind: 'shorts',
    pathnamePattern: /^\/shorts\//,
    containerSelectors: [
      'ytd-shorts',
      'ytd-shorts-player-page-renderer',
      'ytd-reel-video-renderer',
      'ytd-page-manager',
      'ytd-app',
      'body',
    ],
    dynamicContentRescan: true,
  },
];

for (const desc of REELS_BLOCKER_SURFACES) {
  try {
    sharedSurfaceDetector.register(desc);
  } catch {
    // Already registered — see ai-content-blocker for rationale.
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// display:none removes the subtree from the rendering tree entirely.
// visibility:hidden was insufficient on YouTube /shorts/ because YT sets
// visibility:visible inline on its inner ytd-player — a descendant
// visibility:visible reverses ancestor visibility:hidden, leaving the
// video playing inside the otherwise-hidden ytd-shorts container. With
// display:none the descendant cannot reverse, since the element is not
// in the rendering tree at all.
const BLOCKED_CSS = `
    [${BLOCKED_MARKER}="${BLOCKED_VALUE}"] {
      display: none !important;
    }
  `;

// The page left after the block is empty, often plain black, and reads as a page that failed to load; one
// line says why. It hangs from the root element, because the block may hide the body itself.
const COVER_NOTE_ID = 'fw-reels-cover-note';
const COVER_NOTE_STYLE = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:2147483647;'
  + 'max-width:calc(100vw - 32px);box-sizing:border-box;padding:10px 16px;border-radius:8px;'
  + 'background:#202020;color:#e8e8e8;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'
  + 'text-align:center;pointer-events:none;';

function placeCoverNote(line: string): void {
  if (!line) return;
  let note = document.getElementById(COVER_NOTE_ID);
  if (!note) {
    note = document.createElement('div');
    note.id = COVER_NOTE_ID;
    note.setAttribute('role', 'status');
    note.setAttribute('style', COVER_NOTE_STYLE);
    document.documentElement.appendChild(note);
  }
  if (note.textContent !== line) note.textContent = line;
}

function removeCoverNote(): void {
  document.getElementById(COVER_NOTE_ID)?.remove();
}

function pickFirstText(root: HTMLElement, selectors: string[] | undefined): string {
  if (!selectors) return '';
  let longest = '';
  for (const sel of selectors) {
    root.querySelectorAll<HTMLElement>(sel).forEach(el => {
      const t = el.textContent?.trim() ?? '';
      if (t.length > longest.length) longest = t;
    });
    if (longest.length > 0) break;
  }
  return longest;
}

function pickAuthor(root: HTMLElement, selectors: string[] | undefined): string {
  if (!selectors) return 'unknown';
  for (const sel of selectors) {
    const el = root.querySelector<HTMLElement>(sel);
    const t = el?.textContent?.trim();
    if (t) return t.startsWith('@') ? t : `@${t.replace(/^@/, '')}`;
  }
  return 'unknown';
}

function muteAllMediaIn(container: HTMLElement): void {
  container.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => {
    try {
      media.muted = true;
      media.pause();
    } catch {
      // Transitional media state — ignore.
    }
  });
}

/**
 * Reverse of muteAllMediaIn — restore playback after the parent toggles
 * `block-reels` OFF. Unmutes every <video>/<audio> in the subtree and
 * resumes playback. `play()` may reject if the user hasn't gestured on
 * the page yet (browser autoplay policy); we swallow the rejection so
 * the cleanup still completes even when the platform's player isn't
 * ready to resume.
 */
function unmuteAllMediaIn(container: HTMLElement): void {
  container.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => {
    try {
      media.muted = false;
      const result = media.play();
      // play() returns a Promise on modern browsers; older / test envs
      // may return undefined. Guard the catch.
      if (result !== undefined && typeof result.catch === 'function') {
        result.catch(() => { /* autoplay-blocked is fine */ });
      }
    } catch {
      // Transitional media state — ignore.
    }
  });
}

/**
 * Per-container MutationObserver registry. Populated by blockContainer
 * so resetDOM can disconnect each observer at toggle-off time. Without
 * this, late-mounted media after toggle-off was being re-muted by stale
 * observers — reported 2026-05-26: YT /shorts/ video stayed paused +
 * muted even after toggling block-reels OFF.
 *
 * ENG-2 (2026-07-13 engagement-hider audit): resetDOM alone only disconnects
 * at FULL module teardown — never during an active block-reels session. If a
 * platform's SPA remounts the matched page-level container across
 * reel-to-reel navigation (every REELS_BLOCKER_SURFACES entry sets
 * dynamicContentRescan: true, implying this is expected), the old
 * container's observer used to stay alive, pinning the detached subtree —
 * the same growth pattern that drove the 2026-06-07 YouTube OOM in the
 * sibling ai-content-blocker (mediaObservers / sweepMediaObservers /
 * MAX_MEDIA_OBSERVERS). trackContainerMuteObserver below ports that fix.
 */
const containerMuteObservers = new Map<HTMLElement, MutationObserver>();
const MAX_CONTAINER_MUTE_OBSERVERS = 50;
registerHeapGauge('reels.containerMuteObservers', () => containerMuteObservers.size);

function trackContainerMuteObserver(container: HTMLElement, observer: MutationObserver): void {
  containerMuteObservers.set(container, observer);
  sweepContainerMuteObservers();
}

function sweepContainerMuteObservers(): void {
  // Drop observers whose container is no longer in the document — the
  // observer is useless once detached and only serves to pin the removed
  // subtree (mirrors ai-content-blocker's sweepMediaObservers).
  for (const [container, observer] of containerMuteObservers.entries()) {
    if (!container.isConnected) {
      try { observer.disconnect(); } catch { /* observer already gone */ }
      containerMuteObservers.delete(container);
    }
  }
  // Defense in depth: reel surfaces are page-level, so the live count should
  // stay small — but never keep more than the cap alive even if every
  // container is still (surprisingly) connected. Map iteration is
  // insertion-order, so the first entry is the oldest (LRU eviction).
  while (containerMuteObservers.size > MAX_CONTAINER_MUTE_OBSERVERS) {
    const oldestKey = containerMuteObservers.keys().next().value;
    if (!oldestKey) break;
    const oldestObserver = containerMuteObservers.get(oldestKey);
    try { oldestObserver?.disconnect(); } catch { /* observer already gone */ }
    containerMuteObservers.delete(oldestKey);
  }
}

function blockContainer(
  container: HTMLElement,
  extractors: PlatformExtractors,
  platform: Platform,
  mode: 'child' | 'teen' | 'adult',
  matchedToken: string,
): void {
  if (container.getAttribute(BLOCKED_MARKER) === BLOCKED_VALUE) return;

  // Capture context BEFORE the hide. visibility:hidden keeps the subtree
  // queryable, but any later DOM removal would lose the author/caption.
  const author = pickAuthor(container, extractors.author);
  const caption = pickFirstText(container, extractors.caption);
  const postUrl = currentPageAddress();

  // display:none on the inline style as defense-in-depth alongside the
  // injected stylesheet rule. Either path alone hides; both together harden
  // against per-platform inline-style overrides that a future DOM rotation
  // might introduce. Through the door since 2026-09-20: this file had no
  // private-conversation check of any kind, and a reel shared into a DM is an
  // ordinary thing to share.
  if (!hideElement(container, {
    marker: BLOCKED_MARKER, value: BLOCKED_VALUE,
    reason: `reel-surface:${matchedToken}`,
    feature: 'block-reels',
  })) return;
  muteAllMediaIn(container);

  // Late-loaded media guard. The reel player may inject its <video> after
  // the initial query (SPA hydration / lazy-mount). One observer per blocked
  // container; bounded by the small number of concurrent reel surfaces.
  // Tracked in containerMuteObservers so resetDOM can disconnect at toggle-off.
  const mediaObserver = new MutationObserver(() => muteAllMediaIn(container));
  mediaObserver.observe(container, { childList: true, subtree: true });
  // Sweeps detached entries + hard-caps the live count (ENG-2, 2026-07-13
  // engagement-hider audit) — same leak class + fix shape as
  // ai-content-blocker's trackMediaObserver.
  trackContainerMuteObserver(container, mediaObserver);

  // Pre-empt the platform adapter so the comment / classification pipeline
  // doesn't spend tokens on a surface the parent has already blocked.
  container.dataset.fwProcessed = 'true';

  ensureStyleTag(STYLE_TAG_ID, BLOCKED_CSS);

  const payload: BlockedEventInput = {
    platform,
    mode,
    author,
    postUrl,
    blockReason: 'reel-surface',
    matchedToken,
    caption,
    kind: 'video',
  };
  recordBlocked(payload);
}

// Diagnostic state. Logs on transitions only (gate off→on, on→off) so the
// 2s polling tick doesn't spam the console. Exposed for tests via the reset
// helper at the bottom of the module.
const _gateState: { last: Map<Platform, 'on' | 'off' | null> } = { last: new Map() };

function runOnce(
  extractors: PlatformExtractors,
  platform: Platform,
  mode: 'child' | 'teen' | 'adult',
  coverLine = '',
): void {
  const pathname = typeof location !== 'undefined' ? location.pathname : '';
  // `sharedSurfaceDetector.matchAndWalk` is a GLOBAL registry shared across
  // ai-content-blocker, reels-blocker, etc. It returns descriptors from every
  // consumer that matches the platform + URL. ai-content-blocker registers
  // some YouTube descriptors with `pathnamePattern: null` (match-any), so on
  // any YouTube URL those descriptors sit ahead of the reels-blocker entry
  // in the returned array. Before this filter, runOnce read `[0].descriptor
  // .pathnamePattern?.source ?? null` which evaluated to `null` for those
  // match-any entries — the function then returned early and never reached
  // blockContainer. Filtering to this module's own descriptors restores the
  // intended behavior: reels-blocker acts only on reels-blocker descriptors.
  // V1.5 candidate: extend SurfaceDetector with consumer-scoped queries so
  // this filter isn't needed at the call site.
  const surfaceMatches = sharedSurfaceDetector
    .matchAndWalk(platform, pathname)
    .filter(m => m.descriptor.id.startsWith('reels-blocker:'));
  const matched = surfaceMatches.length > 0 ? surfaceMatches[0].descriptor.pathnamePattern?.source ?? null : null;

  const newState: 'on' | 'off' = matched ? 'on' : 'off';
  if (_gateState.last.get(platform) !== newState) {
    _gateState.last.set(platform, newState);
    if (matched) {
      fwDebug(`[FW reels-blocker] url-gate ON platform=${platform} path=${location.pathname} pattern=${matched}`);
    } else {
      fwDebug(`[FW reels-blocker] url-gate off platform=${platform} path=${location.pathname}`);
    }
  }
  if (!matched) {
    // URL gate OFF: reverse any block left over from a reels route. IG's SPA
    // reuses the SAME `main` element across routes, so a block applied on
    // /reels/ used to survive navigation back to the feed — the whole feed
    // stayed display:none until the toggle flipped or the page reloaded
    // (intermittent "everything disappeared" reports). Cheap when nothing is
    // blocked: one querySelector miss.
    if (document.querySelector(`[${BLOCKED_MARKER}="${BLOCKED_VALUE}"]`)) {
      unblockAllContainers();
      fwDebug(`[FW reels-blocker] left reel surface — unblocked platform=${platform} path=${pathname}`);
    }
    return;
  }

  let blockedThisRun = 0;
  let totalContainersFound = 0;
  const allSelectors: string[] = [];
  for (const surfaceMatch of surfaceMatches) {
    allSelectors.push(...surfaceMatch.descriptor.containerSelectors);
    totalContainersFound += surfaceMatch.containers.length;
    for (const containerNode of surfaceMatch.containers) {
      const container = containerNode as HTMLElement;
      const wasBlocked = container.getAttribute(BLOCKED_MARKER) === BLOCKED_VALUE;
      blockContainer(container, extractors, platform, mode, matched);
      if (!wasBlocked) blockedThisRun++;
    }
  }
  if (totalContainersFound > 0) placeCoverNote(coverLine);
  if (blockedThisRun > 0) {
    fwDebug(`[FW reels-blocker] hidden N=${blockedThisRun} platform=${platform} selectors=${allSelectors.join('|')}`);
  }
  // Diagnostic: URL gate matched but ZERO containers found across all
  // selectors. This is the actionable "selectors are stale" signal — every
  // other no-op (gate off, already-blocked) is silent. Fires once per URL
  // transition (state-tracking above limits log flood) when selectors miss
  // entirely. With `body` in every descriptor as the ultimate fallback,
  // this warning should now only fire if `document.body` itself is
  // unavailable (effectively never) — but the warning stays as a safety
  // net for future failure modes.
  if (totalContainersFound === 0) {
    console.warn(
      `[FW reels-blocker] URL gate matched but no containers found platform=${platform} ` +
      `path=${pathname} selectors=${allSelectors.join('|')} — DOM may have rotated; ` +
      `update containerSelectors in reels-blocker.ts:REELS_BLOCKER_SURFACES`,
    );
  }
  // Subsequent ticks that find already-marked containers are silent —
  // logging on every 2 s polling pass would flood the console with no new
  // information.
}

/**
 * Reverse every active block: disconnect mute observers, unmute media,
 * strip the markers and the inline display:none. Used both by full teardown
 * (resetDOM) and by the URL-gate-off path in runOnce, where the SPA carried
 * a blocked page-level container onto a non-reel route.
 */
function unblockAllContainers(): void {
  // Disconnect every per-container mute observer and unmute / resume media
  // BEFORE removing the BLOCKED_MARKER attribute. Order matters: with the
  // observer still alive, any mutation triggered by play() / unmute could
  // re-fire muteAllMediaIn and re-mute the freshly resumed media.
  for (const [container, observer] of containerMuteObservers.entries()) {
    try { observer.disconnect(); } catch { /* observer already gone */ }
    unmuteAllMediaIn(container);
  }
  containerMuteObservers.clear();
  removeCoverNote();

  document.querySelectorAll<HTMLElement>(`[${BLOCKED_MARKER}="${BLOCKED_VALUE}"]`).forEach(el => {
    el.removeAttribute(BLOCKED_MARKER);
    el.removeAttribute(BLOCK_REASON_MARKER);
    el.style.removeProperty('display');
    // Reels containers are PAGE-LEVEL (main / ytd-app / body) and the SPA
    // reuses them across every route, so the per-post rationale for keeping
    // fwProcessed ("don't re-extract a resolved post") does not apply here:
    // leaving it set permanently short-circuited every downstream consumer
    // that dedups on fwProcessed at or above the page node for the rest of
    // the tab's life after ONE reels visit.
    delete el.dataset.fwProcessed;
    // Belt-and-suspenders: also unmute media in case the container was
    // marker-tagged but never made it into the observer Map (defensive on
    // SPA edge cases where the marker write raced the observer attach).
    unmuteAllMediaIn(el);
  });
}

function resetDOM(): void {
  unblockAllContainers();
  removeStyleTag(STYLE_TAG_ID);
}

// ─── Public API ────────────────────────────────────────────────────────────

export function startReelsBlocker(
  platform: Platform,
  settings: FWSettings,
): () => void {
  if (!isFeatureEnabled(settings, 'block-reels', platform)) {
    fwDebug(`[FW reels-blocker] disabled platform=${platform} (feature toggle off)`);
    return () => {};
  }
  const extractors = PLATFORM_EXTRACTORS[platform];
  if (!extractors) {
    fwDebug(`[FW reels-blocker] no extractors platform=${platform}`);
    return () => {};
  }
  // Pull container selectors back from the shared registry purely for the
  // init log; the runtime walk reads through `matchAndWalk` and never reads
  // the registry directly.
  const initSelectors = sharedSurfaceDetector
    .list()
    .filter(d => d.id.startsWith(`reels-blocker:${platform}:`))
    .flatMap(d => d.containerSelectors);
  fwDebug(`[FW reels-blocker] init platform=${platform} containers=${initSelectors.join('|')}`);

  const coverLine = COVER_STRINGS[resolveUiLanguage(settings.uiLanguage)]
    .shortVideos(platform === 'youtube' ? 'Shorts' : 'Reels');
  runOnce(extractors, platform, settings.mode, coverLine);

  // MutationObserver catches DOM hydration drift on first paint. Cheap when
  // the URL gate is off — runOnce returns early on non-reel pathnames.
  //
  // PERF-4 (M79#3, 2026-07-13 perf audit): this was previously the one
  // MutationObserver in the audited engagement set with ZERO rate-limiting —
  // every mutation batch on document.body called runOnce directly, unlike
  // its section-model/structural-finder siblings which coalesce bursts to
  // one scan per ~250ms. On a reel/shorts surface where the platform's own
  // player churns the DOM at high frequency (video swap, buffering state,
  // caption updates), that meant an unbounded per-mutation selector-query
  // cost. Port the sibling scheduleScan()+setTimeout(runScan, intervalMs)
  // coalescing pattern (section-model.ts / structural-finder.ts) verbatim.
  const REELS_SCAN_THROTTLE_MS = 250;
  let scanPending = false;
  let scanTeardown = false;

  const runScan = () => {
    scanPending = false;
    if (scanTeardown) return;
    try {
      runOnce(extractors, platform, settings.mode, coverLine);
    } catch (err) {
      console.warn('[FW reels-blocker] scan threw:', err);
    }
  };

  const scheduleScan = () => {
    if (scanPending) return;
    scanPending = true;
    setTimeout(runScan, REELS_SCAN_THROTTLE_MS);
  };

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA navigation hook. pushState / replaceState don't fire popstate so
  // pure URL-change-without-reload (the standard reel-to-reel swipe pattern)
  // wouldn't trigger MO. The 2s polling tick re-evaluates the URL gate +
  // re-fires the hide on any newly-mounted main container. Same fallback
  // shape as ai-content-blocker.
  const onPopState = () => runOnce(extractors, platform, settings.mode, coverLine);
  window.addEventListener('popstate', onPopState);
  const interval = setInterval(() => runOnce(extractors, platform, settings.mode, coverLine), 2000);

  return () => {
    scanTeardown = true;
    observer.disconnect();
    window.removeEventListener('popstate', onPopState);
    clearInterval(interval);
    resetDOM();
  };
}

// Exports for the engagement controller's master DOM-reset path.
export const REELS_BLOCKER_STYLE_TAG_ID = STYLE_TAG_ID;
export const REELS_BLOCKED_MARKER = BLOCKED_MARKER;
export const REELS_BLOCK_REASON_MARKER = BLOCK_REASON_MARKER;
export const REELS_BLOCKED_VALUE = BLOCKED_VALUE;
export const REELS_COVER_NOTE_ID = COVER_NOTE_ID;

// Test hooks for the containerMuteObservers sweep + cap (ENG-2). Not used in
// production — they exercise the sweep/cap that prevent unbounded growth,
// mirroring ai-content-blocker's __trackMediaObserverForTest hooks.
export function __trackContainerMuteObserverForTest(container: HTMLElement, observer: MutationObserver): void {
  trackContainerMuteObserver(container, observer);
}
export function __containerMuteObserverCountForTest(): number {
  return containerMuteObservers.size;
}
export function __resetContainerMuteObserversForTest(): void {
  for (const observer of containerMuteObservers.values()) {
    try { observer.disconnect(); } catch { /* already gone */ }
  }
  containerMuteObservers.clear();
}
