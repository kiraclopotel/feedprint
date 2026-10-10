// Adversarial read (2026-09-18): a counter write must never be computed from the
// synthetic fail-closed snapshot getSettings() returns when the storage read itself
// failed.
//
// getSettings() fails closed to `{...DEFAULTS, mode:'child', readFailedFallback:true}`
// when chrome.storage.local.get throws and this realm holds no cache (settings.ts:220,
// :367, :379), correct for a READ, because the strongest protection beats a downgrade.
// But settingsForCounterWrite() handed that same synthetic snapshot straight into
// counterPatch(), which computed `settings.totalChecksAllTime + 1` off the DEFAULTS'
// zero rather than the install's real total, and applyUsageIncrement() wrote that
// wrong value straight into chrome.storage.local, silently overwriting a real
// all-time count (or monthly token count) with 1, with nothing shown as an error.
//
// This fires in practice because the service worker realm goes cold roughly every
// minute (the forensic-outbox-drain alarm, periodInMinutes: 1), so the module-level
// settings cache is null most of the time, and local-read.ts documents that
// chrome.storage.local.get transiently rejects under concurrent I/O.
//
// One rejection is not enough to reproduce this from outside: settingsForCounterWrite
// already calls getSettings() a SECOND time whenever the returned snapshot's
// lastResetDate doesn't match today, and the synthetic snapshot's lastResetDate is
// always '' (DEFAULTS), so a single-attempt reject sometimes self-heals on the retry.
// A sustained failure (the same concurrent-I/O contention local-read.ts's own retry
// loop exists for) does not, so `get` is stubbed to reject on every call in this test,
// not just once: that is what actually reaches counterPatch with the synthetic
// snapshot in both getSettings() calls settingsForCounterWrite makes.

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('counter writes never use the synthetic fail-closed settings snapshot', () => {
  let chromeMock: {
    storage: {
      local: {
        get: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
        remove: ReturnType<typeof vi.fn>;
      };
      onChanged: { addListener: ReturnType<typeof vi.fn> };
    };
  };

  beforeEach(() => {
    vi.resetModules();
    chromeMock = {
      storage: {
        local: {
          get: vi.fn().mockRejectedValue(new Error('storage IO error')),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
        onChanged: { addListener: vi.fn() },
      },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = chromeMock;
  });

  function badTotalWrite(key: string, value: unknown): unknown {
    return chromeMock.storage.local.set.mock.calls.find(
      ([patch]) => (patch as Record<string, unknown> | undefined)?.[key] === value,
    );
  }

  it('recordAiCall: does not write totalChecksAllTime computed from the synthetic snapshot', async () => {
    const { recordAiCall } = await import('../../../src/storage/settings');

    let threw = false;
    try {
      await recordAiCall({ inputTokens: 100, outputTokens: 50, tokenEquivalents: 150, provider: 'groq' });
    } catch {
      threw = true;
    }

    // Traced against the pre-fix code (this session could not execute vitest,
    // "another process owns" the test run, so this is a manual trace, not an
    // observed run): settingsForCounterWrite() returns the synthetic snapshot from
    // BOTH getSettings() calls (get() rejects persistently), counterPatch computes
    // totalChecksAllTime: 0 + 1 = 1 from it, chrome.storage.local.set(patch)
    // resolves (the mock's set() always succeeds), and recordAiCall's promise
    // RESOLVES, so threw stays false and the assertion below fails with:
    //   AssertionError: expected false to be true // Object.is equality
    expect(threw).toBe(true);

    // The actual house-rule regression: whatever the promise does, the wrong
    // counter must never reach storage. Pre-fix this finds the patch
    // { totalChecksToday: 1, totalChecksThisMonth: 1, totalChecksAllTime: 1, ... }
    // and fails with something like:
    //   AssertionError: expected { totalChecksToday: 1, ... } to be undefined
    expect(badTotalWrite('totalChecksAllTime', 1)).toBeUndefined();
  });

  it('incrementNeutralized: does not write totalNeutralizedAllTime computed from the synthetic snapshot', async () => {
    const { incrementNeutralized } = await import('../../../src/storage/settings');

    let threw = false;
    try {
      await incrementNeutralized();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(badTotalWrite('totalNeutralizedAllTime', 1)).toBeUndefined();
  });

  it('incrementMetricsHidden: does not write metricsHiddenAllTime computed from the synthetic snapshot', async () => {
    const { incrementMetricsHidden } = await import('../../../src/storage/settings');

    let threw = false;
    try {
      await incrementMetricsHidden(3);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(badTotalWrite('metricsHiddenAllTime', 3)).toBeUndefined();
  });

  it('a subsequent successful read writes the counter normally (fix must not wedge good writes)', async () => {
    // Same module, but get() recovers after the earlier rejecting tests' assertions
    // ran against a fresh module (beforeEach reset it): this test starts clean.
    chromeMock.storage.local.get.mockResolvedValue({});
    const { recordAiCall } = await import('../../../src/storage/settings');

    await recordAiCall({ inputTokens: 0, outputTokens: 0, tokenEquivalents: 0, provider: 'groq' });

    expect(badTotalWrite('totalChecksAllTime', 1)).toBeDefined();
  });
});
