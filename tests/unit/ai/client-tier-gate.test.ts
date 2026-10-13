/** @vitest-environment jsdom */
// FeelingWise — callAI tier-aware budget gate (in-client backstop).
//
// Locks the in-callAI free-tier gate so every consumer of callAI (per-post
// combined detect+rewrite, comment-batch scorer, per-comment rewrite-only)
// short-circuits before the network round-trip when no paid license is set.
// Monthly token-cap enforcement moved to the FeelingWise proxy (KV-backed,
// per-license) — the proxy returns 429 with `cap_monthly` body code, mapped
// to `cap-exhausted` by the client. That server-side path is exercised in
// the proxy's own test surface, not here.
//
// Test contract:
//   - Free tier: callAI returns Err(cap-exhausted) WITHOUT firing fetch.
//   - Starter tier under cap: callAI proceeds (fetch fires once).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { readingConsentFor } from '../../helpers/reading-consent';

function installStorageStub(initial: Record<string, unknown> = {}): { state: Record<string, unknown> } {
  // The shared stub (tests/helpers/chrome-storage.ts). chrome.runtime.sendMessage is installed, as this
  // file's own copy had it: the code under test posts its write to the worker seam.
  return installChromeStorageStub({ initial, sendMessage: () => undefined });
}

// Baseline settings keys that getSettings() expects to find populated so the
// daily / monthly reset blocks do NOT zero our seeded counters mid-test.
function baselineSettings(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    ...extra,
  };
}

describe('callAI — tier-aware budget gate (in-client backstop)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () =>
        Promise.resolve({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
    });
    (globalThis as any).fetch = fetchSpy;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('Free tier: returns Err(cap-exhausted) without firing fetch', async () => {
    // No fw_license_key stored => getLicense() returns FREE_LICENSE.
    installStorageStub(
      baselineSettings({
        dailyCap: 2500,
        totalChecksToday: 0,
        totalTokensThisMonth: 0,
      }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('cap-exhausted');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Free tier: logs the free-tier diagnostic in pipeline format, behind the debug switch only', async () => {
    installStorageStub(
      baselineSettings({
        dailyCap: 2500,
      }),
    );
    const { callAI } = await import('../../../src/ai/client');

    // Written once per post read on the free tier: behind the debug switch (src/core/fw-log.ts), so the page's
    // console is not filled with it.
    await callAI('sys', 'usr');
    const off: string[] = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(off.some((m) => /Pipeline: PASS \(free tier — free\)/.test(m))).toBe(false);

    (globalThis as { __FW_DEBUG__?: boolean }).__FW_DEBUG__ = true;
    try {
      await callAI('sys', 'usr');
    } finally {
      delete (globalThis as { __FW_DEBUG__?: boolean }).__FW_DEBUG__;
    }
    const messages: string[] = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(messages.some((m) => /Pipeline: PASS \(free tier — free\)/.test(m))).toBe(
      true,
    );
  });

  it('Starter tier under cap: proceeds to fetch (gate is non-blocking)', async () => {
    installStorageStub(
      baselineSettings({
        fw_license_key: 'fw-starter-abc12345',
        ...readingConsentFor('fw-starter-abc12345'),
        dailyCap: 2500,
        totalChecksToday: 0,
        totalTokensThisMonth: 100,
      }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('ok');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
