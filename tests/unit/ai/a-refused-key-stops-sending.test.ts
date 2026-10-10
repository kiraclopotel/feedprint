/** @vitest-environment jsdom */
// The promise: after the proxy refuses a key with one of its own licence codes, the same key sends
// nothing more for a while (the AI reading and the time-stamp request alike). The key is not deleted:
// a refusal can be a mistake that is put right on the server, so the pause ends by itself, and a key
// pasted again, or a different key, is tried at once. A refusal that carries no licence code (a bare
// 401 from somewhere on the way) pauses nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';

const KEY = 'fw-starter-abc12345';

function settings(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    fw_license_key: KEY,
    dailyCap: 2500,
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
    ...extra,
  };
}

function response(status: number, body: unknown = {}): Response {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    clone: () => res,
  };
  return res as unknown as Response;
}

const ok = () => response(200, { choices: [{ message: { content: 'fine' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
const refused = (code: string) => response(401, { error: { code, message: code } });
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('a key the proxy refuses stops sending words', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;
    spies.push(vi.spyOn(console, 'log').mockImplementation(() => undefined));
    spies.push(vi.spyOn(console, 'warn').mockImplementation(() => undefined));
    spies.push(vi.spyOn(console, 'error').mockImplementation(() => undefined));
  });

  afterEach(() => {
    while (spies.length) spies.pop()!.mockRestore();
    vi.useRealTimers();
  });

  it.each(['license_revoked', 'license_expired', 'tier_mismatch'])('after %s the next reading makes no request', async (code) => {
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValue(refused(code));
    const { callAI } = await import('../../../src/ai/client');

    const first = await callAI('sys', 'the words of a post');
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.kind).toBe('auth-refusal');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const second = await callAI('sys', 'the words of the next post');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.kind).toBe('auth-refusal');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('the pause holds in a fresh page too (it is kept in storage, not only in memory)', async () => {
    const stub = installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValue(refused('license_revoked'));
    let { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'one');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await settle();

    vi.resetModules();
    installChromeStorageStub({ initial: { ...stub.state }, sendMessage: () => undefined });
    ({ callAI } = await import('../../../src/ai/client'));
    await callAI('sys', 'two');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a burst of readings right after a fresh start all wait for the stored pause', async () => {
    const stub = installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValue(refused('license_revoked'));
    let { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'one');
    await settle();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.resetModules();
    installChromeStorageStub({ initial: { ...stub.state }, sendMessage: () => undefined });
    // A storage read that takes a while, as it can when the worker has just woken.
    const local = (globalThis as any).chrome.storage.local;
    const get = local.get.bind(local);
    local.get = (keys: unknown) => new Promise((resolve) => setTimeout(() => resolve(get(keys)), 5));
    ({ callAI } = await import('../../../src/ai/client'));
    const burst = await Promise.all([callAI('sys', 'a'), callAI('sys', 'b'), callAI('sys', 'c'), callAI('sys', 'd')]);
    expect(burst.every((r) => !r.ok)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('the pause ends by itself: a key put right on the server is tried again later', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValueOnce(refused('license_revoked')).mockResolvedValue(ok());
    const { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'one');
    await callAI('sys', 'two');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-03T18:01:00Z'));
    const later = await callAI('sys', 'three');
    expect(later.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a key not found yet (a key minted a moment ago) pauses only briefly', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'));
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValueOnce(refused('license_not_found')).mockResolvedValue(ok());
    const { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'one');
    await callAI('sys', 'two');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date('2026-10-03T12:16:00Z'));
    expect((await callAI('sys', 'three')).ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a different key is tried at once', async () => {
    const stub = installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValueOnce(refused('license_expired')).mockResolvedValue(ok());
    const { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'one');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await settle();

    const { setLicense } = await import('../../../src/storage/license');
    expect((await setLicense('fw-starter-zzz98765')).ok).toBe(true);
    expect(stub.state.fw_license_key).toBe('fw-starter-zzz98765');
    expect((await callAI('sys', 'two')).ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('the same key pasted again is tried at once (a renewed subscription)', async () => {
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValueOnce(refused('license_expired')).mockResolvedValue(ok());
    const { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'one');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await settle();

    const { setLicense } = await import('../../../src/storage/license');
    await setLicense(KEY);
    expect((await callAI('sys', 'two')).ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('a bare 401 with no licence code pauses nothing', async () => {
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    fetchSpy.mockResolvedValueOnce(response(401)).mockResolvedValue(ok());
    const { callAI } = await import('../../../src/ai/client');
    await callAI('sys', 'one');
    expect((await callAI('sys', 'two')).ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('the pause is bound to the key that was refused', async () => {
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    const { noteLicenseRefused, licenseRefusalHolds } = await import('../../../src/storage/license-refusal');
    const { licenseFingerprint } = await import('../../../src/storage/cap-markers');
    const fp = licenseFingerprint('starter', 'abc12345');
    expect(await licenseRefusalHolds(fp)).toBe(false);
    noteLicenseRefused(fp, 'license_revoked');
    expect(await licenseRefusalHolds(fp)).toBe(true);
    expect(await licenseRefusalHolds(licenseFingerprint('starter', 'zzz98765'))).toBe(false);
  });

  it('the time-stamp request through the proxy is not sent for a refused key, and its own refusal starts the pause', async () => {
    installChromeStorageStub({ initial: settings(), sendMessage: () => undefined });
    // No host permission for the authorities here, so the round goes straight to the proxy.
    const { requestVerifiedTimestamps } = await import('../../../src/forensics/tsa-client');
    fetchSpy.mockResolvedValue(refused('license_revoked'));
    const first = await requestVerifiedTimestamps('ab'.repeat(32), 1);
    expect(first.reasons).toContain('proxy_http_401');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const second = await requestVerifiedTimestamps('cd'.repeat(32), 1);
    expect(second.reasons).toContain('proxy_license_refused');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
