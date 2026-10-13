// G1: the record's search finds what you mean. "criza" finds a post that says "criză" (and "criză" with its accent finds
// it too), "mare criză" finds "E criză mare" (every word, any order), a phrase in quotes finds that exact phrase, and
// "#<number>" still jumps to that record. The text a rewrite produced is searched too. Through the real recordPasses with
// buildSearchIndex, the way the activity list calls them.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import {
  buildSearchIndex, recordPasses, matchesWhat, type ActivityFilterState,
} from '../../../../../src/ui/dashboard/components/activity-filters';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: over.id ?? 'r', timestamp: '2026-09-01T10:00:00.000Z', platform: 'tiktok', kind: 'post',
    originalText: 'x', originalHash: 'h', originalLength: 1, neutralizedText: '', author: 'a',
    postUrl: 'https://www.tiktok.com/@a/video/1', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih',
    verdict: 'pass', chainPosition: 1,
    ...over,
  } as ForensicRecord;
}

const NONE: ActivityFilterState = {
  filter: 'all', platformFilter: 'all', accountFilter: 'all', whenFilter: 'any',
  severityFilter: null, kindFilter: null, modeFilter: null, modelFilter: null,
  techniqueFilter: null, hiddenCategoryFilter: null, safetyBucketFilter: null,
  recordIdsFilter: null, roomUrlFilter: null, hourRangeFilter: null, search: '',
  surfaceFilter: null, sessionFilter: null, seenBeforeFilter: null, authorFilter: null,
};
const what = (r: ForensicRecord, f: ActivityFilterState['filter']) => matchesWhat(r, f, new Map(), new Set());

function finds(r: ForensicRecord, query: string): boolean {
  return recordPasses(r, { ...NONE, search: query }, what, buildSearchIndex([r]));
}

const CRISIS = rec({ id: 'c', originalText: 'E criză mare', chainPosition: 42 });

describe('the activity search finds what a person means', () => {
  it.each([
    ['the word as written', 'criză'],
    ['the word without its accent', 'criza'],
    ['capitals', 'CRIZA'],
    ['capitals with the accent', 'CRIZĂ'],
    ['spaces around the query', '  criza  '],
    ['every word, any order', 'mare criză'],
    ['every word, without the accent', 'mare criza'],
    ['a quoted phrase, in order', '"criză mare"'],
    ['a quoted phrase, without the accent', '"criza mare"'],
    ['a word beside a quoted phrase', 'E "criză mare"'],
    ['the platform, as before', 'tiktok'],
    ['its number', '#42'],
  ])('%s: %j finds the record', (_label, query) => {
    expect(finds(CRISIS, query)).toBe(true);
  });

  it.each([
    ['a quoted phrase in the wrong order', '"mare criză"'],
    ['one word that is not there', 'criza zzz'],
    ['a word that is not there', 'zzz'],
    ['another number', '#999'],
  ])('%s: %j does not find it', (_label, query) => {
    expect(finds(CRISIS, query)).toBe(false);
  });

  it('a phrase does not run across two fields of the record', () => {
    const r = rec({ id: 'f', originalText: 'mare', author: 'criza' });
    expect(finds(r, '"mare criza"')).toBe(false);
  });

  it('a Romanian comma-below and cedilla letter are the same letter', () => {
    const r = rec({ id: 's', originalText: 'o poveste frumoasă și lungă' });
    expect(finds(r, 'si')).toBe(true);
    expect(finds(r, 'şi')).toBe(true);
    expect(finds(r, 'frumoasa')).toBe(true);
  });

  it('the text a rewrite produced is searched too, and a record with none is not hurt', () => {
    const rewritten = rec({ id: 'w', originalText: 'x', neutralizedText: 'o versiune mai calmă' });
    expect(finds(rewritten, 'calma')).toBe(true);
    expect(finds(rec({ id: 'p', originalText: 'x', neutralizedText: '' }), 'calma')).toBe(false);
  });

  it('an empty or quotes-only query narrows nothing', () => {
    expect(finds(CRISIS, '')).toBe(true);
    expect(finds(CRISIS, '   ')).toBe(true);
    expect(finds(CRISIS, '""')).toBe(true);
  });
});

// C1 (the owner's walk of 12 Oct 2026): "I tried to search for a user and it did not find that user." The row shows
// "@handle", and a person types what the row shows; the index held the handle without its @, so "@alice_w" found
// nothing. The display name beside the handle was not searched at all, nor the account a comment sits under, and a
// name with a letter that does not come apart under NFD ("Łukasz") could not be found without it.
describe('an account is found by what the row shows and by what it was called', () => {
  const ALICE = rec({ id: 'a', author: 'alice_w', authorName: 'Alice Wonderland', originalText: 'a post about tea', platform: 'twitter' });
  const WITH_AT = rec({ id: 'b', author: '@bob.builder', originalText: 'a post about bricks', platform: 'youtube' });
  const LUKASZ = rec({ id: 'l', author: 'lukasz99', authorName: 'Łukasz Żółć', originalText: 'x', platform: 'instagram' });
  const JOSE = rec({ id: 'j', author: 'josé_m', authorName: 'José María', originalText: 'x' });
  const FANCY = rec({ id: 'f', author: 'cleo', authorName: '𝓒𝓵𝓮𝓸 𝓟𝓪𝓽𝓻𝓪', originalText: 'x' });
  const UNDER = rec({ id: 'u', kind: 'comment', author: 'replier', roomAuthor: 'carol_the_host', originalText: 'nice one' });

  it.each([
    ['the handle', ALICE, 'alice_w'],
    ['the handle with its @, as the row shows it', ALICE, '@alice_w'],
    ['the handle in capitals', ALICE, 'ALICE_W'],
    ['the handle with its @ in capitals', ALICE, '@Alice_W'],
    ['part of the handle', ALICE, 'alice_'],
    ['the handle said as words', ALICE, 'alice w'],
    ['the handle as a quoted phrase said as words', ALICE, '"alice w"'],
    ['the display name', ALICE, 'Alice Wonderland'],
    ['the display name, one word', ALICE, 'wonderland'],
    ['the display name and the handle together', ALICE, 'wonderland @alice_w'],
    ['a handle the platform stores with its @, typed without', WITH_AT, 'bob.builder'],
    ['a handle the platform stores with its @, typed with it', WITH_AT, '@bob.builder'],
    ['a handle with a dot, said as words', WITH_AT, '"bob builder"'],
    ['a name with letters that keep their mark inside them, plain', LUKASZ, 'lukasz zolc'],
    ['the same name, written out', LUKASZ, 'Łukasz Żółć'],
    ['an accented handle, plain', JOSE, 'jose_m'],
    ['an accented display name, plain', JOSE, 'jose maria'],
    ['an accented display name, as written', JOSE, 'José María'],
    ['a display name set in a fancy alphabet, plain', FANCY, 'cleo patra'],
    ['the account a comment sits under', UNDER, '@carol_the_host'],
    ['the commenter on the same row', UNDER, 'replier'],
  ] as const)('%s: %j finds the record', (_label, record, query) => {
    expect(finds(record, query)).toBe(true);
  });

  it.each([
    ['another handle', ALICE, '@alice_x'],
    ['a name that is not there', ALICE, 'wonderlander'],
    ['a handle that is only part of another word the other way round', ALICE, 'walice'],
    ['the @ alone, with nothing after it, does not match every account', LUKASZ, '@zzz'],
  ] as const)('%s: %j does not find it', (_label, record, query) => {
    expect(finds(record, query)).toBe(false);
  });

  it('a mention in a text is found with or without its @, and a bare @ narrows nothing it should not', () => {
    const mention = rec({ id: 'm', originalText: 'thanks @dana_k for the tip', author: 'someone' });
    expect(finds(mention, '@dana_k')).toBe(true);
    expect(finds(mention, 'dana_k')).toBe(true);
    expect(finds(mention, '@erin')).toBe(false);
  });

  it('an account is found anywhere in a long record, not only among the rows a screen shows', () => {
    const many = Array.from({ length: 3000 }, (_, i) => rec({
      id: `r${i}`, author: `user_${i}`, authorName: `Person ${i}`, originalText: `post number ${i}`, chainPosition: i + 1,
    }));
    const index = buildSearchIndex(many);
    const found = (query: string): string[] =>
      many.filter((r) => recordPasses(r, { ...NONE, search: query }, what, index)).map((r) => r.id);
    expect(found('@user_2999')).toEqual(['r2999']);
    expect(found('Person 2')).toContain('r2');
    expect(found('user_1500')).toEqual(['r1500']);
    expect(found('@user_1')).toHaveLength(1111);
  });
});
