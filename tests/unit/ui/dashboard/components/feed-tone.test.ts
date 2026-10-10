// Pure-layer tests for the Patterns-tab feed-tone aggregation
// (src/ui/dashboard/components/feed-tone.ts): comment-weighted sentiment
// across environment rooms, per-platform split, largest-remainder rounding to
// exactly 100, and the coverage denominator.

import { describe, it, expect } from 'vitest';
import { buildFeedTone } from '../../../../../src/ui/dashboard/components/feed-tone';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function envRecord(
  id: string,
  pos: number, neu: number, neg: number, sampled: number,
  over: Partial<ForensicRecord> = {},
): ForensicRecord {
  return {
    id,
    timestamp: '2026-07-03T10:00:00.000Z',
    platform: 'tiktok',
    originalText: '',
    originalHash: 'h',
    originalLength: 0,
    neutralizedText: '',
    author: 'creator',
    postUrl: 'https://x/y',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    kind: 'environment',
    environment: {
      label: 'healthy-discussion',
      summary: 's',
      dominantTechnique: null,
      positivePct: pos,
      neutralPct: neu,
      negativePct: neg,
      sampled,
    },
    ...over,
  } as ForensicRecord;
}

describe('buildFeedTone', () => {
  it('is empty when no environment records carry sentiment', () => {
    const tone = buildFeedTone([
      { id: 'p', timestamp: '2026-07-03T10:00:00.000Z', platform: 'tiktok', kind: 'post' } as ForensicRecord,
    ]);
    expect(tone.hasData).toBe(false);
    expect(tone.rooms).toBe(0);
  });

  it('comment-weights rooms by sampled — a big room outweighs a small one', () => {
    // Room A: 100% positive over 90 comments. Room B: 100% negative over 10.
    // Comment-weighted → 90% positive, 10% negative.
    const tone = buildFeedTone([
      envRecord('a', 100, 0, 0, 90),
      envRecord('b', 0, 0, 100, 10),
    ]);
    expect(tone.positivePct).toBe(90);
    expect(tone.negativePct).toBe(10);
    expect(tone.neutralPct).toBe(0);
    expect(tone.rooms).toBe(2);
    expect(tone.commentsScored).toBe(100);
  });

  it('always renders shares that sum to exactly 100 (largest-remainder rounding)', () => {
    // Three equal-weight rooms of 33.33% each → must resolve to 34/33/33.
    const tone = buildFeedTone([
      envRecord('a', 100, 0, 0, 1),
      envRecord('b', 0, 100, 0, 1),
      envRecord('c', 0, 0, 100, 1),
    ]);
    expect(tone.positivePct + tone.neutralPct + tone.negativePct).toBe(100);
  });

  it('treats a missing/zero sampled count as one-room weight, not zero', () => {
    // No sampled → weight 1 each; averages to 50/0/50, commentsScored 0.
    const tone = buildFeedTone([
      envRecord('a', 100, 0, 0, 0),
      envRecord('b', 0, 0, 100, 0),
    ]);
    expect(tone.positivePct).toBe(50);
    expect(tone.negativePct).toBe(50);
    expect(tone.rooms).toBe(2);
    expect(tone.commentsScored).toBe(0);
  });

  it('skips records whose sentiment fields are not all finite', () => {
    const bad = envRecord('a', 100, 0, 0, 5);
    // Corrupt one field.
    (bad.environment as { positivePct: unknown }).positivePct = undefined;
    const tone = buildFeedTone([bad]);
    expect(tone.hasData).toBe(false);
  });

  it('splits per platform, most-rooms first', () => {
    const tone = buildFeedTone([
      envRecord('a', 80, 20, 0, 10, { platform: 'tiktok' }),
      envRecord('b', 0, 0, 100, 10, { platform: 'twitter' }),
      envRecord('c', 50, 50, 0, 10, { platform: 'twitter' }),
    ]);
    expect(tone.platforms[0].platform).toBe('twitter'); // 2 rooms
    expect(tone.platforms[0].rooms).toBe(2);
    expect(tone.platforms[1].platform).toBe('tiktok');
  });

  it('respects the since/until window', () => {
    const tone = buildFeedTone(
      [
        envRecord('old', 0, 0, 100, 10, { timestamp: '2026-06-01T10:00:00.000Z' }),
        envRecord('new', 100, 0, 0, 10, { timestamp: '2026-07-03T10:00:00.000Z' }),
      ],
      { since: '2026-06-15T00:00:00.000Z' },
    );
    expect(tone.positivePct).toBe(100);
    expect(tone.rooms).toBe(1);
  });
});
