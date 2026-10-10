// JUDGE-V1-PAIR: a rewrite happens only where two different models both fire.
//
// A new instrument, in its own file, behind a pre-registered measurement, as
// .claude/rules/judge.md requires. It does not widen the JUDGE-V1 question, change its
// prompt, or move its cut. Both judges are asked the same frozen question at the same
// frozen severity; all that is new is that one model's word is no longer enough to
// rewrite what somebody sees.
//
// WHY IT EXISTS
//
// The single judge was right 78.4 percent of the times it acted on the held-out 500 of
// 2026-09-21. That is roughly one post in five rewritten when it should have been left
// alone, and it is the only failure a reader can see, because it lands on content they
// can check with their own eyes. A miss is invisible and the record keeps it either way,
// so the two errors are not worth the same and should not be traded as if they were.
//
// THE MEASUREMENT
//
// Pre-registered in docs/research/provider-2026-09-21/PREREGISTRATION-TEST-READ.md and
// committed (fb307359) before the sealed split was opened, so the bar is checkable
// against the clock rather than against anyone's memory.
//
//   held-out 500   both fired on 126 items, 126 of them charged. None wrong.
//   dev 500        both fired on 115 items, 115 of them charged. None wrong.
//   together       zero wrong calls among 500 non-target items.
//
// Weighted precision 100.0 [97.0, 100]. The number to quote is NOT 100: the rule of
// three puts the false-fire rate under 0.6 percent, which at the population base rate is
// at most 26 wrong against 351 right, so the honest floor is above 93 percent. Recall is
// 50.4 percent against 63.6 for the single judge.
//
// WHAT WAS TRIED AND REJECTED
//
// A third action for items only one judge flags: mark the post, leave the text alone.
// On the sample that bucket looks 85 percent right. Weighted to the real base rate it is
// 43 percent, and widening the first judge's cut to catch near-misses makes it 44.7. A
// mark a reader should ignore half the time teaches them to ignore all of them, so there
// is no middle tier and those items take the same no-action path as anything else the
// judges pass (docs/research/provider-2026-09-21/THE-RECOMMENDATION.md).
//
// WHAT THE RECALL COSTS, HONESTLY
//
// 13 points, and it is the mildest band. What both judges miss is overwhelmingly severity
// 4, the threshold itself. At severity 7 and above they caught 78 of 83 across both
// splits, and nothing rated 9 or 10 was missed at all
// (docs/research/provider-2026-09-21/WHAT-IS-MISSED.md).

// This file imports nothing. prompts.ts re-exports it so the frozen judge file can reach
// it through the one core -> ai edge it already carries, and importing prompts back from
// here would make that a cycle (tests/repo/import-cycles.test.ts). The reading is taken
// structurally rather than by importing JudgeV1Verdict, and the cut is passed in, so this
// file has no opinion about which question was asked, only about what agreement means.

/** The two fields the rule reads. JudgeV1Verdict satisfies this shape. */
export interface JudgeReading {
  charged: boolean;
  severity: number;
}

/** What the record calls this instrument. Distinct from 'judge-v1' because it is one. */
export const JUDGE_PAIR_ID = 'judge-v1-pair' as const;

/** One judge's answer at the given cut. Null or an errored verdict never fires. */
export function verdictFires(v: JudgeReading | null, cut: number): boolean {
  return !!v && v.charged === true && v.severity >= cut;
}

/**
 * Does the second judge need asking at all?
 *
 * Only when the first has already fired. If it has not, no agreement is possible and the
 * call would be spent to learn nothing. This is what keeps the second model on about a
 * tenth of items instead of all of them, and the whole change at roughly thirteen cents a
 * month for a heavy family rather than a doubling of the bill.
 */
export function needsSecondOpinion(first: JudgeReading | null, cut: number): boolean {
  return verdictFires(first, cut);
}

/**
 * The rule. A rewrite happens only where both fire.
 *
 * `second` is null when it was never asked, which is the same as not firing: no agreement,
 * no action. That makes the not-asked and the disagreed cases take one path, which is the
 * one thing this file must not get subtly wrong.
 */
export function pairFires(
  first: JudgeReading | null,
  second: JudgeReading | null,
  cut: number,
): boolean {
  return verdictFires(first, cut) && verdictFires(second, cut);
}

/**
 * What to stamp on the record: the pair when both models actually ran, the single judge
 * when only the first did.
 *
 * A record that names two readers when only one read is as wrong as one that names the
 * wrong company, and this product is the wrong place to be casual about either.
 */
export function judgeIdentity(
  secondWasAsked: boolean,
  firstModel: string,
  secondModel: string,
): { id: 'judge-v1' | 'judge-v1-pair'; model: string } {
  return secondWasAsked
    ? { id: JUDGE_PAIR_ID, model: `${firstModel}+${secondModel}` }
    : { id: 'judge-v1', model: firstModel };
}
