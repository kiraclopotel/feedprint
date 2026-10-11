// FeelingWise - YouTube Shorts record: the Short on screen, once, as a video record.
//
// What it writes down: one `kind:'video'` record per Short the reader was shown (id = `yt-vid-<v>`,
// text = the title as drawn, author = the channel handle, sourceUrl = the Short's address), in the
// same shape /watch and the home grid already produce, with surface `youtube-shorts`. Nothing before
// this read a Short's own words: the post path stands down on /shorts, and the home grid skips Shorts.
//
// Where the words come from: the page, never the network. A record must trace to what the reader's
// screen could show (types/post.ts, Encounter), so the title is the visible `h1` of
// `yt-shorts-video-title-view-model`, the element YouTube's own script draws it in. Not
// `document.title`: through a Polymer transition the document still carries the previous title, and
// the same reason keeps /watch off it (yt-watch-comments.ts). The address names which Short is on
// screen, and a title is attributed to it only once the words have held still.
//
// Bounds. No observer at all: one timer, one second, running only while the page is visible, so there
// is no callback stream to churn. Every set is capped, the records of one page life are capped, and
// the heap valve stops it for good. Behind the `ytShorts` flag, default OFF: the element names are read
// from YouTube's script, not yet watched on a live Short, and a record with a real anchor is also
// judged like any other, so the flag goes on only after a live look with the sound off.

import type { PostContent, Platform } from '../../types/post';
import { isFeatureEnabled } from '../../storage/feature-flags';
import { bumpCounter, registerHeapGauge, registerHeapValve } from '../../diagnostics/diagnostics';

export interface YtShortsSink {
  /** Delivery into the onPostDetected chokepoint (content/index.ts). */
  emitPost: (post: PostContent) => void;
}

// ─── Bounds and timings (exported so tests lock them) ───

export const YT_SHORTS_POLL_MS = 1000;
/** Polls a title must hold still, unchanged, before it is written down. */
export const YT_SHORTS_STABLE_POLLS = 2;
/** After the address changes, polls to wait before accepting the same title as the last Short's. */
export const YT_SHORTS_SAME_TITLE_WAIT_POLLS = 4;
/** Polls after the address changes before a Short with no readable title is counted. */
export const YT_SHORTS_NO_TITLE_POLLS = 6;
/** Hard cap on the once-per-Short set (FIFO eviction). */
const YT_SHORTS_MAX_EMITTED_IDS = 200;
/** Records written in one page life; past it, Shorts are counted and not read. */
export const YT_SHORTS_MAX_RECORDS_PER_PAGE = 400;

const TITLE_SELECTOR = 'yt-shorts-video-title-view-model h1';
const METAPANEL_SELECTOR = 'yt-reel-metapanel-view-model';
const CHANNEL_LINK_SELECTOR = 'yt-reel-channel-bar-view-model a[href^="/@"]';

// ─── State (one instance per content-script realm) ───

let armed = false;
let sink: YtShortsSink | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let onVisibility: (() => void) | null = null;

const emittedIds = new Set<string>();
let recordsThisPage = 0;
let capNoted = false;
let lastPathId: string | null = null;
let pollsSinceChange = 0;
let lastEmitted: { id: string; title: string } | null = null;
let pending: { id: string; title: string; seen: number } | null = null;
let noTitleCountedFor: string | null = null;
let ambiguousCountedFor: string | null = null;

registerHeapGauge('ytShorts.emittedIds', () => emittedIds.size);
registerHeapValve(() => disarm(false));

function addCapped(set: Set<string>, value: string, cap: number): void {
  set.add(value);
  while (set.size > cap) {
    const oldest = set.keys().next().value;
    if (oldest === undefined) break;
    set.delete(oldest);
  }
}

// ─── Reading ───

/** The id in the address of a Short, or null on any other page. */
export function shortIdFromPath(pathname: string): string | null {
  const m = /^\/shorts\/([A-Za-z0-9_-]{6,})/.exec(pathname);
  return m ? m[1] : null;
}

function isOnScreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0
    && r.bottom > 0 && r.top < window.innerHeight
    && r.right > 0 && r.left < window.innerWidth;
}

interface ShortWords {
  title: string;
  author: string;
  titleEl: HTMLElement;
}

/** The Short the reader can see: its title, its channel, and the element the title is drawn in. */
function readVisibleShort(): ShortWords | 'ambiguous' | null {
  const seen: ShortWords[] = [];
  for (const h1 of document.querySelectorAll<HTMLElement>(TITLE_SELECTOR)) {
    if (!isOnScreen(h1)) continue;
    const title = (h1.textContent ?? '').trim();
    if (title === '') continue;
    const panel = h1.closest<HTMLElement>(METAPANEL_SELECTOR);
    const href = panel?.querySelector<HTMLAnchorElement>(CHANNEL_LINK_SELECTOR)?.getAttribute('href') ?? '';
    const handle = /^\/(@[^/?#]+)/.exec(href)?.[1] ?? '';
    seen.push({ title, author: handle ? decodeURIComponent(handle) : 'unknown', titleEl: h1 });
  }
  if (seen.length === 0) return null;
  const distinct = new Set(seen.map((s) => s.title));
  return distinct.size === 1 ? seen[0] : 'ambiguous';
}

function buildRecord(id: string, words: ShortWords): PostContent {
  return {
    id: `yt-vid-${id}`,
    text: words.title,
    author: words.author,
    timestamp: new Date().toISOString(),
    platform: 'youtube' as Platform,
    // The title element itself: the render gate recomputes the anchor from this element's own text.
    domRef: new WeakRef(words.titleEl),
    feedSource: 'for-you',
    sourceUrl: `https://www.youtube.com/shorts/${id}`,
    kind: 'video',
    parentVideoId: `yt-vid-${id}`,
    platform_specific: { platform: 'youtube', surfaceKind: 'youtube-shorts' },
  };
}

// ─── The poll ───

function tick(): void {
  if (!armed || !sink || document.hidden) return;
  const id = shortIdFromPath(window.location.pathname);
  if (id === null) {
    lastPathId = null;
    pending = null;
    return;
  }
  if (id !== lastPathId) {
    lastPathId = id;
    pollsSinceChange = 0;
    pending = null;
  }
  pollsSinceChange++;
  if (emittedIds.has(id)) return;
  if (recordsThisPage >= YT_SHORTS_MAX_RECORDS_PER_PAGE) {
    if (!capNoted) {
      capNoted = true;
      bumpCounter('ytShorts.pageCapReached');
    }
    return;
  }

  const words = readVisibleShort();
  if (words === 'ambiguous') {
    if (ambiguousCountedFor !== id) {
      ambiguousCountedFor = id;
      bumpCounter('ytShorts.ambiguous');
    }
    return;
  }
  if (words === null) {
    if (pollsSinceChange >= YT_SHORTS_NO_TITLE_POLLS && noTitleCountedFor !== id) {
      noTitleCountedFor = id;
      bumpCounter('ytShorts.noTitle');
    }
    return;
  }
  // Still the last Short's words while the address has already moved on: never attribute them to this one.
  if (lastEmitted !== null && lastEmitted.id !== id
    && words.title === lastEmitted.title && pollsSinceChange < YT_SHORTS_SAME_TITLE_WAIT_POLLS) {
    return;
  }
  if (pending !== null && pending.id === id && pending.title === words.title) pending.seen++;
  else pending = { id, title: words.title, seen: 1 };
  if (pending.seen < YT_SHORTS_STABLE_POLLS) return;

  addCapped(emittedIds, id, YT_SHORTS_MAX_EMITTED_IDS);
  recordsThisPage++;
  lastEmitted = { id, title: words.title };
  pending = null;
  bumpCounter('ytShorts.emitted');
  sink.emitPost(buildRecord(id, words));
}

// ─── Arm and disarm ───

function disarm(clearState: boolean): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  pending = null;
  if (clearState) {
    emittedIds.clear();
    lastPathId = null;
    lastEmitted = null;
  }
}

function arm(): void {
  if (!armed || document.hidden || timer !== null) return;
  timer = setInterval(tick, YT_SHORTS_POLL_MS);
}

/**
 * Start the Short record for a YouTube content script. Reads the `ytShorts` flag once; off (the
 * shipped default) attaches nothing. Returns a cleanup that stops the timer and the listener.
 */
export function initYtShorts(shortsSink: YtShortsSink): () => void {
  let disposed = false;

  void isFeatureEnabled('ytShorts').then((enabled) => {
    if (!enabled || disposed) return;
    sink = shortsSink;
    armed = true;
    onVisibility = () => {
      if (document.hidden) disarm(true);
      else arm();
    };
    document.addEventListener('visibilitychange', onVisibility);
    arm();
  }).catch(() => {
    // The flag is unreadable: stay inert.
  });

  return () => {
    disposed = true;
    armed = false;
    disarm(true);
    sink = null;
    if (onVisibility) {
      document.removeEventListener('visibilitychange', onVisibility);
      onVisibility = null;
    }
  };
}

// ─── Test-only hooks ───

/** Run one poll now, without waiting for the timer (tests only). */
export function __ytShortsTickForTest(): void {
  tick();
}

/** Arm with a sink directly, skipping the flag read (tests only). */
export function __ytShortsArmForTest(testSink: YtShortsSink): void {
  sink = testSink;
  armed = true;
}

export function __ytShortsResetForTest(): void {
  armed = false;
  sink = null;
  disarm(true);
  recordsThisPage = 0;
  capNoted = false;
  pollsSinceChange = 0;
  noTitleCountedFor = null;
  ambiguousCountedFor = null;
}

export function __ytShortsDebugForTest(): { armed: boolean; timerActive: boolean; emittedIds: number; recordsThisPage: number } {
  return { armed, timerActive: timer !== null, emittedIds: emittedIds.size, recordsThisPage };
}
