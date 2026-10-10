// Tests for the deterministic "emotional diet" lexical league table
// (src/ui/dashboard/components/lexical-diet.ts). Verifies the table is a
// faithful, free aggregation of the profanity matcher over the captured text
// already on the chain — canonical-stem folding, per-surface counting, tier
// labelling, time windowing — without any AI call.

import { describe, it, expect } from 'vitest';
import { buildSwearLeagueTable } from '../../../../../src/ui/dashboard/components/lexical-diet';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function makeRecord(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-06-13T21:00:00.000Z',
    platform: 'tiktok',
    originalText: '',
    originalHash: 'h',
    originalLength: 0,
    neutralizedText: '',
    author: 'creator99',
    postUrl: 'https://www.tiktok.com/@creator99/video/123',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

describe('buildSwearLeagueTable', () => {
  it('returns an empty table for no records', () => {
    expect(buildSwearLeagueTable([])).toEqual([]);
  });

  it('ignores clean records entirely', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'a', originalText: 'what a lovely sunset, thank you' }),
    ]);
    expect(table).toEqual([]);
  });

  it('ranks terms by total occurrences, descending, ties broken alphabetically', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'a', originalText: 'shit shit shit' }),
      makeRecord({ id: 'b', originalText: 'fuck bitch' }),
    ]);
    expect(table.map((e) => e.term)).toEqual(['shit', 'bitch', 'fuck']);
    expect(table[0]).toMatchObject({ term: 'shit', count: 3 });
    expect(table[0].recordIds).toEqual(['a']);
  });

  it('folds inflections to the canonical dictionary stem', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'a', originalText: 'fucking fucked this up' }),
    ]);
    // Both inflections collapse onto the stem `fuck`.
    expect(table).toHaveLength(1);
    expect(table[0]).toMatchObject({ term: 'fuck', count: 2 });
    expect(table[0].recordIds).toEqual(['a']);
  });

  it('separates total occurrences from distinct record members', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'a', originalText: 'shit shit' }),
      makeRecord({ id: 'b', originalText: 'shit' }),
    ]);
    expect(table[0]).toMatchObject({ term: 'shit', count: 3 });
    expect(table[0].recordIds.sort()).toEqual(['a', 'b']);
  });

  it('orders member recordIds newest-first for drill-down', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'old', originalText: 'shit', timestamp: '2026-06-01T00:00:00.000Z' }),
      makeRecord({ id: 'new', originalText: 'shit', timestamp: '2026-06-20T00:00:00.000Z' }),
      makeRecord({ id: 'mid', originalText: 'shit', timestamp: '2026-06-10T00:00:00.000Z' }),
    ]);
    expect(table[0].recordIds).toEqual(['new', 'mid', 'old']);
  });

  it('aggregates across typed, overlay, and transcript surfaces but not scene', () => {
    const table = buildSwearLeagueTable([
      makeRecord({
        id: 'vid',
        kind: 'video',
        originalText: 'shit',
        videoContext: {
          overlayText: 'fuck',
          scene: 'a person says a swear word like bitch on camera',
          transcript: 'fuck you',
          contentType: 'talking-head',
          techniques: [],
          severity: 0,
          model: 'gemini',
          frameCount: 3,
        },
      } as Partial<ForensicRecord>),
    ]);
    const byTerm = Object.fromEntries(table.map((e) => [e.term, e.count]));
    // shit (typed) ×1, fuck (overlay + transcript) ×2. The `scene` mention of
    // "bitch" must NOT count — it is the model's prose, not the child's exposure.
    expect(byTerm).toEqual({ fuck: 2, shit: 1 });
  });

  it('labels each term as slur or profanity', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'a', originalText: 'you retard, this is shit' }),
    ]);
    const tierOf = Object.fromEntries(table.map((e) => [e.term, e.tier]));
    expect(tierOf.retard).toBe('slur');
    expect(tierOf.shit).toBe('profanity');
  });

  it('tracks lastSeen as the most recent record carrying the term', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'a', originalText: 'shit', timestamp: '2026-06-01T00:00:00.000Z' }),
      makeRecord({ id: 'b', originalText: 'shit', timestamp: '2026-06-20T00:00:00.000Z' }),
      makeRecord({ id: 'c', originalText: 'shit', timestamp: '2026-06-10T00:00:00.000Z' }),
    ]);
    expect(table[0].lastSeen).toBe('2026-06-20T00:00:00.000Z');
  });

  it('collects distinct platforms, sorted', () => {
    const table = buildSwearLeagueTable([
      makeRecord({ id: 'a', originalText: 'shit', platform: 'youtube' }),
      makeRecord({ id: 'b', originalText: 'shit', platform: 'tiktok' }),
      makeRecord({ id: 'c', originalText: 'shit', platform: 'tiktok' }),
    ]);
    expect(table[0].platforms).toEqual(['tiktok', 'youtube']);
  });

  it('honors the since/until window bounds', () => {
    const records = [
      makeRecord({ id: 'old', originalText: 'shit', timestamp: '2026-05-01T00:00:00.000Z' }),
      makeRecord({ id: 'mid', originalText: 'fuck', timestamp: '2026-06-15T00:00:00.000Z' }),
      makeRecord({ id: 'new', originalText: 'bitch', timestamp: '2026-07-01T00:00:00.000Z' }),
    ];
    const table = buildSwearLeagueTable(records, {
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-06-30T00:00:00.000Z',
    });
    expect(table.map((e) => e.term)).toEqual(['fuck']);
  });
});
