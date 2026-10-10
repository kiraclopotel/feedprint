// FeelingWise — YouTube /watch node-accumulation guard (renderer-OOM fix).
//
// Root cause (2026-06-05 OOM hunt): the body MutationObserver accumulates added
// nodes into _pendingNodes, drained ONLY inside requestAnimationFrame. A
// backgrounded *playing* YouTube tab suspends rAF while the MO keeps firing →
// the Set grows without bound until the renderer OOMs. The interceptor has no
// work on /watch anyway, so accumulation is skipped there. This locks the pure
// decision; the MO wiring + visibilitychange backstop are live-verified.

import { describe, it, expect } from 'vitest';
import { shouldSkipNodeAccumulation } from '../../../../src/content/post-path/dom-interceptor';

describe('shouldSkipNodeAccumulation', () => {
  it('SKIPS on YouTube /watch (the OOM surface; yt-watch-comments.ts captures it through its own observer)', () => {
    expect(shouldSkipNodeAccumulation('youtube', '/watch')).toBe(true);
    expect(shouldSkipNodeAccumulation('youtube', '/watch?v=abc123')).toBe(true);
  });

  it('does NOT skip the home feed since 2026-09-17: its tiles are records (PLAN-2026-09-17 item 6), and the observer is bounded now', () => {
    // Skipped from 2026-06-07 (the heap capture that showed youtube.com home climbing) until the
    // pending cap, the visibilitychange drop, the churn breaker, the heap valve and the adapter's
    // per-page tile cap existed. platforms/youtube.ts reads the tiles.
    expect(shouldSkipNodeAccumulation('youtube', '/')).toBe(false);
  });

  it('does NOT skip on channel / community / shorts (community posts can surface there)', () => {
    expect(shouldSkipNodeAccumulation('youtube', '/@creator')).toBe(false);
    expect(shouldSkipNodeAccumulation('youtube', '/@creator/community')).toBe(false);
    expect(shouldSkipNodeAccumulation('youtube', '/shorts/abc')).toBe(false);
    expect(shouldSkipNodeAccumulation('youtube', '/feed/subscriptions')).toBe(false);
  });

  it('does NOT skip on other platforms, even on a /watch path', () => {
    expect(shouldSkipNodeAccumulation('twitter', '/watch')).toBe(false);
    expect(shouldSkipNodeAccumulation('facebook', '/watch')).toBe(false);
    expect(shouldSkipNodeAccumulation('instagram', '/watch')).toBe(false);
    expect(shouldSkipNodeAccumulation('tiktok', '/foryou')).toBe(false);
  });
});
