/** @vitest-environment jsdom */
// The AI request's options at the browser's fetch: the page address is never sent with it, and a
// known account name found in the finished user message stops the call before it leaves.
//
// Mocks globalThis.fetch and stubs chrome.storage.local for the settings and licence reads, the
// way tests/unit/ai/client-result-retry.test.ts does.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';

// Read after vi.resetModules(), so the counts come from the module instance the client uses.
const counts = async () => (await import('../../../src/core/name-labels')).readNameLabelCounts();

function baselineSettings(): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345',
    dailyCap: 2500,
    totalChecksToday: 0,
    totalTokensThisMonth: 100,
  };
}

function okResponse(content = 'answer'): Response {
  const res = {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    clone: () => res,
  };
  return res as unknown as Response;
}

describe('the AI request at the browser fetch', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn(async () => okResponse());
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
    installChromeStorageStub({ initial: baselineSettings(), sendMessage: () => undefined });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends no page address: the referrer policy is pinned on the AI call, and nothing else is added', async () => {
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.feelingwise.org/v1/chat/completions');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(Object.keys(init).sort()).toEqual(['body', 'headers', 'method', 'referrerPolicy', 'signal']);
  });

  it('a known account name still in the user message stops the call in a build with no id, and is counted', async () => {
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'by @user_A: "hello @Pat_99 and Jane Roe"', true, {
      knownIdentifiers: ['@pat_99', 'Jane Roe'],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('internal-error');
      if (result.error.kind === 'internal-error') expect(result.error.code).toBe('identifier-in-request');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await counts()).identifierHits).toBe(2);
  });

  it('with the names replaced, the same identifiers let the call through', async () => {
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'by @user_A: "hello @user_B and @user_C"', true, {
      knownIdentifiers: ['@pat_99', 'Jane Roe'],
    });
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await counts()).identifierHits).toBe(0);
  });
});
