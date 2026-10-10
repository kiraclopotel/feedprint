// @vitest-environment jsdom
//
// When the sampled heap passes the valve the page is close to an out-of-memory
// crash, and the recorder stops reading it until the page loads again. The
// gap marker on the chain says so. Disconnecting the observer alone was not
// that: the three second rescan, the rescan after a route change and the
// catch-up walk when a tab came back to the front all kept walking the body of
// a page that had just hit the memory ceiling.
//
// The owner is still told about route changes after the trip, because that is
// what drops work bound to the page the reader has left.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContentInterceptor } from '../../../../src/content/post-path/dom-interceptor';
import {
  _resetDiagnosticsForTesting, _sampleHeapForTesting, HEAP_VALVE_MB,
} from '../../../../src/diagnostics/diagnostics';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

let heapMB = 100;

function makeAdapter(): { adapter: PlatformAdapter; calls: NodeList[] } {
  const calls: NodeList[] = [];
  return {
    calls,
    adapter: {
      platform: 'twitter',
      detectPlatform: () => true,
      getPostSelector: () => '[data-testid="tweetText"]',
      extractPosts: (nodes: NodeList) => { calls.push(nodes); return []; },
    },
  };
}

function tripValve(): void {
  heapMB = HEAP_VALVE_MB;
  _sampleHeapForTesting();
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
  _resetDiagnosticsForTesting();
  heapMB = 100;
  vi.stubGlobal('chrome', { storage: { local: { get: async () => ({}), set: async () => undefined } } });
  Object.defineProperty(performance, 'memory', { configurable: true, get: () => ({ usedJSHeapSize: heapMB * 1024 * 1024 }) });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  document.body.innerHTML = '<div>feed</div>';
  history.replaceState({}, '', '/home');
  setVisibility('visible');
});

afterEach(() => {
  setVisibility('visible');
  history.replaceState({}, '', '/');
  _resetDiagnosticsForTesting();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the heap valve stops the recorder reading the page', () => {
  it('the three second rescan reads the page before the trip and never after it', () => {
    const { adapter, calls } = makeAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    const afterStart = calls.length;
    vi.advanceTimersByTime(3_001);
    expect(calls.length, 'the rescan runs while the heap is fine').toBe(afterStart + 1);

    tripValve();
    const atTrip = calls.length;
    vi.advanceTimersByTime(30_000);

    expect(calls.length).toBe(atTrip);
    interceptor.stop();
  });

  it('a route change after the trip reads nothing, and the owner still hears of it', () => {
    const { adapter, calls } = makeAdapter();
    const onSurfaceChange = vi.fn();
    const interceptor = new ContentInterceptor(adapter, vi.fn(), onSurfaceChange);
    interceptor.start();
    tripValve();
    const atTrip = calls.length;

    history.pushState({}, '', '/someone/status/1');
    // The route poll notices, and the rescan it schedules is due after that.
    vi.advanceTimersByTime(2_000);

    expect(calls.length).toBe(atTrip);
    expect(onSurfaceChange).toHaveBeenCalledWith('route');
    expect(onSurfaceChange).toHaveBeenCalledWith('route-settled');
    interceptor.stop();
  });

  it('a tab that comes back to the front after the trip is not walked', () => {
    const { adapter, calls } = makeAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    tripValve();
    const atTrip = calls.length;

    setVisibility('hidden');
    setVisibility('visible');

    expect(calls.length).toBe(atTrip);
    interceptor.stop();
  });

  it('a request to read the whole surface again after the trip reads nothing', () => {
    const { adapter, calls } = makeAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    tripValve();
    const atTrip = calls.length;

    interceptor.rescanCurrentSurfaceNow();

    expect(calls.length).toBe(atTrip);
    interceptor.stop();
  });

  it('a request to read the whole surface again after the trip leaves the page untouched', () => {
    const { adapter } = makeAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    tripValve();
    document.body.innerHTML = '<div data-fw-processed="1">a</div><div data-fw-comment-seen="1">b</div>';

    interceptor.rescanCurrentSurfaceNow();

    expect(document.querySelectorAll('[data-fw-processed]').length).toBe(1);
    expect(document.querySelectorAll('[data-fw-comment-seen]').length).toBe(1);
    interceptor.stop();
  });

  it('re-arming one row after the trip leaves that row untouched', () => {
    const { adapter, calls } = makeAdapter();
    const interceptor = new ContentInterceptor(adapter, vi.fn());
    interceptor.start();
    tripValve();
    document.body.innerHTML = '<div data-fw-processed="1"><span>row</span></div>';
    const row = document.querySelector<HTMLElement>('[data-fw-processed]')!;
    const atTrip = calls.length;

    interceptor.rearmElement(row.firstElementChild as HTMLElement);

    expect(calls.length).toBe(atTrip);
    expect(row.dataset.fwProcessed).toBe('1');
    interceptor.stop();
  });
});
