// @vitest-environment jsdom
//
// STORAGE-LICENCE-WORKER-7 and -9: the service worker is the single writer
// of the usage counters.
//
// Before: every realm (each content script, the popup) ran its own
// read-modify-write on chrome.storage.local. Two tabs incrementing at the
// same instant lost one, and at a UTC rollover a realm whose 5 s settings
// cache still held yesterday's snapshot wrote yesterday's count plus one
// into the new period, where it stayed until the next rollover.
//
// Now a realm with a document sends USAGE_INCREMENT and never touches
// storage; the worker applies every increment behind one chain and
// re-reads storage when its snapshot's period keys are behind the clock.
//
// This file models two "tabs" as two callers in a page realm whose
// chrome.runtime.sendMessage delivers to a worker-side applier over the
// same fake storage, and a rollover where another realm has already reset
// the day while the worker's cache still holds yesterday.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Fake {
  state: Record<string, unknown>;
  sets: Array<{ patch: Record<string, unknown>; fromWorker: boolean }>;
  sent: unknown[];
  inWorker: number;
}

let fake: Fake;

function installChrome(initial: Record<string, unknown>, deliver: (payload: unknown) => Promise<unknown>) {
  fake = { state: { ...initial }, sets: [], sent: [], inWorker: 0 };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        // Resolves on a microtask so overlapping callers can interleave.
        get: vi.fn(async () => ({ ...fake.state })),
        set: vi.fn(async (patch: Record<string, unknown>) => {
          fake.sets.push({ patch, fromWorker: fake.inWorker > 0 });
          Object.assign(fake.state, patch);
        }),
        remove: vi.fn(async () => undefined),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      id: 'fw-test',
      sendMessage: vi.fn(async (message: { type: string; payload: unknown }) => {
        fake.sent.push(message);
        if (message.type !== 'USAGE_INCREMENT') return undefined;
        fake.inWorker += 1;
        try {
          await deliver(message.payload);
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        } finally {
          fake.inWorker -= 1;
        }
      }),
    },
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('usage counters: the service worker is the single writer', () => {
  it('two concurrent increments from two tabs land as one consistent count, written only by the worker', async () => {
    const settingsPromise = import('../../../src/storage/settings');
    const { utcDayKey, utcMonthKey } = await settingsPromise;
    installChrome(
      { lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(), totalChecksToday: 0, totalChecksThisMonth: 0, totalChecksAllTime: 0 },
      // The worker side: the same module's applier, as the SW handler calls it.
      async payload => {
        const { applyUsageIncrement } = await settingsPromise;
        await applyUsageIncrement(payload as Parameters<typeof applyUsageIncrement>[0]);
      },
    );
    const { recordAiCall, isCounterWriterRealm } = await settingsPromise;
    const call = { inputTokens: 0, outputTokens: 0, tokenEquivalents: 0, provider: 'groq' };
    expect(isCounterWriterRealm()).toBe(false);

    // Tab A and tab B fire at the same instant.
    await Promise.all([recordAiCall(call), recordAiCall(call)]);

    expect(fake.state.totalChecksToday).toBe(2);
    expect(fake.state.totalChecksThisMonth).toBe(2);
    expect(fake.state.totalChecksAllTime).toBe(2);
    expect(fake.sent.filter(m => (m as { type: string }).type === 'USAGE_INCREMENT')).toHaveLength(2);
    // Every storage write came from the worker side; the tabs wrote nothing.
    expect(fake.sets.length).toBeGreaterThan(0);
    expect(fake.sets.every(s => s.fromWorker)).toBe(true);
  });

  it('a tab whose increment is not acknowledged logs the loss once and writes nothing itself', async () => {
    const settingsPromise = import('../../../src/storage/settings');
    const { utcDayKey, utcMonthKey } = await settingsPromise;
    installChrome({ lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() }, async () => {
      throw new Error('storage unavailable');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { incrementMetricsHidden } = await settingsPromise;
    await expect(incrementMetricsHidden(3)).resolves.toBeUndefined();
    await incrementMetricsHidden(1);
    expect(fake.sets).toHaveLength(0);
    const lossWarnings = warn.mock.calls.filter(c => String(c[0]).includes('usage increment'));
    expect(lossWarnings).toHaveLength(1);
    expect(String(lossWarnings[0][0])).toContain('storage unavailable');
    warn.mockRestore();
  });

  it('a period rollover re-reads storage before writing, so yesterday is not carried into today', async () => {
    // Worker realm: no document.
    const doc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
    try {
      vi.useFakeTimers();
      // 23:59:58 UTC on the last day of a month, so both keys roll together.
      vi.setSystemTime(new Date('2026-08-31T23:59:58.000Z'));
      const settings = await import('../../../src/storage/settings');
      const { applyUsageIncrement, getSettings, isCounterWriterRealm, utcDayKey, utcMonthKey } = settings;
      expect(isCounterWriterRealm()).toBe(true);
      installChrome(
        {
          lastResetDate: utcDayKey(),
          lastResetMonth: utcMonthKey(),
          totalChecksToday: 1990,
          totalChecksThisMonth: 40_000,
          totalChecksAllTime: 90_000,
        },
        async () => undefined,
      );

      // Prime the worker's 5 s cache with yesterday's snapshot.
      const primed = await getSettings();
      expect(primed.totalChecksToday).toBe(1990);

      // Three seconds later the UTC day and month have rolled; the cache is
      // still inside its TTL. Another realm has already written the reset.
      vi.setSystemTime(new Date('2026-09-01T00:00:01.000Z'));
      Object.assign(fake.state, {
        totalChecksToday: 0,
        totalNeutralizedToday: 0,
        totalTokensToday: 0,
        estimatedCostToday: 0,
        metricsHiddenToday: 0,
        lastResetDate: utcDayKey(),
        totalChecksThisMonth: 0,
        totalTokensThisMonth: 0,
        lastResetMonth: utcMonthKey(),
      });

      await applyUsageIncrement({ kind: 'ai-call', inputTokens: 0, outputTokens: 0, tokenEquivalents: 0, provider: 'groq' });

      expect(fake.state.totalChecksToday).toBe(1);
      expect(fake.state.totalChecksThisMonth).toBe(1);
      expect(fake.state.totalChecksAllTime).toBe(90_001);
      expect(fake.state.lastResetDate).toBe('2026-09-01');
      expect(fake.state.lastResetMonth).toBe('2026-09');
    } finally {
      if (doc) Object.defineProperty(globalThis, 'document', doc);
    }
  });

  it('a rollover the worker sees first resets storage itself before counting', async () => {
    const doc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: undefined });
    try {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-23T23:59:58.000Z'));
      const settings = await import('../../../src/storage/settings');
      const { applyUsageIncrement, getSettings, utcDayKey, utcMonthKey } = settings;
      installChrome(
        { lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(), totalChecksToday: 1990, totalChecksThisMonth: 100, totalChecksAllTime: 500 },
        async () => undefined,
      );
      await getSettings();
      vi.setSystemTime(new Date('2026-08-24T00:00:01.000Z'));

      await applyUsageIncrement({ kind: 'ai-call', inputTokens: 0, outputTokens: 0, tokenEquivalents: 0, provider: 'groq' });

      expect(fake.state.totalChecksToday).toBe(1);
      expect(fake.state.lastResetDate).toBe('2026-08-24');
      // Same month: the monthly counter keeps counting.
      expect(fake.state.totalChecksThisMonth).toBe(101);
      expect(fake.state.totalChecksAllTime).toBe(501);
    } finally {
      if (doc) Object.defineProperty(globalThis, 'document', doc);
    }
  });
});
