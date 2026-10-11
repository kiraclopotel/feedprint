export type AIFailure =
  | { kind: 'transient-http'; status: number; retryAfterMs?: number }
  | { kind: 'rate-limit'; retryAfterMs: number }
  | { kind: 'json-refusal' }
  | { kind: 'auth-refusal' }
  // The relay asked this key for the reading go-ahead (403 consent_required) and the person has not given it, or the
  // pause that follows that answer still holds. Not a licence problem and not our request being refused: it needs the
  // person to open the popup and start the reading, so it has a kind of its own (storage/reading-pause.ts).
  | { kind: 'consent-required' }
  | { kind: 'content-policy' }
  | { kind: 'network'; message?: string }
  | { kind: 'aborted' }
  // 'master-off' = the parent's aiAnalysisEnabled master breaker is off:
  // not a quota, a deliberate zero-spend state. Same fail-closed routing as
  // the quota caps so DOM-side protections still fire.
  | { kind: 'cap-exhausted'; cap: 'daily' | 'monthly' | 'tier-free' | 'master-off' }
  | { kind: 'pre-llm-circuit-breaker' }
  // The proxy's usage coordinator (Durable Object) is unavailable: a
  // deploy/binding fault, not a transient network blip. NOT retried (a
  // broken binding stays broken; retrying per post was a storm) and logged
  // loudly once per call so the failure is visible instead of hiding
  // behind a generic transient error.
  | { kind: 'coordinator-unavailable' }
  // Pre-LLM gate. Returned when scoreBatch determines the input is in a
  // language the current model cannot productively evaluate (Arabic,
  // Chinese, Japanese, etc. — anything `detectThreadLanguage` tags as
  // 'unknown'). Skips the LLM round-trip entirely; saves ~2s + Groq input
  // tokens per non-EN/RO thread. Routes through the same failClosed path
  // so harm-floor + slur escalation still fires on slur-laden non-EN
  // content (slur dict is language-blind).
  | { kind: 'pre-llm-unsupported-language' }
  // The proxy relayed a 4xx that is not one of its licence refusals: Groq
  // rejected the request itself (400 json_validate_failed, 413, 422). Our
  // request, not the key, so it is never retried and never counted as a
  // licence problem. Item 3c, 2026-09-13: three of these wore the
  // auth-refusal label on the owner's dev key in one day.
  | { kind: 'internal-error'; status: number; code?: string };

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function Ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function Err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function unwrapOrEmpty(result: Result<string, AIFailure>): string {
  return result.ok ? result.value : '';
}

export function parseRetryAfterMs(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10) * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }
  return undefined;
}
