/** @vitest-environment jsdom */
// The AI health line read "100 AI calls · 74 ok / 26 errored" from a buffer that keeps one entry per
// attempt. A call that met a 429 waits and tries once more, and both tries were counted as calls,
// so a 429 cleared by its retry showed as an errored call next to the ok one it became. A call
// counts once, with how it finally ended; the per-status line still counts every answer.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installChromeStorageStub } from '../../helpers/chrome-storage';
import { utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { summarizeGroqTelemetry } from '../../../src/ai/telemetry-summary';
import { GROQ_TELEMETRY_STORAGE_KEY, type GroqCallTelemetry } from '../../../src/ai/telemetry';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

function makeFetchResponse(opts: { ok: boolean; status: number; body?: unknown; retryAfter?: string }): Response {
  const headers = new Map<string, string>();
  if (opts.retryAfter !== undefined) headers.set('retry-after', opts.retryAfter);
  const res = {
    ok: opts.ok,
    status: opts.status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: () => Promise.resolve(opts.body ?? {}),
    clone: () => res,
  };
  return res as unknown as Response;
}

const OK_BODY = { choices: [{ message: { content: 'reading' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } };

function entry(partial: Partial<GroqCallTelemetry>): GroqCallTelemetry {
  return {
    ts: '2026-09-25T00:10:00.000Z',
    model: 'm',
    region: null,
    requestId: null,
    systemFingerprint: null,
    latencyMs: 100,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    finishReason: null,
    truncated: false,
    status: 200,
    rateLimitRemaining: { requests: null, tokens: null },
    retryAfterMs: null,
    ...partial,
  };
}

describe('a call the client retried counts once, with its final outcome', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchSpy = vi.fn();
    (globalThis as unknown as { fetch: unknown }).fetch = fetchSpy;
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('both tries of one call carry the same call id, and the summary counts one ok call', async () => {
    const { state } = installChromeStorageStub({
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
    fetchSpy
      .mockResolvedValueOnce(makeFetchResponse({ ok: false, status: 429, retryAfter: '1' }))
      .mockResolvedValueOnce(makeFetchResponse({ ok: true, status: 200, body: OK_BODY }));
    const { callAI } = await import('../../../src/ai/client');

    const result = await callAI('sys', 'usr');
    expect(result.ok).toBe(true);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    const entries = state[GROQ_TELEMETRY_STORAGE_KEY] as GroqCallTelemetry[];
    expect(entries.map((e) => e.status)).toEqual([429, 200]);
    expect(typeof entries[0].callId).toBe('string');
    expect(entries[0].callId).toBe(entries[1].callId);

    const s = summarizeGroqTelemetry(entries);
    expect(s.calls).toBe(1);
    expect(s.okCalls).toBe(1);
    expect(s.errorCalls).toBe(0);
    expect(s.attempts).toBe(2);
    expect(s.retriedCalls).toBe(1);
    expect(s.statusBreakdown).toEqual([{ status: 200, count: 1 }, { status: 429, count: 1 }]);
  }, 10_000);

  it('groups tries by call id; entries saved without one count one call each', () => {
    const s = summarizeGroqTelemetry([
      entry({ callId: 'a', status: 429 }),
      entry({ callId: 'b', status: 429 }),
      entry({ callId: 'a', status: 200 }),
      entry({ callId: 'b', status: 429 }),
      entry({ callId: 'c', status: 200 }),
      entry({ status: 500 }),
    ]);
    expect(s.calls).toBe(4);
    expect(s.okCalls).toBe(2);
    expect(s.errorCalls).toBe(2);
    expect(s.attempts).toBe(6);
    expect(s.retriedCalls).toBe(2);
    expect(s.statusBreakdown).toEqual([
      { status: 429, count: 3 },
      { status: 200, count: 2 },
      { status: 500, count: 1 },
    ]);
  });

  it('the AI health line and the Issues card each say what they count', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const t = DASHBOARD_STRINGS[lang];
      const line = t.opsGroqCalls(74, 64, 10, 26, 100, 3542, 19115);
      expect(line, lang).toContain('74');
      expect(line, lang).toContain('100');
      expect(line, lang).toContain('26');
      expect(t.opsGroqStatusLine('HTTP 200: 74 · HTTP 429: 26'), lang).toContain('HTTP 429: 26');
      expect(t.opsCardLlmTitle(10), lang).toMatch(/24/);
    }
  });
});
