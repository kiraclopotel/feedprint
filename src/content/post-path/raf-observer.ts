// FeelingWise — rAF-debounced MutationObserver helper.
//
// Standard pattern for high-frequency body-subtree observers (engagement
// modules, comment-pipeline trigger, adapter dispatch). Any burst of
// mutations within a single animation frame collapses to ONE callback.
// The 60Hz browser frame budget caps invocation rate at ≤60/sec regardless
// of mutation burst size, breaking the positive-feedback amplification that
// caused a YouTube tab-crash on 2026-05-24.
//
// History:
//   • Ship #27 — inline rAF debounce applied in youtube-engagement.ts +
//     ai-content-blocker.ts. Fixed the SPA-nav crash temporarily.
//   • Live re-test revealed the equivalent unfixed observers in
//     video-pipeline.ts + interceptor.ts + 3 engagement modules continued
//     amplifying. Whack-a-mole signature → architectural fix.
//   • Ship #27.1 — this helper, applied uniformly across all body-subtree
//     observers.
//
// Why rAF and not setTimeout / requestIdleCallback:
//   • rAF aligns with the browser's paint cycle — DOM writes inside the
//     callback batch with the next layout pass instead of triggering an
//     extra one.
//   • rAF pauses when the tab is backgrounded — naturally reduces CPU
//     when the user isn't looking. Each module's setInterval fallback
//     (every 2-3s) keeps coverage when the tab is hidden.
//   • requestIdleCallback firing is variable + can starve; rAF is
//     predictable and bounded.
//
// Why try/catch around the callback:
//   • A throwing callback without try/catch would leave `pendingRaf=0`
//     stuck in the next iteration, blocking all future fires. Defensive
//     against bugs in caller code.

export interface RafBodyObserverHandle {
  /** The underlying MutationObserver. Most callers don't need this. */
  observer: MutationObserver;
  /** Disconnect the observer + cancel any pending rAF. Idempotent. */
  cleanup: () => void;
}

/**
 * Create a MutationObserver on `document.body { childList: true, subtree: true }`
 * whose callback fires at most once per animation frame regardless of mutation
 * burst size.
 *
 * @param callback The work to perform per frame. If a burst of mutations
 *                 arrives within the same frame, this fires exactly once at
 *                 the next rAF tick. If it throws, the next frame's tick
 *                 still fires (does not get stuck).
 */
export function createRafBodyObserver(callback: () => void): RafBodyObserverHandle {
  let pendingRaf = 0;

  const observer = new MutationObserver(() => {
    if (pendingRaf !== 0) return;
    pendingRaf = requestAnimationFrame(() => {
      pendingRaf = 0;
      try {
        callback();
      } catch (err) {
        console.warn('[FeelingWise] rAF body observer callback threw:', err);
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const cleanup = (): void => {
    observer.disconnect();
    if (pendingRaf !== 0) {
      cancelAnimationFrame(pendingRaf);
      pendingRaf = 0;
    }
  };

  return { observer, cleanup };
}

/**
 * Trailing-edge throttle: `call()` runs `fn` at once when the window has
 * elapsed, otherwise schedules exactly one run for the end of the window.
 * The earlier "skip if inside the window" throttle DROPPED the call, so a
 * post inserted right after a sweep was not hidden until the 2 s poll
 * (measured 2026-09-03: reply prompts p50 1.3 s, max 2.0 s). Nothing is
 * dropped here; the worst case is one window.
 */
export function trailingThrottle(fn: () => void, windowMs: number): { call: () => void; cancel: () => void } {
  // "Never ran" must not collide with a clock reading of 0 (fake timers).
  let lastRun = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  const run = (): void => {
    timer = 0;
    lastRun = Date.now();
    fn();
  };
  return {
    call() {
      if (timer) return;
      const wait = windowMs - (Date.now() - lastRun);
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    },
  };
}
