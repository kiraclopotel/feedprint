/** @vitest-environment jsdom */
// The relay asks every key for the person's go-ahead before it reads (403 consent_required; from 12 Oct 2026 00:00 UTC no
// key is let through without it). The Tester's full test (11 Oct 2026): the client read that answer as "our request was
// refused", the reading stopped, every post stayed as written with no dot and no word why, and the popup still showed the
// licence as fine; and a 429 was met with twenty more calls in half a minute instead of a pause.
//
// Now: the answer has a kind of its own, the key sends nothing more until the person gives the go-ahead (or ten minutes
// pass), a marker in storage lets the popup, the Issues tab and the toolbar icon say so, and a reading the relay answers
// clears it. A 429 pauses every call from leaving until its Retry-After has passed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';

const KEY = 'fw-starter-abc12345';
const MARKER = 'readingPaused';

function settings(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    fw_license_key: KEY,
    dailyCap: 2500,
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
  };
}

function response(status: number, body: unknown = {}, retryAfter: string | null = null): Response {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: () => Promise.resolve(body),
    clone: () => res,
  };
  return res as unknown as Response;
}

const ok = () => response(200, { choices: [{ message: { content: 'fine' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const askedForConsent = () => response(403, { error: { code: 'consent_required', message: 'The reading has not been started from the extension yet' } });

describe('the relay asks for the go-ahead', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let stub: ReturnType<typeof installChromeStorageStub>;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn();
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    stub = installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    spies.push(vi.spyOn(console, 'log').mockImplementation(() => undefined));
    spies.push(vi.spyOn(console, 'warn').mockImplementation(() => undefined));
    spies.push(vi.spyOn(console, 'error').mockImplementation(() => undefined));
  });

  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('answers with its own kind, leaves a marker, and sends nothing more with that key', async () => {
    fetchSpy.mockResolvedValue(askedForConsent());
    const { callAI } = await import('../../../src/ai/client');

    const first = await callAI('sys', 'usr');
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.kind).toBe('consent-required');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(stub.state[MARKER], 'the marker is in storage for the popup, the Issues tab and the icon').toMatchObject({ code: 'consent_required' });

    const second = await callAI('sys', 'usr');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe('consent-required');
    expect(fetchSpy, 'nothing left for the second reading').toHaveBeenCalledTimes(1);
  });

  it('it is not counted as a licence refusal: the key is not paused for hours', async () => {
    fetchSpy.mockResolvedValue(askedForConsent());
    const { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'usr');
    expect(stub.state.licenseRefused, 'no licence marker').toBeUndefined();
  });

  it('giving the go-ahead ends the pause at once, and the next reading goes out', async () => {
    fetchSpy.mockResolvedValueOnce(askedForConsent());
    const { callAI } = await import('../../../src/ai/client');
    const { recordReadingConsent } = await import('../../../src/storage/reading-consent');

    await callAI('sys', 'usr');
    expect(stub.state[MARKER]).toBeDefined();

    await recordReadingConsent(KEY, 'the words the person saw', 'Example Provider Ltd.');
    expect(stub.state[MARKER], 'the marker went with the go-ahead').toBeUndefined();

    fetchSpy.mockResolvedValueOnce(ok());
    const third = await callAI('sys', 'usr');
    expect(third.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('after ten minutes one reading tries again; an answered reading clears the marker', async () => {
    fetchSpy.mockResolvedValueOnce(askedForConsent());
    const { callAI } = await import('../../../src/ai/client');
    const start = Date.now();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(start);

    await callAI('sys', 'usr');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    nowSpy.mockReturnValue(start + 9 * 60_000);
    await callAI('sys', 'usr');
    expect(fetchSpy, 'still inside the pause').toHaveBeenCalledTimes(1);

    nowSpy.mockReturnValue(start + 11 * 60_000);
    fetchSpy.mockResolvedValueOnce(ok());
    const later = await callAI('sys', 'usr');
    expect(later.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(stub.state[MARKER], 'the relay answered a reading, so the pause is over').toBeUndefined();
  });

  it('a new key is tried at once: the marker goes with the key it was earned under', async () => {
    fetchSpy.mockResolvedValueOnce(askedForConsent());
    const { callAI } = await import('../../../src/ai/client');
    const { setLicense } = await import('../../../src/storage/license');
    await callAI('sys', 'usr');
    expect(stub.state[MARKER]).toBeDefined();

    await setLicense('fw-starter-zzz98765');
    expect(stub.state[MARKER]).toBeUndefined();
    fetchSpy.mockResolvedValueOnce(ok());
    expect((await callAI('sys', 'usr')).ok).toBe(true);
  });
});

describe('a 429 pauses the calls instead of being met with more', () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    vi.resetModules();
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    spies.push(vi.spyOn(console, 'log').mockImplementation(() => undefined));
    spies.push(vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  });
  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
    vi.useRealTimers();
  });

  it('twelve readings at once make at most ten requests in all, where each used to make two', async () => {
    const fetchSpy = vi.fn().mockImplementation(async () => response(429, { error: { message: 'rate limited' } }, '1'));
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');
    const results = await Promise.all(Array.from({ length: 12 }, () => callAI('sys', 'usr')));
    for (const r of results) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('rate-limit');
    }
    expect(fetchSpy.mock.calls.length).toBeLessThanOrEqual(10);
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  }, 20_000);

  it('a reading that arrives during the pause does not reach the relay until the Retry-After has passed', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(response(429, { error: { message: 'rate limited' } }, '1'))
      .mockResolvedValue(ok());
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    const { callAI } = await import('../../../src/ai/client');
    const firstDone = callAI('sys', 'usr');
    // The first attempt is on the wire; this one is made while its 429 is fresh.
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    const second = await callAI('sys', 'usr');
    await firstDone;
    expect(second.ok).toBe(true);
    expect(Date.now() - t0, 'it waited out the second the relay asked for').toBeGreaterThanOrEqual(700);
    // One refused request, one retried after the wait, one more for the second reading.
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  }, 20_000);
});
