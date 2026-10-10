// FeelingWise — Scroll velocity tracker.
//
// Passive scroll listener + EMA over ~2s window. Feeds ViewportInfo.velocityPxPerSec
// in queue.ts:enqueue → staleMsForVelocity → adaptive cancel-stale tier:
//   <100 px/s   → 60s   browsing  (user engaged, dispatch patiently)
//   100-500     → 20s   scanning  (moderate compute)
//   ≥500        → 8s    skimming  (cancel aggressively, user won't return)
//
// Earlier, velocityPxPerSec was hardcoded 0 in
// content/index.ts:computeViewportInfo, putting every post on the 60s tier.
// Capture measured 19% cancel-stale rate at the 60s threshold — 4× the
// ≤5% floor. Combined with token-bucket tuning (faster dispatch),
// velocity-aware staleness lets fast-scroll bursts free queue depth
// without spending Groq tokens on posts the user has visibly scrolled past.
//
// Implementation properties (per `feedback_dont_trust_code_until_understood.md`):
//
//   - PASSIVE listener — `{ passive: true }` keeps the page's own scroll
//     handlers from being blocked. The listener does no preventDefault.
//   - τ = 2000ms — single fast-scroll burst doesn't fully replace the prior
//     EMA reading; sustained fast scroll converges in ~2-3 τ. Matches the
//     ARCH §4 "browsing/scanning/skimming" velocity bands.
//   - Idle decay — getCurrentVelocity() applies pure exponential decay since
//     the last sample. Without this, a mid-scroll pause would still report
//     the last skimming velocity. Critical: a getter side-effect-free
//     decay path means concurrent reads stay coherent.
//   - DI hooks — nowFn + scrollYFn injectable for vitest deterministic tests.

const TAU_MS = 2000;
// Pathological dt-skip clamp. Without this, a 1ms dt + 1M-px scroll = 1B px/sec.
// 10k px/sec is "user reflexively flicks Magic Mouse to the bottom" — well above
// any realistic bound, well within the skim threshold (≥500).
const MAX_VELOCITY = 10_000;

export class ScrollVelocityTracker {
  private nowFn: () => number;
  private scrollYFn: () => number;
  private lastY = 0;
  private lastTime = 0;
  private velocityEma = 0;
  private started = false;

  constructor(opts: { nowFn?: () => number; scrollYFn?: () => number } = {}) {
    this.nowFn = opts.nowFn ?? Date.now;
    this.scrollYFn = opts.scrollYFn ?? (() =>
      typeof window !== 'undefined' ? window.scrollY : 0
    );
  }

  /** Idempotent — safe to call from init() on every platform initialization. */
  start(): void {
    if (this.started) return;
    if (typeof window === 'undefined') return; // SW / test-without-jsdom
    this.started = true;
    this.lastY = this.scrollYFn();
    this.lastTime = this.nowFn();
    window.addEventListener('scroll', this.handleScroll, { passive: true });
  }

  /** Test-only — releases the listener to prevent jsdom-listener pollution across tests. */
  stop(): void {
    if (!this.started) return;
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.handleScroll);
    }
    this.started = false;
    this.velocityEma = 0;
    this.lastY = 0;
    this.lastTime = 0;
  }

  private handleScroll = (): void => {
    const t = this.nowFn();
    const dt = t - this.lastTime;
    if (dt <= 0) return; // duplicate same-tick event — ignore
    const y = this.scrollYFn();
    const instant = Math.min(MAX_VELOCITY, Math.abs((y - this.lastY) * 1000 / dt));
    const alpha = 1 - Math.exp(-dt / TAU_MS);
    this.velocityEma = alpha * instant + (1 - alpha) * this.velocityEma;
    this.lastY = y;
    this.lastTime = t;
  };

  /**
   * px/sec, decayed by time-since-last-sample so a long pause reports ~0
   * (otherwise a 5s-old skim reading would keep cancel-stale at 8s for
   * posts the user has now stopped to read).
   */
  getCurrentVelocity(): number {
    if (!this.started) return 0;
    const dt = this.nowFn() - this.lastTime;
    if (dt <= 0) return Math.max(0, this.velocityEma);
    const decay = Math.exp(-dt / TAU_MS);
    return Math.max(0, decay * this.velocityEma);
  }
}

// ─── Module singleton ────────────────────────────────────────────────────────

let singleton: ScrollVelocityTracker | null = null;

function getScrollVelocityTracker(): ScrollVelocityTracker {
  if (!singleton) singleton = new ScrollVelocityTracker();
  return singleton;
}

/** Read current velocity. Returns 0 before startScrollVelocityTracking() runs. */
export function getCurrentVelocity(): number {
  return getScrollVelocityTracker().getCurrentVelocity();
}

/** Idempotent — wires the passive scroll listener to window. */
export function startScrollVelocityTracking(): void {
  getScrollVelocityTracker().start();
}
