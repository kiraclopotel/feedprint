// Pure decision logic for the BATCH-path corpus regression gate.
//
// Extracted from the test so it can be exercised in isolation (TDD) and so the
// "did detection regress?" decision is one auditable function, not inline test
// glue. The test file reads the published aggregate-only regression lock and
// feeds it here; these functions never touch the filesystem.
//
// WHY corpus-aware: different corpora have wildly different operating points
// (honest-en-v1 ~0.5-0.7, holdout-30 ~0.75-1.0, the circular edge-case sets
// ~0.27). A single global floor lets an easy-corpus run mask a hard-corpus
// collapse. Each registered corpus is held to ITS OWN latest real run.

export interface ResultsFile {
  generated_at: string;
  corpus: string; // e.g. "honest-en-v1.json"
  mode: 'real' | 'mock';
  total_records: number;
  overall: {
    f1: number | null;
    precision: number | null;
    recall: number | null;
  };
  /** Stamped by the runner when the run's AI-failure rate exceeded MAX_FAILED_RATE. */
  poisoned?: boolean;
  /** Count of per-record `failed: true` entries. Derived by the gate's loader
   *  for files written before the runner stamped it. */
  failed_count?: number;
}

/**
 * Maximum tolerated AI-call failure rate before a "real" run stops being a
 * measurement. A failed call is scored on the deterministic fail-closed
 * fallback (regex harm-floor), not the model — the 2026-06-04 committed run
 * was 289/289 failed (total Groq outage) yet reported F1 0.677 with
 * precision 1.0, and the gate blessed it. Every legitimate committed run has
 * 0 failures, so 10% separates outage artifacts from real measurements with
 * a wide margin. Single source of truth; the runner imports it.
 */
export const MAX_FAILED_RATE = 0.1;

/** A run whose verdicts came (substantially) from the fail-closed fallback
 *  rather than the model. Such a file measures the regex floor, not detection. */
export function isPoisonedRun(f: ResultsFile): boolean {
  if (f.poisoned === true) return true;
  if (f.failed_count != null && f.total_records > 0) {
    return f.failed_count / f.total_records > MAX_FAILED_RATE;
  }
  return false;
}

/**
 * Honest per-corpus F1 FLOORS — "the worst F1 we tolerate before failing CI".
 * NOT the latest/best number; a floor below the measured shipped operating
 * point, leaving room for Groq run-to-run sampling noise without masking a
 * real regression.
 *
 *   honest-en-v1: historical local-private real runs span F1 0.38–0.72;
 *   shipped operating point ~0.59 (RULE-12, OPERATING_POINT.md). The public
 *   checkout carries reviewed aggregate evidence only, never record rows.
 *   Floor 0.52 trips on a genuine collapse (0.30–0.45, which earlier broken
 *   prompts actually produced) but rides out normal variance.
 *
 * ONLY non-circular corpora belong here (see isCircularCorpus). Add a corpus
 * only with reviewed real-mode aggregate evidence justifying the floor.
 */
export const BASELINES: Record<string, number> = {
  'honest-en-v1.json': 0.52,
};

/**
 * Corpora auto-labeled by FW's own old pipeline — measuring accuracy against
 * these is CIRCULAR (self-agreement, not correctness). Mirrors the banned list
 * in scripts/research/runners/run-batch-corpus.ts. Such a corpus must never serve as a
 * regression floor.
 */
const CIRCULAR_PATTERNS: RegExp[] = [
  /^_chain-/, /^context-corpus/, /^forensic-/, /^mini-corpus-/,
  /^labeled-100/, /^past-forensics-corpus/, /^synthetic-edge-cases/,
  /^tree-ctx-/, /-results-/,
];

export function isCircularCorpus(corpus: string): boolean {
  const name = corpus.replace(/\.json$/, '');
  return CIRCULAR_PATTERNS.some((re) => re.test(name));
}

/**
 * All clean (non-poisoned) REAL-mode results files for one corpus, oldest
 * first. Mock runs are ignored (mock always returns 'none'/sev=2 → F1=0; it
 * measures nothing); poisoned runs are ignored (they measure the fail-closed
 * regex floor, not the model).
 */
function cleanRealRuns(files: ResultsFile[], corpus: string): ResultsFile[] {
  const real = files.filter(
    (f) => f.corpus === corpus && f.mode === 'real' && f.overall.f1 != null && !isPoisonedRun(f),
  );
  // ISO timestamps sort lexicographically; newest last.
  real.sort((a, b) => a.generated_at.localeCompare(b.generated_at));
  return real;
}

/**
 * The most recent clean REAL-mode results file for one corpus, by ISO
 * timestamp. Returns null when the corpus has no clean real run.
 */
export function latestRealRun(files: ResultsFile[], corpus: string): ResultsFile | null {
  const real = cleanRealRuns(files, corpus);
  return real.length === 0 ? null : real[real.length - 1];
}

export type RegressionStatus = 'pass' | 'regression' | 'no-run';

export interface CorpusVerdict {
  corpus: string;
  floor: number;
  f1: number | null;
  status: RegressionStatus;
}

/**
 * Evaluate one corpus against its floor using the MEDIAN F1 of its last
 * (up to) 3 clean real runs.
 *   - no clean real run → 'no-run' (the CI caller treats this as a failure)
 *   - median F1 < floor → 'regression'
 *   - otherwise         → 'pass'
 *
 * WHY median-of-3, not single-latest: same-config back-to-back runs on this
 * harness have swung F1 by up to 0.19 (2026-05-30, 0.527 → 0.720 in 163s with
 * no intervening commit) — Groq 8b is not deterministic even at temp=0/seed=42,
 * and n≈41 positives means a handful of flipped verdicts moves F1 ~0.1. A
 * single-run gate therefore passes/fails on the luck of the last committed
 * draw. The median of 3 still trips on a genuine collapse (three lucky draws
 * in a row is what it takes to mask one) while riding out one noisy run.
 */
export function evaluateCorpus(files: ResultsFile[], corpus: string, floor: number): CorpusVerdict {
  const recent = cleanRealRuns(files, corpus).slice(-3);
  const f1s = recent
    .map((f) => f.overall.f1)
    .filter((f1): f1 is number => f1 != null)
    .sort((a, b) => a - b);
  if (f1s.length === 0) return { corpus, floor, f1: null, status: 'no-run' };
  const median = f1s[Math.floor((f1s.length - 1) / 2)];
  return { corpus, floor, f1: median, status: median < floor ? 'regression' : 'pass' };
}
