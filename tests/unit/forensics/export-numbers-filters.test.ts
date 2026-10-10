// The numbers engine's filters over non-impression records and the meaning
// of "seen before" (audit 2026-09-13 L1, chain findings 18 and 24).
//
// Three things are locked here.
// 1. An image analysis record follows its parent impression through every
//    filter; with no parent in the file it is dropped whenever a filter
//    narrows. A system marker is kept only when no filter but platform is set.
// 2. surfaceBucket keeps 'unknown' (not captured) apart from 'other', and
//    'following' has its own bucket.
// 3. The seen-before column and the seen-before filter share one meaning of
//    earlier: earlier in the whole array, never recomputed over a filtered set.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import {
  applyFilters,
  computePlatformRows,
  seenBeforeIds,
  surfaceBucket,
} from '../../../src/forensics/export-numbers';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import * as engine from '../../../src/forensics/export-numbers';

let n = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  n++;
  return {
    id: `fr-${n}`,
    timestamp: `2026-09-10T10:${String(n % 60).padStart(2, '0')}:00.000Z`,
    platform: 'twitter',
    originalText: `text ${n}`,
    originalHash: `hash-${n}`,
    originalLength: 6,
    neutralizedText: '',
    author: '@person',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: `ih-${n}`,
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: n,
    verdict: 'pass',
    kind: 'post',
    ...over,
  } as ForensicRecord;
}

/** An X home post on For You, its image record, a profile post with its image, an orphan image, a marker. */
function fixture(): ForensicRecord[] {
  n = 0;
  return [
    rec({ feedSource: 'for-you', parentVideoId: '1001', postUrl: 'https://x.com/a/status/1001' }),
    rec({ kind: 'image', parentVideoId: '1001', feedSource: 'unknown', originalHash: undefined }),
    rec({ feedSource: 'profile', parentVideoId: '1002', postUrl: 'https://x.com/b/status/1002' }),
    rec({ kind: 'image', parentVideoId: '1002', feedSource: 'unknown', originalHash: undefined }),
    rec({ kind: 'image', parentVideoId: '9999', feedSource: 'unknown', originalHash: undefined }),
    rec({ kind: 'gap-marker', verdict: undefined }),
    rec({ kind: 'environment', parentVideoId: '1001' }),
  ];
}

const loadInline = () => new Function(`${EXPORT_NUMBERS_INLINE_SOURCE}; return FWN;`)() as typeof engine;

describe('applyFilters over non-impression records (L1)', () => {
  it('an X image record with For You selected does not appear unless its post does', () => {
    const rs = fixture();
    const out = applyFilters(rs, { platforms: ['twitter'], surfaces: ['for-you'] });
    const ids = out.map(r => r.id);
    expect(ids).toContain('fr-1');
    expect(ids).toContain('fr-2'); // image of the For You post follows it
    expect(ids).not.toContain('fr-3');
    expect(ids).not.toContain('fr-4'); // image of the profile post follows it out
    expect(ids).not.toContain('fr-5'); // orphan image: dropped when a filter narrows
    expect(ids).not.toContain('fr-6'); // marker: dropped when a filter narrows
    expect(ids).not.toContain('fr-7'); // environment: dropped when a filter narrows
  });

  it('with only the platform filter set, markers and images of that platform stay', () => {
    const rs = fixture();
    expect(applyFilters(rs, { platforms: ['twitter'] })).toHaveLength(rs.length);
    expect(applyFilters(rs, {})).toHaveLength(rs.length);
  });

  it('an image follows its parent through the sitting and seen-before filters', () => {
    n = 0;
    const rs = [
      rec({ originalHash: 'dup', parentVideoId: '1', timestamp: '2026-09-10T10:00:00Z' }),
      rec({ kind: 'image', parentVideoId: '1', originalHash: undefined, timestamp: '2026-09-10T10:00:01Z' }),
      rec({ originalHash: 'dup', parentVideoId: '2', timestamp: '2026-09-10T12:00:00Z' }),
      rec({ kind: 'image', parentVideoId: '2', originalHash: undefined, timestamp: '2026-09-10T12:00:01Z' }),
    ];
    expect(applyFilters(rs, { sittings: [2] }).map(r => r.id)).toEqual(['fr-3', 'fr-4']);
    expect(applyFilters(rs, { seenBefore: true }).map(r => r.id)).toEqual(['fr-3', 'fr-4']);
    expect(applyFilters(rs, { seenBefore: false }).map(r => r.id)).toEqual(['fr-1', 'fr-2']);
  });

  it('a parent is matched on the same platform only', () => {
    n = 0;
    const rs = [
      rec({ platform: 'facebook', parentVideoId: '1', feedSource: 'for-you' }),
      rec({ platform: 'twitter', kind: 'image', parentVideoId: '1', originalHash: undefined }),
    ];
    expect(applyFilters(rs, { surfaces: ['for-you'] }).map(r => r.id)).toEqual(['fr-1']);
  });

  it('the inline copy agrees', () => {
    const inline = loadInline();
    const rs = fixture();
    const filters: engine.FilterState[] = [{ surfaces: ['for-you'] }, { platforms: ['twitter'] }, { sittings: [1] }, { seenBefore: false }];
    for (const f of filters) {
      expect(inline.applyFilters(rs, f)).toEqual(applyFilters(rs, f));
    }
  });
});

describe('surfaceBucket keeps unknown and following apart (chain 18)', () => {
  it('maps the named sources, unknown to unknown, following to following, the rest to other', () => {
    expect(surfaceBucket(rec({ feedSource: 'for-you' }))).toBe('for-you');
    expect(surfaceBucket(rec({ feedSource: 'following' }))).toBe('following');
    expect(surfaceBucket(rec({ feedSource: 'unknown' }))).toBe('unknown');
    expect(surfaceBucket(rec({ feedSource: undefined }))).toBe('unknown');
    expect(surfaceBucket(rec({ feedSource: 'video' }))).toBe('other');
    expect(surfaceBucket(rec({ feedSource: 'manual' }))).toBe('other');
    expect(loadInline().surfaceBucket(rec({ feedSource: 'unknown' }))).toBe('unknown');
  });

  it('the following and unknown filters select only their own records', () => {
    n = 0;
    const rs = [rec({ feedSource: 'following' }), rec({ feedSource: 'unknown' }), rec({ feedSource: 'video' })];
    expect(applyFilters(rs, { surfaces: ['following'] }).map(r => r.id)).toEqual(['fr-1']);
    expect(applyFilters(rs, { surfaces: ['unknown'] }).map(r => r.id)).toEqual(['fr-2']);
    expect(applyFilters(rs, { surfaces: ['other'] }).map(r => r.id)).toEqual(['fr-3']);
  });
});

describe('seen before means earlier in the whole array (chain 24)', () => {
  it('with a surface filter set, a record first seen on another surface still counts as seen before', () => {
    n = 0;
    const rs = [
      rec({ originalHash: 'dup', feedSource: 'profile' }),
      rec({ originalHash: 'dup', feedSource: 'for-you' }),
      rec({ originalHash: 'solo', feedSource: 'for-you' }),
    ];
    const rows = computePlatformRows(rs, { surfaces: ['for-you'] });
    expect(rows[0].impressions).toBe(2);
    expect(rows[0].extraCopies).toBe(1);
    expect(rows[0].uniquePosts).toBe(1);
    expect(rows[5].extraCopies).toBe(1);
    // and the column agrees with the filter's own set
    const filtered = applyFilters(rs, { surfaces: ['for-you'], seenBefore: true });
    expect(filtered.map(r => r.id)).toEqual(['fr-2']);
    expect(Object.keys(seenBeforeIds(rs))).toEqual(['fr-2']);
    expect(loadInline().computePlatformRows(rs, { surfaces: ['for-you'] })).toEqual(rows);
  });
});
