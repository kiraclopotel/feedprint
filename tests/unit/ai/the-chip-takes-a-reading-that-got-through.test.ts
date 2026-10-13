/** @vitest-environment jsdom */
// The header chip read "NOT CHECKED" on the owner's working install (13 Oct 2026): the one zero-token call that checks the
// key, GET /v1/models, gave no answer (the relay answers it from its provider's model list) while reading calls with the same
// key were going through. Two things follow. The probe says how it gave no answer (a counter per cause: a status, a timeout, a
// dropped connection), so the next look reads the cause instead of guessing. And a reading call that got through lately, with
// this key, stands in for the check where the list gave none; it never overrules a refusal.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { readingConsentFor } from '../../helpers/reading-consent';
import { computeStatusStates } from '../../../src/ui/popup/panels/status';
import { licenseFingerprint } from '../../../src/storage/cap-markers';

const bumped: string[] = [];
vi.mock('../../../src/diagnostics/diagnostics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/diagnostics/diagnostics')>()),
  bumpCounter: vi.fn((name: string) => { bumped.push(name); }),
}));

const KEY = 'fw-starter-abc12345';
const STAMP = 'readingGotThrough';
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const FP = licenseFingerprint('starter', 'abc12345');
const T0 = 1_800_000_000_000;

function installStore(): ReturnType<typeof installChromeStorageStub> {
  return installChromeStorageStub({
    initial: {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
      fw_license_key: KEY, dailyCap: 2500, totalChecksToday: 0, totalTokensThisMonth: 100,
      ...readingConsentFor(KEY),
    },
    sendMessage: () => undefined,
  });
}

const answer = (status: number) => ({
  ok: status >= 200 && status < 300, status, headers: { get: () => null },
  json: () => Promise.resolve({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
});

beforeEach(() => {
  vi.resetModules();
  bumped.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the models check says how it gave no answer', () => {
  it('a status that is neither yes nor refusal is counted by its number', async () => {
    installStore();
    for (const status of [429, 503]) {
      (globalThis as any).fetch = vi.fn().mockResolvedValue(answer(status));
      const { probeProxy } = await import('../../../src/ai/client');
      expect(await probeProxy(`${KEY}${status}`)).toBe('unknown');
    }
    expect(bumped).toEqual(['licenseProbe:status-429', 'licenseProbe:status-503']);
  });

  it('a dropped connection and a timeout are told apart', async () => {
    installStore();
    (globalThis as any).fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { probeProxy } = await import('../../../src/ai/client');
    expect(await probeProxy(`${KEY}net`)).toBe('unknown');
    expect(bumped).toEqual(['licenseProbe:network']);

    bumped.length = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    (globalThis as any).fetch = vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const slow = probeProxy(`${KEY}slow`);
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await slow).toBe('unknown');
    expect(bumped).toEqual(['licenseProbe:timeout']);
  });

  it('an answer, yes or refusal, counts nothing', async () => {
    installStore();
    const { probeProxy } = await import('../../../src/ai/client');
    (globalThis as any).fetch = vi.fn().mockResolvedValue(answer(200));
    expect(await probeProxy(`${KEY}ok`)).toBe('ok');
    (globalThis as any).fetch = vi.fn().mockResolvedValue(answer(401));
    expect(await probeProxy(`${KEY}no`)).toBe('revoked');
    expect(bumped.filter((n) => n.startsWith('licenseProbe'))).toEqual([]);
  });
});

describe('a reading call that got through is noted, once a minute, and only a reading', () => {
  it('a 2xx answer writes the stamp bound to the key; an error answer writes none', async () => {
    const stub = installStore();
    (globalThis as any).fetch = vi.fn().mockResolvedValue(answer(400));
    const { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'usr');
    expect(stub.state[STAMP], 'a refused call is not a reading').toBeUndefined();

    vi.resetModules();
    (globalThis as any).fetch = vi.fn().mockResolvedValue(answer(200));
    const again = await import('../../../src/ai/client');
    const result = await again.callAI('sys', 'usr');
    expect(result.ok).toBe(true);
    expect(stub.state[STAMP]).toMatchObject({ fingerprint: FP });
  });

  it('is rewritten at most once a minute for one key, at once for another', async () => {
    const stub = installStore();
    const { noteReadingGotThrough } = await import('../../../src/ai/reading-got-through');
    noteReadingGotThrough(FP, T0);
    noteReadingGotThrough(FP, T0 + 30_000);
    expect((stub.state[STAMP] as { at: number }).at).toBe(T0);
    noteReadingGotThrough(FP, T0 + 61_000);
    expect((stub.state[STAMP] as { at: number }).at).toBe(T0 + 61_000);
    noteReadingGotThrough('someone-else', T0 + 62_000);
    expect(stub.state[STAMP]).toEqual({ fingerprint: 'someone-else', at: T0 + 62_000 });
  });
});

describe('what the stamp is worth', () => {
  const PAID = { tier: 'starter', secret: 'abc12345' };

  it('stands for fifteen minutes, for this key only, and never from the future', async () => {
    const stub = installStore();
    const { readingGotThroughNow } = await import('../../../src/ai/reading-got-through');
    stub.state[STAMP] = { fingerprint: FP, at: T0 };
    expect(await readingGotThroughNow(PAID, T0 + FIFTEEN_MINUTES)).toBe(true);
    expect(await readingGotThroughNow(PAID, T0 + FIFTEEN_MINUTES + 1)).toBe(false);
    expect(await readingGotThroughNow({ tier: 'starter', secret: 'changed99' }, T0 + 1000), 'a pasted-over key does not inherit it').toBe(false);
    expect(await readingGotThroughNow({ tier: 'free', secret: '' }, T0 + 1000), 'a free install has no key').toBe(false);
    stub.state[STAMP] = { fingerprint: FP, at: T0 + 10 * 60_000 };
    expect(await readingGotThroughNow(PAID, T0), 'a stamp from the future is not believed').toBe(false);
    for (const junk of [undefined, null, 'x', {}, { fingerprint: FP }, { at: T0 }]) {
      stub.state[STAMP] = junk;
      expect(await readingGotThroughNow(PAID, T0)).toBe(false);
    }
  });

  it('the chip takes it where the models list gave no answer, and nowhere else', () => {
    const paid = { tier: 'starter' };
    expect(computeStatusStates(paid, 'unknown', false).licenseState).toBe('unchecked');
    expect(computeStatusStates(paid, 'unknown', true).licenseState, 'the owner\'s install: reading works, the list does not answer').toBe('ok');
    expect(computeStatusStates(paid, 'revoked', true).licenseState, 'a refusal is never overruled').toBe('err');
    expect(computeStatusStates(paid, 'ok', false).licenseState).toBe('ok');
    expect(computeStatusStates(paid, null, true).licenseState, 'nothing asked yet: still checking').toBe('checking');
    expect(computeStatusStates({ tier: 'free' }, 'unknown', true).licenseState).toBe('free');
  });
});
