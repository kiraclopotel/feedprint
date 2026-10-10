// FeelingWise — resilient chrome.storage.local read.
//
// chrome.storage.local.get can transiently REJECT under heavy concurrent I/O (per-post chain
// writes, settings reads and cap checks hitting storage at once; when this was written the video
// eyes and ears added their own round trips, and that path has since been removed).
// A single such blip used to flip a
// paid/dev user to FREE (getLicense → cap=tier-free) or pause the video sensor
// for the rest of the session (checkVideoBudget → "daily budget read failed"):
// a TRANSIENT failure must never change the user's effective tier or budget.
// Retrying the read a couple of times across a short delay clears the
// contention without touching the happy path — the first attempt returns
// immediately, and the delay is paid only on the rare failure.
//
// A DEAD extension context (orphaned content script after a reload) is NOT
// transient — retrying would only flood the log — so a context-invalidated
// error rethrows immediately for the caller's permanent-shutdown handling.

import { isContextError } from './context-guard';

/** Total read attempts (1 initial + retries). */
export const LOCAL_READ_ATTEMPTS = 3;
/** Base delay between attempts, ms. Scales linearly per attempt. */
const LOCAL_READ_RETRY_MS = 50;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `chrome.storage.local.get(key)` with a bounded retry on transient failure.
 * `key` may be one name or a list of them, the way the underlying get takes
 * them. It was typed for one name until 2026-09-19, which is why the settings
 * read, the only reader fetching a list, was the one reader with no retry: a
 * single blip there handed every parent-PIN gate a snapshot with no PIN in it.
 * The body always handled a list; only the type refused.
 * Resolves with the raw record (same shape as the underlying get). A
 * context-invalidated error rethrows immediately (permanent); any other error
 * rethrows only after every attempt is exhausted.
 *
 * Under the same heavy concurrent I/O that makes `get` REJECT, it can also
 * RESOLVE without the expected key present (an empty/partial record, no throw).
 * A caller that knows a key should be there can pass `isPresent` to retry that
 * resolved-but-missing case the SAME way a thrown blip is retried. Callers that
 * legitimately expect a key to be absent (fresh install / free user) omit
 * `isPresent` and keep the resolve-once behavior — a genuinely-absent key must
 * never become an error. When every attempt resolves unsatisfactory, the last
 * resolved record is returned (never thrown), so absence stays absence.
 */
export async function getLocalWithRetry(
  key: string | string[],
  attempts: number = LOCAL_READ_ATTEMPTS,
  retryMs: number = LOCAL_READ_RETRY_MS,
  isPresent?: (record: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  let lastResolved: Record<string, unknown> | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const record = await chrome.storage.local.get(key);
      if (!isPresent || isPresent(record)) return record;
      // Resolved but the expected key is missing — treat as a transient blip and
      // retry, mirroring the thrown-rejection backoff below.
      lastResolved = record;
      if (attempt < attempts - 1) await delay(retryMs * (attempt + 1));
    } catch (err) {
      if (isContextError(err)) throw err; // permanent — do not retry
      lastErr = err;
      if (attempt < attempts - 1) await delay(retryMs * (attempt + 1));
    }
  }
  // Exhausted. Prefer a resolved (if empty) record over throwing: a
  // genuinely-absent key resolves to its empty record, it does not raise.
  if (lastResolved !== undefined) return lastResolved;
  throw lastErr;
}
