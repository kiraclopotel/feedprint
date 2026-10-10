// FeelingWise — YouTube /watch comment capture (docs/history/2026-08/YOUTUBE-E1-BRIEF.md).
//
// The watch session IS the existing video room: one `kind:'video'` record
// (id = `yt-vid-<v>`, text = video title, author = channel name, sourceUrl =
// canonical watch URL) plus `kind:'comment'` records nested under
// `parentVideoId = yt-vid-<v>` — the exact TikTok video-room shape, ZERO
// chain-schema change. Records + marks only: `isCommentRewriteEnabled`
// stays false for YouTube, so the batch path never rewrites here.
//
// The room record is emitted INDEPENDENTLY of the comments (owner decision
// 2026-08-02, deliberately diverging from TikTok's no-orphan-video rule).
// A watched video is an exposure whether or not its comment section ever
// rendered, and on YouTube the canonical link stays resolvable afterwards,
// so the link/title/channel triple IS the evidence the record exists to
// carry. Emission waits for the real title element rather than falling back
// to `document.title`, because Polymer keeps the previous video's title in
// the document during an SPA transition and a record must never attribute
// one video's title to another.
//
// Gate: feature flag `ytWatchComments`, DEFAULT ON since 2026-08-02 (the
// watch-memory A/B returned clean; `storage/feature-flags.ts` holds that
// default and is the only source of it). When off this module attaches
// nothing — no observer, no listeners, no DOM reads. The 2026-05
// /watch renderer-OOM mitigations are NOT reverted by this module:
// `shouldSkipNodeAccumulation` (interceptor.ts), the `extractPosts` /watch
// early-return (platforms/youtube.ts), and the `_processNodes` /watch
// short-circuit all stay in force. This module is the re-enable SHAPE the
// brief mandates instead: one SCOPED observer on `ytd-comments#comments`
// only, trailing-debounced (500 ms), disconnected while `document.hidden`.
//
// Memory discipline (every structure capped, cleared on tab-background):
//   • YT_WATCH_MAX_COMMENTS_PER_SCAN — emit cap per scan pass; the unseen
//     tail is picked up by later scans (window slides, nothing frozen out).
//   • YT_WATCH_MAX_SEEN_KEYS — FIFO-evicting dedup Set of comment keys.
//   • YT_WATCH_MAX_EMITTED_VIDEO_IDS — FIFO-evicting once-per-video Set.
//   • On `visibilitychange → hidden`: observer disconnected, debounce +
//     poll timers cleared, both Sets cleared. Re-emissions after return to
//     visible are deduped downstream by deterministic ids (session caches)
//     and the forensic content-hash gate, plus the `fwYtSeen` DOM stamp on
//     rows that survived in the DOM.

import type { PostContent, Platform } from '../../types/post';
import { isFeatureEnabled } from '../../storage/feature-flags';
import { bumpCounter, registerHeapGauge, registerHeapValve } from '../../diagnostics/diagnostics';
import { ChurnBreaker } from '../post-path/churn-breaker';
import { noteGap } from '../record/gap-ledger';
import { recordItemRead } from '../../storage/settings';
import { releaseMarkedElement } from '../injector';

/**
 * The comment container's observer has its own rate ceiling
 * (churn-breaker.ts): a comment section that fires 600 callbacks a minute
 * for a full minute is not a comment section being read, it is a stream. The
 * observer is disconnected for the cooldown, the loss is a signed gap, and
 * the observer is re-attached after.
 */
const YT_WATCH_CHURN_MAX_PER_MINUTE = 600;
const YT_WATCH_CHURN_SUSTAIN_MS = 60_000;
const YT_WATCH_CHURN_COOLDOWN_MS = 60_000;
const churn = new ChurnBreaker({ maxPerMinute: YT_WATCH_CHURN_MAX_PER_MINUTE, sustainMs: YT_WATCH_CHURN_SUSTAIN_MS, cooldownMs: YT_WATCH_CHURN_COOLDOWN_MS });
let churnRearmId: ReturnType<typeof setTimeout> | null = null;

// The heap valve (diagnostics.ts): past the threshold this module drops its
// observer and timers for the rest of the page's life. The interceptor's
// handler writes the gap; this one only stops. Safe when not armed.
registerHeapValve(() => disarm(false));

export interface YtWatchCommentSink {
  /** Delivery into the onPostDetected chokepoint (content/index.ts). */
  emitPost: (post: PostContent) => void;
}

// ─── Caps + timings (exported so tests lock the exact bounds) ───

/** Trailing debounce for the scoped observer (brief §3: ≥500 ms). */
export const YT_WATCH_SCAN_DEBOUNCE_MS = 500;
/** Hard cap on comment emits per scan pass. */
export const YT_WATCH_MAX_COMMENTS_PER_SCAN = 20;
/** Hard cap on the seen-comment dedup Set (FIFO eviction). */
export const YT_WATCH_MAX_SEEN_KEYS = 500;
/** Hard cap on the once-per-video room-record Set (FIFO eviction). */
const YT_WATCH_MAX_EMITTED_VIDEO_IDS = 100;
/** Container-discovery poll (comments render lazily below the fold). */
const CONTAINER_POLL_INTERVAL_MS = 2000;
const CONTAINER_POLL_MAX_ATTEMPTS = 15;

// ─── Module state (single instance per content-script realm) ───

let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let pollAttempts = 0;
let armed = false;
let sink: YtWatchCommentSink | null = null;
let onVisibility: (() => void) | null = null;
let onYtNavigate: (() => void) | null = null;

const seenCommentKeys = new Set<string>();
const emittedVideoIds = new Set<string>();
registerHeapGauge('ytWatch.seenCommentKeys', () => seenCommentKeys.size);

function addCapped(set: Set<string>, value: string, cap: number): void {
  set.add(value);
  while (set.size > cap) {
    const oldest = set.keys().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

// ─── Extraction ───

function isWatchPage(): boolean {
  return typeof window !== 'undefined' && window.location.pathname.startsWith('/watch');
}

function currentVideoId(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('v');
}

function getContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('ytd-comments#comments');
}

/** Deterministic non-crypto hash for the no-`lc=` fallback comment id. */
function hashKey(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * The watch header's own title element. Deliberately NOT `document.title`:
 * through a Polymer SPA transition the document still carries the PREVIOUS
 * video's title, and a record that attributed one video's title to another
 * would be a false claim in signed evidence. An empty string means "not
 * readable yet" and defers the room record to a later tick.
 */
function readWatchTitle(): string {
  return document.querySelector<HTMLElement>(
    'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string',
  )?.textContent?.trim() ?? '';
}

function extractVideoRoom(videoId: string, watchUrl: string, title: string): PostContent {
  const channelEl = document.querySelector<HTMLElement>(
    '#owner ytd-channel-name a, #owner #channel-name a, ytd-video-owner-renderer ytd-channel-name a',
  );
  // The title element, whose text IS `text` below. This was
  // document.documentElement, and the render gate recomputes the anchor from
  // the element's own textContent, so it compared the title against the whole
  // page and could never match: the same defect as the comments beside it, one
  // record up. src/content/platforms/youtube.ts:277 already anchors a video on
  // `titleEl ?? tile`. Found 2026-09-19. The fallback is the document element
  // the record used before, so a page whose title element has moved still
  // produces a record rather than none.
  const titleEl = document.querySelector<HTMLElement>(
    'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string',
  );
  return {
    id: `yt-vid-${videoId}`,
    text: title,
    author: channelEl?.textContent?.trim() || 'unknown',
    timestamp: new Date().toISOString(),
    platform: 'youtube' as Platform,
    domRef: new WeakRef(titleEl ?? document.documentElement),
    feedSource: 'video',
    sourceUrl: watchUrl,
    kind: 'video',
    parentVideoId: `yt-vid-${videoId}`,
    platform_specific: { platform: 'youtube', surfaceKind: 'youtube-watch' },
  };
}

/**
 * Watch-session record, at most once per video id, as soon as the real title
 * is readable — INDEPENDENT of the comment section.
 *
 * Deliberately unlike TikTok, where an empty-caption video with no comments
 * stays unrecorded to avoid orphan video nodes. On YouTube the watch session
 * IS the exposure unit and the canonical link stays resolvable long after the
 * view, so link + title + channel is the evidence worth keeping even when no
 * comment ever loaded (owner decision 2026-08-02). Under-recording a watched
 * video is the bigger evidence failure here.
 */
function emitRoomIfNeeded(videoId: string): void {
  if (!sink || emittedVideoIds.has(videoId)) return;
  const title = readWatchTitle();
  if (!title) return;
  addCapped(emittedVideoIds, videoId, YT_WATCH_MAX_EMITTED_VIDEO_IDS);
  sink.emitPost(extractVideoRoom(videoId, `https://www.youtube.com/watch?v=${videoId}`, title));
}

function scan(): void {
  if (!sink || !armed) return;
  if (typeof document === 'undefined' || document.hidden) return;
  if (!isWatchPage()) return;
  const videoId = currentVideoId();
  if (!videoId) return;

  // Before the container check, so the room record does not depend on the
  // comment section existing, and so it precedes its own comments in the
  // common case (seedRoomContextFromPost stamps roomAuthor/roomCaption/
  // roomUrl; group-records.ts backfills if a late room record arrives after).
  emitRoomIfNeeded(videoId);

  const container = getContainer();
  if (!container) return;

  const parentVideoId = `yt-vid-${videoId}`;
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const threads = container.querySelectorAll<HTMLElement>('ytd-comment-thread-renderer');
  const newComments: PostContent[] = [];

  for (const thread of threads) {
    if (newComments.length >= YT_WATCH_MAX_COMMENTS_PER_SCAN) break;
    if (thread.dataset.fwYtSeen === 'true') continue;

    // Attribute-equality form rather than `#id`: YouTube duplicates these
    // ids across every thread, and scoped `#id` queries hit engine
    // getElementById fast paths (first-in-document match) — jsdom's nwsapi
    // returns null for later threads. `[id="…"]` matches per-subtree.
    const textEl = thread.querySelector<HTMLElement>('[id="content-text"]');
    const text = textEl?.textContent?.trim() ?? '';
    if (text.length < 2) continue;
    const author = thread.querySelector<HTMLElement>('[id="author-text"]')?.textContent?.trim()
      || 'unknown';

    const key = `${author}|${text.slice(0, 160)}`;
    if (seenCommentKeys.has(key)) {
      thread.dataset.fwYtSeen = 'true';
      continue;
    }

    // Prefer YouTube's own comment id (the `lc=` permalink param) so the
    // record id is stable across sessions; fall back to a deterministic
    // author+text hash (never a random UUID — chain-id stability, spec
    // cross-cutting theme A).
    const lcHref = thread.querySelector<HTMLAnchorElement>('a[href*="lc="]')
      ?.getAttribute('href') ?? '';
    const lcMatch = lcHref.match(/[?&]lc=([^&#]+)/);
    const commentId = lcMatch ? lcMatch[1] : hashKey(key);

    addCapped(seenCommentKeys, key, YT_WATCH_MAX_SEEN_KEYS);
    thread.dataset.fwYtSeen = 'true';
    newComments.push({
      id: `yt-c-${commentId}`,
      text,
      author,
      timestamp: new Date().toISOString(),
      platform: 'youtube',
      // The BODY element, not the thread. `text` above is this element's own
      // text, and the render gate recomputes the anchor as
      // `id::domRef.textContent.slice(0,200)` and compares it to
      // `id::post.text.slice(0,200)` (src/forensics/anchor-revalidation.ts).
      // A thread's textContent carries the author, the timestamp, the like
      // count, the Reply control and every loaded reply, so the two could
      // never be equal and the gate read 'dom-recycled' for every comment on
      // every video: no marker, no hide and no rewrite ever landed on a
      // YouTube comment, and each one was signed with a reason that had not
      // happened. Recovery could not save it either, because
      // COMMENT_RECOVERY_SELECTORS walks up with
      // `closest('ytd-comment-view-model')` and a view-model is a child of a
      // thread, never an ancestor. Anchoring on the body is what X, Facebook
      // and TikTok already do and what that recovery table has always named as
      // YouTube's marker host. Found 2026-09-19; the thread is still what
      // carries `fwYtSeen`, so dedup granularity is unchanged.
      domRef: new WeakRef(textEl ?? thread),
      feedSource: 'video',
      sourceUrl: `${watchUrl}&lc=${commentId}`,
      // 'top-comment', not the 'comment' alias. The alias is legal and the
      // assemblers accept it again, but the modern kind carries the level
      // explicitly and needs no resolution step.
      kind: 'top-comment',
      depth: 1,
      parentVideoId,
      platform_specific: { platform: 'youtube', surfaceKind: 'youtube-watch' },
    });
  }

  // A thread seen for the first time is a comment read (B10-1); one already seen is not counted again.
  for (const comment of newComments) {
    recordItemRead('youtube', 'comment');
    sink.emitPost(comment);
  }
}

function scheduleScan(): void {
  // Rate ceiling first (churn-breaker.ts): a tripped observer stops here.
  const rate = churn.note();
  if (rate.tripped) { tripChurnBreaker(rate.count); return; }
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    scan();
  }, YT_WATCH_SCAN_DEBOUNCE_MS);
}

/** The breaker tripped: disconnect, say so on the chain, re-attach after the cooldown if still armed. */
function tripChurnBreaker(count: number): void {
  observer?.disconnect();
  observer = null;
  if (debounceTimer !== null) { clearTimeout(debounceTimer); debounceTimer = null; }
  bumpCounter('ytWatch.churnBreaker');
  noteGap('churn-breaker', count, 'events');
  console.warn(`[FeelingWise] watch comments rate ceiling: ${count} callbacks in a minute; standing down for ${YT_WATCH_CHURN_COOLDOWN_MS / 1000}s`);
  if (churnRearmId !== null) clearTimeout(churnRearmId);
  churnRearmId = setTimeout(() => {
    churnRearmId = null;
    if (!armed) return;
    const container = getContainer();
    if (container) attachObserver(container);
  }, YT_WATCH_CHURN_COOLDOWN_MS);
}

// ─── Arm / disarm ───

function attachObserver(container: HTMLElement): void {
  if (observer) return;
  observer = new MutationObserver(scheduleScan);
  observer.observe(container, { childList: true, subtree: true });
}

const WATCH_TITLE_SELECTOR = 'h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string';
let markedVideoId: string | null = null;

/**
 * F65 (the owner's screenshots, 3 Oct 2026): YouTube keeps ONE title element
 * through its in-page navigation and only swaps the words in it. A mark drawn
 * on it for one video (the dot, its explanation, the old title its red state
 * puts back) stayed there for the next video until a reload. On every
 * navigation to a different video id, whatever our mark left on the title
 * element is released; the new video's own record marks it again if it must.
 */
function releaseWatchTitleMark(): void {
  const videoId = currentVideoId();
  if (videoId !== null && videoId === markedVideoId) return;
  markedVideoId = videoId;
  document.querySelectorAll<HTMLElement>(WATCH_TITLE_SELECTOR).forEach((titleEl) => {
    releaseMarkedElement(titleEl);
    const h1 = titleEl.closest<HTMLElement>('h1');
    if (h1) releaseMarkedElement(h1);
  });
}

function disarm(clearState: boolean): void {
  if (churnRearmId !== null) { clearTimeout(churnRearmId); churnRearmId = null; }
  observer?.disconnect();
  observer = null;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (clearState) {
    seenCommentKeys.clear();
    emittedVideoIds.clear();
  }
}

function arm(): void {
  if (!armed || document.hidden || !isWatchPage()) return;
  const videoId = currentVideoId();
  if (videoId) emitRoomIfNeeded(videoId);
  const container = getContainer();
  if (container) {
    attachObserver(container);
    scan();
  }

  // ONE bounded poll, two jobs: find a comment container that mounts lazily
  // below the fold, and retry the room record while the watch header is still
  // rendering. On a video with comments turned off the container never
  // appears, so this poll is the only thing that will ever record the watch
  // session. Still one interval, still hard-capped at
  // CONTAINER_POLL_MAX_ATTEMPTS — no new producer, so the renderer-OOM
  // discipline in this file's header is unchanged.
  const roomPending = videoId !== null && !emittedVideoIds.has(videoId);
  if (container && !roomPending) return;
  if (pollTimer !== null) return;
  pollAttempts = 0;
  pollTimer = setInterval(() => {
    pollAttempts++;
    const id = currentVideoId();
    if (id) emitRoomIfNeeded(id);
    const late = getContainer();
    if (late) {
      attachObserver(late);
      scan();
    }
    const stillPending = id !== null && !emittedVideoIds.has(id);
    const done = late !== null && !stillPending;
    if ((done || pollAttempts >= CONTAINER_POLL_MAX_ATTEMPTS) && pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }, CONTAINER_POLL_INTERVAL_MS);
}

// ─── Entry point ───

/**
 * Initialize /watch capture for a YouTube content script. Reads the
 * `ytWatchComments` flag ONCE; the shipped default is ON, and an explicit
 * stored `false` is the kill switch, in which case nothing is attached and
 * the returned cleanup is a near-no-op. Returns a cleanup that tears down
 * the observer, timers, and listeners.
 */
export function initYtWatchComments(commentSink: YtWatchCommentSink): () => void {
  let disposed = false;

  void isFeatureEnabled('ytWatchComments').then((enabled) => {
    if (!enabled || disposed) return;
    sink = commentSink;
    armed = true;
    // The video on screen at start keeps its mark through the navigate event
    // YouTube fires for the first page too (releaseWatchTitleMark).
    markedVideoId = currentVideoId();

    // Brief §3: disconnected while document.hidden; state cleared on
    // background (memory discipline), recovered by rescan on return.
    onVisibility = () => {
      if (document.hidden) {
        disarm(true);
      } else {
        arm();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Polymer SPA navigation: new video = new room. Old container is
    // usually replaced, so tear down and re-arm against the fresh one.
    // Seen-keys are cleared (they belong to the old room); emittedVideoIds
    // is kept so back-nav to a recorded video doesn't duplicate its room
    // record within the session.
    onYtNavigate = () => {
      disarm(false);
      seenCommentKeys.clear();
      releaseWatchTitleMark();
      arm();
    };
    document.addEventListener('yt-navigate-finish', onYtNavigate);

    arm();
  }).catch(() => {
    // Flag unreadable → stay inert (fail-closed on the OOM gate).
  });

  return () => {
    disposed = true;
    armed = false;
    disarm(true);
    sink = null;
    markedVideoId = null;
    if (onVisibility) {
      document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    }
    if (onYtNavigate) {
      document.removeEventListener('yt-navigate-finish', onYtNavigate);
      onYtNavigate = null;
    }
  };
}

// ─── Test-only hooks (pattern: __*ForTest) ───

/** Run a scan synchronously, bypassing the debounce (tests only). */
export function __ytWatchScanNowForTest(): void {
  scan();
}

export function __ytWatchDebugForTest(): {
  armed: boolean;
  observerActive: boolean;
  seenKeyCount: number;
  emittedVideoCount: number;
} {
  return {
    armed,
    observerActive: observer !== null,
    seenKeyCount: seenCommentKeys.size,
    emittedVideoCount: emittedVideoIds.size,
  };
}
