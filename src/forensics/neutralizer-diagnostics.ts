// FeelingWise — Neutralizer diagnostics counter
//
// The outer `try/catch` in `neutralizer.ts` + the shape-guard rejects
// all swallow their failures to keep the pipeline silent for the end
// user (intended: PASS on failure, don't block rendering). That silence
// also hides bugs in the rejection paths.
//
// This module exposes a tiny counter so the dashboard (or a DevTools
// peek at chrome.storage.local) can answer the question "did my fix
// take effect, or did I just make the error invisible?". Reason codes
// are free-form strings; callers define the taxonomy. The storage
// shape is deliberately a flat `Record<string, number>` so adding a
// new reason code later requires zero migration.
//
// Storage layout (chrome.storage.local):
//   neutralizerDiagnostics: {
//     date: 'YYYY-MM-DD',           // UTC; resets when date flips
//     counts: { 'non-string-neutralized-text': 12, 'parse-failed': 3, ... }
//   }
//
// Off-the-record-by-design: this writes to chrome.storage.local, NOT
// to any forensic IDB store. It's an operational counter, not
// evidence; it must not cross into the chain-of-custody record set.
// It lives under src/forensics/ only because the other telemetry-
// adjacent modules live here.

export type NeutralizerEventReason =
  | 'non-string-neutralized-text'
  | 'parse-failed'
  | 'techniques-shape-drift'
  | 'techniques-not-iterable'
  | 'refusal-short-circuit'         // Anthropic stop_reason: 'refusal'
  | 'severity-floor-drop'           // LLM emitted severity <6 entry
  | 'meta-talk-leak'                // rewrite violated no-meta-talk rule
  | 'voice-inversion'               // rewrite flipped 3rd→1st person
  | 'injected-advisory'             // rewrite injected "rely on credible sources" / "essential to verify" advice not present in original
  | 'length-ratio-exceeded'         // rewrite > 2× original AND > 100 chars (rewriter bailed and bloated)
  | 'unknown-throw'                 // outer catch fallback
  // Two-stage cascade triage outcome counters. Triage emits one of
  // yes/unsure/no/parse_fail; the counters let the dashboard verify the
  // production short-circuit rate matches the ~61% baseline (measured on
  // hostile-stratified labeled-100).
  | 'triage-yes'                    // triage said yes → full classify ran
  | 'triage-unsure'                 // triage said unsure → full classify ran
  | 'triage-no'                     // triage said no → SHORT-CIRCUIT, returned benign
  | 'triage-parse-fail'             // parser couldn't extract verdict → full classify ran (recall-safe)
  // The uncategorised-residual split. 'combined' is what the judge's free-text
  // primary_concern falls to when it matches no technique enum, so the phrase
  // itself is the only content behind the verdict. It lands on the record as
  // techniques[].why unless the judge returned primary_concern: null, in which
  // case the record carries the residual name and nothing else. These two
  // answer "how much of the residual bucket is genuinely empty" — a question
  // the records themselves cannot answer, because an absent `why` is
  // indistinguishable from a pre-2026-08-22 record that never had the field.
  | 'combined-with-concern'          // residual verdict WITH the model's phrase (becomes why)
  | 'combined-no-concern';           // residual verdict with a null/blank concern (no why on the record)

interface NeutralizerDiagnostics {
  /** `Date.prototype.toDateString()` — matches `settings.lastResetDate`. */
  date: string;
  counts: Record<string, number>;
}

const STORAGE_KEY = 'neutralizerDiagnostics';

/**
 * Uses UTC-day key so day-rollover semantics match the daily-counter
 * reset in settings.ts. Format `YYYY-MM-DD` (UTC). Existing
 * chrome.storage.local `neutralizerDiagnostics` records with the old
 * `toDateString()` value will
 * mismatch on next read and trigger an auto-reset (acceptable: counters are
 * operational, not chain-of-custody).
 */
function todayKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function emptyDiagnostics(): NeutralizerDiagnostics {
  return { date: todayKey(), counts: {} };
}

/**
 * Best-effort read. Returns today's fresh shell if storage is missing,
 * stale-dated, or errors out. Never throws.
 */
export async function readNeutralizerDiagnostics(): Promise<NeutralizerDiagnostics> {
  try {
    // chrome.storage may not exist in non-extension test contexts.
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
      return emptyDiagnostics();
    }
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const raw = result?.[STORAGE_KEY];
    if (!raw || typeof raw !== 'object') return emptyDiagnostics();

    const date = typeof (raw as { date?: unknown }).date === 'string'
      ? (raw as { date: string }).date
      : '';
    const rawCounts = (raw as { counts?: unknown }).counts;
    const counts: Record<string, number> = {};
    if (rawCounts && typeof rawCounts === 'object') {
      for (const [k, v] of Object.entries(rawCounts as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
          counts[k] = v;
        }
      }
    }

    // Auto-reset on day flip. Mirror of the daily-reset pattern in settings.ts.
    if (date !== todayKey()) {
      return emptyDiagnostics();
    }
    return { date, counts };
  } catch {
    return emptyDiagnostics();
  }
}

/**
 * Increment the counter for `reason` by 1. Best-effort — swallows all errors
 * so the caller (neutralizer.ts hot-path) never pays reliability cost for
 * diagnostics.
 *
 * Reason is typed broadly to allow follow-up additions without a schema bump.
 */
export async function recordNeutralizerEvent(reason: NeutralizerEventReason | string): Promise<void> {
  try {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
    const current = await readNeutralizerDiagnostics();
    const nextCounts = { ...current.counts };
    nextCounts[reason] = (nextCounts[reason] ?? 0) + 1;
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        date: todayKey(),
        counts: nextCounts,
      },
    });
  } catch {
    // Swallow — diagnostics must never fail the caller.
  }
}

/**
 * Reset counter to zero for the current day. Used by the daily-reset hook or
 * the dashboard "clear" action. Exported for tests.
 *
 * Unlike the counter above, a failed write rejects, so the chain reset can
 * tell the parent this part was not cleared.
 */
export async function resetNeutralizerDiagnostics(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: emptyDiagnostics() });
}
