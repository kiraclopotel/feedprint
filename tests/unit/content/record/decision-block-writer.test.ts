// content/decision.ts: the decision block as the legacy paths can write it
// honestly today. A rail's action comes from the policy table for the mode; any
// other named row keeps the legacy action with judge null; a signal with no row
// writes no block; the mask is allow applied as mask; applied differing from
// action carries the fixed note.

import { describe, it, expect } from 'vitest';
import { decisionForLegacy, decisionForJudge, decisionForMask, appliedFor, NOTE_NOT_APPLIED, NOTE_LEGACY_ACTED, NOTE_PAIR_VETOED, READER_DEFAULT } from '../../../../src/content/record/decision';
import { isPaidPlacement } from '../../../../src/forensics/export-numbers';
import type { ForensicRecord } from '../../../../src/types/forensic';
import { levelOf } from '../../../../src/types/mode';

describe('decisionForLegacy', () => {
  it('a household blocklist hit is R1, hide in every mode, with the word as the match', () => {
    for (const mode of ['child', 'teen', 'adult'] as const) {
      const d = decisionForLegacy({ mode, detectionMode: 'blocklist:word:elon', techniques: [], severity: 9, applied: 'hide', mask: false });
      expect(d).toBeDefined();
      expect(d!.row).toBe('R1');
      expect(d!.action).toBe('hide');
      expect(d!.applied).toBe('hide');
      expect(d!.rails).toEqual([{ name: 'blocklist', match: 'elon' }]);
      expect(d!.judge).toBeNull();
      expect(d!.household).toEqual({ mode: levelOf(mode), reader: READER_DEFAULT, topicRule: null, mask: false });
      expect(d!.note).toBeNull();
    }
  });

  it('the sponsored rail takes the table cell: collapse, and a slur carries no match', () => {
    const ad = decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: ['consumer-rapid-frame'], severity: 6, applied: 'collapse', mask: false });
    expect(ad!.row).toBe('R4');
    expect(ad!.action).toBe('collapse');
    const slur = decisionForLegacy({ mode: 'adult', detectionMode: 'slur:1', techniques: ['extreme-toxicity'], severity: 9, applied: 'hide', mask: true });
    expect(slur!.row).toBe('R2');
    expect(slur!.rails).toEqual([{ name: 'identity-slur', match: '' }]);
    expect(slur!.household.mask).toBe(true);
  });

  // The reason the row matters beyond its words: R4 is a rail row, and the
  // export's own paid-placements column counts a record by that rail. Until
  // 2026-09-18 whyFor reached R4 from the TECHNIQUE name, so a judged
  // sales-pressure post with no ad marker on it was written with a sponsored
  // rail and then counted as an advertisement in a signed forensic export.
  // The measurement behind the row is section 3d of
  // docs/measurements/2026-08-02-accuracy.md, which recorded the same
  // confusion running the other way.
  // Driven through the real builder and the real column predicate, both ways.
  it('a judged sales-pressure post is not counted as a paid placement; a real ad is', () => {
    const judged = decisionForLegacy({ mode: 'teen', detectionMode: 'combined-detect-neutralize', techniques: ['consumer-rapid-frame'], severity: 6, applied: 'soften', mask: false });
    expect(judged!.row).toBe('J6');
    expect(judged!.rails).toEqual([]);
    expect(isPaidPlacement({ decision: judged } as unknown as ForensicRecord)).toBe(false);

    const ad = decisionForLegacy({ mode: 'teen', detectionMode: 'sponsored-ad', techniques: ['consumer-rapid-frame'], severity: 6, applied: 'collapse', mask: false });
    expect(ad!.row).toBe('R4');
    expect(ad!.rails).toEqual([{ name: 'sponsored', match: '' }]);
    expect(isPaidPlacement({ decision: ad } as unknown as ForensicRecord)).toBe(true);
  });

  it('a hide the page could not apply says so: applied mark, the fixed note', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'coded-harm:x', techniques: [], severity: 9, applied: 'mark', mask: false });
    expect(d!.row).toBe('R3');
    expect(d!.action).toBe('hide');
    expect(d!.applied).toBe('mark');
    expect(d!.note).toBe(NOTE_NOT_APPLIED);
  });

  it('a legacy judge hide names its band with the legacy action and no judge', () => {
    const d = decisionForLegacy({ mode: 'teen', detectionMode: 'comment-batch:negative', techniques: ['anger-trigger'], severity: 8, applied: 'hide', mask: false });
    expect(d!.row).toBe('J2');
    expect(d!.action).toBe('hide');
    expect(d!.judge).toBeNull();
    expect(d!.rails).toEqual([]);
  });

  it('a signal with no honest row writes no block', () => {
    expect(decisionForLegacy({ mode: 'teen', detectionMode: 'pre-rewrite-hide:profanity-tier', techniques: ['profanity'], severity: 9, applied: 'hide', mask: false })).toBeUndefined();
    expect(decisionForLegacy({ mode: 'child', detectionMode: 'something-else', techniques: [], severity: 1, applied: 'mark', mask: false })).toBeUndefined();
  });
});

describe('decisionForMask and appliedFor', () => {
  it('a mask is nothing charged, applied as mask, household.mask true', () => {
    const d = decisionForMask('adult');
    expect(d.row).toBe('D1');
    expect(d.action).toBe('allow');
    expect(d.applied).toBe('mask');
    expect(d.household.mask).toBe(true);
    expect(d.note).toBeNull();
  });

  it('appliedFor maps the legacy kinds and a failed visual to mark', () => {
    expect(appliedFor('hide', true)).toBe('hide');
    expect(appliedFor('collapse', true)).toBe('collapse');
    expect(appliedFor('neutralize', true)).toBe('soften');
    expect(appliedFor('hide', false)).toBe('mark');
  });
});

describe('decisionForJudge', () => {
  const judge = { id: 'judge-v1' as const, hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' };

  it('names the instrument, carries the five fields verbatim, and takes the table row for the mode', () => {
    const d = decisionForJudge({ mode: 'adult', judge, provider: 'groq', applied: 'mark', mask: false, rewrite: { attempted: true, outcome: 'failed' } });
    expect(d.judge).toEqual({ id: 'judge-v1', hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', provider: 'groq' });
    expect(d.reading).toEqual({ charged: true, family: 'hostile', severity: 5, effect: 'recruit', intent: 'react' });
    expect(d.row).toBe('J7');
    expect(d.action).toBe('mark');
    expect(d.applied).toBe('mark');
    expect(d.note).toBeNull();
    expect(d.rewrite).toEqual({ attempted: true, outcome: 'failed' });
  });

  it('when the legacy path did something other than the table says, the note says the legacy path acted first', () => {
    const d = decisionForJudge({ mode: 'adult', judge, provider: 'workers-ai', applied: 'soften', mask: false, rewrite: { attempted: true, outcome: 'applied' } });
    expect(d.action).toBe('mark');
    expect(d.applied).toBe('soften');
    expect(d.note).toBe(NOTE_LEGACY_ACTED);
    expect(d.judge?.provider).toBe('workers-ai');
  });

  it('a severity 9 reading is J1 and hide in every mode', () => {
    for (const mode of ['child', 'teen', 'adult'] as const) {
      const d = decisionForJudge({ mode, judge: { ...judge, severity: 9 }, provider: 'groq', applied: 'hide', mask: false, rewrite: { attempted: false, outcome: 'off' } });
      expect(d.row).toBe('J1');
      expect(d.action).toBe('hide');
    }
  });

  // 2026-09-20: until this date NOTE_LEGACY_ACTED was written for every difference between
  // applied and the row's action, so a rewrite that FAILED (applied allow, outcome failed) and a
  // hide or collapse that did not land (applied mark) were both signed "the legacy path acted
  // ...; applied is what it did". Found by running decisionForJudge with the post path's own
  // arguments (src/content/post-path/result-apply.ts).
  it('a failed rewrite is not signed as though the legacy path acted', () => {
    const d = decisionForJudge({ mode: 'adult', judge, provider: 'groq', applied: 'allow', mask: false, rewrite: { attempted: true, outcome: 'failed' } });
    expect(d.row).toBe('J7');
    expect(d.action).toBe('mark');
    expect(d.applied).toBe('allow');
    expect(d.note).toBe(NOTE_NOT_APPLIED);
  });

  it('a rewrite that landed and did more than the row asked still says the legacy path acted', () => {
    const d = decisionForJudge({ mode: 'adult', judge, provider: 'groq', applied: 'soften', mask: false, rewrite: { attempted: true, outcome: 'applied' } });
    expect(d.row).toBe('J7');
    expect(d.action).toBe('mark');
    expect(d.applied).toBe('soften');
    expect(d.note).toBe(NOTE_LEGACY_ACTED);
  });

  it('a hide or collapse that did not land is not signed as though it had', () => {
    const d = decisionForJudge({
      mode: 'adult',
      judge: { ...judge, severity: 8 },
      provider: 'groq',
      applied: 'mark',
      landed: false,
      mask: false,
      rewrite: { attempted: false, outcome: 'off' },
    });
    expect(d.row).toBe('J2');
    expect(d.action).toBe('collapse');
    expect(d.note).toBe(NOTE_NOT_APPLIED);
  });

  it('a hide or collapse that landed says the legacy path acted', () => {
    const d = decisionForJudge({
      mode: 'adult',
      judge: { ...judge, severity: 8 },
      provider: 'groq',
      applied: 'hide',
      landed: true,
      mask: false,
      rewrite: { attempted: false, outcome: 'off' },
    });
    expect(d.row).toBe('J2');
    expect(d.action).toBe('collapse');
    expect(d.note).toBe(NOTE_LEGACY_ACTED);
  });

  // gem 75, cold read of 24ac1a39: the pair veto (first model fired, second asked and
  // disagreed) reaches this branch the same way a failed rewrite or an unlanded hide does
  // (applied allow, no rewrite attempted), and every one of his 103 was signed as though an
  // unwired legacy path had acted. It is told apart by judge.id: 'judge-v1-pair' is stamped
  // only when the second model was actually asked, which happens only because the first
  // fired (judge-pair.ts:judgeIdentity/needsSecondOpinion).
  it('a pair veto is not signed as though the legacy path acted', () => {
    const d = decisionForJudge({
      mode: 'adult',
      judge: { ...judge, id: 'judge-v1-pair', severity: 5 },
      provider: 'groq',
      applied: 'allow',
      mask: false,
      rewrite: null,
    });
    expect(d.row).toBe('J7');
    expect(d.action).toBe('mark');
    expect(d.applied).toBe('allow');
    expect(d.note).toBe(NOTE_PAIR_VETOED);
    expect(d.note).not.toBe(NOTE_LEGACY_ACTED);
  });

  // Cold read of ede2c0b9: judge.id alone over-caught. A pair-judged record where both models
  // AGREED (real action 2026-09-21) still ends up with an applied action the generic table
  // does not name (167 of his, 64 like this one, e.g. #8373: a mark the legacy path softened),
  // and that is genuinely the legacy path acting, not a veto. Applied 'allow' is what only a
  // veto has; anything else pair-judged keeps the legacy note.
  it('a pair AGREEMENT that acted keeps the legacy note, not the veto one', () => {
    const d = decisionForJudge({
      mode: 'adult',
      judge: { ...judge, id: 'judge-v1-pair', severity: 5 },
      provider: 'groq',
      applied: 'soften',
      mask: false,
      rewrite: { attempted: true, outcome: 'applied' },
    });
    expect(d.row).toBe('J7');
    expect(d.action).toBe('mark');
    expect(d.applied).toBe('soften');
    expect(d.note).toBe(NOTE_LEGACY_ACTED);
    expect(d.note).not.toBe(NOTE_PAIR_VETOED);
  });

  it('a pass writes no note: not charged, applied allow', () => {
    const d = decisionForJudge({
      mode: 'adult',
      judge: { ...judge, charged: false, family: 'none', severity: 0 },
      provider: 'groq',
      applied: 'allow',
      mask: false,
      rewrite: null,
    });
    expect(d.row).toBe('D1');
    expect(d.action).toBe('allow');
    expect(d.note).toBeNull();
  });
});
