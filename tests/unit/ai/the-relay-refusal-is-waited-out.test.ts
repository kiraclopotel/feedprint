/** @vitest-environment jsdom */
// The relay answers 429 too_many_failed_keys with Retry-After: 60 when an address has sent too many unknown licence
// keys, which a paying person behind a shared address can meet through no fault of their own. Asking again inside
// that minute only extends the refusal, and the old retry slept up to the header on every post, so the client must
// wait it out off the network: one request, no retry inside the call, and nothing sent until the minute is over.

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

function refused(retryAfter: string | null) {
  const body = { error: { code: 'too_many_failed_keys' } };
  return {
    ok: false,
    status: 429,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    clone: () => ({ json: () => Promise.resolve(body) }),
    json: () => Promise.resolve(body),
  };
}

describe('callAI after the relay refuses the address for unknown keys', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('asks once, does not retry inside the call, and sends nothing more until the Retry-After has passed', async () => {
    installStorageStub(paidSettings());
    const fetchSpy = vi.fn().mockResolvedValue(refused('60'));
    (globalThis as any).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');

    const first = await callAI('sys', 'usr');
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.kind).toBe('rate-limit');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await callAI('sys', 'usr');
    expect(second.ok).toBe(false);
    if (!second.ok && second.error.kind === 'rate-limit') expect(second.error.retryAfterMs).toBeGreaterThan(55_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('asks again once the minute is over', async () => {
    installStorageStub(paidSettings());
    const fetchSpy = vi.fn().mockResolvedValue(refused('60'));
    (globalThis as any).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');
    const start = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(start);

    await callAI('sys', 'usr');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    nowSpy.mockReturnValue(start + 61_000);
    await callAI('sys', 'usr');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it('waits a minute when the refusal carries no Retry-After', async () => {
    installStorageStub(paidSettings());
    const fetchSpy = vi.fn().mockResolvedValue(refused(null));
    (globalThis as any).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');

    await callAI('sys', 'usr');
    const second = await callAI('sys', 'usr');
    if (!second.ok && second.error.kind === 'rate-limit') expect(second.error.retryAfterMs).toBeGreaterThan(55_000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
