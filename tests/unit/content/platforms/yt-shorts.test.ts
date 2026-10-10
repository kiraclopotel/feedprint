// @vitest-environment jsdom
//
// YouTube Shorts record (src/content/platforms/yt-shorts.ts): the Short on screen is written down once,
// as a video record, from the title the page draws. These tests lock the contract:
//   - flag off (the default): nothing is attached;
//   - the words come from the visible title element only (two-sided: what it reads and what it must not);
//   - a title is never attributed to a Short before the words have held still, and never the previous
//     Short's words while the address has already moved on;
//   - once per Short; a Short with no readable title is counted and not written;
//   - every bound holds (page cap, timer stops while the tab is hidden, nothing off /shorts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostContent } from '../../../../src/types/post';

const flagState = { ytShorts: false };

vi.mock('../../../../src/storage/feature-flags', () => ({
  isFeatureEnabled: vi.fn(async (flag: string) => (flag === 'ytShorts' ? flagState.ytShorts : false)),
}));

import {
  YT_SHORTS_MAX_RECORDS_PER_PAGE,
  YT_SHORTS_NO_TITLE_POLLS,
  YT_SHORTS_POLL_MS,
  YT_SHORTS_SAME_TITLE_WAIT_POLLS,
  YT_SHORTS_STABLE_POLLS,
  __ytShortsArmForTest,
  __ytShortsDebugForTest,
  __ytShortsResetForTest,
  __ytShortsTickForTest,
  initYtShorts,
  shortIdFromPath,
} from '../../../../src/content/platforms/yt-shorts';
import { _getDiagnosticCountersForTesting, _resetDiagnosticsForTesting } from '../../../../src/diagnostics/diagnostics';
import { verifyAnchorMatch } from '../../../../src/forensics/anchor-revalidation';
import { computeAnchorKey } from '../../../../src/core/anchor-key';

// ─── Fixtures ───

const ON_SCREEN = { top: 100, bottom: 160, left: 20, right: 300, width: 280, height: 60 };
const OFF_SCREEN = { top: 5000, bottom: 5060, left: 20, right: 300, width: 280, height: 60 };

function rect(r: typeof ON_SCREEN): () => DOMRect {
  return () => ({ ...r, x: r.left, y: r.top, toJSON: () => ({}) }) as DOMRect;
}

/** One Short's overlay as YouTube draws it: a metapanel holding the channel bar and the title. */
function shortOverlay(opts: { title: string; handle?: string; visible?: boolean }): HTMLElement {
  const renderer = document.createElement('ytd-reel-video-renderer');
  const panel = document.createElement('yt-reel-metapanel-view-model');
  const channel = document.createElement('yt-reel-channel-bar-view-model');
  if (opts.handle) {
    const link = document.createElement('a');
    link.setAttribute('href', `/${opts.handle}`);
    link.textContent = opts.handle;
    channel.appendChild(link);
  }
  const titleModel = document.createElement('yt-shorts-video-title-view-model');
  const h1 = document.createElement('h1');
  h1.textContent = opts.title;
  h1.getBoundingClientRect = rect(opts.visible === false ? OFF_SCREEN : ON_SCREEN);
  titleModel.appendChild(h1);
  panel.append(channel, titleModel);
  renderer.appendChild(panel);
  document.body.appendChild(renderer);
  return h1;
}

function go(id: string): void {
  window.history.replaceState({}, '', `/shorts/${id}`);
}

function ticks(n: number): void {
  for (let i = 0; i < n; i++) __ytShortsTickForTest();
}

let emitted: PostContent[] = [];
const sink = { emitPost: (post: PostContent) => { emitted.push(post); } };

function counter(name: string): number | undefined {
  return (_getDiagnosticCountersForTesting() as Record<string, number | undefined>)[name];
}

beforeEach(() => {
  document.body.innerHTML = '';
  emitted = [];
  flagState.ytShorts = false;
  __ytShortsResetForTest();
  _resetDiagnosticsForTesting();
  window.history.replaceState({}, '', '/');
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

afterEach(() => {
  vi.useRealTimers();
  __ytShortsResetForTest();
});

describe('the flag', () => {
  it('attaches nothing when the flag is off (the default)', async () => {
    vi.useFakeTimers();
    const stop = initYtShorts(sink);
    await vi.advanceTimersByTimeAsync(10);

    expect(__ytShortsDebugForTest().armed).toBe(false);
    expect(__ytShortsDebugForTest().timerActive).toBe(false);
    stop();
  });

  it('arms one timer when the flag is on, and cleanup stops it', async () => {
    vi.useFakeTimers();
    flagState.ytShorts = true;
    const stop = initYtShorts(sink);
    await vi.advanceTimersByTimeAsync(10);
    expect(__ytShortsDebugForTest().timerActive).toBe(true);

    stop();
    expect(__ytShortsDebugForTest().timerActive).toBe(false);
    expect(__ytShortsDebugForTest().armed).toBe(false);
  });

  it('polls on its own once armed and writes the Short after the words hold still', async () => {
    vi.useFakeTimers();
    flagState.ytShorts = true;
    go('Shrt00Exmpl');
    shortOverlay({ title: 'Ranking The Funniest Cats #Shorts', handle: '@example_shorts' });
    const stop = initYtShorts(sink);

    await vi.advanceTimersByTimeAsync(YT_SHORTS_POLL_MS * (YT_SHORTS_STABLE_POLLS + 1));

    expect(emitted).toHaveLength(1);
    stop();
  });
});

describe('what it reads', () => {
  beforeEach(() => __ytShortsArmForTest(sink));

  it('writes the visible Short: id from the address, title and channel from the page', () => {
    go('Shrt00Exmpl');
    shortOverlay({ title: 'Ranking The Funniest Cats #Shorts #cats', handle: '@example_shorts' });

    ticks(YT_SHORTS_STABLE_POLLS);

    expect(emitted).toHaveLength(1);
    const post = emitted[0];
    expect(post.id).toBe('yt-vid-Shrt00Exmpl');
    expect(post.text).toBe('Ranking The Funniest Cats #Shorts #cats');
    expect(post.author).toBe('@example_shorts');
    expect(post.kind).toBe('video');
    expect(post.platform).toBe('youtube');
    expect(post.parentVideoId).toBe('yt-vid-Shrt00Exmpl');
    expect(post.sourceUrl).toBe('https://www.youtube.com/shorts/Shrt00Exmpl');
    expect(post.platform_specific).toEqual({ platform: 'youtube', surfaceKind: 'youtube-shorts' });
    expect(counter('ytShorts.emitted')).toBe(1);
  });

  it('carries no field that is undefined, so an older record hashes the same', () => {
    go('Shrt00Exmpl');
    shortOverlay({ title: 'A title', handle: '@someone' });
    ticks(YT_SHORTS_STABLE_POLLS);

    expect(Object.entries(emitted[0]).filter(([, v]) => v === undefined)).toEqual([]);
  });

  it('anchors the record on the title element, so the anchor check matches it', () => {
    go('Shrt00Exmpl');
    const h1 = shortOverlay({ title: 'A title', handle: '@someone' });
    ticks(YT_SHORTS_STABLE_POLLS);

    const post = emitted[0];
    expect(post.domRef.deref()).toBe(h1);
    expect(verifyAnchorMatch(computeAnchorKey(post), post, post.domRef)).toBe('match');
  });

  it('says "unknown" for the channel when the page shows no channel link', () => {
    go('Shrt00Exmpl');
    shortOverlay({ title: 'A title without a channel bar link' });
    ticks(YT_SHORTS_STABLE_POLLS);

    expect(emitted[0].author).toBe('unknown');
  });

  it('does not read a neighbouring Short that is mounted but off screen', () => {
    go('Shrt00Exmpl');
    shortOverlay({ title: 'The next Short, not shown yet', handle: '@other', visible: false });
    shortOverlay({ title: 'The Short on screen', handle: '@mine' });

    ticks(YT_SHORTS_STABLE_POLLS);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].text).toBe('The Short on screen');
    expect(emitted[0].author).toBe('@mine');
  });

  it('does not read a heading that is not inside the title element', () => {
    go('Shrt00Exmpl');
    const stray = document.createElement('h1');
    stray.textContent = 'A heading elsewhere on the page';
    stray.getBoundingClientRect = rect(ON_SCREEN);
    document.body.appendChild(stray);
    const inPanel = document.createElement('yt-reel-metapanel-view-model');
    const h1 = document.createElement('h1');
    h1.textContent = 'A heading in a panel with no title element';
    h1.getBoundingClientRect = rect(ON_SCREEN);
    inPanel.appendChild(h1);
    document.body.appendChild(inPanel);

    ticks(YT_SHORTS_NO_TITLE_POLLS);

    expect(emitted).toHaveLength(0);
  });

  it('does not write when two different titles are on screen at once, and counts it', () => {
    go('Shrt00Exmpl');
    shortOverlay({ title: 'One title', handle: '@a' });
    shortOverlay({ title: 'Another title', handle: '@b' });

    ticks(YT_SHORTS_STABLE_POLLS + 2);

    expect(emitted).toHaveLength(0);
    expect(counter('ytShorts.ambiguous')).toBe(1);
  });

  it('writes nothing off /shorts', () => {
    window.history.replaceState({}, '', '/watch?v=abcdefghijk');
    shortOverlay({ title: 'A title', handle: '@a' });

    ticks(YT_SHORTS_NO_TITLE_POLLS);

    expect(emitted).toHaveLength(0);
  });

  it('reads the id from the address, and only from /shorts/', () => {
    expect(shortIdFromPath('/shorts/Shrt00Exmpl')).toBe('Shrt00Exmpl');
    expect(shortIdFromPath('/shorts/Shrt00Exmpl/')).toBe('Shrt00Exmpl');
    expect(shortIdFromPath('/shorts')).toBeNull();
    expect(shortIdFromPath('/watch')).toBeNull();
    expect(shortIdFromPath('/@channel/shorts')).toBeNull();
  });
});

describe('a title belongs to the Short it was drawn for', () => {
  beforeEach(() => __ytShortsArmForTest(sink));

  it('waits for the words to hold still before writing', () => {
    go('Shrt00Exmpl');
    shortOverlay({ title: 'A title', handle: '@a' });

    ticks(YT_SHORTS_STABLE_POLLS - 1);

    expect(emitted).toHaveLength(0);
    ticks(1);
    expect(emitted).toHaveLength(1);
  });

  it('does not give the last Short\'s words to the next one while the page is still swapping', () => {
    go('firstShort01');
    const h1 = shortOverlay({ title: 'The first Short', handle: '@a' });
    ticks(YT_SHORTS_STABLE_POLLS);
    expect(emitted).toHaveLength(1);

    go('secondShort2');
    ticks(YT_SHORTS_SAME_TITLE_WAIT_POLLS - 1);
    expect(emitted).toHaveLength(1);

    h1.textContent = 'The second Short';
    ticks(YT_SHORTS_STABLE_POLLS);

    expect(emitted).toHaveLength(2);
    expect(emitted[1].id).toBe('yt-vid-secondShort2');
    expect(emitted[1].text).toBe('The second Short');
  });

  it('accepts an identical title once the wait has passed', () => {
    go('firstShort01');
    shortOverlay({ title: 'Same title', handle: '@a' });
    ticks(YT_SHORTS_STABLE_POLLS);

    go('secondShort2');
    ticks(YT_SHORTS_SAME_TITLE_WAIT_POLLS + YT_SHORTS_STABLE_POLLS);

    expect(emitted.map((p) => p.id)).toEqual(['yt-vid-firstShort01', 'yt-vid-secondShort2']);
  });

  it('writes each Short once, also when the reader goes back to it', () => {
    go('firstShort01');
    const h1 = shortOverlay({ title: 'The first Short', handle: '@a' });
    ticks(YT_SHORTS_STABLE_POLLS);
    go('secondShort2');
    h1.textContent = 'The second Short';
    ticks(YT_SHORTS_SAME_TITLE_WAIT_POLLS + YT_SHORTS_STABLE_POLLS);
    go('firstShort01');
    h1.textContent = 'The first Short';
    ticks(YT_SHORTS_SAME_TITLE_WAIT_POLLS + YT_SHORTS_STABLE_POLLS);

    expect(emitted.map((p) => p.id)).toEqual(['yt-vid-firstShort01', 'yt-vid-secondShort2']);
  });

  it('counts a Short with no readable title once, and writes no record for it', () => {
    go('Shrt00Exmpl');

    ticks(YT_SHORTS_NO_TITLE_POLLS + 3);

    expect(emitted).toHaveLength(0);
    expect(counter('ytShorts.noTitle')).toBe(1);
  });
});

describe('the bounds', () => {
  it('stops the timer while the tab is hidden and starts it again when it returns', async () => {
    vi.useFakeTimers();
    flagState.ytShorts = true;
    const stop = initYtShorts(sink);
    await vi.advanceTimersByTimeAsync(10);
    expect(__ytShortsDebugForTest().timerActive).toBe(true);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(__ytShortsDebugForTest().timerActive).toBe(false);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(__ytShortsDebugForTest().timerActive).toBe(true);
    stop();
  });

  it('writes no more than the page cap in one page life, and counts the stop once', () => {
    __ytShortsArmForTest(sink);
    const h1 = shortOverlay({ title: 'x', handle: '@a' });
    for (let i = 0; i < YT_SHORTS_MAX_RECORDS_PER_PAGE + 5; i++) {
      go(`short${String(i).padStart(6, '0')}`);
      h1.textContent = `Short number ${i}`;
      ticks(YT_SHORTS_STABLE_POLLS);
    }

    expect(emitted).toHaveLength(YT_SHORTS_MAX_RECORDS_PER_PAGE);
    expect(counter('ytShorts.pageCapReached')).toBe(1);
  });
});
