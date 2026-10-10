// FeelingWise — Page-world SPA route notifier.
//
// Runs in the page's MAIN world (ships in the page-world bundle,
// manifest.json world:"MAIN" entry — X/FB/IG/TT, and YouTube since
// 2026-09-14). Wraps
// history.pushState + history.replaceState and dispatches a
// CustomEvent('fw:route-change') on document after the URL commits.
// The isolated-world route watcher (src/content/post-path/dom-interceptor.ts
// `_startRouteWatcher`) listens for it — same cross-world relay idiom
// as fw:platform-payload (./interceptor.ts + ./relay.ts).
//
// Why here and not in the content script (G3 2026-08-04): each world
// has its OWN History binding. A pushState wrapper installed in the
// isolated world only intercepts the content script's own calls — page
// frameworks (X/React Router, FB, IG, TT) call the MAIN-world binding
// and never hit it. The previous isolated-world patch was dead code;
// programmatic navigations were really detected by the 800 ms pathname
// poll, leaving up to ~1.2 s of extraction under the stale route.
//
// Unlike the fetch/XHR wire interceptor, which parses every matched
// response a second time, this costs almost nothing: two function wrappers
// plus one event dispatch per navigation, no per-request work, no payload
// capture.
// The event carries NO detail — the isolated world re-reads
// window.location itself (the document and location are shared across
// worlds; function bindings are not), so nothing page-forgeable rides
// the relay.
//
// CRITICAL: this file has ZERO imports (same constraint as
// ./interceptor.ts — the page-world bundle must stay self-contained
// and must never drag isolated-world modules into the page realm).

/**
 * Install the notifier. Returns a disposer that restores the exact
 * original pushState/replaceState identities. Idempotent: a second
 * install while the first is active returns a no-op disposer.
 */
export function installPageWorldRouteNotifier(): () => void {
  if (typeof window === 'undefined' || typeof history === 'undefined') {
    return () => {
      /* no History in this realm */
    };
  }
  const w = window as unknown as { __fwRouteNotifierInstalled?: boolean };
  if (w.__fwRouteNotifierInstalled) {
    return () => {
      /* already installed by another caller */
    };
  }
  w.__fwRouteNotifierInstalled = true;

  const notify = (): void => {
    try {
      document.dispatchEvent(new CustomEvent('fw:route-change'));
    } catch {
      /* dispatch must never disrupt page JS */
    }
  };

  const originalPush = history.pushState;
  const originalReplace = history.replaceState;

  // Dispatch AFTER the original call so listeners re-reading
  // window.location see the NEW url. No same-route filtering here —
  // the notifier stays policy-free; route-key dedup belongs to the
  // isolated world (computeRouteKey in src/content/post-path/dom-interceptor.ts).
  history.pushState = function fwPushState(
    this: History,
    ...args: Parameters<History['pushState']>
  ): void {
    originalPush.apply(this, args);
    notify();
  };
  history.replaceState = function fwReplaceState(
    this: History,
    ...args: Parameters<History['replaceState']>
  ): void {
    originalReplace.apply(this, args);
    notify();
  };

  return () => {
    history.pushState = originalPush;
    history.replaceState = originalReplace;
    w.__fwRouteNotifierInstalled = false;
  };
}
