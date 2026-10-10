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
