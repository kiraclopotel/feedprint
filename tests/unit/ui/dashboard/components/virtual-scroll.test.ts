// Feed virtual-scroll math (computeVirtualRange). The feed is windowed against
// window.scrollY with top/bottom spacers; computeVirtualRange decides which rows
// mount and the spacer heights. Scroll position is held by NATIVE browser
// anchoring (CSS overflow-anchor), not JS — the old anchorScrollDelta compensator
// was removed (known-issues M34), so there is no JS scroll math left to test here.

import { describe, it, expect } from 'vitest';
import {
  buildOffsets,
  computeVirtualRange,
  FEED_ESTIMATED_H,
} from '../../../../../src/ui/dashboard/components/virtual-scroll';

const keyAt = (i: number) => `k${i}`;

describe('computeVirtualRange', () => {
  it('returns the empty range for zero items', () => {
    expect(computeVirtualRange(0, keyAt, new Map(), 0, 0, 800)).toEqual({
      start: 0, end: -1, topH: 0, bottomH: 0,
    });
  });

  it('at the top, start is 0 and topH is 0', () => {
    const r = computeVirtualRange(100, keyAt, new Map(), 0, 0, 800);
    expect(r.start).toBe(0);
    expect(r.topH).toBe(0);
  });

  it('topH equals the cumulative estimated height of items above start', () => {
    // Scroll far down with all-estimated heights; topH must be start * estimate.
    const r = computeVirtualRange(1000, keyAt, new Map(), 0, 100_000, 800);
    expect(r.start).toBeGreaterThan(0);
    expect(r.topH).toBe(r.start * FEED_ESTIMATED_H);
  });

  it('uses measured heights over the estimate when present', () => {
    const heights = new Map<string, number>();
    for (let i = 0; i < 5; i++) heights.set(`k${i}`, 100); // 5 short rows above
    // scrollY chosen so the first 5 short rows are above the viewport+overscan.
    const r = computeVirtualRange(50, keyAt, heights, 0, 1500, 800);
    // topH must reflect the 100px measured rows, not FEED_ESTIMATED_H estimates, for any
    // measured index below start.
    expect(r.topH).toBeLessThan(r.start * FEED_ESTIMATED_H + 1);
  });

  // Q25: the hook caches buildOffsets and hands the prebuilt result in; the
  // range computed from a prebuilt cache must be identical to the inline
  // build, or the cache would silently shift the mounted window.
  it('a prebuilt offsets cache yields the identical range', () => {
    const heights = new Map<string, number>();
    for (let i = 0; i < 20; i++) heights.set(`k${i}`, 150 + (i % 3) * 40);
    const prebuilt = buildOffsets(500, keyAt, heights);
    for (const scrollY of [0, 900, 5_000, 90_000]) {
      const inline = computeVirtualRange(500, keyAt, heights, 0, scrollY, 800);
      const cached = computeVirtualRange(500, keyAt, heights, 0, scrollY, 800, prebuilt);
      expect(cached).toEqual(inline);
    }
  });

  it('buildOffsets totals match the per-row sum', () => {
    const heights = new Map<string, number>([['k0', 123], ['k2', 77]]);
    const { offsets, totalH } = buildOffsets(4, keyAt, heights);
    expect(offsets).toEqual([0, 123, 123 + FEED_ESTIMATED_H, 123 + FEED_ESTIMATED_H + 77]);
    expect(totalH).toBe(123 + FEED_ESTIMATED_H + 77 + FEED_ESTIMATED_H);
  });
});
