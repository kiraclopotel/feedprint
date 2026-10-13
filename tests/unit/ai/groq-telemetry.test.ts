/** @vitest-environment jsdom */
// FeelingWise — Groq call telemetry (production-readiness observability).
//
// Locks the per-call observability primitives wired into src/ai/client.ts:
//   - Response-header capture: x-groq-region, x-request-id, x-ratelimit-*
//   - Body capture: usage.{prompt,completion,total}_tokens, system_fingerprint,
//     choices[0].finish_reason (with `truncated` derived from finish_reason='length')
//   - End-to-end latency (pre-fetch → post-parse, wall-clock ms)
//   - chrome.storage.local ring buffer at GROQ_TELEMETRY_STORAGE_KEY, capped
//     at GROQ_TELEMETRY_RING_BUFFER_CAP (oldest evicted on overflow)
//   - Fire-and-forget contract: caller path is not blocked on storage
//   - Error-path skip: fetch throws → no telemetry entry written
//
// Mirrors the in-test fetch-spy + storage-stub pattern from
// tests/unit/ai/client-result-retry.test.ts so this file plugs into the same
// vitest harness.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readingConsentFor } from '../../helpers/reading-consent';

import {
  utcDayKey,
  utcMonthKey,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import {
  GROQ_TELEMETRY_STORAGE_KEY,
  GROQ_TELEMETRY_RING_BUFFER_CAP,
  buildGroqCallTelemetry,
  recordGroqCallTelemetry,
  type GroqCallTelemetry,
} from '../../../src/ai/telemetry';

function installStorageStub(initial: Record<string, unknown> = {}): {
  state: Record<string, unknown>;
} {
  const state: Record<string, unknown> = { ...initial };
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) {
            if (k in state) out[k] = state[k];
          }
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => {
          Object.assign(state, obj);
          return Promise.resolve();
        },
        remove: (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) delete state[k];
          return Promise.resolve();
        },
      },
    },
    runtime: { sendMessage: () => undefined },
  };
  return { state };
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

// Build a fetch-Response-like object that carries headers + a parsed body.
// The headers `Map` is wrapped to mimic the Fetch API's `headers.get` shape
// — Groq returns header names in lowercase already, so we don't bother with
// case-folding in the stub.
function makeFetchResponse(opts: {
  ok: boolean;
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}): Response {
  const headersMap = new Map<string, string>();
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headersMap.set(k.toLowerCase(), v);
  }
  return {
    ok: opts.ok,
    status: opts.status,
    headers: {
      get: (name: string) => headersMap.get(name.toLowerCase()) ?? null,
    },
    json: () => Promise.resolve(opts.body ?? {}),
  } as unknown as Response;
}

function okBody(extra: Record<string, unknown> = {}): unknown {
  return {
    choices: [{ message: { content: 'rewrite-output' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 },
    system_fingerprint: 'fp_test_123',
    ...extra,
  };
}

describe('groq telemetry — buildGroqCallTelemetry (pure shape mapper)', () => {
  it('captures x-groq-region from response headers', () => {
    const t = buildGroqCallTelemetry({
      model: 'llama-3.1-8b-instant',
      status: 200,
      headers: makeFetchResponse({
        ok: true,
        status: 200,
        headers: { 'x-groq-region': 'us-east-1' },
      }).headers,
      body: okBody(),
      latencyMs: 432,
      retryAfterMs: null,
    });
    expect(t.region).toBe('us-east-1');
  });

  it('captures usage tokens + system_fingerprint + finish_reason from parsed body', () => {
    const t = buildGroqCallTelemetry({
      model: 'llama-3.1-8b-instant',
      status: 200,
      headers: makeFetchResponse({ ok: true, status: 200 }).headers,
      body: okBody(),
      latencyMs: 100,
      retryAfterMs: null,
    });
    expect(t.promptTokens).toBe(120);
    expect(t.completionTokens).toBe(80);
    expect(t.totalTokens).toBe(200);
    expect(t.systemFingerprint).toBe('fp_test_123');
    expect(t.finishReason).toBe('stop');
    expect(t.truncated).toBe(false);
  });

  it('flags finish_reason=length as truncated (max_tokens hit)', () => {
    const t = buildGroqCallTelemetry({
      model: 'llama-3.1-8b-instant',
      status: 200,
      headers: makeFetchResponse({ ok: true, status: 200 }).headers,
      body: {
        choices: [{ message: { content: 'partial' }, finish_reason: 'length' }],
        usage: { prompt_tokens: 50, completion_tokens: 1024, total_tokens: 1074 },
      },
      latencyMs: 800,
      retryAfterMs: null,
    });
    expect(t.finishReason).toBe('length');
    expect(t.truncated).toBe(true);
  });

  it('parses x-ratelimit-remaining-{requests,tokens} as decimals', () => {
    const t = buildGroqCallTelemetry({
      model: 'llama-3.1-8b-instant',
      status: 200,
      headers: makeFetchResponse({
        ok: true,
        status: 200,
        headers: {
          'x-ratelimit-remaining-requests': '14',
          'x-ratelimit-remaining-tokens': '249.87',
        },
      }).headers,
      body: okBody(),
      latencyMs: 100,
      retryAfterMs: null,
    });
    expect(t.rateLimitRemaining.requests).toBe(14);
    expect(t.rateLimitRemaining.tokens).toBeCloseTo(249.87, 2);
  });

  it('returns null fields when headers / body keys are absent', () => {
    const t = buildGroqCallTelemetry({
      model: 'llama-3.1-8b-instant',
      status: 200,
      headers: makeFetchResponse({ ok: true, status: 200 }).headers,
      body: { choices: [] },
      latencyMs: 100,
      retryAfterMs: null,
    });
    expect(t.region).toBeNull();
    expect(t.requestId).toBeNull();
    expect(t.systemFingerprint).toBeNull();
    expect(t.finishReason).toBeNull();
    expect(t.rateLimitRemaining.requests).toBeNull();
    expect(t.rateLimitRemaining.tokens).toBeNull();
    expect(t.promptTokens).toBe(0);
    expect(t.completionTokens).toBe(0);
  });
});

describe('groq telemetry — recordGroqCallTelemetry (ring buffer)', () => {
  beforeEach(() => {
    installStorageStub();
  });

  function sampleEntry(overrides: Partial<GroqCallTelemetry> = {}): GroqCallTelemetry {
    return {
      ts: new Date(0).toISOString(),
      model: 'llama-3.1-8b-instant',
      region: 'us-east-1',
      requestId: null,
      systemFingerprint: null,
      latencyMs: 100,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      finishReason: 'stop',
      truncated: false,
      status: 200,
      rateLimitRemaining: { requests: null, tokens: null },
      retryAfterMs: null,
      ...overrides,
    };
  }

  it('ring buffer caps at GROQ_TELEMETRY_RING_BUFFER_CAP entries (oldest evicted)', async () => {
    for (let i = 0; i < GROQ_TELEMETRY_RING_BUFFER_CAP + 5; i++) {
      await recordGroqCallTelemetry(sampleEntry({ latencyMs: i }));
    }
    const stored = await chrome.storage.local.get(GROQ_TELEMETRY_STORAGE_KEY);
    const arr = stored[GROQ_TELEMETRY_STORAGE_KEY] as GroqCallTelemetry[];
    expect(arr.length).toBe(GROQ_TELEMETRY_RING_BUFFER_CAP);
    // Oldest entries (latencyMs 0..4) should be evicted; first remaining is 5.
    expect(arr[0].latencyMs).toBe(5);
    expect(arr[arr.length - 1].latencyMs).toBe(GROQ_TELEMETRY_RING_BUFFER_CAP + 4);
  });
});

// Build a fetch-Response-like object matching the shape callGroqOnce reads
// for the integration tests below.
function makeClientFetchResponse(opts: {
  ok: boolean;
  status: number;
  body?: unknown;
  retryAfter?: string | null;
  headers?: Record<string, string>;
}): Response {
  const headers = new Map<string, string>();
  if (opts.retryAfter !== null && opts.retryAfter !== undefined) {
    headers.set('retry-after', opts.retryAfter);
  }
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    headers.set(k.toLowerCase(), v);
  }
  return {
    ok: opts.ok,
    status: opts.status,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
    json: () => Promise.resolve(opts.body ?? {}),
  } as unknown as Response;
}

describe('groq telemetry — integration with callAI', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let storageState: { state: Record<string, unknown> };

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn();
    (globalThis as any).fetch = fetchSpy;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    storageState = installStorageStub(baselineSettings({ totalTokensThisMonth: 100 }));
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  async function readTelemetry(): Promise<GroqCallTelemetry[]> {
    // Allow the fire-and-forget telemetry write to flush.
    await new Promise((r) => setTimeout(r, 0));
    const arr = storageState.state[GROQ_TELEMETRY_STORAGE_KEY];
    return Array.isArray(arr) ? (arr as GroqCallTelemetry[]) : [];
  }

  it('successful call writes a telemetry entry with headers + body fields populated', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeClientFetchResponse({
        ok: true,
        status: 200,
        headers: {
          'x-groq-region': 'us-east-1',
          'x-request-id': 'req_abc123',
          'x-ratelimit-remaining-requests': '14',
          'x-ratelimit-remaining-tokens': '5980',
        },
        body: {
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 40, completion_tokens: 12, total_tokens: 52 },
          system_fingerprint: 'fp_live_42',
        },
      }),
    );
    const { callAI } = await import('../../../src/ai/client');
    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(true);

    const entries = await readTelemetry();
    expect(entries.length).toBe(1);
    const e = entries[0];
    // Assertion mirrors src/ai/client.ts:GROQ_FAST_MODEL.
    expect(e.model).toBe('openai/gpt-oss-20b');
    expect(e.region).toBe('us-east-1');
    expect(e.requestId).toBe('req_abc123');
    expect(e.systemFingerprint).toBe('fp_live_42');
    expect(e.status).toBe(200);
    expect(e.promptTokens).toBe(40);
    expect(e.completionTokens).toBe(12);
    expect(e.totalTokens).toBe(52);
    expect(e.finishReason).toBe('stop');
    expect(e.truncated).toBe(false);
    expect(e.rateLimitRemaining.requests).toBe(14);
    expect(e.rateLimitRemaining.tokens).toBe(5980);
    expect(typeof e.latencyMs).toBe('number');
    expect(e.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('fire-and-forget — caller is not blocked on telemetry storage', async () => {
    fetchSpy.mockResolvedValueOnce(
      makeClientFetchResponse({
        ok: true,
        status: 200,
        body: {
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        },
      }),
    );
    const { callAI } = await import('../../../src/ai/client');

    const t0 = Date.now();
    const result = await callAI('sys', 'usr');
    const elapsed = Date.now() - t0;

    // The call resolves before the telemetry write completes (fire-and-forget).
    // We can't assert "telemetry not yet written" deterministically since the
    // storage stub is synchronous, but we CAN assert the result was returned
    // without observing any storage failure (the contract is that telemetry
    // never throws / never rejects in the caller's path).
    expect(result.ok).toBe(true);
    expect(elapsed).toBeLessThan(5000);
  });

  it('error path — fetch throws → no telemetry entry written', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('socket hang up'));
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('network');
    }

    const entries = await readTelemetry();
    expect(entries.length).toBe(0);
  });
});
