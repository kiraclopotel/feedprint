import { describe, it, expect } from 'vitest';
import {
  buildGrowthByRecordId, growthIdentity,
} from '../../../../../src/ui/dashboard/components/metric-growth';
import type { ForensicRecord, RecordMetrics } from '../../../../../src/types/forensic';

function rec(over: Partial<ForensicRecord>, metrics?: RecordMetrics): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-06-14T00:00:00.000Z', platform: 'tiktok',
    originalText: '', originalHash: 'h', originalLength: 0, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih',
    kind: 'post',
    ...over,
    ...(metrics ? { metrics } : {}),
  } as ForensicRecord;
}

describe('growthIdentity', () => {
  it('keys a post on parentVideoId, else a non-bare postUrl', () => {
    expect(growthIdentity(rec({ kind: 'post', parentVideoId: 'tk-vid-9', postUrl: 'x' })))
      .toBe('p:tk-vid-9');
    expect(growthIdentity(rec({ kind: 'post', postUrl: 'https://x.com/u/status/1' })))
      .toBe('p:https://x.com/u/status/1');
  });

  it('keys a comment ONLY on its anchorUrl (never the post url)', () => {
    expect(growthIdentity(rec({ kind: 'comment', anchorUrl: 'https://x.com/u/status/2', postUrl: 'https://x.com/u/status/1' })))
      .toBe('c:https://x.com/u/status/2');
    // No per-comment anchor (IG/TikTok) → not identifiable across sightings.
    expect(growthIdentity(rec({ kind: 'comment', anchorUrl: undefined, postUrl: 'https://x.com/u/status/1' })))
      .toBeNull();
  });

  it('treats a bare platform-root url as no-identity', () => {
    expect(growthIdentity(rec({ kind: 'post', postUrl: 'https://www.facebook.com/' }))).toBeNull();
    expect(growthIdentity(rec({ kind: 'post', postUrl: 'https://x.com/home' }))).toBeNull();
  });
});

describe('buildGrowthByRecordId', () => {
  it('pairs two sightings of the same post into a latest-vs-first delta', () => {
    const first = rec({ id: 'a', timestamp: '2026-06-10T10:00:00.000Z', postUrl: 'https://x.com/u/status/1' },
      { primary_likes: 100, views: 2000 });
    const last = rec({ id: 'b', timestamp: '2026-06-15T14:00:00.000Z', postUrl: 'https://x.com/u/status/1' },
      { primary_likes: 1500, views: 12000 });
    const g = buildGrowthByRecordId([last, first]); // unsorted input
    const growth = g.get('b');
    expect(growth).toBeDefined();
    expect(growth!.sinceTs).toBe('2026-06-10T10:00:00.000Z');
    expect(growth!.latestTs).toBe('2026-06-15T14:00:00.000Z');
    expect(growth!.sightings).toBe(2);
    expect(growth!.latest.primary_likes).toBe(1500);
    const byKey = Object.fromEntries(growth!.deltas.map(d => [d.key, d.delta]));
    expect(byKey.primary_likes).toBe(1400);
    expect(byKey.views).toBe(10000);
    // Every sighting maps to the same growth so whichever card renders, it hits.
    expect(g.get('a')).toBe(growth);
  });

  it('pairs comment sightings by anchorUrl, never mixing comment with its post', () => {
    const post = rec({ id: 'p', kind: 'post', timestamp: '2026-06-10T00:00:00.000Z', postUrl: 'https://x.com/u/status/1' },
      { primary_likes: 10 });
    const c1 = rec({ id: 'c1', kind: 'comment', timestamp: '2026-06-10T00:00:00.000Z', anchorUrl: 'https://x.com/u/status/2', postUrl: 'https://x.com/u/status/1' },
      { likes: 5 });
    const c2 = rec({ id: 'c2', kind: 'comment', timestamp: '2026-06-15T00:00:00.000Z', anchorUrl: 'https://x.com/u/status/2', postUrl: 'https://x.com/u/status/1' },
      { likes: 20 });
    const g = buildGrowthByRecordId([post, c1, c2]);
    // The lone post has only one sighting → no growth; the comment pair does.
    expect(g.get('p')).toBeUndefined();
    expect(g.get('c2')!.deltas).toEqual([{ key: 'likes', from: 5, to: 20, delta: 15 }]);
  });

  it('produces no entry for a single sighting, a net-zero change, or a no-identity item', () => {
    expect(buildGrowthByRecordId([rec({ id: 's', postUrl: 'https://x.com/u/status/1' }, { primary_likes: 9 })]).size).toBe(0);

    const a = rec({ id: 'a', timestamp: '2026-06-10T00:00:00.000Z', postUrl: 'https://x.com/u/status/1' }, { primary_likes: 9 });
    const b = rec({ id: 'b', timestamp: '2026-06-11T00:00:00.000Z', postUrl: 'https://x.com/u/status/1' }, { primary_likes: 9 });
    expect(buildGrowthByRecordId([a, b]).size).toBe(0); // unchanged → nothing to show

    const bare1 = rec({ id: 'x', timestamp: '2026-06-10T00:00:00.000Z', postUrl: 'https://www.facebook.com/' }, { primary_likes: 1 });
    const bare2 = rec({ id: 'y', timestamp: '2026-06-11T00:00:00.000Z', postUrl: 'https://www.facebook.com/' }, { primary_likes: 9 });
    expect(buildGrowthByRecordId([bare1, bare2]).size).toBe(0); // no stable identity → never paired
  });
});
