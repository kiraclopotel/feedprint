// BATCH-path corpus regression gate (audit finding T-1 fix).
//
// WHAT THIS GUARDS: that a prompt / floor / model change has not dropped
// detection F1 below the locked floor for each registered, non-circular
// corpus. Private record-level result files stay local. This gate reads the
// reviewed aggregate-only lock file and holds each registered corpus to ITS
// OWN latest real run without publishing the underlying rows.
//
// HISTORY: the prior version of this gate was vacuous — it (a) compared the
// single globally-latest file (any corpus) against one fixed 0.273 floor
// borrowed from the hardest CIRCULAR corpus, so a ~48% F1 collapse on the real
// corpus still passed, and (b) silently returned on mock/no-file. The decision
// logic now lives in regression-gate.ts and is unit-tested below with synthetic
// inputs, so the gate provably catches a regression instead of sleeping.
//
// HOW TO UPDATE A FLOOR: run a fresh real pass on the local-private corpus,
// inspect the result, then publish only the reviewed aggregate in
// tests/fixtures/calibration/batch-regression-lock.json. Never publish record rows.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BASELINES,
  isCircularCorpus,
  isPoisonedRun,
  latestRealRun,
  evaluateCorpus,
  MAX_FAILED_RATE,
  type ResultsFile,
} from './regression-gate';

const LOCK_FILE = path.join('tests', 'fixtures', 'calibration', 'batch-regression-lock.json');

function realFile(corpus: string, f1: number | null, generated_at: string): ResultsFile {
  return { corpus, mode: 'real', generated_at, total_records: 289, overall: { f1, precision: f1, recall: f1 } };
}
function mockFile(corpus: string, generated_at: string): ResultsFile {
  return { corpus, mode: 'mock', generated_at, total_records: 289, overall: { f1: 0, precision: 0, recall: 0 } };
}

// ─────────────────────────────────────────────────────────────────────────
// UNIT — the decision logic provably catches a regression (synthetic inputs)
// ─────────────────────────────────────────────────────────────────────────

describe('regression gate decision logic', () => {
  it('flags a real run whose F1 fell below the floor as a regression', () => {
    const files = [realFile('honest-en-v1.json', 0.30, '2026-06-01T00:00:00Z')];
    const v = evaluateCorpus(files, 'honest-en-v1.json', 0.52);
    expect(v.status).toBe('regression');
    expect(v.f1).toBe(0.30);
  });

  it('passes a real run at or above the floor', () => {
    const files = [realFile('honest-en-v1.json', 0.60, '2026-06-01T00:00:00Z')];
    expect(evaluateCorpus(files, 'honest-en-v1.json', 0.52).status).toBe('pass');
  });

  it('picks the latest REAL run and ignores a newer mock run', () => {
    const files = [
      realFile('honest-en-v1.json', 0.60, '2026-06-01T00:00:00Z'),
      mockFile('honest-en-v1.json', '2026-06-02T00:00:00Z'), // newer, but mock → ignored
    ];
    const latest = latestRealRun(files, 'honest-en-v1.json');
    expect(latest?.overall.f1).toBe(0.60);
    expect(evaluateCorpus(files, 'honest-en-v1.json', 0.52).status).toBe('pass');
  });

  it('checks each corpus against its OWN latest run — an easy corpus cannot mask a hard regression', () => {
    const files = [
      realFile('holdout-30.json', 1.0, '2026-06-02T00:00:00Z'), // newest overall, easy, passing
      realFile('honest-en-v1.json', 0.30, '2026-06-01T00:00:00Z'), // older, real, regressed
    ];
    // The globally-latest file is the passing holdout-30; the hard corpus must
    // still be evaluated from its own run and flagged.
    expect(evaluateCorpus(files, 'honest-en-v1.json', 0.52).status).toBe('regression');
  });

  it('reports no-run when a corpus has only mock results', () => {
    const files = [mockFile('honest-en-v1.json', '2026-06-01T00:00:00Z')];
    expect(evaluateCorpus(files, 'honest-en-v1.json', 0.52).status).toBe('no-run');
  });

  it('never registers a circular corpus as a baseline floor', () => {
    for (const corpus of Object.keys(BASELINES)) {
      expect(isCircularCorpus(corpus), `${corpus} is circular and must not be a floor`).toBe(false);
    }
  });

  it('ignores a poisoned (high-failure) run even when it is the newest', () => {
    // The 2026-06-04 shape: a total Groq outage scored on the fail-closed
    // regex floor, reporting a flattering F1. Must not be treated as a run.
    const outage = { ...realFile('honest-en-v1.json', 0.68, '2026-06-04T00:00:00Z'), failed_count: 289 };
    const clean = realFile('honest-en-v1.json', 0.60, '2026-06-03T00:00:00Z');
    expect(isPoisonedRun(outage)).toBe(true);
    expect(latestRealRun([outage, clean], 'honest-en-v1.json')?.generated_at).toBe('2026-06-03T00:00:00Z');
  });

  it('honors the runner-stamped poisoned flag without a failed_count', () => {
    const stamped = { ...realFile('honest-en-v1.json', 0.70, '2026-06-05T00:00:00Z'), poisoned: true };
    expect(isPoisonedRun(stamped)).toBe(true);
    expect(latestRealRun([stamped], 'honest-en-v1.json')).toBeNull();
  });

  it(`tolerates failure rates up to ${MAX_FAILED_RATE} and no higher`, () => {
    const fewFails = { ...realFile('honest-en-v1.json', 0.60, '2026-06-03T00:00:00Z'), failed_count: 28 };
    const tooMany = { ...realFile('honest-en-v1.json', 0.60, '2026-06-03T00:00:00Z'), failed_count: 30 };
    expect(isPoisonedRun(fewFails)).toBe(false); // 28/289 ≈ 9.7%
    expect(isPoisonedRun(tooMany)).toBe(true);   // 30/289 ≈ 10.4%
  });

  it('judges the median of the last 3 clean runs, so one noisy run cannot flip the gate', () => {
    // One unlucky draw below the floor among two healthy runs → still pass.
    const files = [
      realFile('honest-en-v1.json', 0.65, '2026-06-01T00:00:00Z'),
      realFile('honest-en-v1.json', 0.45, '2026-06-02T00:00:00Z'), // noise dip
      realFile('honest-en-v1.json', 0.60, '2026-06-03T00:00:00Z'),
    ];
    const v = evaluateCorpus(files, 'honest-en-v1.json', 0.52);
    expect(v.f1).toBe(0.60);
    expect(v.status).toBe('pass');
    // A sustained collapse (two of three below floor) → regression.
    const collapsed = [
      realFile('honest-en-v1.json', 0.65, '2026-06-01T00:00:00Z'),
      realFile('honest-en-v1.json', 0.40, '2026-06-02T00:00:00Z'),
      realFile('honest-en-v1.json', 0.42, '2026-06-03T00:00:00Z'),
    ];
    expect(evaluateCorpus(collapsed, 'honest-en-v1.json', 0.52).status).toBe('regression');
  });

  it('only the runs newer than older history count toward the median window', () => {
    // Old strong runs must not paper over a recent collapse.
    const files = [
      realFile('honest-en-v1.json', 0.70, '2026-05-30T00:00:00Z'),
      realFile('honest-en-v1.json', 0.70, '2026-05-31T00:00:00Z'),
      realFile('honest-en-v1.json', 0.30, '2026-06-01T00:00:00Z'),
      realFile('honest-en-v1.json', 0.31, '2026-06-02T00:00:00Z'),
      realFile('honest-en-v1.json', 0.32, '2026-06-03T00:00:00Z'),
    ];
    expect(evaluateCorpus(files, 'honest-en-v1.json', 0.52).status).toBe('regression');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// GATE — committed real runs hold each registered corpus to its floor
// ─────────────────────────────────────────────────────────────────────────

function loadCommittedResults(): ResultsFile[] {
  if (!fs.existsSync(LOCK_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')) as { runs?: ResultsFile[] };
    return Array.isArray(parsed.runs)
      ? parsed.runs.filter((r): r is ResultsFile => r != null && typeof r.corpus === 'string')
      : [];
  } catch {
    return [];
  }
}

describe('BATCH-path corpus regression lock (published aggregate)', () => {
  const files = loadCommittedResults();

  for (const [corpus, floor] of Object.entries(BASELINES)) {
    it(`${corpus}: latest real F1 ≥ ${floor}`, () => {
      const v = evaluateCorpus(files, corpus, floor);
      expect(
        v.status,
        `${corpus} has no published aggregate or its median F1=${v.f1} is below floor ${floor}`,
      ).toBe('pass');
    });
  }
});
