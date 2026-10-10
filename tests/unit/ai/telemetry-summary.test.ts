// Pure Groq telemetry summarizer — src/ai/telemetry-summary.ts.

import { describe, it, expect } from 'vitest';
import { summarizeGroqTelemetry } from '../../../src/ai/telemetry-summary';
import type { GroqCallTelemetry } from '../../../src/ai/telemetry';

function tel(partial: Partial<GroqCallTelemetry> = {}): GroqCallTelemetry {
  return {
    ts: '2026-06-06T10:00:00.000Z',
    model: 'llama-3.1-8b-instant',
    region: 'us-east-1',
    requestId: 'req',
    systemFingerprint: null,
    latencyMs: 400,
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    finishReason: 'stop',
    truncated: false,
    status: 200,
    rateLimitRemaining: { requests: null, tokens: null },
    retryAfterMs: null,
    ...partial,
  };
}

describe('summarizeGroqTelemetry', () => {
  it('returns an all-zero summary for no entries', () => {
    const s = summarizeGroqTelemetry([]);
    expect(s.calls).toBe(0);
    expect(s.latencyP50).toBe(0);
    expect(s.statusBreakdown).toEqual([]);
    expect(s.models).toEqual([]);
    expect(s.minRemainingRequests).toBeNull();
    expect(s.firstTs).toBeNull();
  });

  it('sums tokens and counts ok vs error by HTTP status', () => {
    const s = summarizeGroqTelemetry([
      tel({ status: 200, promptTokens: 100, completionTokens: 50, totalTokens: 150 }),
      tel({ status: 200, promptTokens: 200, completionTokens: 60, totalTokens: 260 }),
      // Error responses carry no usage block (tokens 0), like real Groq 4xx/5xx.
      tel({ status: 429, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
      tel({ status: 500, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    ]);
    expect(s.calls).toBe(4);
    expect(s.okCalls).toBe(2);
    expect(s.errorCalls).toBe(2);
    expect(s.promptTokens).toBe(300);
    expect(s.completionTokens).toBe(110);
    expect(s.totalTokens).toBe(410);
  });

  it('computes latency percentiles', () => {
    const entries = Array.from({ length: 100 }, (_, i) => tel({ latencyMs: i + 1 }));
    const s = summarizeGroqTelemetry(entries);
    expect(s.latencyP50).toBe(50);
    expect(s.latencyP95).toBe(95);
    expect(s.latencyMaxMs).toBe(100);
  });

  it('counts truncated calls (finish_reason=length)', () => {
    const s = summarizeGroqTelemetry([
      tel({ truncated: true, finishReason: 'length' }),
      tel({ truncated: false }),
      tel({ truncated: true, finishReason: 'length' }),
    ]);
    expect(s.truncatedCalls).toBe(2);
  });

  it('tracks the minimum rate-limit headroom across calls, ignoring nulls', () => {
    const s = summarizeGroqTelemetry([
      tel({ rateLimitRemaining: { requests: 500, tokens: 9000 } }),
      tel({ rateLimitRemaining: { requests: null, tokens: 3000 } }),
      tel({ rateLimitRemaining: { requests: 120, tokens: null } }),
    ]);
    expect(s.minRemainingRequests).toBe(120);
    expect(s.minRemainingTokens).toBe(3000);
  });

  it('takes the latest non-null retry-after in ring order', () => {
    const s = summarizeGroqTelemetry([
      tel({ retryAfterMs: 1000 }),
      tel({ retryAfterMs: null }),
      tel({ retryAfterMs: 2000 }),
      tel({ retryAfterMs: null }),
    ]);
    expect(s.lastRetryAfterMs).toBe(2000);
  });

  it('builds a status breakdown sorted by count desc and lists models + ts span', () => {
    const s = summarizeGroqTelemetry([
      tel({ status: 200, model: 'llama-3.1-8b-instant', ts: '2026-06-06T09:00:00.000Z' }),
      tel({ status: 200, model: 'llama-3.1-8b-instant' }),
      tel({ status: 429, model: 'meta-llama/llama-4-scout-17b-16e-instruct', ts: '2026-06-06T11:00:00.000Z' }),
    ]);
    expect(s.statusBreakdown[0]).toEqual({ status: 200, count: 2 });
    expect(s.statusBreakdown[1]).toEqual({ status: 429, count: 1 });
    expect(s.models).toEqual(['llama-3.1-8b-instant', 'meta-llama/llama-4-scout-17b-16e-instruct']);
    expect(s.firstTs).toBe('2026-06-06T09:00:00.000Z');
    expect(s.lastTs).toBe('2026-06-06T11:00:00.000Z');
  });
});
