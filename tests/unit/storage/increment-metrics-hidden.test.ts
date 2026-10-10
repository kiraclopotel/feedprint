// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { incrementMetricsHidden, utcDayKey, utcMonthKey } from '../../../src/storage/settings';

// 2026-05-04 §CT-5 — engagement-hide counter increment.
// Wired into per-platform engagement files at the dataset.fw*='hidden' assignment
// points. Default increment is 1 (one DOM element transitioned to hidden); per-element
// metrics-only loops pass N. Privacy-aware: respects §CT-3 disableLocalStats toggle.

interface MockStorage {
  data: Record<string, unknown>;
  setArgs: Array<Record<string, unknown>>;
}

let mockStorage: MockStorage;

beforeEach(() => {
  mockStorage = { data: {}, setArgs: [] };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...mockStorage.data })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          mockStorage.setArgs.push(patch);
          Object.assign(mockStorage.data, patch);
        }),
        remove: vi.fn(async () => { /* no-op */ }),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('incrementMetricsHidden — engagement-hide counter', () => {
  it('default increment is 1', async () => {
    mockStorage.data = {
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
    };
    await incrementMetricsHidden();
    const setCall = mockStorage.setArgs.find(a => 'metricsHiddenToday' in a);
    expect(setCall).toBeDefined();
    expect(setCall!.metricsHiddenToday).toBe(1);
    expect(setCall!.metricsHiddenAllTime).toBe(1);
  });

  it('explicit increment by N adds N', async () => {
    mockStorage.data = {
      metricsHiddenToday: 7,
      metricsHiddenAllTime: 100,
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
    };
    await incrementMetricsHidden(5);
    const setCall = mockStorage.setArgs.find(a => 'metricsHiddenToday' in a);
    expect(setCall!.metricsHiddenToday).toBe(12);
    expect(setCall!.metricsHiddenAllTime).toBe(105);
  });

  it('merges the per-switch tally into hiddenByFeature, all-time', async () => {
    mockStorage.data = {
      metricsHiddenAllTime: 10,
      hiddenByFeature: { 'block-ads': 2, 'no-swearing': 5 },
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
    };
    await incrementMetricsHidden(3, { 'block-ads': 3, slurs: 1 });
    const setCall = mockStorage.setArgs.find(a => 'hiddenByFeature' in a);
    expect(setCall!.metricsHiddenAllTime).toBe(13);
    expect(setCall!.hiddenByFeature).toEqual({ 'block-ads': 5, 'no-swearing': 5, slurs: 1 });
  });

  it('a tally with nothing hidden (starred words) still writes', async () => {
    mockStorage.data = { lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() };
    await incrementMetricsHidden(0, { 'no-swearing': 2 });
    const setCall = mockStorage.setArgs.find(a => 'hiddenByFeature' in a);
    expect(setCall!.metricsHiddenAllTime).toBe(0);
    expect(setCall!.hiddenByFeature).toEqual({ 'no-swearing': 2 });
  });

  it('zero or negative increment is no-op (defensive)', async () => {
    mockStorage.data = {
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
    };
    await incrementMetricsHidden(0);
    await incrementMetricsHidden(-3);
    const writes = mockStorage.setArgs.filter(a => 'metricsHiddenToday' in a);
    expect(writes.length).toBe(0);
  });

  // Queue item 4. The ten call sites all fire `void incrementMetricsHidden()` from DOM handlers,
  // so on a single paint that hides many elements the calls overlap. Every overlapping call used
  // to read the same stored value before any of them had written, and the last write won: ten
  // hides were recorded as one. The number this undercounts is "hidden from your child", which is
  // the one figure on the dashboard that shows a parent what they are paying for.
  //
  // Awaiting at the call sites is not the fix. They are synchronous DOM paths and blocking them
  // on storage would trade a wrong number for a slow feed. The read-modify-write serialises
  // inside the function instead.
  it('does not lose overlapping increments', async () => {
    mockStorage.data = {
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
    };

    await Promise.all(Array.from({ length: 10 }, () => incrementMetricsHidden()));

    expect(mockStorage.data.metricsHiddenToday).toBe(10);
    expect(mockStorage.data.metricsHiddenAllTime).toBe(10);
  });

  it('does not lose overlapping increments of mixed size', async () => {
    mockStorage.data = {
      metricsHiddenToday: 4,
      metricsHiddenAllTime: 40,
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
    };

    await Promise.all([
      incrementMetricsHidden(3),
      incrementMetricsHidden(),
      incrementMetricsHidden(6),
    ]);

    expect(mockStorage.data.metricsHiddenToday).toBe(14);
    expect(mockStorage.data.metricsHiddenAllTime).toBe(50);
  });

  it('handles missing initial counters as 0 (back-compat for pre-§CT-5 installs)', async () => {
    mockStorage.data = {
      // No metricsHiddenToday / AllTime — installed pre-§CT-5
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
    };
    await incrementMetricsHidden(3);
    const setCall = mockStorage.setArgs.find(a => 'metricsHiddenToday' in a);
    expect(setCall!.metricsHiddenToday).toBe(3);
    expect(setCall!.metricsHiddenAllTime).toBe(3);
  });
});
