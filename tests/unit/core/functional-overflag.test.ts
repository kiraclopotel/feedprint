// CI guard for the over-flagging trust line.
//
// FeelingWise's hand-authored functional suite (tests/fixtures/calibration/functional-pairs.json,
// honest-by-construction labels) carries a CLEAN block of genuinely-fine content
// — genuine opinion, fair critique, quoted/negated harm, reclaimed terms, venting,
// supportive messages — that the deterministic detection layers MUST leave alone.
// "Over-flagging is a primary failure" (VISION): a wrongly-flagged honest feeling
// costs more trust than a missed borderline case. This test locks the measured
// 0%-over-flag line so it can never silently regress.
//
// It exercises the PRODUCTION deterministic functions directly (not a copy), and
// mirrors the per-comment gate in run-functional-eval.mjs::deterministicVerdict /
// comment-batch-scorer.ts::enrichWithHarmFloor. It does NOT run the LLM/BATCH path
// (that needs a live run); this guards the deterministic floor + the no-over-flag
// invariant on it.

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import { computeHarmFloor, HARM_FLOOR_TRIGGER_THRESHOLD } from '../../../src/core/harm-floor';
import { filterProfanity } from '../../../src/core/profanity-filter';
import { detectEmojiPile, detectRepetition } from '../../../src/analysis/pre-llm-signals';
import { detectCodedHarm } from '../../../src/core/coded-harm-catcher';
import { repoPath } from '../../helpers/repo-root';

// Production parity: enrichWithHarmFloor's IDENTITY_SLUR_WEIGHT.
const IDENTITY_SLUR_WEIGHT = 50;

/** Mirrors the production deterministic per-comment flag decision (batch path). */
function flagsDeterministically(text: string): boolean {
  const hf = computeHarmFloor(text, []); // techniques=[] — batch-path parity
  const slur = filterProfanity(text, 'teen', { tier: 'slurs' });
  const slurBonus = slur.filtered ? IDENTITY_SLUR_WEIGHT : 0;
  const score = Math.min(
    100,
    hf.score + slurBonus + (detectEmojiPile(text)?.weight ?? 0) + (detectRepetition(text)?.weight ?? 0),
  );
  return score >= HARM_FLOOR_TRIGGER_THRESHOLD || detectCodedHarm(text) != null;
}

interface FunctionalItem {
  id: string;
  text: string;
  should_flag: boolean;
  technique?: string;
}

const suite = JSON.parse(
  fs.readFileSync(repoPath('tests', 'fixtures', 'calibration', 'functional-pairs.json'), 'utf8'),
) as { items: FunctionalItem[] };

const items = suite.items;
const clean = items.filter((i) => i.should_flag === false);
const manipulative = items.filter((i) => i.should_flag === true);

describe('functional over-flag guard (deterministic layers)', () => {
  it('the suite carries a meaningful clean block', () => {
    expect(clean.length).toBeGreaterThan(20);
    expect(manipulative.length).toBeGreaterThan(5);
  });

  it('never over-flags clean/neutral content — the 0% over-flag trust line', () => {
    const overflagged = clean.filter((i) => flagsDeterministically(i.text)).map((i) => i.id);
    // If this fails, the deterministic layer started flagging genuinely-fine
    // content — a trust regression. The failing ids tell you which.
    expect(overflagged).toEqual([]);
  });

  it('still catches the unambiguous deterministic harms (coverage floor not zero)', () => {
    // The deterministic layer is EXPECTED to miss semantic manipulation (that's
    // the LLM's job), but the coded-harm cases must not silently stop matching.
    const caught = manipulative.filter((i) => flagsDeterministically(i.text)).length;
    expect(caught).toBeGreaterThan(0);
  });
});
