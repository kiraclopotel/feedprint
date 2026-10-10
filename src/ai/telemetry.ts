// FeelingWise — Groq call telemetry (production-readiness observability).
//
// Captures the per-call operational metrics Groq's production-readiness
// checklist (https://console.groq.com/docs/production-readiness/production-ready-checklist)
// calls out as the monitoring & observability pillar: response-header datacenter
// region, rate-limit remainders, request-id for support correlation, actual
// (not estimated) token usage, finish-reason for truncation detection, and
// end-to-end wall-clock latency.
//
// Sink: chrome.storage.local ring buffer at `STORAGE_KEY`, capped at
// `RING_BUFFER_CAP` entries (~10 KB at the observed ~100-byte serialized
// entry size). Last-N write semantics — oldest entries evicted on overflow.
// Fire-and-forget: callers `void recordGroqCallTelemetry(...)` without
// awaiting so the LLM hot path is never blocked on a storage round-trip.
//
// Out of scope for this turn (V1.1+):
//   - TTFT (would require streaming response instrumentation).
//   - Dashboard visualization (data lands; UI consumes later).
//   - External sink (Prometheus / OTLP / posthog). Local-only.

/** Storage key for the ring buffer. */
export const GROQ_TELEMETRY_STORAGE_KEY = 'groqTelemetry';

/** Maximum number of telemetry entries retained in the ring buffer. */
export const GROQ_TELEMETRY_RING_BUFFER_CAP = 100;

/**
 * Single Groq call's operational metrics. Shape is stable — readers
 * (future dashboard, ad-hoc devtools) depend on field names.
 */
export interface GroqCallTelemetry {
  /** ISO-8601 timestamp of the response receipt (after JSON parse). */
  ts: string;
  /** Model name string sent in the request body. */
  model: string;
  /**
   * Datacenter region from `x-groq-region`, or null if absent.
   *
   * ALWAYS NULL SINCE 2026-09-21: the header was Groq's and the current provider sends
   * no equivalent. The field name is the giveaway, which is why it is being said here
   * rather than left to be inferred.
   */
  region: string | null;
  /** `x-request-id`, for support correlation. Still sent by the current provider. */
  requestId: string | null;
  /**
   * Server-side model snapshot fingerprint from the response body, or null if absent.
   *
   * ALWAYS NULL SINCE 2026-09-21: DeepInfra's reply carries no `system_fingerprint`. Its
   * top-level fields are choices, created, id, model, object, service_tier and usage.
   */
  systemFingerprint: string | null;
  /** End-to-end wall-clock latency: pre-fetch → post-parse, in milliseconds. */
  latencyMs: number;
  /** Actual prompt-token count from `usage.prompt_tokens`. 0 if absent. */
  promptTokens: number;
  /** Actual completion-token count from `usage.completion_tokens`. 0 if absent. */
  completionTokens: number;
  /** Sum from `usage.total_tokens`. 0 if absent. */
  totalTokens: number;
  /**
   * `choices[0].finish_reason`. `'stop'` is the healthy case. `'length'`
   * means the model hit `max_tokens` mid-output — downstream JSON parser
   * will see truncated structure. `'content_filter'` indicates a safety
   * trip. null when the response body omitted the field.
   */
  finishReason: string | null;
  /** True iff `finishReason === 'length'`. Convenience flag for truncation alerts. */
  truncated: boolean;
  /** HTTP status code of the response. */
  status: number;
  /**
   * Rate-limit headroom remaining at response time.
   *
   * BOTH ARE ALWAYS NULL ON THE CURRENT PROVIDER and that is not a bug. A live 200 from
   * DeepInfra on 2026-09-21 returned exactly Date, Content-Type, Content-Length,
   * Connection, server, x-robots-tag and x-request-id. No rate-limit headers at all.
   * Groq sent them, DeepInfra does not, and the debug tab showing blanks here is the
   * honest answer rather than a failure to read them
   * (docs/research/provider-2026-09-21/APP-VS-PROVIDER.md, section 4).
   *
   * Kept rather than deleted because nothing decides on them, the shape costs nothing,
   * and a future provider may send them again. The limit that actually binds is the
   * account's concurrency ceiling, which is not reported per response by anyone.
   */
  rateLimitRemaining: {
    /** `x-ratelimit-remaining-requests` — RPM budget left. null if absent. */
    requests: number | null;
    /** `x-ratelimit-remaining-tokens` — TPM budget left. null if absent. */
    tokens: number | null;
  };
  /**
   * `retry-after` header value in milliseconds, null in healthy responses. Already
   * normalized to ms (the header arrives as a seconds-integer or an HTTP-date string).
   *
   * Unlike the other provider-dependent fields on this record, this one is not merely
   * telemetry: `src/ai/client.ts` backs off by `retryAfterMs ?? 5_000` on a rate limit
   * and on a transient 5xx. Groq sent it on 429 and 503. Whether the current provider
   * does is UNVERIFIED, because finding out means provoking a 429 against a live paid
   * account, which is not worth the answer. If it does not, the backoff is a flat five
   * seconds: safe, but blind rather than provider-guided.
   */
  retryAfterMs: number | null;
  /**
   * Known account names the last check found still in the request. Present since the letters
   * replaced names; absent on older entries. A shipped build counts these and sends anyway, so a
   * non-zero value here is the one local trace of a name that got through.
   */
  identifierHits?: number;
  /**
   * The same for every attempt one `callAI` makes, so a call the client retried after a rate limit
   * counts once, with how it finally ended. Absent on entries saved before attempts were tied
   * together; each of those counts as a call of its own.
   */
  callId?: string;
}

/**
 * Build a `GroqCallTelemetry` from a fetch Response + parsed JSON body +
 * timing. Header lookups are case-insensitive (Fetch API `Headers.get`
 * normalizes), so callers don't need to worry about Groq's casing.
 *
 * `retryAfterRaw` is the raw string from `response.headers.get('retry-after')`
 * — the parser is shared with `ai-error.ts:parseRetryAfterMs` to keep one
 * source of truth for the seconds-vs-HTTP-date branch.
 */
export function buildGroqCallTelemetry(args: {
  model: string;
  status: number;
  headers: Headers | { get(name: string): string | null };
  body: unknown;
  latencyMs: number;
  retryAfterMs: number | null;
  identifierHits?: number;
  callId?: string;
}): GroqCallTelemetry {
  const headers = args.headers;
  const body = args.body as
    | {
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        system_fingerprint?: string;
        choices?: Array<{ finish_reason?: string }>;
      }
    | undefined;

  const usage = body?.usage;
  const finishReason = body?.choices?.[0]?.finish_reason ?? null;

  const remainingRequestsRaw = headers.get('x-ratelimit-remaining-requests');
  const remainingTokensRaw = headers.get('x-ratelimit-remaining-tokens');

  return {
    ts: new Date().toISOString(),
    model: args.model,
    region: headers.get('x-groq-region'),
    requestId: headers.get('x-request-id'),
    systemFingerprint: body?.system_fingerprint ?? null,
    latencyMs: args.latencyMs,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
    finishReason,
    truncated: finishReason === 'length',
    status: args.status,
    rateLimitRemaining: {
      requests: parseNullableNumber(remainingRequestsRaw),
      tokens: parseNullableNumber(remainingTokensRaw),
    },
    retryAfterMs: args.retryAfterMs,
    ...(args.identifierHits ? { identifierHits: args.identifierHits } : {}),
    ...(args.callId ? { callId: args.callId } : {}),
  };
}

function parseNullableNumber(raw: string | null): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Groq emits rate-limit remainders as decimals ("249.87"). parseFloat
  // covers integer and decimal alike.
  const n = parseFloat(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Best-effort read of the telemetry ring buffer for the dashboard. Returns the
 * stored entries (oldest → newest) or an empty array. Never throws.
 */
export async function readGroqTelemetry(): Promise<GroqCallTelemetry[]> {
  try {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return [];
    const existing = await chrome.storage.local.get(GROQ_TELEMETRY_STORAGE_KEY);
    const arr = existing?.[GROQ_TELEMETRY_STORAGE_KEY];
    return Array.isArray(arr) ? (arr as GroqCallTelemetry[]) : [];
  } catch {
    return [];
  }
}

/**
 * Append a telemetry entry to the chrome.storage.local ring buffer.
 * Fire-and-forget by contract: never throws, never rejects in a way the
 * caller can observe. If chrome.storage is unavailable (jsdom unit-test
 * realms without the stub, MV3 SW restricted access edge case), the entry
 * is silently dropped — telemetry must not block the user-protection path.
 */
export async function recordGroqCallTelemetry(t: GroqCallTelemetry): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    const existing = await chrome.storage.local.get(GROQ_TELEMETRY_STORAGE_KEY);
    const arr: GroqCallTelemetry[] = Array.isArray(existing?.[GROQ_TELEMETRY_STORAGE_KEY])
      ? (existing[GROQ_TELEMETRY_STORAGE_KEY] as GroqCallTelemetry[])
      : [];
    arr.push(t);
    // Ring-buffer trim: evict oldest entries when over cap.
    const trimmed = arr.length > GROQ_TELEMETRY_RING_BUFFER_CAP
      ? arr.slice(arr.length - GROQ_TELEMETRY_RING_BUFFER_CAP)
      : arr;
    await chrome.storage.local.set({ [GROQ_TELEMETRY_STORAGE_KEY]: trimmed });
  } catch {
    // Best-effort. Telemetry failure must never bubble into the LLM call path.
  }
}
