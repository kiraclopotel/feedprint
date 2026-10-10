// @vitest-environment jsdom
//
// blockedContainers leak fix (PERF-5, 2026-07-13 perf audit) —
// src/content/engagement/ai-content-blocker.ts.
//
// Background. blockContainer() adds every newly-blocked container to the
// module-level `blockedContainers` Set so resetDOM's toggle-off unmute pass
// can find them. Before this fix, that Set was ONLY ever cleared by
// resetDOM() (full toggle-off) — on a long scroll session (TikTok/IG) every
// distinct blocked post accumulates in the Set for the life of the tab, each
// entry pinning a strong reference to a container the platform's own
// virtualizer may have already removed from the live DOM. This is the exact
// leak pattern documented in this file's own comments (live evidence
// 2026-06-07: youtube.com 132MB -> 2450MB) and already fixed once for the
// sibling `mediaObservers` Set (sweepMediaObservers + MAX_MEDIA_OBSERVERS).
// This test locks the same sweep + cap behavior for `blockedContainers`.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __trackBlockedContainerForTest,
  __blockedContainerCountForTest,
  __resetDOMForTest,
} from '../../../../src/content/engagement/ai-content-blocker';

// resetDOM's unmute pass calls container.querySelectorAll('video, audio') on
// every tracked container, so the fake needs a stub that returns something
// with a no-op forEach (no real <video>/<audio> elements in these tests).
const fakeContainer = (isConnected: boolean) =>
  ({
    isConnected,
    querySelectorAll: () => ({ forEach: () => {} }),
  }) as unknown as HTMLElement;

beforeEach(() => __resetDOMForTest());

describe('blockedContainers sweep + cap (PERF-5)', () => {
  it('sweeps containers detached by the virtualizer on the next track call', () => {
    __trackBlockedContainerForTest(fakeContainer(true));
    __trackBlockedContainerForTest(fakeContainer(false)); // detached
    __trackBlockedContainerForTest(fakeContainer(true));
    // The detached one from the previous call should have been swept by the
    // time a subsequent track runs the sweep again — but sweeping also runs
    // synchronously on every track call, so even the detached entry added
    // above should already be gone.
    expect(__blockedContainerCountForTest()).toBe(2);
  });

  it('hard-caps the live blockedContainers count even when every container is connected', () => {
    for (let i = 0; i < 250; i++) {
      __trackBlockedContainerForTest(fakeContainer(true));
    }
    expect(__blockedContainerCountForTest()).toBeLessThanOrEqual(200);
  });

  it('is bounded and does not grow unboundedly on a long "scroll session" of connected+detached containers', () => {
    for (let i = 0; i < 500; i++) {
      // Simulate a virtualizer: every other container gets detached shortly
      // after being tracked (as would happen once it scrolls off-screen and
      // the platform removes it from the live tree).
      __trackBlockedContainerForTest(fakeContainer(i % 2 === 0));
    }
    expect(__blockedContainerCountForTest()).toBeLessThanOrEqual(200);
  });

  it('resetDOM still clears the set on full toggle-off (existing behavior preserved)', () => {
    __trackBlockedContainerForTest(fakeContainer(true));
    expect(__blockedContainerCountForTest()).toBeGreaterThan(0);
    __resetDOMForTest();
    expect(__blockedContainerCountForTest()).toBe(0);
  });
});
