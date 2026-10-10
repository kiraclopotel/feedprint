// What 'combined' MEANS on a persisted record.
//
// Two source comments claimed opposite meanings for the same field. This
// suite pins the meaning against the code that WRITES it, so the next reader
// cannot be misled by prose again.
//
// The only live writer of 'combined' on the posts path is the fallback return
// of `mapConcernToTechnique` (src/core/neutralizer.ts), reached from
// `judgeToCombinedShape`. The judge prompt (JUDGE_DETECT_NEUTRALIZE) emits ONE
// free-text `primary_concern`; the shape translator maps it onto exactly one
// enum member and builds a ONE-element techniques array. So:
//
//   'combined' = the model named a concern that matched none of the technique
//   enums. It is an UNCATEGORISED RESIDUAL, never "two or more stacked".
//
// It is also not always detail-free: the model's own concern phrase rides
// along in `evidence[0]`, which is exactly the string `forensics/logger.ts`
// folds into the signed record's `techniques[].why`.
//
// CONDITIONAL, and the exception is on the same path: the judge schema permits
// `primary_concern: null`, and `mapConcernToTechnique` maps null to 'combined'
// too. Then `reason` is '', `evidence` is [''], logger.ts's `.filter(Boolean)`
// strips it, and the record carries the residual technique with NO `why` at
// all. Those records are the genuinely empty part of the bucket. They are
// counted apart at the source so the size of that part is measured; both the
// hole and the counters are locked below.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TechniqueResult } from '../../../src/types/analysis';

vi.mock('../../../src/ai/client', () => ({
  callAI: vi.fn(),
}));
vi.mock('../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async () => 'deadbeef'),
}));
vi.mock('../../../src/forensics/neutralizer-diagnostics', () => ({
  recordNeutralizerEvent: vi.fn(async () => undefined),
}));

import { combinedDetectAndNeutralize } from '../../../src/core/neutralizer';
import { callAI } from '../../../src/ai/client';
import { Ok } from '../../../src/ai/ai-error';
import { recordNeutralizerEvent } from '../../../src/forensics/neutralizer-diagnostics';

const mockedCallAI = vi.mocked(callAI);
const mockedRecordEvent = vi.mocked(recordNeutralizerEvent);

/**
 * The exact derivation `src/forensics/logger.ts` applies to build
 * `techniques[].why` from `evidence`. Reproduced (not imported) because the
 * logger's own function is buried behind the chain-write lock, signing and IDB;
 * if it drifts from this, the drift is the finding.
 */
function whyFrom(evidence: readonly string[] | undefined): string | undefined {
  const why = (evidence ?? []).map((e) => String(e).trim()).filter(Boolean).join('; ');
  return why ? why : undefined;
}

const NO_L1: TechniqueResult[] = [
  { technique: 'fear-appeal', present: false, confidence: 0, severity: 0, evidence: [] },
];

function judgeSays(primaryConcern: string | null, severity = 7) {
  return Ok(JSON.stringify({
    concerning: true,
    acts_on_reader: true,
    primary_concern: primaryConcern,
    severity,
    confidence: 0.8,
    should_rewrite: false,
    neutralized_text: null,
  }));
}

async function present(concern: string | null): Promise<TechniqueResult[]> {
  mockedCallAI.mockResolvedValueOnce(judgeSays(concern));
  const result = await combinedDetectAndNeutralize(
    'a post', NO_L1, 'teen', 'en', 'unknown', undefined,
  );
  return (result?.analysis.techniques ?? []).filter((t) => t.present);
}

beforeEach(() => {
  mockedCallAI.mockReset();
  mockedRecordEvent.mockClear();
});

/** Reason codes this run recorded, filtered to the residual-split pair. */
function residualEvents(): string[] {
  return mockedRecordEvent.mock.calls
    .map((c) => String(c[0]))
    .filter((r) => r === 'combined-with-concern' || r === 'combined-no-concern');
}

describe("'combined' is an uncategorised residual, not a multi-technique bucket", () => {
  it('a concern matching no technique enum lands on combined, alone', async () => {
    const confirmed = await present('the caption is a wall of unreadable keysmash');
    expect(confirmed.map((t) => t.technique)).toEqual(['combined']);
  });

  it('a null concern lands on combined, alone', async () => {
    const confirmed = await present(null);
    expect(confirmed.map((t) => t.technique)).toEqual(['combined']);
  });

  it('a combined record never carries component techniques beside it', async () => {
    const confirmed = await present('an unmatched free-text concern');
    // The claim under test: NOT "2+ distinct techniques present". The judge
    // path emits a one-element array by construction, so a 'combined' record
    // has no components to render, ever.
    expect(confirmed).toHaveLength(1);
  });

  it('a concern that DOES match an enum never falls to combined', async () => {
    const confirmed = await present('scapegoating: blames a named ethnic group');
    expect(confirmed.map((t) => t.technique)).toEqual(['scapegoating']);
  });

  it("the model's own concern phrase survives on the entry (this is what becomes techniques[].why)", async () => {
    const concern = 'the caption is a wall of unreadable keysmash';
    const confirmed = await present(concern);
    expect(confirmed[0].evidence).toEqual([concern]);
    expect(whyFrom(confirmed[0].evidence)).toBe(concern);
  });

  // The hole. `why` is NOT unconditional, and the case where it is missing is
  // the same null-concern case that produces the residual technique.
  it('a null concern leaves nothing behind the verdict: evidence is blank and the record gets no why', async () => {
    const confirmed = await present(null);
    expect(confirmed.map((t) => t.technique)).toEqual(['combined']);
    // The judge produced no phrase, so `reason` was '' and evidence carries the
    // empty string, not the absence of an entry.
    expect(confirmed[0].evidence).toEqual(['']);
    // logger.ts drops it rather than storing '', so the signed record ends up
    // with the residual name and no rationale at all.
    expect(whyFrom(confirmed[0].evidence)).toBeUndefined();
  });
});

// A record whose technique is 'combined' WITH the model's phrase behind it and
// one with nothing behind it are different facts, and the record cannot tell
// them apart afterwards: an absent `why` is indistinguishable from a record
// written before the field existed. The split is therefore counted at the
// source, so "how much of the residual bucket is genuinely empty" is a measured
// number rather than a guess.
describe('the residual bucket is counted split, not lumped', () => {
  it('counts a residual verdict that carries the concern phrase', async () => {
    await present('an unmatched free-text concern');
    expect(residualEvents()).toEqual(['combined-with-concern']);
  });

  it('counts a residual verdict with a null concern separately', async () => {
    await present(null);
    expect(residualEvents()).toEqual(['combined-no-concern']);
  });

  it('does not count a verdict that landed on a named technique', async () => {
    await present('scapegoating: blames a named ethnic group');
    expect(residualEvents()).toEqual([]);
  });
});
