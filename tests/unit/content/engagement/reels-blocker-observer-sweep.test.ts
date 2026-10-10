// @vitest-environment jsdom
//
// ENG-2 (2026-07-13 engagement-hider audit) — reels-blocker's
// containerMuteObservers Map had no periodic sweep of detached containers
// and no hard cap, unlike its structural sibling ai-content-blocker (fixed
// 2026-06-07: mediaObservers Set + sweepMediaObservers + MAX_MEDIA_OBSERVERS
// =200). resetDOM only disconnected every tracked observer at full module
// teardown, never during an active block-reels session. If a platform's SPA
// remounts the matched page-level container across reel-to-reel navigation
// (dynamicContentRescan: true on every REELS_BLOCKER_SURFACES entry implies
// this is expected), the old container's observer was never disconnected —
// the exact growth pattern that drove the 2026-06-07 YouTube OOM.
//
// This test locks the same sweep + cap shape as the ai-content-blocker fix.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  __trackContainerMuteObserverForTest,
  __containerMuteObserverCountForTest,
  __resetContainerMuteObserversForTest,
} from '../../../../src/content/engagement/reels-blocker';

const fakeObserver = () => ({ disconnect: () => {} }) as unknown as MutationObserver;
const fakeContainer = (isConnected: boolean) => ({ isConnected }) as unknown as HTMLElement;

beforeEach(() => __resetContainerMuteObserversForTest());

describe('reels-blocker — containerMuteObservers sweep + cap (ENG-2)', () => {
  it('sweeps observers whose container was detached by a platform SPA remount', () => {
    const c1 = fakeContainer(true);
    const c2 = fakeContainer(false); // detached — e.g. old container after reel-to-reel nav
    const c3 = fakeContainer(true);
    __trackContainerMuteObserverForTest(c1, fakeObserver());
    __trackContainerMuteObserverForTest(c2, fakeObserver());
    __trackContainerMuteObserverForTest(c3, fakeObserver());

    expect(__containerMuteObserverCountForTest()).toBe(2);
  });

  it('disconnects the observer for a swept (detached) container', () => {
    const disconnect1 = { called: false };
    const disconnect2 = { called: false };
    const o1 = { disconnect: () => { disconnect1.called = true; } } as unknown as MutationObserver;
    const o2 = { disconnect: () => { disconnect2.called = true; } } as unknown as MutationObserver;

    __trackContainerMuteObserverForTest(fakeContainer(true), o1);
    __trackContainerMuteObserverForTest(fakeContainer(false), o2);
    // A subsequent track call re-runs the sweep and should have disconnected
    // the detached container's observer.
    __trackContainerMuteObserverForTest(fakeContainer(true), fakeObserver());

    expect(disconnect2.called).toBe(true);
    expect(disconnect1.called).toBe(false);
  });

  it('hard-caps the live observer count even when every container stays connected', () => {
    for (let i = 0; i < 100; i++) {
      __trackContainerMuteObserverForTest(fakeContainer(true), fakeObserver());
    }
    const count = __containerMuteObserverCountForTest();
    expect(count).toBeLessThan(100);
    expect(count).toBeGreaterThan(0);
  });

  it('disconnects and clears everything on reset/teardown', () => {
    let disconnected = false;
    const o = { disconnect: () => { disconnected = true; } } as unknown as MutationObserver;
    __trackContainerMuteObserverForTest(fakeContainer(true), o);

    __resetContainerMuteObserversForTest();

    expect(__containerMuteObserverCountForTest()).toBe(0);
    expect(disconnected).toBe(true);
  });
});
