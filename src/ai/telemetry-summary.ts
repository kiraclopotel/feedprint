// FeelingWise — Groq telemetry summarizer (pure).
//
// Turns the per-attempt GroqCallTelemetry ring (src/ai/telemetry.ts,
// chrome.storage.local `groqTelemetry`, 100-entry) into a debug-tab summary:
// how many AI calls ran, how fast, how many tokens, how often a call was
// truncated (finish_reason=length → the JSON parser sees a cut-off response),
// how much rate-limit headroom is left, and the HTTP-status breakdown.
//
// PURE + Node-testable: no chrome, no IDB, no Date.now(). Reuses the
// nearest-rank percentile from perf-summary so latency math is consistent
// across the debug tab.

import type { GroqCallTelemetry } from './telemetry';
import { percentile } from '../diagnostics/perf-summary';

const round1 = (x: number): number => Math.round(x * 10) / 10;

export interface GroqTelemetrySummary {
  /**
   * Calls, each counted once: the tries one call made share a call id, and a call the client
   * retried after a rate limit is one call, not two.
   */
  calls: number;
  /** Calls whose last try got an HTTP 2xx. */
  okCalls: number;
  /** Calls whose last try got HTTP >= 400, so the call failed after any retry. */
  errorCalls: number;
  /** Tries the buffer holds, one per answer; what `statusBreakdown` counts. */
  attempts: number;
  /** Calls that needed more than one try. */
  retriedCalls: number;
  latencyP50: number;
  latencyP95: number;
  latencyMaxMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Calls cut off at max_tokens (finish_reason === 'length'). */
  truncatedCalls: number;
  /** Lowest rate-limit headroom observed; null when never reported. */
  minRemainingRequests: number | null;
  minRemainingTokens: number | null;
  /** Most recent retry-after (ms) seen on a 429/503, null when none. */
  lastRetryAfterMs: number | null;
  /** HTTP status → count of answers (every try, not every call), sorted by count desc. */
  statusBreakdown: Array<{ status: number; count: number }>;
  /** Distinct model strings seen (sorted). */
  models: string[];
  firstTs: string | null;
  lastTs: string | null;
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/**
 * Summarize Groq telemetry entries. Pure — pass the list from
 * `readGroqTelemetry()`. Entries are assumed oldest → newest (ring order);
 * `lastRetryAfterMs` takes the latest non-null in that order.
 */
export function summarizeGroqTelemetry(entries: GroqCallTelemetry[]): GroqTelemetrySummary {
  if (entries.length === 0) {
    return {
      calls: 0, okCalls: 0, errorCalls: 0, attempts: 0, retriedCalls: 0,
      latencyP50: 0, latencyP95: 0, latencyMaxMs: 0,
      promptTokens: 0, completionTokens: 0, totalTokens: 0,
      truncatedCalls: 0, minRemainingRequests: null, minRemainingTokens: null,
      lastRetryAfterMs: null, statusBreakdown: [], models: [],
      firstTs: null, lastTs: null,
    };
  }

  const latencies: number[] = [];
  const statusCounts = new Map<number, number>();
  const models = new Set<string>();
  let truncatedCalls = 0;
  // Call id → the status of its latest try. Entries without an id stand alone.
  const lastStatusByCall = new Map<string, number>();
  const triesByCall = new Map<string, number>();
  let promptTokens = 0, completionTokens = 0, totalTokens = 0;
  let minRemainingRequests: number | null = null;
  let minRemainingTokens: number | null = null;
  let lastRetryAfterMs: number | null = null;

  entries.forEach((e, i) => {
    const key = e.callId ? `id:${e.callId}` : `entry:${i}`;
    lastStatusByCall.set(key, e.status);
    triesByCall.set(key, (triesByCall.get(key) ?? 0) + 1);
    latencies.push(e.latencyMs);
    if (e.truncated) truncatedCalls++;
    promptTokens += e.promptTokens;
    completionTokens += e.completionTokens;
    totalTokens += e.totalTokens;
    minRemainingRequests = minNullable(minRemainingRequests, e.rateLimitRemaining.requests);
    minRemainingTokens = minNullable(minRemainingTokens, e.rateLimitRemaining.tokens);
    if (e.retryAfterMs !== null) lastRetryAfterMs = e.retryAfterMs;
    statusCounts.set(e.status, (statusCounts.get(e.status) ?? 0) + 1);
    if (e.model) models.add(e.model);
  });

  let okCalls = 0, errorCalls = 0, retriedCalls = 0;
  for (const status of lastStatusByCall.values()) {
    if (status >= 200 && status < 300) okCalls++;
    else if (status >= 400) errorCalls++;
  }
  for (const tries of triesByCall.values()) if (tries > 1) retriedCalls++;

  const sortedLat = latencies.slice().sort((a, b) => a - b);
  const statusBreakdown = Array.from(statusCounts.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status - b.status);

  return {
    calls: lastStatusByCall.size,
    okCalls,
    errorCalls,
    attempts: entries.length,
    retriedCalls,
    latencyP50: round1(percentile(sortedLat, 50)),
    latencyP95: round1(percentile(sortedLat, 95)),
    latencyMaxMs: round1(sortedLat[sortedLat.length - 1]),
    promptTokens,
    completionTokens,
    totalTokens,
    truncatedCalls,
    minRemainingRequests,
    minRemainingTokens,
    lastRetryAfterMs,
    statusBreakdown,
    models: Array.from(models).sort(),
    firstTs: entries[0].ts,
    lastTs: entries[entries.length - 1].ts,
  };
}
