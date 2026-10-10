// Calibration happens off the device by design: feedback improves the next published version,
// and nothing learns on the parent's device. So the threshold is always the mode's default.

import { Mode } from '../types/mode';

const DEFAULT_THRESHOLDS: Record<Mode, number> = { child: 0.45, teen: 0.55, adult: 0.60 };

/**
 * The one confidence the adult reader writes on every record it fires on. It is not a measure of
 * certainty: the measured rule (JUDGE-V1, charged at severity 4 and above) has no confidence term,
 * and this sits above every threshold so no later gate re-cuts what the measurement already cut.
 *
 * It lives beside the thresholds it must clear, and it is written in one place and described in
 * another: the writers put it on the record, and the export's methodology block prints it as "a
 * fixed value and not a measure of certainty". A copy in either place would let a signed file
 * misdescribe itself. The frozen src/core/neutralizer.ts still carries the literal, and
 * tests/unit/core/adult-reader-confidence-is-one-number.source.test.ts holds the two equal.
 */
export const ADULT_READER_FIXED_CONFIDENCE = 0.9;

/** The one place the thresholds are read from, so no caller writes its own. */
export async function getEffectiveThreshold(mode: Mode): Promise<number> {
  // Async although nothing is awaited, so a stored override can return without touching the
  // callers. It may return only with something that writes it: the last one was read on every
  // call and never written by anything.
  return DEFAULT_THRESHOLDS[mode];
}

