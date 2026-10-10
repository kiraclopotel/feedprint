/** @vitest-environment jsdom */
// callAI's plan gate (unit 5 of the entitlements mechanism): a paid key whose plan does not include
// the reading makes no call at all, exactly as the free tier, so the proxy's 403 feature_missing is
// never the first thing that stops it. A key that holds the reading calls as before. A good key
// check refreshes what the key turns on, at most every six hours. A paid key with no checked list asks
// for one once before it is refused, at most every ten minutes.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { installChromeStorageStub } from '../../helpers/chrome-storage';

const plan = vi.hoisted(() => ({ holdsReading: true, refreshes: 0, kind: 'signed', refreshGives: 'stored', refreshTurnsOn: false }));

function installStore(): void {
  installChromeStorageStub({
    initial: {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      lastResetDate: utcDayKey(),
      lastResetMonth: utcMonthKey(),
      fw_license_key: 'fw-starter-abc12345',
      dailyCap: 2500,
      totalChecksToday: 0,
      totalTokensThisMonth: 100,
    },
    sendMessage: () => undefined,
  });
}

describe('callAI: the plan gate', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    plan.holdsReading = true;
    plan.refreshes = 0;
    plan.kind = 'signed';
    plan.refreshGives = 'stored';
    plan.refreshTurnsOn = false;
    vi.doMock('../../../src/storage/license-entitlements', () => ({
      READING_FEATURE: 'reading',
      licenseHoldsFeature: vi.fn(async (_license: unknown, feature: string) => feature === 'reading' && plan.holdsReading),
      readEntitlements: vi.fn(async () => ({ kind: plan.kind, features: [] })),
      refreshEntitlements: vi.fn(async () => {
        plan.refreshes++;
        if (plan.refreshTurnsOn) { plan.holdsReading = true; plan.kind = 'signed'; }
        return plan.refreshGives;
      }),
    }));
    fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    });
    (globalThis as any).fetch = fetchSpy;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    installStore();
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.doUnmock('../../../src/storage/license-entitlements');
  });

  it('a paid key whose plan lacks the reading makes no call', async () => {
    plan.holdsReading = false;
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('cap-exhausted');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a paid key that holds the reading calls as before', async () => {
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a good key check refreshes what the key turns on: once for the same key, again for a new key', async () => {
    const { probeProxy } = await import('../../../src/ai/client');
    expect(await probeProxy('fw-starter-abc12345')).toBe('ok');
    expect(await probeProxy('fw-starter-abc12345')).toBe('ok');
    await Promise.resolve();
    expect(plan.refreshes).toBe(1);
    expect(await probeProxy('fw-starter-other999')).toBe('ok');
    await Promise.resolve();
    expect(plan.refreshes).toBe(2);
  });

  it('a refused key check does not refresh', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, headers: { get: () => null }, json: () => Promise.resolve({}) });
    const { probeProxy } = await import('../../../src/ai/client');
    expect(await probeProxy('fw-starter-abc12345')).toBe('revoked');
    await Promise.resolve();
    expect(plan.refreshes).toBe(0);
  });

  it('a paid key with no checked list asks once, then reads when the answer holds the reading', async () => {
    plan.holdsReading = false;
    plan.kind = 'unchecked';
    plan.refreshTurnsOn = true;
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(plan.refreshes).toBe(1);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('an unchecked key whose fetch fails is refused, and not asked again within ten minutes', async () => {
    plan.holdsReading = false;
    plan.kind = 'unchecked';
    plan.refreshGives = 'kept';
    const { callAI } = await import('../../../src/ai/client');
    expect((await callAI('sys', 'usr')).ok).toBe(false);
    expect((await callAI('sys', 'usr')).ok).toBe(false);
    expect(plan.refreshes).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a checked list that leaves the reading out is not asked again before refusing', async () => {
    plan.holdsReading = false;
    plan.kind = 'signed';
    const { callAI } = await import('../../../src/ai/client');
    expect((await callAI('sys', 'usr')).ok).toBe(false);
    expect(plan.refreshes).toBe(0);
  });
});
