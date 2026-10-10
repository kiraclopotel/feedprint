// @vitest-environment jsdom
//
// G3 (2026-08-04) — MAIN-world SPA route notifier.
//
// A content script's ISOLATED world has its own History binding, so a
// pushState/replaceState patch installed there never observes the calls
// page frameworks make on the MAIN-world binding. The page-world bundle
// therefore wraps the MAIN-world methods and relays each navigation as
// a CustomEvent('fw:route-change') on document — the same cross-world
// relay idiom as fw:platform-payload (page-world/fetch-interceptor.ts).
//
// These tests pin: dispatch-after-URL-commit ordering (the isolated
// listener re-reads location, so the event must fire AFTER the URL
// changed), replaceState coverage, install idempotency, disposer
// restoration, and that the notifier leaves the E4-lazy wire layer
// (fetch/XHR) untouched.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPageWorldRouteNotifier } from '../../../../src/content/page-world/route-notifier';

// Pristine methods captured before any test installs a wrapper, so a
// failed test cannot leak a patched History into its neighbours.
const PRISTINE_PUSH = history.pushState;
const PRISTINE_REPLACE = history.replaceState;

let dispose: (() => void) | null = null;

beforeEach(() => {
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  delete (window as { __fwRouteNotifierInstalled?: boolean }).__fwRouteNotifierInstalled;
  history.replaceState({}, '', '/');
});

afterEach(() => {
  dispose?.();
  dispose = null;
  history.pushState = PRISTINE_PUSH;
  history.replaceState = PRISTINE_REPLACE;
  delete (window as { __fwRouteNotifierInstalled?: boolean }).__fwRouteNotifierInstalled;
});

function collectRouteEvents(): { paths: string[]; detach: () => void } {
  const paths: string[] = [];
  const listener = (): void => {
    paths.push(window.location.pathname + window.location.search);
  };
  document.addEventListener('fw:route-change', listener);
  return {
    paths,
    detach: () => document.removeEventListener('fw:route-change', listener),
  };
}

describe('installPageWorldRouteNotifier', () => {
  it('pushState dispatches fw:route-change AFTER the URL is committed', () => {
    const events = collectRouteEvents();
    dispose = installPageWorldRouteNotifier();

    history.pushState({}, '', '/alice/status/12345');

    events.detach();
    // Exactly one event, and the listener already saw the NEW location —
    // the isolated-world watcher re-reads location, so ordering is the
    // contract, not the (empty) event payload.
    expect(events.paths).toEqual(['/alice/status/12345']);
  });

  it('replaceState also dispatches (route-key dedup is the isolated world\'s job, not the notifier\'s)', () => {
    const events = collectRouteEvents();
    dispose = installPageWorldRouteNotifier();

    history.replaceState({}, '', '/search?q=ab');

    events.detach();
    expect(events.paths).toEqual(['/search?q=ab']);
  });

  it('second install is a no-op (no double dispatch per navigation)', () => {
    dispose = installPageWorldRouteNotifier();
    const disposeSecond = installPageWorldRouteNotifier();
    const events = collectRouteEvents();

    history.pushState({}, '', '/bob');

    events.detach();
    expect(events.paths).toHaveLength(1);
    // The second (no-op) disposer must not strip the first install.
    disposeSecond();
    const eventsAfter = collectRouteEvents();
    history.pushState({}, '', '/carol');
    eventsAfter.detach();
    expect(eventsAfter.paths).toHaveLength(1);
  });

  it('disposer restores the exact original function identities and stops dispatching', () => {
    dispose = installPageWorldRouteNotifier();
    expect(history.pushState).not.toBe(PRISTINE_PUSH);
    expect(history.replaceState).not.toBe(PRISTINE_REPLACE);

    dispose();
    dispose = null;

    expect(history.pushState).toBe(PRISTINE_PUSH);
    expect(history.replaceState).toBe(PRISTINE_REPLACE);
    const events = collectRouteEvents();
    history.pushState({}, '', '/dave');
    events.detach();
    expect(events.paths).toHaveLength(0);
  });

  it('does NOT touch fetch/XHR — the route notifier does no per-request work', () => {
    const originalFetch = window.fetch;
    const originalXhrSend = XMLHttpRequest.prototype.send;
    const originalXhrOpen = XMLHttpRequest.prototype.open;

    dispose = installPageWorldRouteNotifier();

    expect(window.fetch).toBe(originalFetch);
    expect(XMLHttpRequest.prototype.send).toBe(originalXhrSend);
    expect(XMLHttpRequest.prototype.open).toBe(originalXhrOpen);
  });

  it('wrapped pushState still forwards arguments to the real History (state + URL land)', () => {
    dispose = installPageWorldRouteNotifier();

    history.pushState({ fw: 'state-blob' }, '', '/eve?keep=1');

    expect(window.location.pathname).toBe('/eve');
    expect(window.location.search).toBe('?keep=1');
    expect(history.state).toEqual({ fw: 'state-blob' });
  });
});
