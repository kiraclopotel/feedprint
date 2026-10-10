// Pure-layer tests for the Patterns-tab feed-composition aggregation
// (src/ui/dashboard/components/feed-composition.ts): topic labels from
// environment records, format labels from video/image contentType, the two
// axes kept separate, and the label-coverage counts that keep the unlabeled
// share visible.

import { describe, it, expect } from 'vitest';
import { buildFeedComposition } from '../../../../../src/ui/dashboard/components/feed-composition';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function makeRecord(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-07-01T10:00:00.000Z',
    platform: 'tiktok',
    originalText: 'text',
    originalHash: 'h',
    originalLength: 4,
    neutralizedText: '',
    author: 'creator',
    postUrl: 'https://www.tiktok.com/@creator/video/123',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

function envRecord(id: string, topicLabels: string[], over: Partial<ForensicRecord> = {}): ForensicRecord {
  return makeRecord({
    id,
    kind: 'environment',
    environment: {
      label: 'healthy-discussion',
      summary: 's',
      dominantTechnique: null,
      topicLabels,
      negativePct: 0,
      positivePct: 100,
      neutralPct: 0,
      sampled: 5,
    },
    ...over,
  });
}

describe('buildFeedComposition', () => {
  it('tallies topic labels across environment records with drill-down members', () => {
    const c = buildFeedComposition([
      envRecord('a', ['gaming', 'comedy-memes'], { timestamp: '2026-07-01T10:00:00.000Z' }),
      envRecord('b', ['gaming'], { timestamp: '2026-07-02T10:00:00.000Z', platform: 'instagram' }),
    ]);
    expect(c.topics.map((t) => t.label)).toEqual(['gaming', 'comedy-memes']);
    const gaming = c.topics[0];
    expect(gaming.count).toBe(2);
    // Newest-first member order.
    expect(gaming.recordIds).toEqual(['b', 'a']);
    expect(gaming.platforms).toEqual(['instagram', 'tiktok']);
    expect(gaming.lastSeen).toBe('2026-07-02T10:00:00.000Z');
  });

  it('keeps format labels (video/image contentType) on a separate axis', () => {
    const c = buildFeedComposition([
      makeRecord({
        id: 'v1',
        kind: 'video',
        videoContext: {
          overlayText: '', scene: '', contentType: 'music-dance',
          techniques: [], severity: 0, model: 'm', frameCount: 4,
        } as ForensicRecord['videoContext'],
      }),
      makeRecord({
        id: 'i1',
        kind: 'image',
        imageContext: {
          overlayText: '', scene: '', contentType: 'meme-humor',
          techniques: [], severity: 0, model: 'm', imageCount: 1,
        } as ForensicRecord['imageContext'],
      }),
      envRecord('e1', ['music']),
    ]);
    expect(c.formats.map((f) => f.label).sort()).toEqual(['meme-humor', 'music-dance']);
    expect(c.topics.map((t) => t.label)).toEqual(['music']);
  });

  it('counts coverage honestly — unlabeled content records stay in the denominator, markers are excluded', () => {
    const c = buildFeedComposition([
      envRecord('e1', ['news']),
      makeRecord({ id: 'p1', kind: 'post' }),           // content, no label path yet
      makeRecord({ id: 'c1', kind: 'top-comment' }),    // content, no label path yet
      makeRecord({ id: 'legacy' }),                     // legacy kind-less content record
      makeRecord({ id: 'm1', kind: 'reset-marker' }),   // marker — not content
    ]);
    expect(c.eligible).toBe(4);
    expect(c.labeled).toBe(1);
  });

  it('an environment record with no labels counts as eligible but not labeled', () => {
    const c = buildFeedComposition([envRecord('e1', [])]);
    expect(c.eligible).toBe(1);
    expect(c.labeled).toBe(0);
    expect(c.topics).toEqual([]);
  });

  it('an `other`/unclassified format shows in the breakdown but does NOT count as labeled coverage', () => {
    const c = buildFeedComposition([
      makeRecord({
        id: 'v1', kind: 'video',
        videoContext: { overlayText: '', scene: '', contentType: 'other', techniques: [], severity: 0, model: 'm', frameCount: 4 } as ForensicRecord['videoContext'],
      }),
      makeRecord({
        id: 'v2', kind: 'video',
        videoContext: { overlayText: '', scene: '', contentType: 'gaming', techniques: [], severity: 0, model: 'm', frameCount: 4 } as ForensicRecord['videoContext'],
      }),
    ]);
    // both eligible; only the real 'gaming' label counts toward coverage.
    expect(c.eligible).toBe(2);
    expect(c.labeled).toBe(1);
    // but 'other' is still visible in the formats breakdown (evidence for widening).
    expect(c.formats.map((f) => f.label).sort()).toEqual(['gaming', 'other']);
  });

  // A relational verdict about a comment section ("the crowd ignores the
  // post's claim") is a product finding, not a topic. The room call emits both
  // in one response; counting the relational half as a failed topic
  // classification buries 240 of them in the residual bucket.
  it('gives room relational verdicts their own axis instead of the topic residual', () => {
    const c = buildFeedComposition([
      envRecord('a', ['other'], {
        environment: {
          label: 'healthy-discussion', summary: 'the comments ignore the claim',
          dominantTechnique: null, topicLabels: ['other'],
          claimVsReaction: 'ignores', commentManipulation: 'none', audienceDistress: false,
          negativePct: 0, positivePct: 100, neutralPct: 0, sampled: 5,
        } as ForensicRecord['environment'],
      }),
      envRecord('b', ['other'], {
        environment: {
          label: 'pile-on', summary: 'commenters pile on one person',
          dominantTechnique: null, topicLabels: ['other'],
          claimVsReaction: 'contradicts', commentManipulation: 'pile-on', audienceDistress: true,
          negativePct: 80, positivePct: 10, neutralPct: 10, sampled: 9,
        } as ForensicRecord['environment'],
      }),
      envRecord('c', ['news']),
    ]);
    // The relational readings are counted, named, and drillable on their own axis.
    const rooms = Object.fromEntries(c.rooms.map((r) => [r.label, r.count]));
    expect(rooms['claim:ignores']).toBe(1);
    expect(rooms['claim:contradicts']).toBe(1);
    expect(rooms['crowd:pile-on']).toBe(1);
    expect(rooms['distress']).toBe(1);
    expect(rooms['crowd:none']).toBeUndefined();
    expect(c.roomsRead).toBe(2);
    // And the two 'other' rows are declared as carrying a room reading rather
    // than being silently written off as unclassifiable.
    expect(c.otherWithRoomVerdict).toBe(2);
  });

  it("a topic of only 'other' does not count toward label coverage", () => {
    // The row already tells the reader 'other' counts as unlabeled; the
    // coverage arithmetic has to agree with the row, on both axes.
    const c = buildFeedComposition([
      envRecord('a', ['other']),
      envRecord('b', ['other', 'news']),
      envRecord('c', ['sports']),
    ]);
    expect(c.eligible).toBe(3);
    expect(c.labeled).toBe(2);
    expect(c.topics.map((t) => t.label)).toContain('other');
  });

  it('respects the since/until window', () => {
    const c = buildFeedComposition(
      [
        envRecord('old', ['sports'], { timestamp: '2026-06-01T10:00:00.000Z' }),
        envRecord('new', ['news'], { timestamp: '2026-07-01T10:00:00.000Z' }),
      ],
      { since: '2026-06-15T00:00:00.000Z' },
    );
    expect(c.topics.map((t) => t.label)).toEqual(['news']);
    expect(c.eligible).toBe(1);
  });

  it('sorts by count desc then label asc, and a record counts once per label', () => {
    const c = buildFeedComposition([
      envRecord('a', ['news', 'politics']),
      envRecord('b', ['politics']),
      envRecord('c', ['animals']),
    ]);
    expect(c.topics.map((t) => `${t.label}:${t.count}`)).toEqual([
      'politics:2', 'animals:1', 'news:1',
    ]);
  });
});
