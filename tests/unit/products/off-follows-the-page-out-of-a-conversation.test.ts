/** @vitest-environment jsdom */
//
// Off checked once whether the page was a private conversation, at boot, and
// never again.
//
// Every one of these sites is a single page application. Walking from the feed
// into Messages changes the URL without loading anything, so the check in
// `content.ts` had already run and passed, and the filters went on working:
// the word filter, the emoji stripper, the comment block, the picker, all of
// them, over a private conversation. The standing rule is that private
// surfaces are out of scope for every filter.
//
// The recorder has always re-checked on every route change and releases its
// covers when the answer turns private. Found 2026-09-19 by a read of the free
// product, which named the missing re-check; verified against both entry
// points before anything moved.
//
// The watch reports a CHANGE, not a state, so a caller cannot double-stop or
// double-start, and it works in both directions: a person who walks back out
// to the feed gets their filters back without reloading. pushState and
// replaceState fire no event, which is why there is a tick as well as a
// popstate listener; that is the shape the other filters already use.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PRIVATE_SURFACE_POLL_MS, watchPrivateSurface } from '../../../src/products/off/private-surface-watch';

let isPrivate: boolean;
let entered: number;
let left: number;

function start(): () => void {
  return watchPrivateSurface({
    isPrivate: () => isPrivate,
    onEnter: () => { entered++; },
    onLeave: () => { left++; },
  });
}

/** One poll tick, the way the page's own clock would deliver it. */
async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(PRIVATE_SURFACE_POLL_MS + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
  isPrivate = false;
  entered = 0;
  left = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Off follows the page out of a conversation (2026-09-19)', () => {
  it('notices the walk from the feed into Messages with no page load', async () => {
    const stop = start();
    await tick();
    expect(entered, 'nothing happened while the page stayed the feed').toBe(0);

    isPrivate = true;
    await tick();
    expect(entered, 'the filters are told to stop').toBe(1);
    stop();
  });

  it('gives the filters back on the walk out again', async () => {
    isPrivate = true;
    const stop = start();
    isPrivate = false;
    await tick();
    expect(left, 'the feed is a feed again').toBe(1);
    expect(entered, 'and it was never told to stop, having started stopped').toBe(0);
    stop();
  });

  it('says it once, however many times it is asked', async () => {
    // The tick keeps running. A state, reported every two seconds, would tear
    // down and rebuild every filter on a loop.
    const stop = start();
    isPrivate = true;
    await tick();
    await tick();
    await tick();
    expect(entered).toBe(1);
    stop();
  });

  it('answers a history move without waiting for the tick', async () => {
    const stop = start();
    isPrivate = true;
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(entered, 'the back button is not something to wait two seconds on').toBe(1);
    stop();
  });

  it('stops watching when it is stopped', async () => {
    const stop = start();
    stop();
    isPrivate = true;
    await tick();
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(entered).toBe(0);
  });

  it('a page that starts inside a conversation is not reported as entering one', async () => {
    // content.ts already returned early on that first reading. A watch that
    // reported the starting state would stop filters that never started.
    isPrivate = true;
    const stop = start();
    await tick();
    expect(entered).toBe(0);
    expect(left).toBe(0);
    stop();
  });
});
