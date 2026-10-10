// §CT-26g.3.7 — resetUsageStats clears the engagement-hider counters too.
//
// Spotted 2026-05-04: post-reset popup showed CHECKS=0 / FIXED=0 /
// TOKENS=0 / HIDDEN=133. The metricsHiddenToday/AllTime keys were missing
// from the resetUsageStats Promise.allSettled call. This regression test
// locks them into the chrome.storage.local.set keyset.

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('§CT-26g.3.7 — resetUsageStats clears metricsHiddenToday + metricsHiddenAllTime', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('chrome.storage.local.set call includes metricsHiddenToday: 0 + metricsHiddenAllTime: 0', async () => {
    const setSpy = vi.fn().mockResolvedValue(undefined);
    // Mock chrome global
    (globalThis as unknown as { chrome?: { storage: { local: { set: unknown } }; action?: { setBadgeText?: () => void } } }).chrome = {
      storage: { local: { set: setSpy } },
      action: { setBadgeText: () => {} },
    };

    const { resetUsageStats } = await import('../../../src/storage/settings');
    await resetUsageStats();

    expect(setSpy).toHaveBeenCalledTimes(1);
    const arg = setSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toHaveProperty('metricsHiddenToday', 0);
    expect(arg).toHaveProperty('metricsHiddenAllTime', 0);
    // Sanity — the previously-existing keys are still cleared
    expect(arg).toHaveProperty('totalChecksToday', 0);
    expect(arg).toHaveProperty('totalChecksAllTime', 0);
    expect(arg).toHaveProperty('totalNeutralizedToday', 0);
    expect(arg).toHaveProperty('estimatedCostAllTime', 0);
  });
});
