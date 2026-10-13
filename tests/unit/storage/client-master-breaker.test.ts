/** @vitest-environment jsdom */
// FeelingWise — callAI master AI breaker (aiAnalysisEnabled).
//
// Locks the zero-spend guarantee: when the parent flips aiAnalysisEnabled
// off, callAI returns Err(cap-exhausted, cap='master-off') WITHOUT reading
// the license or touching the network — even on a paid tier that would
// otherwise proceed. Every Groq caller (per-post pipeline, comment batch,
// room sensor, profanity-soften rewrites) funnels through callAI, so this
// single gate is the whole guarantee for text AI. The media paths are gated
// separately in content/index.ts start gates.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { readingConsentFor } from '../../helpers/reading-consent';

function installStorageStub(initial: Record<string, unknown> = {}): { state: Record<string, unknown> } {
  // The shared stub (tests/helpers/chrome-storage.ts). chrome.runtime.sendMessage is installed, as this
  // file's own copy had it: the code under test posts its write to the worker seam.
  return installChromeStorageStub({ initial, sendMessage: () => undefined });
}

function baselineSettings(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    ...extra,
  };
}

describe('callAI — master AI breaker', () => {
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

  it('breaker off on a PAID tier: Err(cap-exhausted, master-off), no fetch', async () => {
    installStorageStub(
      baselineSettings({
        fw_license_key: 'fw-starter-abc12345',
        aiAnalysisEnabled: false,
        dailyCap: 2500,
        totalChecksToday: 0,
        totalTokensThisMonth: 0,
      }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'cap-exhausted') {
      expect(result.error.cap).toBe('master-off');
    } else {
      throw new Error(`expected cap-exhausted, got ${JSON.stringify(result)}`);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('breaker absent (legacy install): defaults ON, paid tier proceeds to fetch', async () => {
    installStorageStub(
      baselineSettings({
        fw_license_key: 'fw-starter-abc12345',
        ...readingConsentFor('fw-starter-abc12345'),
        dailyCap: 2500,
        totalChecksToday: 0,
        totalTokensThisMonth: 0,
      }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
