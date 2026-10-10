// @vitest-environment jsdom
//
// Behavior locks for the feed windowing hook (src/ui/dashboard/hooks/
// use-virtual-scroll.ts). Both used to be source-text greps on Dashboard.tsx;
// they now mount the hook and observe what it does.
//
// 1. The unmount ResizeObserver tick must never poison the height map. A row
//    the windowing removes from the DOM gets a final callback with contentRect
//    0x0; storing that 0 makes the spacer math count the row as 0px tall, so
//    the feed's total height collapses and native scroll anchoring turns the
//    churn into whole-feed flicker (found 2026-07-01, post-reset feed).
//    A disconnected element is never a real measurement.
// 2. Q25 offsets cache: cumulative offsets are rebuilt only when the row set
//    or a measured height changes, never per scroll frame.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useCallback } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const buildOffsetsSpy = vi.fn();
vi.mock('../../../../../src/ui/dashboard/components/virtual-scroll', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/ui/dashboard/components/virtual-scroll')>();
  const buildOffsets: typeof actual.buildOffsets = (...args) => {
    buildOffsetsSpy();
    return actual.buildOffsets(...args);
  };
  return { ...actual, buildOffsets };
});

import { useVirtualScroll } from '../../../../../src/ui/dashboard/components/use-virtual-scroll';
import { FEED_ESTIMATED_H } from '../../../../../src/ui/dashboard/components/virtual-scroll';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ROCallback = (entries: Array<{ target: Element; contentRect: { height: number } }>) => void;
let roCallback: ROCallback | null = null;

class FakeResizeObserver {
  constructor(cb: ROCallback) { roCallback = cb; }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const ROW_COUNT = 200;
const keyOf = (i: number): string => `k${i}`;

let lastRange = { start: 0, end: -1, topH: 0, bottomH: 0 };
function Feed({ count }: { count: number }) {
  const keyAt = useCallback((i: number) => keyOf(i), []);
  const { containerRef, range } = useVirtualScroll(count, keyAt);
  lastRange = range;
  const rows = [];
  for (let i = range.start; i <= range.end; i++) {
    rows.push(createElement('div', { key: keyOf(i), 'data-fw-key': keyOf(i) }));
  }
  return createElement('div', { ref: containerRef }, ...rows);
}

let host: HTMLDivElement;
let root: Root;

// rAF runs as a macrotask so the hook's "one recompute per frame" latch
// releases between calls (a synchronous stub would leave it latched).
const nextFrame = async (): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

beforeEach(async () => {
  buildOffsetsSpy.mockClear();
  roCallback = null;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root.render(createElement(Feed, { count: ROW_COUNT })); });
  await nextFrame();
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.unstubAllGlobals();
});

function totalHeight(r: typeof lastRange, measured: Map<string, number>): number {
  let mounted = 0;
  for (let i = r.start; i <= r.end; i++) mounted += measured.get(keyOf(i)) ?? FEED_ESTIMATED_H;
  return r.topH + mounted + r.bottomH;
}

describe('useVirtualScroll: unmount ResizeObserver tick must never poison the height map', () => {
  it('mounts a window with a bottom spacer that accounts for the unmounted rows', () => {
    expect(lastRange.start).toBe(0);
    expect(lastRange.end).toBeLessThan(ROW_COUNT - 1);
    expect(totalHeight(lastRange, new Map())).toBe(ROW_COUNT * FEED_ESTIMATED_H);
  });

  it('a CONNECTED row measurement changes the spacer math (the observer is wired)', async () => {
    expect(roCallback).not.toBeNull();
    const before = lastRange;
    const row = host.querySelector('[data-fw-key="k0"]')!;
    expect(row.isConnected).toBe(true);
    await act(async () => { roCallback!([{ target: row, contentRect: { height: 900 } }]); });
    await nextFrame();
    const measured = new Map([['k0', 900]]);
    expect(totalHeight(lastRange, measured)).toBe(ROW_COUNT * FEED_ESTIMATED_H + 900 - FEED_ESTIMATED_H);
    expect(lastRange).not.toEqual(before);
  });

  it('a DISCONNECTED row reporting 0x0 is ignored: the total feed height does not collapse', async () => {
    const before = lastRange;
    const ghost = document.createElement('div');
    ghost.dataset.fwKey = 'k0';
    expect(ghost.isConnected).toBe(false);
    await act(async () => { roCallback!([{ target: ghost, contentRect: { height: 0 } }]); });
    await nextFrame();
    // Without the guard the stored 0 shrinks the total by one estimated row
    // and moves the window; with it nothing about the range changes.
    expect(lastRange).toEqual(before);
    expect(totalHeight(lastRange, new Map())).toBe(ROW_COUNT * FEED_ESTIMATED_H);
  });
});

describe('useVirtualScroll: offsets cache keyed on count, keyAt and heights version (Q25)', () => {
  it('scroll frames reuse the cached offsets; only a height change or a new row set rebuilds', async () => {
    const initialBuilds = buildOffsetsSpy.mock.calls.length;
    expect(initialBuilds).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 5; i++) {
      await act(async () => { window.dispatchEvent(new Event('scroll')); });
      await nextFrame();
    }
    expect(buildOffsetsSpy.mock.calls.length).toBe(initialBuilds);

    const row = host.querySelector('[data-fw-key="k1"]')!;
    await act(async () => { roCallback!([{ target: row, contentRect: { height: 650 } }]); });
    await nextFrame();
    expect(buildOffsetsSpy.mock.calls.length).toBe(initialBuilds + 1);

    await act(async () => { root.render(createElement(Feed, { count: ROW_COUNT + 10 })); });
    await nextFrame();
    expect(buildOffsetsSpy.mock.calls.length).toBeGreaterThan(initialBuilds + 1);
  });
});
