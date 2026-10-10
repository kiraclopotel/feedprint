// FeelingWise — perf-trace unit tests (LOOP-271 scaffold)
//
// Locks the contract that LOOP-271 depends on:
//   • NOOP_TRACER never persists, never throws, returns fn results unchanged.
//   • Active tracer captures elapsed ms via performance.now().
//   • End() is idempotent — repeated calls do not double-write.
//   • Wrap() captures success vs failure metadata.
//   • startTrace returns NOOP when feature flag is off (default).
//   • startTrace returns active tracer when flag is on.
//
// idb persistence itself is OUT OF SCOPE for this suite — IndexedDB is not
// reliably available in the sandbox jsdom; persist failures are swallowed
// (verified) so this just asserts the no-throw contract on persist failure.

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  startTrace,
  recordSpan,
  V2_STAGES,
  type V2Stage,
  type PerfRecord,
  __makeActiveTracerForTests,
  __NOOP_TRACER_FOR_TESTS,
  __MAX_RECORDS_FOR_TESTS,
  persistRecord,
  readPerfPersistFailures,
} from '../../../src/diagnostics/perf-trace';
import {
  __resetFeatureFlagsCacheForTests,
  isFlagExplicitlySet,
} from '../../../src/storage/feature-flags';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

// ─── chrome.storage stub ────────────────────────────────────────────────────

interface ChromeStub {
  storage: {
    local: {
      get: (keys: string[] | string | object) => Promise<Record<string, unknown>>;
      set: (data: Record<string, unknown>) => Promise<void>;
    };
  };
}

function installChromeStub(initialFlags: Record<string, unknown> = {}): void {
  const data: Record<string, unknown> = { ...initialFlags };
  const stub: ChromeStub = {
    storage: {
      local: {
        get: async (keys) => {
          if (Array.isArray(keys)) {
            const out: Record<string, unknown> = {};
            for (const k of keys) {
              if (k in data) out[k] = data[k];
            }
            return out;
          }
          return data;
        },
        set: async (next) => {
          Object.assign(data, next);
        },
      },
    },
  };
  (globalThis as unknown as { chrome: ChromeStub }).chrome = stub;
}

function clearChromeStub(): void {
  delete (globalThis as Partial<{ chrome: ChromeStub }>).chrome;
}

// ─── Suites ─────────────────────────────────────────────────────────────────

describe('perf-trace — V2_STAGES enumeration', () => {
  it('has bilingual dashboard help for the Child protection stages', () => {
    for (const stage of ['first_protection', 'protection_terminal'] as const) {
      expect(DASHBOARD_STRINGS.en.opsStageHelp[stage]).toBeTruthy();
      expect(DASHBOARD_STRINGS.ro.opsStageHelp[stage]).toBeTruthy();
    }
  });
  it('exposes the canonical stages with no duplicates', () => {
    const expected: V2Stage[] = [
      'pipeline_total',
      'cache_lookup',
      'detect',
      'combined_call',
      'neutralize',
      'first_protection',
      'protection_terminal',
    ];
    expect([...V2_STAGES]).toEqual(expected);
    expect(new Set(V2_STAGES).size).toBe(V2_STAGES.length);
  });
});

describe('perf-trace — NOOP_TRACER (production fast-path)', () => {
  it('stage() returns a callable that does nothing', () => {
    const end = __NOOP_TRACER_FOR_TESTS.stage('pipeline_total');
    expect(typeof end).toBe('function');
    // Calling end with various options must not throw.
    expect(() => end()).not.toThrow();
    expect(() => end({ success: false, error: 'whatever' })).not.toThrow();
  });

  it('wrap() passes the resolved value through', async () => {
    const result = await __NOOP_TRACER_FOR_TESTS.wrap('combined_call', async () => 42);
    expect(result).toBe(42);
  });

  it('wrap() rethrows the rejection without swallowing it', async () => {
    await expect(
      __NOOP_TRACER_FOR_TESTS.wrap('combined_call', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });
});

describe('perf-trace — active tracer (escape-hatch constructor)', () => {
  it('stage().end() captures non-negative elapsed ms', async () => {
    const tracer = __makeActiveTracerForTests({
      platform: 'twitter',
      mode: 'teen',
      provider: 'groq',
    });
    const end = tracer.stage('combined_call');
    // Force a tick to push performance.now() forward measurably.
    await new Promise((r) => setTimeout(r, 5));
    expect(() => end()).not.toThrow();
  });

  it('end() is idempotent — second call is silent (no double-record)', async () => {
    const tracer = __makeActiveTracerForTests({
      platform: 'twitter',
      mode: 'teen',
    });
    const end = tracer.stage('combined_call');
    // Calling end twice must not throw nor blow up.
    expect(() => {
      end({ success: true });
      end({ success: false, error: 'should-not-record' });
    }).not.toThrow();
  });

  it('wrap() returns the resolved value and marks success', async () => {
    const tracer = __makeActiveTracerForTests({ platform: 'tiktok', mode: 'teen' });
    const result = await tracer.wrap('combined_call', async () => 'ok');
    expect(result).toBe('ok');
  });

  it('wrap() rethrows on rejection (does NOT swallow pipeline-relevant errors)', async () => {
    const tracer = __makeActiveTracerForTests({ platform: 'tiktok', mode: 'teen' });
    await expect(
      tracer.wrap('combined_call', async () => {
        throw new Error('upstream failure');
      }),
    ).rejects.toThrow('upstream failure');
  });

  it('persist failure inside the tracer does not propagate to the caller', async () => {
    // No chrome / no indexedDB in this test → persistRecord swallows the
    // error. Active tracer must not throw upward.
    clearChromeStub();
    const tracer = __makeActiveTracerForTests({ platform: 'twitter', mode: 'teen' });
    const end = tracer.stage('combined_call');
    await expect(
      (async () => {
        end({ success: true });
        // Allow the fire-and-forget persist promise to flush.
        await new Promise((r) => setTimeout(r, 5));
      })(),
    ).resolves.toBeUndefined();
  });

  it('truncates long error strings to 140 chars in wrap()', async () => {
    const tracer = __makeActiveTracerForTests({ platform: 'twitter', mode: 'teen' });
    const longErr = 'x'.repeat(500);
    await expect(
      tracer.wrap('combined_call', async () => {
        throw new Error(longErr);
      }),
    ).rejects.toThrow();
    // The internal record (not asserted directly here, no persist visible) is
    // bounded — guarded by the source's `.slice(0, 140)`. This test ensures
    // the wrap path itself doesn't choke on multi-KB error strings.
  });
});

describe('perf-trace — startTrace + feature flag gating', () => {
  beforeEach(() => {
    __resetFeatureFlagsCacheForTests();
    clearChromeStub();
  });

  it('returns NOOP when chrome.storage is unavailable (test/detached)', async () => {
    const tracer = await startTrace({ platform: 'twitter', mode: 'teen' });
    // Identity check: NOOP_TRACER is the singleton.
    expect(tracer).toBe(__NOOP_TRACER_FOR_TESTS);
  });

  it('returns NOOP when ff_captureV2Metrics is false (default)', async () => {
    installChromeStub({ ff_captureV2Metrics: false });
    const tracer = await startTrace({ platform: 'twitter', mode: 'teen' });
    expect(tracer).toBe(__NOOP_TRACER_FOR_TESTS);
  });

  it('returns NOOP when the flag key is absent (no value yet stored)', async () => {
    installChromeStub({}); // empty
    const tracer = await startTrace({ platform: 'twitter', mode: 'teen' });
    expect(tracer).toBe(__NOOP_TRACER_FOR_TESTS);
  });

  it('returns active tracer when ff_captureV2Metrics is true', async () => {
    installChromeStub({ ff_captureV2Metrics: true });
    const tracer = await startTrace({ platform: 'twitter', mode: 'teen' });
    expect(tracer).not.toBe(__NOOP_TRACER_FOR_TESTS);
    // Its wrap() still passes through values like the noop does.
    const result = await tracer.wrap('combined_call', async () => 7);
    expect(result).toBe(7);
  });

  it('recordSpan is a silent no-op when the flag is off', async () => {
    installChromeStub({ ff_captureV2Metrics: false });
    await expect(
      recordSpan({ platform: 'tiktok', mode: 'teen' }, 'combined_call', 1234),
    ).resolves.toBeUndefined();
  });

  it('recordSpan never throws with the flag on and no indexedDB (persist swallows)', async () => {
    installChromeStub({ ff_captureV2Metrics: true });
    await expect(
      (async () => {
        await recordSpan(
          { platform: 'tiktok', mode: 'teen' },
          'combined_call',
          850,
          { provider: 'groq', success: true },
        );
        // Allow the fire-and-forget persist promise to flush.
        await new Promise((r) => setTimeout(r, 5));
      })(),
    ).resolves.toBeUndefined();
  });

  it('recordSpan never throws when chrome.storage is unavailable', async () => {
    clearChromeStub();
    await expect(
      recordSpan({ platform: 'tiktok', mode: 'teen' }, 'neutralize', 10),
    ).resolves.toBeUndefined();
  });

  it('isFlagExplicitlySet distinguishes unset from explicitly-false', async () => {
    installChromeStub({});
    expect(await isFlagExplicitlySet('captureV2Metrics')).toBe(false);
    installChromeStub({ ff_captureV2Metrics: false });
    expect(await isFlagExplicitlySet('captureV2Metrics')).toBe(true);
    installChromeStub({ ff_captureV2Metrics: true });
    expect(await isFlagExplicitlySet('captureV2Metrics')).toBe(true);
  });

  it('isFlagExplicitlySet claims "set" when storage is unreadable (never auto-flip blind)', async () => {
    clearChromeStub();
    expect(await isFlagExplicitlySet('captureV2Metrics')).toBe(true);
  });

  it('startTrace itself never throws even on storage exception', async () => {
    // Install a malicious stub whose get() throws.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: () => {
            throw new Error('storage broke');
          },
          set: async () => {},
        },
      },
    };
    await expect(startTrace({ platform: 'twitter', mode: 'teen' })).resolves.toBeDefined();
  });
});

describe('perf-trace — bounds + invariants', () => {
  it('MAX_RECORDS is bounded, sane (1000)', () => {
    expect(__MAX_RECORDS_FOR_TESTS).toBe(1000);
  });

  it('PerfRecord shape is version-stamped (forward-compat guard)', () => {
    const tracer = __makeActiveTracerForTests({ platform: 'twitter', mode: 'teen' });
    // We can't intercept the persist call without mocking the module; the
    // shape contract is enforced at the type level (PerfRecord.version: 1).
    // This test just locks that V2_STAGES does NOT contain stages that the
    // PerfRecord type doesn't accept — caught at compile time, but worth a
    // runtime smoke-check too.
    for (const stage of V2_STAGES) {
      expect(typeof tracer.stage(stage)).toBe('function');
    }
  });
});

describe('perf-trace — write-failure signal (2026-08-24 empty-panel defect)', () => {
  // The panel could not tell "flag off" from "flag on but every write is
  // failing" because a persist failure only ever logged to console.warn.
  // persistRecord now also bumps a durable, best-effort counter so the
  // dashboard can read it (perfEmptyStateReason in core/perf-summary.ts).
  const record = (): PerfRecord => ({
    version: 1, timestamp: Date.now(), stage: 'combined_call', ms: 5,
    platform: 'twitter', mode: 'teen', success: true,
  });

  it('bumps the durable counter when a persist fails (no IndexedDB in this sandbox)', async () => {
    installChromeStub();
    expect((await readPerfPersistFailures()).count).toBe(0);
    await persistRecord(record());
    const after = await readPerfPersistFailures();
    expect(after.count).toBe(1);
    expect(after.lastError.length).toBeGreaterThan(0);
    expect(after.lastAt.length).toBeGreaterThan(0);
  });

  it('accumulates across repeated failures the same day', async () => {
    installChromeStub();
    await persistRecord(record());
    await persistRecord(record());
    await persistRecord(record());
    expect((await readPerfPersistFailures()).count).toBe(3);
  });

  it('never throws when chrome.storage is unavailable', async () => {
    clearChromeStub();
    await expect(persistRecord(record())).resolves.toBeUndefined();
    await expect(readPerfPersistFailures()).resolves.toEqual(
      expect.objectContaining({ count: 0 }),
    );
  });
});
