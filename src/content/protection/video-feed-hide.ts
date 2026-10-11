// FeelingWise: what happens after a marked video is silenced or hidden on a
// single-player video feed.
//
// After a marked video on TikTok was hidden and the user skipped to the next one, the
// sound stayed muted for every video after it, and the comments bar needed a second
// press to open. A mute belongs to the one video, and other platforms can behave the
// same, so the fix is general.
//
// The class, not the TikTok patch. A single-player video feed (TikTok For You,
// Following, Explore and permalinks; Instagram Reels; YouTube Shorts) has ONE
// sound state that the platform carries from video to video: the player reads
// `muted` back off the <video> on every `volumechange` and stores it as the
// user's preference. Setting `muted = true` on a marked video therefore mutes
// every video after it, which is the defect he saw. So on these feeds the
// silence is scoped to the item three ways:
//
//   1. Pause, and keep paused: a `play` listener re-pauses the media while the
//      item carries `data-fw-silenced`. The platform's player re-calls play()
//      on an item it thinks is current (see ai-content-blocker.ts for the
//      failure shape); the listener answers each call. `play` fires before any
//      audio frame is rendered, so nothing is heard.
//   2. Mute only for the instant of the hide, then put `muted` back to what it
//      was before FeelingWise touched it (the document curtain's baseline when
//      the curtain got there first). The platform sees the user's own state on
//      its next read, and the next unmarked video plays the way the user left it.
//   3. Never unmute what the user muted: a `true` baseline is left as `true`.
//
// After a HIDE (display:none) on such a feed the item is advanced: the next
// sibling item that FeelingWise has not hidden is scrolled into view. A run of
// hidden items is walked up to MAX_HIDDEN_RUN and then stopped with a visible
// notice, and a second breaker caps advances per window so a feed that keeps
// re-hiding cannot loop. The comment panel is snapshotted before the hide and,
// when it was open and the hide closed it, opened again once on the item the
// user landed on; a panel FeelingWise never closed is never touched.
//
// Surfaces the table does not name (X, Facebook, YouTube Home) keep the old
// posture: muted and paused, because their players own no cross-item sound
// state that we have measured. Adding a surface is one table row.

import type { ResolvedUiLanguage } from '../../i18n';
import { MARKER_STRINGS } from '../../i18n/marker-strings';
import { documentMuteBaseline } from './document-start-shield';

/** One row per single-player video feed. `item` is the per-video container
 *  the platform swaps as the user scrolls; `commentToggle` opens that item's
 *  comment panel; `commentPanel` is the panel when open. */
export interface VideoFeedSurface {
  readonly name: 'tiktok-feed' | 'tiktok-permalink' | 'instagram-reels' | 'youtube-shorts';
  readonly item: string;
  /** True when `el` is the item container. Needed where the container has no
   *  selector of its own (Instagram Reels: `main > div` holding a <video>). */
  readonly isItem: (el: Element) => boolean;
  readonly commentToggle: string | null;
  readonly commentPanel: string | null;
}

let hostForTesting: string | null = null;

/** True on `domain` or any of its subdomains. */
function onHost(domain: string): boolean {
  const host = hostForTesting ?? location.hostname;
  return host === domain || host.endsWith(`.${domain}`);
}

/** Tests run on localhost; this stands in for the page's host until reset with null. */
export function _setHostForTesting(host: string | null): void {
  hostForTesting = host;
}

export const VIDEO_FEED_SURFACES: ReadonlyArray<VideoFeedSurface> = [
  {
    name: 'tiktok-feed',
    item: '[data-e2e="recommend-list-item-container"]',
    isItem: (el) => el.matches('[data-e2e="recommend-list-item-container"]'),
    commentToggle: '[data-e2e="comment-icon"]',
    commentPanel: '[class*="DivCommentListContainer"]',
  },
  {
    name: 'tiktok-permalink',
    item: '[data-e2e="video-detail"]',
    isItem: (el) => el.matches('[data-e2e="video-detail"]'),
    commentToggle: '[data-e2e="comments"]',
    commentPanel: '[class*="DivCommentListContainer"]',
  },
  {
    // instagram.ts `_extractReelSurface`: each reel is a direct child of <main>
    // containing a <video>; there is no article and no data hook. The shape alone
    // is not Instagram's: on X the one div under <main> is the whole layout, so
    // without the host check one hidden post silenced every video on the page and
    // re-paused each of them on every play. The other rows name selectors only
    // their own site has.
    name: 'instagram-reels',
    item: 'main > div',
    isItem: (el) =>
      onHost('instagram.com') && el.parentElement?.tagName === 'MAIN' && !!el.querySelector('video'),
    commentToggle: null,
    commentPanel: null,
  },
  {
    name: 'youtube-shorts',
    item: 'ytd-reel-video-renderer',
    isItem: (el) => el.matches('ytd-reel-video-renderer'),
    commentToggle: null,
    commentPanel: null,
  },
];

/** Consecutive hidden items walked before the advance stops and says so. */
export const MAX_HIDDEN_RUN = 5;
/** Advances allowed per window before the breaker stops them. */
export const MAX_ADVANCES_PER_WINDOW = 8;
const ADVANCE_WINDOW_MS = 10_000;
/** How long the notice stays on screen. */
const NOTICE_MS = 6_000;
/** Delay before the comment panel is checked after an advance: the platform
 *  mounts the landed item's panel asynchronously. */
export const COMMENT_RESTORE_DELAY_MS = 400;

export const SILENCED_ATTR = 'data-fw-silenced';
/** The reel a silence belongs to, where the page names one in its address. */
export const SILENCED_FOR_ATTR = 'data-fw-silenced-for';
export const RUN_NOTICE_ATTR = 'data-fw-video-run-notice';

/** The item container `el` sits in, or `el` itself, on a named surface; null elsewhere. */
export function videoFeedItemOf(el: Element | null): { item: HTMLElement; surface: VideoFeedSurface } | null {
  let node: Element | null = el;
  while (node) {
    if (node instanceof HTMLElement) {
      for (const surface of VIDEO_FEED_SURFACES) {
        if (surface.isItem(node)) return { item: node, surface };
      }
    }
    node = node.parentElement;
  }
  return null;
}

// ─── Scoped silence ─────────────────────────────────────────────────────────

/** `muted` as it was before FeelingWise first touched the element. */
const muteBaselines = new WeakMap<HTMLMediaElement, boolean>();
/** Media carrying the re-pause listener. */
const guarded = new WeakSet<HTMLMediaElement>();

/** The reel the address names (/reel/<id>/ or /reels/<id>/), on Instagram only; null elsewhere. */
function currentReelId(): string | null {
  if (!onHost('instagram.com')) return null;
  return location.pathname.match(/\/reels?\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

function guardedItemOf(media: HTMLMediaElement): HTMLElement | null {
  return media.closest<HTMLElement>(`[${SILENCED_ATTR}="true"]`);
}

function mediaIn(root: ParentNode): HTMLMediaElement[] {
  const els: HTMLMediaElement[] = [];
  if (root instanceof HTMLMediaElement) els.push(root);
  root.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => els.push(m));
  return els;
}

/**
 * Silence every media element in `item`, scoped to the item: paused and kept
 * paused while the item carries `data-fw-silenced`, muted only for the instant
 * of the call, `muted` then restored to the baseline (the user's own state).
 * Safe to call again on the same item: the scope and its baseline are kept.
 */
export function silenceVideoItem(item: HTMLElement): void {
  const inScope = item.getAttribute(SILENCED_ATTR) === 'true';
  item.setAttribute(SILENCED_ATTR, 'true');
  // Instagram draws the next reel into the same box as the address moves on, so a silence tied to
  // the box would keep every later reel paused; it is tied to the reel the address names.
  const reel = currentReelId();
  if (reel) item.setAttribute(SILENCED_FOR_ATTR, reel);
  for (const m of mediaIn(item)) {
    try {
      // The baseline is the user's state at the start of a scope. Inside a
      // scope it is kept (the user cannot reach a hidden video, so a later
      // `true` there is not theirs); a new scope reads it afresh.
      if (!inScope || !muteBaselines.has(m)) {
        muteBaselines.set(m, documentMuteBaseline(m) ?? m.muted);
      }
      if (!guarded.has(m)) {
        guarded.add(m);
        m.addEventListener('play', () => {
          const scope = guardedItemOf(m);
          const reel = scope?.getAttribute(SILENCED_FOR_ATTR);
          if (scope && reel && reel !== currentReelId()) {
            releaseVideoItem(scope);
            return;
          }
          if (scope) {
            try { m.pause(); } catch { /* transitional state */ }
          }
        });
      }
      m.muted = true;
      m.pause();
      // The mute is transient on a single-player feed: put the user's own
      // state back so the platform never reads ours as a preference.
      m.muted = muteBaselines.get(m) ?? false;
    } catch {
      // media element in a transitional state; best effort
    }
  }
}

/**
 * End the scope: the re-pause listener goes inert, the media stays paused,
 * `muted` is already the user's own. Used when the user reveals a hidden
 * item; playing it is then their call.
 */
export function releaseVideoItem(item: HTMLElement): void {
  item.removeAttribute(SILENCED_ATTR);
  item.removeAttribute(SILENCED_FOR_ATTR);
}

// ─── Comment panel ──────────────────────────────────────────────────────────

export interface CommentPanelSnapshot {
  readonly open: boolean;
}

function isShown(el: HTMLElement | null): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hidden || node.style.display === 'none' || node.style.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return el !== null;
}

function commentPanelOpen(surface: VideoFeedSurface): boolean {
  if (!surface.commentPanel) return false;
  const panels = Array.from(document.querySelectorAll<HTMLElement>(surface.commentPanel));
  return panels.some(isShown);
}

/** Take before the hide: whether the user had the comment panel open. */
export function snapshotCommentPanel(surface: VideoFeedSurface): CommentPanelSnapshot {
  return { open: commentPanelOpen(surface) };
}

/**
 * After the advance: if the panel was open before the hide and is closed now,
 * the hide closed it, so open it once on the item the user landed on. A panel
 * that was closed before, or is still open, is left alone.
 */
export function restoreCommentPanel(
  surface: VideoFeedSurface,
  before: CommentPanelSnapshot,
  landed: HTMLElement | null,
): boolean {
  if (!before.open || !surface.commentToggle) return false;
  if (commentPanelOpen(surface)) return false;
  const scope: ParentNode = landed ?? document;
  const toggle = scope.querySelector<HTMLElement>(surface.commentToggle);
  if (!toggle) return false;
  toggle.click();
  return true;
}

// ─── Advance ────────────────────────────────────────────────────────────────

export type AdvanceOutcome =
  | { advanced: true; landed: HTMLElement; skipped: number }
  | { advanced: false; reason: 'run-cap' | 'breaker' | 'no-next'; skipped: number };

/**
 * True when FeelingWise hid this item (any hide path that stamps the item).
 * The AI-content filter (visibility:hidden) and the Reels filter (display:none)
 * both stamp data-fw-blocked and leave the item in the feed, so nextItem still
 * finds an item they hid as the next video.
 */
export function isHiddenByUs(el: HTMLElement): boolean {
  return el.getAttribute('data-fw-hard-hidden') === 'true'
    || el.getAttribute('data-fw-ad-hidden') === 'true'
    // The feed ad hider's mark (engagement/feed-ad-blocker.ts), on a Shorts ad card since 2026-10-09.
    || el.getAttribute('data-fw-feed-ad') === 'true'
    || el.hasAttribute('data-fw-blocked');
}

function nextItem(from: HTMLElement, surface: VideoFeedSurface): HTMLElement | null {
  let node = from.nextElementSibling;
  while (node) {
    if (node instanceof HTMLElement && surface.isItem(node)) return node;
    node = node.nextElementSibling;
  }
  return null;
}

const advanceTimes: number[] = [];

function breakerTripped(now: number): boolean {
  while (advanceTimes.length && now - advanceTimes[0] > ADVANCE_WINDOW_MS) advanceTimes.shift();
  return advanceTimes.length >= MAX_ADVANCES_PER_WINDOW;
}

export function _resetAdvanceBreakerForTesting(): void {
  advanceTimes.length = 0;
}

/**
 * Scroll the next item FeelingWise has not hidden into view. Walks past up to
 * MAX_HIDDEN_RUN hidden siblings; stops with 'run-cap' beyond that, 'breaker'
 * when too many advances landed in the window, 'no-next' when the feed has no
 * further item loaded. Never loops: one call, one bounded walk.
 */
export function advancePastHiddenVideo(
  hidden: HTMLElement,
  surface: VideoFeedSurface,
  now: number = Date.now(),
): AdvanceOutcome {
  if (breakerTripped(now)) return { advanced: false, reason: 'breaker', skipped: 0 };
  let skipped = 0;
  let candidate = nextItem(hidden, surface);
  while (candidate && isHiddenByUs(candidate)) {
    skipped += 1;
    if (skipped >= MAX_HIDDEN_RUN) return { advanced: false, reason: 'run-cap', skipped };
    candidate = nextItem(candidate, surface);
  }
  if (!candidate) return { advanced: false, reason: 'no-next', skipped };
  advanceTimes.push(now);
  if (typeof candidate.scrollIntoView === 'function') {
    try { candidate.scrollIntoView({ block: 'start' }); } catch { /* not scrollable here */ }
  }
  return { advanced: true, landed: candidate, skipped };
}

// ─── Which item the user is watching ────────────────────────────────────────
//
// On TikTok the automatic scroll after a mark sometimes turned back to an earlier
// post. A mark can land on an item the user already
// scrolled past (the reading answers late) or on one the feed preloaded below.
// Advancing from such an item scrolls to ITS next sibling, which is behind or
// ahead of where the user is. So the advance runs only when the hidden item
// was the one on screen, read before the hide takes its box away; any other
// hide keeps the watched item where it was.

// ─── The person is scrolling ────────────────────────────────────────────────

/**
 * How long after a wheel, a touch move, a navigation key or a pointer press the person counts as still scrolling. A smooth scroll
 * to the next card runs a few hundred milliseconds, and the card on screen moves the whole time. A press counts because dragging
 * the scrollbar and pressing TikTok's own up and down buttons both begin with one (F47 site B2).
 */
const SCROLL_QUIET_MS = 800;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', ' ', 'Spacebar', 'Home', 'End']);
let lastScrollIntentAt = Number.NEGATIVE_INFINITY;

function noteScrollIntent(event: Event): void {
  if (event.type === 'keydown' && !SCROLL_KEYS.has((event as KeyboardEvent).key)) return;
  // A pointer move counts only while a button is held: that is a drag, as on the scrollbar, which goes on past the press (F47 D).
  if (event.type === 'pointermove' && (event as PointerEvent).buttons === 0) return;
  lastScrollIntentAt = Date.now();
}

// Input only, never the `scroll` event: that one also fires for the page's own snap and for our own scrollIntoView, which are
// not the person. Capture and passive: it sees the input wherever it lands and never delays it. No permission, no network.
if (typeof document !== 'undefined') {
  for (const type of ['wheel', 'touchmove', 'keydown', 'pointerdown', 'pointermove'] as const) {
    document.addEventListener(type, noteScrollIntent, { capture: true, passive: true });
  }
}

/** True while the person's own scroll input is recent. */
function personIsScrolling(): boolean {
  return Date.now() - lastScrollIntentAt < SCROLL_QUIET_MS;
}

/** True when `el`'s box holds the middle line of the window. */
export function isWatchedItem(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const mid = (window.innerHeight || document.documentElement.clientHeight) / 2;
  return r.height > 0 && r.top <= mid && r.bottom > mid;
}

export interface WatchSnapshot {
  /** The item on screen before the hide, or null when none holds the middle line. */
  readonly watched: HTMLElement | null;
  readonly top: number;
}

/** Take before the hide: which item among `item` and its siblings is on screen, and where. */
export function snapshotWatched(item: HTMLElement, surface: VideoFeedSurface): WatchSnapshot {
  const siblings = item.parentElement ? Array.from(item.parentElement.children) : [item];
  for (const el of siblings) {
    if (el instanceof HTMLElement && surface.isItem(el) && isWatchedItem(el)) {
      return { watched: el, top: el.getBoundingClientRect().top };
    }
  }
  return { watched: null, top: 0 };
}

/**
 * After hiding an item that was not on screen: when the hide moved the watched
 * item (a box above it collapsed and the feed did not hold its place), scroll
 * it back to where it was. Returns true when it scrolled.
 */
function holdWatchedItem(before: WatchSnapshot): boolean {
  const el = before.watched;
  if (!el || !el.isConnected) return false;
  // The watched card moves while the person scrolls, and that move is not the collapse's: putting the card back to its saved
  // top would scroll the feed backwards against them (F47, the jump-back).
  if (personIsScrolling()) return false;
  if (Math.abs(el.getBoundingClientRect().top - before.top) < 1) return false;
  if (typeof el.scrollIntoView !== 'function') return false;
  try { el.scrollIntoView({ block: 'start' }); } catch { return false; }
  return true;
}

/**
 * The single step both hide paths take after an item on a single-player feed
 * went display:none: advance when it was the watched item, otherwise hold the
 * watched item in place. Returns the advance outcome, or null when it held.
 */
export function afterFeedItemHidden(
  hidden: HTMLElement,
  surface: VideoFeedSurface,
  comments: CommentPanelSnapshot,
  watch: WatchSnapshot,
  lang: ResolvedUiLanguage = 'en',
): AdvanceOutcome | null {
  if (watch.watched === hidden) {
    // The person is scrolling right now: the feed is not moved under their own scroll. The move is held until they have been
    // quiet (F47 D), not dropped: a scroll that lands on a card the filter then hides is the common case, and skipping the move
    // there would leave a black screen.
    if (personIsScrolling()) {
      advanceWhenQuiet(hidden, surface, comments, lang, 0);
      return null;
    }
    return afterVideoHidden(hidden, surface, comments, lang);
  }
  holdWatchedItem(watch);
  return null;
}

/** How many times the held move waits for the person to stop before it gives up (about four seconds). */
const MAX_SCROLL_WAITS = 5;

/**
 * Run the move for `hidden` once the person's scroll input has been quiet for SCROLL_QUIET_MS, but only when they are still on
 * nothing or on the hidden card itself. When another card holds the screen they have moved on, and nothing is done. A person who
 * keeps scrolling past MAX_SCROLL_WAITS waits is left alone. One timer at a time per hide; nothing is left running.
 */
function advanceWhenQuiet(
  hidden: HTMLElement,
  surface: VideoFeedSurface,
  comments: CommentPanelSnapshot,
  lang: ResolvedUiLanguage,
  waits: number,
): void {
  const quietIn = SCROLL_QUIET_MS - (Date.now() - lastScrollIntentAt);
  setTimeout(() => {
    // A card the person revealed ("Show anyway") in the wait is theirs to look at: the reveal leaves the hide's own marker, so
    // isHiddenByUs still says yes, and the move would scroll the feed off the card they chose to see (the critic's HOLD).
    if (!hidden.isConnected || !isHiddenByUs(hidden) || hidden.getAttribute('data-fw-user-revealed') === 'true') return;
    if (personIsScrolling()) {
      if (waits + 1 < MAX_SCROLL_WAITS) advanceWhenQuiet(hidden, surface, comments, lang, waits + 1);
      return;
    }
    const onScreen = snapshotWatched(hidden, surface).watched;
    if (onScreen && onScreen !== hidden) return;
    afterVideoHidden(hidden, surface, comments, lang);
  }, Math.max(quietIn, 0) + 50);
}

// ─── Notice ─────────────────────────────────────────────────────────────────

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

/** One fixed chip at the top of the page; replaces any earlier one. */
function showVideoRunNotice(text: string): HTMLElement {
  document.querySelectorAll(`[${RUN_NOTICE_ATTR}]`).forEach((n) => n.remove());
  if (noticeTimer) clearTimeout(noticeTimer);
  const chip = document.createElement('div');
  chip.setAttribute(RUN_NOTICE_ATTR, 'true');
  chip.setAttribute('role', 'status');
  chip.textContent = text;
  chip.style.cssText = [
    'position:fixed', 'top:16px', 'left:50%', 'transform:translateX(-50%)',
    'z-index:2147483646', 'padding:8px 14px', 'border-radius:8px',
    'background:rgba(20,20,20,0.92)', 'color:#fff', 'font:13px/1.4 system-ui,sans-serif',
    'pointer-events:none', 'max-width:80vw',
  ].join(';');
  document.body.appendChild(chip);
  noticeTimer = setTimeout(() => { chip.remove(); noticeTimer = null; }, NOTICE_MS);
  return chip;
}

// ─── The one entry point the hide paths call ────────────────────────────────

/**
 * Call once, right after an item on a single-player feed went display:none.
 * `before` is the comment snapshot taken before the hide. Advances, shows the
 * notice when the walk stops, and restores the comment panel after the
 * platform has had COMMENT_RESTORE_DELAY_MS to mount the landed item's panel.
 */
export function afterVideoHidden(
  hidden: HTMLElement,
  surface: VideoFeedSurface,
  before: CommentPanelSnapshot,
  lang: ResolvedUiLanguage = 'en',
): AdvanceOutcome {
  const ms = MARKER_STRINGS[lang];
  const outcome = advancePastHiddenVideo(hidden, surface);
  if (!outcome.advanced) {
    if (outcome.reason === 'run-cap' || outcome.reason === 'breaker') {
      showVideoRunNotice(ms.videoRunNotice(outcome.skipped + 1));
    } else {
      showVideoRunNotice(ms.videoHiddenScrollOn);
    }
    return outcome;
  }
  setTimeout(() => {
    restoreCommentPanel(surface, before, outcome.landed);
  }, COMMENT_RESTORE_DELAY_MS);
  return outcome;
}
