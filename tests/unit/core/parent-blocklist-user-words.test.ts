// FeelingWise — a user's own blocked words reach inflections and run-together
// forms (PLAN-2026-09-14 item 5b).
//
// The owner blocked "motherfucker" and "dickheadmotherfucker" still showed.
// This suite is the two-sided proof: tests/fixtures/calibration/user-words-v1.json
// holds what must now hide and what must still show. Add a case there and it
// runs with no code change.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchParentBlocklist, readParentBlocklist } from '../../../src/core/parent-blocklist';
import { repoPath } from '../../helpers/repo-root';

interface Case {
  words: string[];
  text: string;
  rule?: string;
  why: string;
}

const fixture = JSON.parse(
  readFileSync(repoPath('tests', 'fixtures', 'calibration', 'user-words-v1.json'), 'utf8'),
) as { mustMatch: Case[]; mustNotMatch: Case[] };

function match(c: Case) {
  const list = readParentBlocklist({ words: c.words.filter(w => !w.includes(' ')), phrases: c.words.filter(w => w.includes(' ')), accounts: [] });
  return matchParentBlocklist(list, c.text);
}

describe('user words fixture: shape', () => {
  it('is two-sided and every case says why', () => {
    expect(fixture.mustMatch.length).toBeGreaterThanOrEqual(15);
    expect(fixture.mustNotMatch.length).toBeGreaterThanOrEqual(15);
    for (const c of [...fixture.mustMatch, ...fixture.mustNotMatch]) expect(c.why.length).toBeGreaterThan(0);
  });
});

describe('user words: must match', () => {
  for (const c of fixture.mustMatch) {
    it(`${c.text}  (${c.why})`, () => {
      const hit = match(c);
      expect(hit, c.why).not.toBeNull();
      expect(hit?.kind).toBe('word');
      if (c.rule) expect(hit?.rule).toBe(c.rule);
    });
  }
});

describe('user words: must not match', () => {
  for (const c of fixture.mustNotMatch) {
    it(`${c.text}  (${c.why})`, () => {
      expect(match(c), c.why).toBeNull();
    });
  }
});

describe('user words: cost', () => {
  it('stays under 0.2 ms per post with a ten-word list (0.033 measured alone)', () => {
    const list = readParentBlocklist({
      words: ['motherfucker', 'fuck', 'diet', 'skinnytok', 'idiot', 'loser', 'prost', 'slabit', 'pendejo', 'otario'],
      phrases: [], accounts: [],
    });
    const text = 'Honestly the assistant said the dietary guidelines changed again, everyone in the classroom was confused about the recommendations and the nutritionists disagreed #healthylifestyle #wellness';
    // Best of several short batches, as in profanity-run-together.test.ts: the
    // full suite shares the machine, and the minimum is the uninterrupted batch.
    const round = (times: number): number => {
      const started = performance.now();
      for (let i = 0; i < times; i++) matchParentBlocklist(list, text);
      return (performance.now() - started) / times;
    };
    round(500);
    let best = Infinity;
    for (let batch = 0; batch < 7; batch++) best = Math.min(best, round(500));
    expect(best, `${best.toFixed(4)} ms per post`).toBeLessThan(0.2);
  }, 20000);
});
