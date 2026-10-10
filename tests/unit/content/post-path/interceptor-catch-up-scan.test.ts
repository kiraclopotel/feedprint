// @vitest-environment jsdom
//
// One walk when the recorder comes back to a page it was not watching.
//
// The interceptor sheds its observer in three places, each for a good reason:
// the churn breaker's cooldown when a page fires callbacks faster than any
// recorder can read them, the backgrounded tab whose drain is suspended by the
// browser, and the heap valve. Each writes its gap marker, so the record says a
// stretch is missing rather than pretending it is whole.
//
// What was missing is the recovery. A MutationObserver reports what happens
// next, never what happened while it was detached, so everything the page added
// during a stand-down was invisible for good. On most platforms the three
// second safety rescan picked those items up when the surface came back. On
// YouTube that rescan is deliberately off, because walking the body every three
// seconds on that SPA was part of the watch-page memory climb, so nothing ever
// looked again on the one platform where the breaker is most likely to trip.
//
// One walk per event is not the rescan loop, and it is what turns a recorded
// gap into a recovered one.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContentInterceptor } from '../../../../src/content/post-path/dom-interceptor';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

function makeAdapter(platform: PlatformAdapter['platform']): {
  adapter: PlatformAdapter;
  calls: NodeList[];
} {
  const calls: NodeList[] = [];
  return {
    calls,
    adapter: {
      platform,
      detectPlatform: () => true,
      getPostSelector: () => '[data-testid="tweetText"]',
      extractPosts: (nodes: NodeList) => { calls.push(nodes); return []; },
    },
  };
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  document.body.innerHTML = '';
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('the recorder looks again after it was not watching', () => {
  it('walks the page once when a backgrounded tab comes back, on a platform with no safety rescan', () => {
    const { adapter, calls } = makeAdapter('youtube');
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    const afterStart = calls.length;

    setVisibility('hidden');
    expect(calls.length).toBe(afterStart);

    setVisibility('visible');

    expect(calls.length).toBe(afterStart + 1);
    interceptor.stop();
  });

  it('does not walk the page when the tab was never hidden', () => {
    const { adapter, calls } = makeAdapter('youtube');
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    const afterStart = calls.length;

    // A visibilitychange that reports visible, with nothing dropped before it,
    // owes nothing: the observer never stopped reporting.
    setVisibility('visible');

    expect(calls.length).toBe(afterStart);
    interceptor.stop();
  });

  it('owes one walk per absence, not one per return', () => {
    const { adapter, calls } = makeAdapter('youtube');
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    const afterStart = calls.length;

    setVisibility('hidden');
    setVisibility('visible');
    setVisibility('visible');
    setVisibility('visible');

    expect(calls.length).toBe(afterStart + 1);
    interceptor.stop();
  });

  it('a stopped interceptor owes nothing when the tab comes back', () => {
    const { adapter, calls } = makeAdapter('youtube');
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    setVisibility('hidden');
    interceptor.stop();
    const afterStop = calls.length;

    setVisibility('visible');

    expect(calls.length).toBe(afterStop);
  });
});
