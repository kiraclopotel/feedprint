/** @vitest-environment jsdom */
// Q45 (wiring W51): text-path proxy-cap latch.
//
// A proxy 429 with cap_daily/cap_monthly is permanent for the billing
// period, but before this it was returned per call and latched nowhere: a
// capped license kept opening an authenticated fetch on every scroll for
// the rest of the period, and no surface recorded the cap. Now the first
// cap 429 arms an in-memory latch (short-circuit before the network) and
// writes the textCapReached marker the dashboard Issues tab renders; both
// expire by UTC period-key comparison.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';

function installStorageStub(initial: Record<string, unknown> = {}): { state: Record<string, unknown> } {
  const state: Record<string, unknown> = { ...initial };
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in state) out[k] = state[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
      },
    },
    runtime: { sendMessage: () => undefined },
  };
  return { state };
}

function paidSettings(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345',
    dailyCap: 2500,
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
  };
}

function cap429(code: 'cap_daily' | 'cap_monthly') {
  const body = { error: { code } };
  return {
    ok: false,
    status: 429,
    headers: { get: () => null },
    clone: () => ({ json: () => Promise.resolve(body) }),
    json: () => Promise.resolve(body),
  };
}

describe('callAI — proxy-cap latch (Q45)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('one cap_monthly 429 latches: the second call never touches the network', async () => {
    const { state } = installStorageStub(paidSettings());
    const fetchSpy = vi.fn().mockResolvedValue(cap429('cap_monthly'));
    (globalThis as any).fetch = fetchSpy;
    const { callAI, TEXT_CAP_STORAGE_KEY } = await import('../../../src/ai/client');

    const first = await callAI('sys', 'usr');
    expect(first.ok).toBe(false);
    if (!first.ok && first.error.kind === 'cap-exhausted') expect(first.error.cap).toBe('monthly');
    else throw new Error(`expected cap-exhausted, got ${JSON.stringify(first)}`);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await callAI('sys', 'usr');
    expect(second.ok).toBe(false);
    if (!second.ok && second.error.kind === 'cap-exhausted') expect(second.error.cap).toBe('monthly');
    expect(fetchSpy).toHaveBeenCalledTimes(1); // latched — no second fetch

    // The Issues-tab marker was persisted with the current period key.
    const marker = state[TEXT_CAP_STORAGE_KEY] as { cap: string; periodKey: string };
    expect(marker.cap).toBe('monthly');
    expect(marker.periodKey).toBe(utcMonthKey());
  });

  it('a persisted current-period marker re-arms the latch in a fresh realm (no live 429 needed)', async () => {
    const stub = installStorageStub(paidSettings());
    stub.state.textCapReached = { cap: 'daily', periodKey: utcDayKey() };
    const fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'cap-exhausted') expect(result.error.cap).toBe('daily');
    else throw new Error(`expected cap-exhausted, got ${JSON.stringify(result)}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a stale marker from a previous period is ignored and calls resume', async () => {
    const stub = installStorageStub(paidSettings());
    stub.state.textCapReached = { cap: 'monthly', periodKey: '2020-01' };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    });
    (globalThis as any).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a latch earned by one key does not bind a different key (STORAGE-LICENCE-WORKER-1)', async () => {
    const { state } = installStorageStub(paidSettings());
    const fetchSpy = vi.fn().mockResolvedValue(cap429('cap_monthly'));
    (globalThis as any).fetch = fetchSpy;
    const { callAI, TEXT_CAP_STORAGE_KEY } = await import('../../../src/ai/client');

    const first = await callAI('sys', 'usr');
    expect(first.ok).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const marker = state[TEXT_CAP_STORAGE_KEY] as { licenseFingerprint?: string };
    expect(marker.licenseFingerprint).toBe('starter:2345');

    // The parent pastes a paid family key. In the realm that latched, the
    // in-memory latch is still armed; it must be dropped on the next call.
    state.fw_license_key = 'fw-family-newkey999';
    fetchSpy.mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ choices: [{ message: { content: 'hello' } }] }),
      clone: () => ({ json: () => Promise.resolve({}) }),
    });
    const second = await callAI('sys', 'usr');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(second.ok).toBe(true);
  });

  it('a persisted marker from a different key does not re-arm the latch in a fresh realm', async () => {
    installStorageStub({
      ...paidSettings(),
      textCapReached: { cap: 'monthly', periodKey: utcMonthKey(), licenseFingerprint: 'starter:old1' },
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200, headers: { get: () => null },
      json: () => Promise.resolve({ choices: [{ message: { content: 'hello' } }] }),
      clone: () => ({ json: () => Promise.resolve({}) }),
    });
    (globalThis as any).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
  });

  it('an ordinary rate-limit 429 (no cap code) does NOT latch', async () => {
    installStorageStub(paidSettings());
    const body = {};
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      // Zero Retry-After keeps the client's transient-retry backoff from
      // sleeping through the test timeout.
      headers: { get: (h: string) => (h === 'Retry-After' ? '0' : null) },
      clone: () => ({ json: () => Promise.resolve(body) }),
      json: () => Promise.resolve(body),
    });
    (globalThis as any).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');

    const first = await callAI('sys', 'usr');
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.kind).toBe('rate-limit');
    const callsAfterFirst = fetchSpy.mock.calls.length; // includes the one retry
    await callAI('sys', 'usr');
    // Second call still reaches the network — nothing latched.
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});
