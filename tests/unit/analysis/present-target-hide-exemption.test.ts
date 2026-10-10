// Absent-target hide exemption (src/analysis/present-target.ts), shame-
// attack ONLY, plus its flush-path wiring in src/content/index.ts.
//
// Offline bar (pre-registered in docs/history/archive/MECH8B-REPORT-2026-07-24.md, measured
// by scripts/research/retired/mech8b-offline-2026-07/pilot-8b-offline.ts on the two recorded 2026-07-24 runs): among
// severity>=6 rows, >=3 FP exemptions AND 0 TP exemptions — held on both
// runs (7 FP / 0 TP each). Scapegoating is scope-excluded: group victims are
// never "present", so a presence test would exempt genuine group smears
// (docs/history/archive/MECH8-REPORT-2026-07-24.md diagnosis — both TP costs of the wider
// scope were scapegoating).

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  hasPresentTarget,
  isAbsentTargetInterventionExempt,
} from '../../../src/analysis/present-target';
import {
  isManipulative,
  MANIPULATION_SEVERITY_THRESHOLD,
} from '../../../src/analysis/comment-batch-scorer';

const INDEX_PATH = 'src/content/comment-batch/flush.ts';
const SCORER_PATH = 'src/analysis/comment-batch-scorer.ts';

const shameAttack = { technique: 'shame-attack', action: undefined, overrideOrigin: undefined } as const;
const scapegoating = { technique: 'scapegoating', action: undefined, overrideOrigin: undefined } as const;

// Absent-target texts (no second-person token, no @-mention) matching the
// measured FP class: public-figure / absent-third-party insults.
const ABSENT_EN = 'Politicians are all liars and thieves, every single one of them.';
const ABSENT_RO = 'Politicienii sunt niste hoti si mincinosi, toata clasa politica e o rusine.';

describe('isAbsentTargetInterventionExempt — shame-attack absent target exempts (EN + RO)', () => {
  it('exempts an EN shame-attack aimed at nobody present', () => {
    expect(hasPresentTarget(ABSENT_EN)).toBe(false);
    expect(isAbsentTargetInterventionExempt(shameAttack, ABSENT_EN)).toBe(true);
  });

  it('exempts a RO shame-attack aimed at nobody present', () => {
    expect(hasPresentTarget(ABSENT_RO)).toBe(false);
    expect(isAbsentTargetInterventionExempt(shameAttack, ABSENT_RO)).toBe(true);
  });
});

describe('isAbsentTargetInterventionExempt — present target keeps the hide', () => {
  it('EN second-person address is present → no exemption', () => {
    expect(isAbsentTargetInterventionExempt(shameAttack, 'You are pathetic and everyone knows it.')).toBe(false);
  });

  it('RO second-person address (diacritic-folded) is present → no exemption', () => {
    expect(isAbsentTargetInterventionExempt(shameAttack, 'Ești jalnic și toată lumea râde de tine.')).toBe(false);
  });

  it('@-mention is present → no exemption', () => {
    expect(isAbsentTargetInterventionExempt(shameAttack, '@dana pathetic as always, what an embarrassment')).toBe(false);
  });
});

describe('isAbsentTargetInterventionExempt — scapegoating NEVER exempts', () => {
  it('scapegoating with zero presence markers still gets no exemption (group-disqualifier by scope)', () => {
    expect(hasPresentTarget(ABSENT_EN)).toBe(false);
    expect(isAbsentTargetInterventionExempt(scapegoating, ABSENT_EN)).toBe(false);
    expect(isAbsentTargetInterventionExempt(scapegoating, ABSENT_RO)).toBe(false);
    expect(
      isAbsentTargetInterventionExempt(
        scapegoating,
        'Those people are the reason this country is falling apart.',
      ),
    ).toBe(false);
  });
});

describe('isAbsentTargetInterventionExempt — uncertain defaults to hidden', () => {
  it('empty / whitespace / missing text → no exemption (fail-open keeps intervention)', () => {
    expect(isAbsentTargetInterventionExempt(shameAttack, '')).toBe(false);
    expect(isAbsentTargetInterventionExempt(shameAttack, '   ')).toBe(false);
    expect(isAbsentTargetInterventionExempt(shameAttack, undefined)).toBe(false);
  });

  it('deterministic-override / hide-tier verdicts → no exemption', () => {
    expect(
      isAbsentTargetInterventionExempt(
        { technique: 'shame-attack', action: undefined, overrideOrigin: 'coded-harm' } as never,
        ABSENT_EN,
      ),
    ).toBe(false);
    expect(
      isAbsentTargetInterventionExempt(
        { technique: 'shame-attack', action: 'hide', overrideOrigin: undefined } as never,
        ABSENT_EN,
      ),
    ).toBe(false);
  });

  it('dehumanizing absent-target text → no exemption (hide stays reachable)', () => {
    expect(
      isAbsentTargetInterventionExempt(shameAttack, 'These parasites should be exterminated.'),
    ).toBe(false);
  });
});

describe('flush-path wiring (src/content/index.ts)', () => {
  const source = readFileSync(resolve(process.cwd(), INDEX_PATH), 'utf8');

  it('computes the exemption at push time from the full verdict', () => {
    expect(source).toContain('absentTargetExempt: isAbsentTargetInterventionExempt(verdict, post.text)');
  });

  it('guards ONLY the shame-attack disjunct of the empty-rewrite hide promotion', () => {
    expect(source).toContain("(technique === 'shame-attack' && !item.absentTargetExempt) ||");
    // scapegoating / anger-trigger / fear-appeal disjuncts stay unguarded.
    expect(source).toContain("technique === 'scapegoating' ||");
    expect(source).toContain("technique === 'anger-trigger' ||");
    expect(source).toContain("technique === 'fear-appeal'");
  });
});

describe('flag-gate boundary — presence reaches the flag tier for shame-attack ONLY', () => {
  // Reopened 2026-08-02. The original lock kept presence out of the flag tier
  // entirely; it was drawn because both true-positive costs in the 2026-07-24
  // eval were SCAPEGOATING verdicts. Scapegoating is what the lock actually
  // protects, so that is what this now asserts. The hide-tier exemption stays
  // out of the scorer: hide and flag are separate decisions.
  const scorerSource = readFileSync(
    resolve(process.cwd(), SCORER_PATH),
    'utf8',
  );

  it('never imports the HIDE-tier exemption into the scorer', () => {
    expect(scorerSource).not.toContain('isAbsentTargetInterventionExempt');
  });

  it('applies presence exactly once, inside the shame-attack branch', () => {
    expect(scorerSource).toContain("technique === 'shame-attack' && item.target_present !== true");
    expect(scorerSource.match(/hasPresentTarget\(/g)).toHaveLength(1);
  });

  it('never gates scapegoating on target presence', () => {
    expect(scorerSource).not.toMatch(/scapegoating[^\n]*hasPresentTarget/);
    expect(scorerSource).not.toMatch(/hasPresentTarget[^\n]*scapegoating/);
  });

  it('isManipulative still flags a threshold shame-attack verdict — target presence is not an input', () => {
    expect(MANIPULATION_SEVERITY_THRESHOLD).toBe(6);
    expect(isManipulative({ severity: 6, technique: 'shame-attack' } as never)).toBe(true);
    expect(isManipulative({ severity: 7, technique: 'scapegoating' } as never)).toBe(true);
    expect(isManipulative({ severity: 5, technique: 'shame-attack' } as never)).toBe(false);
  });
});
