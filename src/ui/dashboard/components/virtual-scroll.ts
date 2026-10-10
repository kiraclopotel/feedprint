// Feed virtual-scroll math (window-level windowing).
//
// Extracted from Dashboard.tsx so the offset/spacer arithmetic can be
// unit-tested without a DOM. The hook in Dashboard.tsx (useVirtualScroll) owns
// the React/DOM wiring; everything here is pure. Scroll position is preserved by
// native browser anchoring (CSS overflow-anchor), not JS — there is no
// compensation math here to test.

export const FEED_OVERSCAN = 800;   // px above/below viewport to keep mounted
export const FEED_ESTIMATED_H = 400; // fallback height (media cards are 420-500px; text-only ~200px; 400 splits the difference)

export interface VirtualRange {
  start: number;
  end: number;
  topH: number;
  bottomH: number;
}

/**
 * Computes which indices should be mounted given current scroll + viewport.
 * Also returns spacer heights so the scroll-height stays correct.
 */
/**
 * Cumulative offsets for the current row set. O(n) with a keyAt call and a
 * Map lookup per row, plus an n-slot allocation. Q25: this used to run
 * inside computeVirtualRange on EVERY animation frame while scrolling; at
 * the 10k-record cap that meant 10k lookups plus a 10k-slot allocation per
 * frame purely to re-derive numbers that only change when the row set or a
 * measured height changes. The hook now caches this result and rebuilds it
 * only on (count, keyAt identity, heights version) change; the per-frame
 * path is the O(log n) search below.
 */
export function buildOffsets(
  count: number,
  keyAt: (i: number) => string,
  heights: Map<string, number>,
): { offsets: number[]; totalH: number } {
  let cum = 0;
  const offsets: number[] = new Array(count);
  for (let i = 0; i < count; i++) {
    offsets[i] = cum;
    cum += heights.get(keyAt(i)) ?? FEED_ESTIMATED_H;
  }
  return { offsets, totalH: cum };
}

export function computeVirtualRange(
  count: number,
  keyAt: (i: number) => string,
  heights: Map<string, number>,
  containerTop: number,   // px from page top to timeline container
  scrollY: number,
  viewH: number,
  prebuilt?: { offsets: number[]; totalH: number },
): VirtualRange {
  if (count === 0) return { start: 0, end: -1, topH: 0, bottomH: 0 };

  const { offsets, totalH } = prebuilt ?? buildOffsets(count, keyAt, heights);

  const viewTop    = scrollY - containerTop - FEED_OVERSCAN;
  const viewBottom = scrollY - containerTop + viewH + FEED_OVERSCAN;

  // Binary search: first item whose bottom edge >= viewTop
  let lo = 0, hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] + (heights.get(keyAt(mid)) ?? FEED_ESTIMATED_H) < viewTop) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;

  // Linear scan from start for end
  let end = start;
  for (let i = start + 1; i < count; i++) {
    if (offsets[i] > viewBottom) break;
    end = i;
  }

  const topH    = offsets[start];
  const bottomH = Math.max(0, totalH - offsets[end] - (heights.get(keyAt(end)) ?? FEED_ESTIMATED_H));

  return { start, end, topH, bottomH };
}

// NOTE: scroll-position preservation is NOT done in JS. The feed relies on the
// browser's NATIVE scroll-anchoring (CSS overflow-anchor) to hold the visible row
// fixed when these spacer heights change as rows mount/unmount. The earlier
// JS compensator (anchorScrollDelta + window.scrollTo) was removed: it raced the
// scroll handler and yanked the feed up a row mid-scroll (known-issues M34).
