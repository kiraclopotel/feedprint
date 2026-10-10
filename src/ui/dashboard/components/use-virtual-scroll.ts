import { useCallback, useEffect, useRef, useState } from 'react';
import { buildOffsets, computeVirtualRange } from '../components/virtual-scroll';

// ─── Feed virtual-scroll ───────────────────────────────────────────────────
//
// Why: mounting every group in a long chain keeps thousands of
// PostGroupCard/FeedCard fibers alive and re-reconciling on every interaction.
// True windowing keeps ~25-50 nodes mounted regardless of feed size.
//
// Approach: window-level scroll tracking + ResizeObserver height measurement.
// Items outside [scrollTop − OVERSCAN, scrollTop + viewH + OVERSCAN] are
// unmounted and replaced by top/bottom spacer <div>s that preserve scroll
// height.  Unmeasured items fall back to FEED_ESTIMATED_H until their first
// ResizeObserver callback fires. The pure math (computeVirtualRange) lives in
// ../components/virtual-scroll and is unit-tested. Scroll position is held by
// native browser anchoring (overflow-anchor), not JS — see useVirtualScroll.

/**
 * Hook: returns { containerRef, range, reportHeight }.
 * Attach containerRef to the fc-timeline div.  Call reportHeight whenever a
 * row measures its own height.  range is the slice to render.
 */
export function useVirtualScroll(count: number, keyAt: (i: number) => string) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const heightsRef   = useRef<Map<string, number>>(new Map());

  const [range, setRange] = useState({ start: 0, end: count > 0 ? Math.min(40, count - 1) : -1, topH: 0, bottomH: 0 });

  // Scroll position is held by NATIVE browser scroll-anchoring, not JS. The feed
  // scrolls the window; when the windowed rows mount/unmount and the spacers
  // resize, the browser keeps the visible anchor row fixed on its own (rows are
  // anchor candidates; the spacers are overflow-anchor:none so they're never the
  // anchor — see dashboard-design.css .fc-timeline). The earlier hand-rolled
  // window.scrollTo() compensator raced the scroll handler and yanked the feed up
  // a row mid-scroll (known-issues M34); it is gone. recompute() now ONLY updates
  // which rows are mounted + the spacer heights — it never moves the scroll.
  // Q25 offsets cache: cumulative row offsets change only when the row set
  // (count/keyAt) or a measured height changes, yet they were rebuilt with a
  // full O(n) pass + allocation on every scroll frame. heightsVersionRef
  // bumps on every heights-map mutation; recompute reuses the cached build
  // while (count, keyAt, version) match.
  const heightsVersionRef = useRef(0);
  const offsetsCacheRef = useRef<{
    count: number;
    keyAt: (i: number) => string;
    version: number;
    built: { offsets: number[]; totalH: number };
  } | null>(null);

  const recompute = useCallback(() => {
    const container = containerRef.current;
    if (count === 0) {
      setRange(prev =>
        prev.start === 0 && prev.end === -1 && prev.topH === 0 && prev.bottomH === 0
          ? prev
          : { start: 0, end: -1, topH: 0, bottomH: 0 },
      );
      return;
    }
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const scrollYNow = window.scrollY;
    const containerTop = rect.top + scrollYNow;
    const cache = offsetsCacheRef.current;
    const version = heightsVersionRef.current;
    const built = cache && cache.count === count && cache.keyAt === keyAt && cache.version === version
      ? cache.built
      : buildOffsets(count, keyAt, heightsRef.current);
    offsetsCacheRef.current = { count, keyAt, version, built };
    const next = computeVirtualRange(
      count, keyAt, heightsRef.current, containerTop, scrollYNow, window.innerHeight, built,
    );
    setRange(prev =>
      prev.start === next.start && prev.end === next.end &&
      prev.topH  === next.topH  && prev.bottomH === next.bottomH
        ? prev : next
    );
  }, [count, keyAt]);

  // Scroll / resize listener (throttled to rAF)
  useEffect(() => {
    let raf = 0;
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; recompute(); }); };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    recompute();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [recompute]);

  // Re-run when count changes (new records arrived)
  useEffect(() => { recompute(); }, [count, recompute]);

  // Keep measured row heights tied to the active row identity set. Count-only
  // clearing misses filter/sort swaps with the same number of rows; stale
  // heights then push the virtual spacers around and look like scroll flicker.
  useEffect(() => {
    const liveKeys = new Set<string>();
    for (let i = 0; i < count; i++) liveKeys.add(keyAt(i));
    let changed = false;
    for (const key of Array.from(heightsRef.current.keys())) {
      if (!liveKeys.has(key)) {
        heightsRef.current.delete(key);
        heightsVersionRef.current += 1;
        changed = true;
      }
    }
    if (changed) recompute();
  }, [count, keyAt, recompute]);

  // Measure heights from data-fw-key direct children of the container.
  // ResizeObserver fires when any measured child changes height; MutationObserver
  // re-wires after the virtual window mounts/unmounts items.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    const scheduleRecompute = () => {
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; recompute(); });
    };
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const key = el.dataset.fwKey;
        if (!key) continue;
        // A row REMOVED from the DOM (unmounted by the windowing) gets a final
        // ResizeObserver tick with contentRect 0×0. Storing that 0 poisons the
        // spacer math: `heights.get(key) ?? FEED_ESTIMATED_H` does not rescue a
        // stored 0, so every previously-unmounted row counts as 0px tall —
        // total feed height collapses/restores at rAF rate and native scroll
        // anchoring turns it into self-sustaining feed flicker + scroll-position
        // teleports (verified in docs/redesign/mockups/2026-07-01/
        // feed-divider-oscillation.html: jump probe park 20000px → dragged to 0
        // unguarded, rock-stable guarded). A disconnected element is never a
        // real measurement.
        if (!el.isConnected) continue;
        const h = Math.round(entry.contentRect.height);
        const prevH = heightsRef.current.get(key);
        if (prevH !== h) {
          // Scroll-stability probe (opt-in; zero cost unless enabled). A card that
          // RE-measures to a materially different height AFTER its first measurement
          // is the #412 instability signature — a stable card measures once and holds.
          // With content-visibility removed this should stay silent during a passive
          // scroll; a burst here means something is flipping card heights mid-scroll
          // again. Enable from the dashboard DevTools console: `window.__FW_FEED_DEBUG
          // = true`, then scroll the media-heavy tail near the latest record.
          if (prevH !== undefined && Math.abs(h - prevH) >= 24 &&
              typeof window !== 'undefined' && (window as unknown as { __FW_FEED_DEBUG?: boolean }).__FW_FEED_DEBUG) {
            console.debug(`[fw-feed] card ${key} re-measured ${prevH}→${h}px (Δ${h - prevH}px) during scroll`);
          }
          heightsRef.current.set(key, h);
          heightsVersionRef.current += 1;
          changed = true;
        }
      }
      if (changed) scheduleRecompute();
    });
    const observeChildren = () => {
      for (const child of container.children) {
        const el = child as HTMLElement;
        if (el.dataset.fwKey) ro.observe(el);
      }
    };
    const mo = new MutationObserver(observeChildren);
    mo.observe(container, { childList: true });
    observeChildren();
    return () => {
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [recompute]);

  return { containerRef, range };
}
