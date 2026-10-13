/** @vitest-environment jsdom */
// FeelingWise — callAI Result-typed retry layer.
//
// Locks the higher-level retry behavior added to src/ai/client.ts after the
// Result<T, E>-typed cascade landed:
//   - Rate-limit (429), transient-http (5xx) and network get exactly one
//     retry; the second result (success or failure) is final. `network`
//     joined that set 2026-08-02 — see the test below for why.
//   - Permanent failures (auth-refusal/content-policy/cap-exhausted) do NOT
//     retry.
//   - Retry-After is honored on rate-limit retries, capped at 60s.
//
// Mocks `globalThis.fetch` with vi.fn(). Stubs chrome.storage.local for the
// settings + license reads. Mirrors the in-test fetch-spy + storage-stub
// pattern from tests/unit/ai/client-tier-gate.test.ts so this file plugs into
// the same vitest harness.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { readingConsentFor } from '../../helpers/reading-consent';

import {
  utcDayKey,
  utcMonthKey,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';

function installStorageStub(initial: Record<string, unknown> = {}): { state: Record<string, unknown> } {
  // The shared stub (tests/helpers/chrome-storage.ts). chrome.runtime.sendMessage is installed, as this
  // file's own copy had it: the code under test posts its write to the worker seam.
  return installChromeStorageStub({ initial, sendMessage: () => undefined });
}

function baselineSettings(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    fw_license_key: 'fw-starter-abc12345',
    ...readingConsentFor('fw-starter-abc12345'),
    dailyCap: 2500,
    totalChecksToday: 0,
    totalTokensThisMonth: 0,
    ...extra,
  };
}

// Build a fetch-Response-like object matching the shape callGroqOnce reads.
function makeFetchResponse(opts: {
  ok: boolean;
  status: number;
  body?: unknown;
  retryAfter?: string | null;
}): Response {
  const headers = new Map<string, string>();
  if (opts.retryAfter !== null && opts.retryAfter !== undefined) {
    headers.set('retry-after', opts.retryAfter);
  }
  const res = {
    ok: opts.ok,
    status: opts.status,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    json: () => Promise.resolve(opts.body ?? {}),
    clone: () => res,
  };
  return res as unknown as Response;
}

function okBody(content = 'rewrite-output'): unknown {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
}

describe('callAI — retry layer (Result-typed cascade)', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    vi.useRealTimers();
  });

  it('happy path: 200 with valid JSON returns Ok(content), fetch called once', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({ ok: true, status: 200, body: okBody('hello world') }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('hello world');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rate-limit retry honored: 429 then 200 returns Ok, fetch called twice', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: false, status: 429, retryAfter: '1' }),
      )
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: true, status: 200, body: okBody('after-retry') }),
      );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('after-retry');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rate-limit retry — Retry-After cap: header of 120s does not stall the second fetch beyond 60s', async () => {
    vi.useFakeTimers();
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: false, status: 429, retryAfter: '120' }),
      )
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: true, status: 200, body: okBody('after-cap') }),
      );
    const { callAI } = await import('../../../src/ai/client');

    const pending = callAI('sys', 'usr');
    // The stored go-ahead is read through a real digest, which takes real time: wait for the first
    // request before the clock moves, or the retry's sleep is set after the clock has moved on.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Advance just past the 60s cap; if the retry layer waited the full 120s
    // the second fetch would not have fired and the call would still be
    // pending after this advance.
    await vi.advanceTimersByTimeAsync(60_001);

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('after-cap');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('rate-limit retry — both attempts 429: returns Err(rate-limit), fetch called twice', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: false, status: 429, retryAfter: '1' }),
      )
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: false, status: 429, retryAfter: '1' }),
      );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('rate-limit');
      if (result.error.kind === 'rate-limit') {
        expect(typeof result.error.retryAfterMs).toBe('number');
      }
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('transient-http retry: 503 then 200 returns Ok, fetch called twice', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy
      .mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 503 }))
      .mockResolvedValueOnce(
        makeFetchResponse({ ok: true, status: 200, body: okBody('after-503') }),
      );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe('after-503');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('transient-http retry — both attempts 500: returns Err(transient-http), fetch called twice', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy
      .mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 500 }))
      .mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 500 }));
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('transient-http');
      if (result.error.kind === 'transient-http') {
        expect(result.error.status).toBe(500);
      }
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('permanent failure — 401 returns Err(auth-refusal), fetch called ONCE (no retry)', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 401 }));
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('auth-refusal');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a 401 carrying one of the worker licence codes is auth-refusal', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 401, body: { error: { code: 'license_revoked', message: 'License has been revoked' } } }));
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('auth-refusal');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a 400 relayed from Groq (json_validate_failed) is internal-error, not a licence refusal, and is not retried', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 400, body: { error: { code: 'json_validate_failed', message: 'schema' } } }));
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('internal-error');
      if (result.error.kind === 'internal-error') {
        expect(result.error.status).toBe(400);
        expect(result.error.code).toBe('json_validate_failed');
      }
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a 413 with no readable body is internal-error; a bare 403 stays auth-refusal', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 413 }));
    fetchSpy.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 403 }));
    const { callAI } = await import('../../../src/ai/client');
    const first = await callAI('sys', 'usr');
    const second = await callAI('sys', 'usr');
    expect(!first.ok && first.error.kind).toBe('internal-error');
    expect(!second.ok && second.error.kind).toBe('auth-refusal');
  });

  it('permanent failure — 451 returns Err(content-policy), fetch called ONCE (no retry)', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 451 }));
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('content-policy');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('network error — both attempts throw: returns Err(network), fetch called TWICE', async () => {
    // `network` moved OUT of the permanent set on 2026-08-02. A day's
    // diagnostic showed 40 network failures, 36 inside one hour, and each
    // unretried one cost a post its judgement. A socket hang-up is exactly
    // what a second attempt clears.
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockRejectedValue(new Error('socket hang up'));
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      if (result.error.kind === 'network') {
        expect(result.error.message).toBe('socket hang up');
      }
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('deadline: a proxy call that never answers is aborted at PROXY_TEXT_DEADLINE_MS and reported as network', async () => {
    // No timeout at all before this: one stalled socket held a concurrency
    // slot for the life of the tab and every later Child cover sat on
    // "checking" (STORAGE-LICENCE-WORKER-8).
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    vi.useFakeTimers();
    let aborted = 0;
    fetchSpy.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          aborted++;
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
    );
    const { callAI } = await import('../../../src/ai/client');
    const { PROXY_TEXT_DEADLINE_MS } = await import('../../../src/ai/fetch-with-deadline');

    const pending = callAI('sys', 'usr');
    // The stored go-ahead is read through a real digest: wait for each request before the clock moves.
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(PROXY_TEXT_DEADLINE_MS + 5);
    // The network retry sleeps 750 ms, then runs a second attempt that also stalls.
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(PROXY_TEXT_DEADLINE_MS + 1_000);
    const result = await pending;

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
      if (result.error.kind === 'network') {
        expect(result.error.message).toContain(`${PROXY_TEXT_DEADLINE_MS} ms`);
      }
    }
    expect(aborted).toBe(2);
  });

  it('deadline: a caller abort still reports aborted, not network', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockImplementation((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        const fail = (): void => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (init.signal?.aborted) fail();
        else init.signal?.addEventListener('abort', fail);
      }),
    );
    const { callAI } = await import('../../../src/ai/client');
    const controller = new AbortController();
    const pending = callAI('sys', 'usr', true, { signal: controller.signal });
    await new Promise(r => setTimeout(r, 5));
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('aborted');
  });

  it('network error that clears on the retry returns Ok', async () => {
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    fetchSpy.mockRejectedValueOnce(new Error('socket hang up'));
    fetchSpy.mockResolvedValueOnce(
      makeFetchResponse({ ok: true, status: 200, body: okBody('recovered') }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('getLastFailureKind names the last failure and clears on success', async () => {
    // The single-post cascade collapses a failure to null before the pipeline
    // sees it. Without this the chain record cannot say WHY a post went
    // unjudged, and the dashboard back-compat default reads every one as
    // 'network' — an attribution nobody measured.
    installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
    const { callAI, getLastFailureKind } = await import('../../../src/ai/client');

    fetchSpy.mockResolvedValue(
      makeFetchResponse({ ok: false, status: 401, body: 'unauthorized' }),
    );
    await callAI('sys', 'usr');
    expect(getLastFailureKind()).toBe('auth-refusal');

    fetchSpy.mockReset();
    fetchSpy.mockResolvedValue(
      makeFetchResponse({ ok: true, status: 200, body: okBody('fine') }),
    );
    await callAI('sys', 'usr');
    expect(getLastFailureKind()).toBeNull();
  });

  it('getLastFailureKind covers the cap-exhausted short-circuit, which never reaches the network', async () => {
    installStorageStub(
      baselineSettings({ dailyCap: 5, totalChecksToday: 5, totalTokensThisMonth: 100 }),
    );
    const { callAI, getLastFailureKind } = await import('../../../src/ai/client');

    await callAI('sys', 'usr');

    expect(getLastFailureKind()).toBe('cap-exhausted');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cap-exhausted — daily cap reached: returns Err(cap-exhausted, daily), fetch NOT called', async () => {
    installStorageStub(
      baselineSettings({
        dailyCap: 100,
        totalChecksToday: 100,
        totalTokensThisMonth: 100,
      }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('cap-exhausted');
      if (result.error.kind === 'cap-exhausted') {
        expect(result.error.cap).toBe('daily');
      }
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
