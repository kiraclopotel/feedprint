// Echo groups: the same wording from several accounts inside a few days (11 Oct 2026, the owner's idea; the Leader placed the
// pure function with Code). The owner saw on X an account say something, and another say the same with a few words more or
// fewer. A fixed rule over text, author and time: groups of three or more accounts inside 72 hours, pairs as a second output,
// nothing from a model, and no words in the result.

import { describe, it, expect } from 'vitest';
import { findEchoGroups, type EchoItem } from '../../../src/analysis/echo-groups';

const HOUR = 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

const CORE = 'the council has quietly approved the new waste plant behind the old school and nobody asked the people living there';

let n = 0;
function item(author: string, text: string, hoursIn: number, platform = 'x'): EchoItem {
  return { id: `i${++n}`, platform, author, atMs: T0 + hoursIn * HOUR, text };
}

describe('a group: the same wording from three or more accounts inside 72 hours', () => {
  it('finds three accounts saying the same thing', () => {
    const result = findEchoGroups([item('ann', CORE, 0), item('bob', CORE, 5), item('cat', CORE, 30)]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ accounts: 3, wordings: 1, platforms: ['x'] });
    expect(result.groups[0].ids).toHaveLength(3);
    expect(result.pairs).toHaveLength(0);
  });

  it('finds the variant the owner saw: a few words more or fewer, one word changed', () => {
    const result = findEchoGroups([
      item('ann', CORE, 0),
      item('bob', `${CORE} wake up`, 2),
      item('cat', CORE.replace('quietly', 'secretly'), 9),
      item('dan', CORE.split(' ').slice(0, -2).join(' '), 12),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].accounts).toBe(4);
    expect(result.groups[0].wordings).toBe(4);
    expect(result.groups[0].wordsMax - result.groups[0].wordsMin).toBeGreaterThanOrEqual(2);
  });

  it('does not care about case, punctuation, links or @names', () => {
    const result = findEchoGroups([
      item('ann', CORE, 0),
      item('bob', `@ann ${CORE.toUpperCase()}!!! https://example.com/a?b=1`, 1),
      item('cat', `${CORE}... #waste www.example.org/x`, 2),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].wordings).toBeLessThanOrEqual(2);
  });

  it('names the platforms it spans and the first and last time', () => {
    const result = findEchoGroups([item('ann', CORE, 0, 'x'), item('bob', CORE, 3, 'facebook'), item('cat', CORE, 6, 'x')]);
    expect(result.groups[0].platforms).toEqual(['facebook', 'x']);
    expect(result.groups[0].firstMs).toBe(T0);
    expect(result.groups[0].lastMs).toBe(T0 + 6 * HOUR);
  });
});

describe('what is not a group', () => {
  it('one account saying it three times is repetition, not an echo', () => {
    expect(findEchoGroups([item('ann', CORE, 0), item('ann', CORE, 4), item('ann', CORE, 8)])).toMatchObject({ groups: [], pairs: [], comparable: 1 });
  });

  it('three accounts spread over more than 72 hours are not inside one window', () => {
    const result = findEchoGroups([item('ann', CORE, 0), item('bob', CORE, 50), item('cat', CORE, 100)]);
    expect(result.groups).toHaveLength(0);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].accounts).toBe(2);
  });

  it('a chain of echoes longer than the window gives the busiest 72 hours, not the whole chain', () => {
    const result = findEchoGroups([0, 24, 48, 72, 96, 120, 144].map((h, i) => item(`acct${i}`, CORE, h)));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].accounts).toBe(4);
    expect(result.groups[0].lastMs - result.groups[0].firstMs).toBeLessThanOrEqual(72 * HOUR);
  });

  it('short lines never count: a greeting from many accounts is not a wave', () => {
    const result = findEchoGroups(['ann', 'bob', 'cat', 'dan'].map((a, i) => item(a, 'good morning everyone, have a lovely day', i)));
    expect(result.groups).toHaveLength(0);
    expect(result.comparable).toBe(0);
  });

  it('different things are different things', () => {
    const result = findEchoGroups([
      item('ann', CORE, 0),
      item('bob', 'the bakery on the corner finally reopened this morning and the queue went around the block twice', 1),
      item('cat', 'my daughter finished her first marathon today and we are all so proud of how hard she trained', 2),
    ]);
    expect(result.groups).toHaveLength(0);
    expect(result.pairs).toHaveLength(0);
  });

  it('an item with no author, or no time, is left out rather than guessed', () => {
    const result = findEchoGroups([item('ann', CORE, 0), item('', CORE, 1), item('cat', CORE, 2), { ...item('dan', CORE, 3), atMs: Number.NaN }]);
    expect(result.groups).toHaveLength(0);
    expect(result.pairs).toHaveLength(1);
  });
});

describe('a pair: two accounts, the second output', () => {
  it('is reported apart from the groups, and says whether it is word for word', () => {
    const result = findEchoGroups([item('ann', CORE, 0), item('bob', CORE, 5), item('cat', 'a completely unrelated sentence about the weather being rather nice for the whole week ahead', 6)]);
    expect(result.groups).toHaveLength(0);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toMatchObject({ accounts: 2, wordings: 1 });
  });

  it('a pair with different wording has more than one wording', () => {
    const result = findEchoGroups([item('ann', CORE, 0), item('bob', `${CORE} please share`, 5)]);
    expect(result.pairs[0].wordings).toBe(2);
  });
});

describe('what comes out', () => {
  it('holds no words: ids, counts and times only', () => {
    const result = findEchoGroups([item('ann', CORE, 0), item('bob', CORE, 5), item('cat', CORE, 30)]);
    const out = JSON.stringify(result);
    for (const word of ['council', 'waste', 'school', 'ann', 'bob', 'cat']) expect(out).not.toContain(word);
  });

  it('the thresholds can be changed: four accounts needed', () => {
    const items = [item('ann', CORE, 0), item('bob', CORE, 5), item('cat', CORE, 30)];
    expect(findEchoGroups(items, { minAccounts: 4 }).groups).toHaveLength(0);
    expect(findEchoGroups(items, { windowMs: 10 * HOUR }).groups).toHaveLength(0);
  });

  it('stays quick on a large record: 12,000 different items in a few seconds, and the one echo found', () => {
    const many: EchoItem[] = [];
    for (let i = 0; i < 12000; i++) {
      many.push(item(`user${i % 900}`, `item ${i} says something about topic ${i % 97} with a few ordinary words number ${i * 7} and ${i * 13} to end`, i * 0.01));
    }
    many.push(item('x1', CORE, 10), item('x2', CORE, 11), item('x3', CORE, 12));
    const started = Date.now();
    const result = findEchoGroups(many);
    expect(Date.now() - started).toBeLessThan(8000);
    expect(result.groups.some((g) => g.accounts === 3)).toBe(true);
  }, 20_000);
});
