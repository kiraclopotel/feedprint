// Media-mute observer registry bounding (YouTube OOM fix) —
// src/content/engagement/ai-content-blocker.ts.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  __trackMediaObserverForTest,
  __mediaObserverCountForTest,
  __resetMediaObserversForTest,
} from '../../../../src/content/engagement/ai-content-blocker';

const fakeObserver = () => ({ disconnect: vi.fn() }) as unknown as MutationObserver;
const fakeContainer = (isConnected: boolean) => ({ isConnected }) as unknown as HTMLElement;

beforeEach(() => __resetMediaObserversForTest());

describe('media-observer registry', () => {
  it('sweeps observers whose container was detached by the virtualizer', () => {
    const o1 = fakeObserver();
    const o2 = fakeObserver();
    const o3 = fakeObserver();
    __trackMediaObserverForTest(o1, fakeContainer(true));
    __trackMediaObserverForTest(o2, fakeContainer(false)); // detached → swept on next track
    __trackMediaObserverForTest(o3, fakeContainer(true));
    expect(__mediaObserverCountForTest()).toBe(2);
    expect(o2.disconnect).toHaveBeenCalled();
    expect(o1.disconnect).not.toHaveBeenCalled();
  });

  it('hard-caps the live observer count even when every container is connected', () => {
    for (let i = 0; i < 250; i++) {
      __trackMediaObserverForTest(fakeObserver(), fakeContainer(true));
    }
    expect(__mediaObserverCountForTest()).toBeLessThanOrEqual(200);
  });

  it('disconnects and clears everything on reset/teardown', () => {
    const o = fakeObserver();
    __trackMediaObserverForTest(o, fakeContainer(true));
    __resetMediaObserversForTest();
    expect(__mediaObserverCountForTest()).toBe(0);
    expect(o.disconnect).toHaveBeenCalled();
  });
});
