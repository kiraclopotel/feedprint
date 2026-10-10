// House-rule swear handling: the deterministic trigger that routes a passing
// teen/child comment to silent soften-or-hide. Locks the detection half of the
// fix (found 2026-06-04: "...the fuckers" was left intact on a genuine-opinion
// PASS). The soften/hide routing itself lives in the comment-batch flush flow;
// this guards that the trigger fires on real swears and stays quiet on benign
// opinions (no over-action).

import { describe, it, expect } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';

describe('house-rule profanity trigger for passing comments', () => {
  it('fires on the real swearing comments that previously slipped through', () => {
    const swearing = [
      'And now Bam is suing for that amount the fuckers',            // africandiva4
      'Honestly so deserved that family has been getting fucked over', // Xcalamity_02
    ];
    for (const t of swearing) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered).toBe(true);
    }
  });

  it('stays quiet on benign opinions (no over-action, keeps over-block at 0)', () => {
    const benign = [
      'New body cam release from police here:',
      'Well, also a lot of lost court fees and whatnot in there. Dr visits and an anxiety disorder.',
      'SpaceX is about to price its IPO at $135 per share.',
    ];
    for (const t of benign) {
      expect(filterProfanity(t, 'teen', { tier: 'profanity' }).filtered).toBe(false);
    }
  });
});
