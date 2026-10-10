// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordAiCall, incrementNeutralized, utcDayKey, utcMonthKey } from '../../../src/storage/settings';

// The lost-update race is a property of the read-modify-write, not of one counter. It was found on
// metricsHidden (board queue item 4) and the two counters here had it identically, in the same
// file, one line apart. `increment-metrics-hidden.test.ts` covers metricsHidden; this covers the
// other two so a future edit cannot quietly un-serialise them.
//
// The storage mock resolves on a microtask, which is what makes the race reproducible: without
// serialisation every overlapping call reads before any of them writes.

interface MockStorage {
  data: Record<string, unknown>;
}

let mockStorage: MockStorage;

beforeEach(() => {
  mockStorage = { data: { lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() } };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn(async () => ({ ...mockStorage.data })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          Object.assign(mockStorage.data, patch);
        }),
        remove: vi.fn(async () => { /* no-op */ }),
      },
      onChanged: { addListener: vi.fn() },
    },
  };
});

describe('counter writes survive overlapping callers', () => {
  it('recordAiCall counts every overlapping call', async () => {
    await Promise.all(
      Array.from({ length: 8 }, () =>
        recordAiCall({ inputTokens: 0, outputTokens: 0, tokenEquivalents: 0, provider: 'groq' }),
      ),
    );

    expect(mockStorage.data.totalChecksToday).toBe(8);
    expect(mockStorage.data.totalChecksThisMonth).toBe(8);
    expect(mockStorage.data.totalChecksAllTime).toBe(8);
  });

  it('incrementNeutralized counts every overlapping call', async () => {
    await Promise.all(Array.from({ length: 8 }, () => incrementNeutralized()));

    expect(mockStorage.data.totalNeutralizedToday).toBe(8);
    expect(mockStorage.data.totalNeutralizedAllTime).toBe(8);
  });

  it('a failed write does not stop the increments queued behind it', async () => {
    // One caller's storage write rejects. The counter it was writing is lost, which is correct and
    // unavoidable, but the shared chain must not stay poisoned: the calls behind it still land.
    const chrome = (globalThis as unknown as { chrome: { storage: { local: { set: (patch: Record<string, unknown>) => Promise<void> } } } }).chrome;
    const realSet = chrome.storage.local.set;
    let failed = false;
    chrome.storage.local.set = vi.fn(async (patch: Record<string, unknown>) => {
      if (!failed) {
        failed = true;
        throw new Error('storage unavailable');
      }
      return realSet(patch);
    });

    const results = await Promise.allSettled([
      incrementNeutralized(),
      incrementNeutralized(),
      incrementNeutralized(),
    ]);

    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(mockStorage.data.totalNeutralizedToday).toBe(2);
  });
});
