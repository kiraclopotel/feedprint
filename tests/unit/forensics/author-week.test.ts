// The reading's line from the record (forensics/author-week.ts): content
// records by one account on one platform in the last seven days, and how
// many of those the product flagged. Markers, environment summaries and
// cancellations are not sightings; another platform's same handle is another
// account; a record older than a week is not this week.

import { describe, expect, it } from 'vitest';
import { countAuthorWeek, isReadingRecord, sameHandle, AUTHOR_WEEK_MS } from '../../../src/forensics/author-week';
import type { ForensicRecord } from '../../../src/types/forensic';

const NOW = Date.parse('2026-09-05T12:00:00.000Z');

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'fr-1',
    timestamp: new Date(NOW - 60_000).toISOString(),
    platform: 'twitter',
    originalText: 'x',
    originalHash: 'h',
    originalLength: 1,
    neutralizedText: '',
    author: 'alice',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'unknown',
    integrityHash: 'i',
    verdict: 'pass',
    ...over,
  } as ForensicRecord;
}

describe('countAuthorWeek', () => {
  it('counts this account on this platform, this week, and the flagged share of it', () => {
    const records = [
      rec({ verdict: 'flagged' }),
      rec({ verdict: 'flagged-hidden' }),
      rec({ verdict: 'pass' }),
      rec({ verdict: 'skipped' }),
      // A record from before the verdict field existed is a flag, as every other reader treats it.
      rec({ verdict: undefined }),
      rec({ author: 'bob', verdict: 'flagged' }),
      rec({ platform: 'instagram', verdict: 'flagged' }),
      rec({ timestamp: new Date(NOW - AUTHOR_WEEK_MS - 1000).toISOString(), verdict: 'flagged' }),
      rec({ kind: 'environment', verdict: 'flagged' }),
      rec({ verdict: 'cancelled-stale' }),
    ];
    expect(countAuthorWeek(records, 'alice', 'twitter', NOW)).toEqual({ seen: 5, charged: 3 });
  });

  it('the reader\'s own earlier readings are neither sightings nor flags', () => {
    const records = [
      rec({ verdict: 'flagged' }),
      rec({ verdict: 'pass', detectionMode: 'pass:read-this:charged:recruit:react' }),
      rec({ verdict: 'pass', detectionMode: 'pass:read-this:not-charged' }),
    ];
    expect(countAuthorWeek(records, 'alice', 'twitter', NOW)).toEqual({ seen: 1, charged: 1 });
    expect(isReadingRecord({ detectionMode: 'pass:read-this:not-charged' })).toBe(true);
    expect(isReadingRecord({ detectionMode: 'pass:pre-llm-free-tier-no-ai' })).toBe(false);
    expect(isReadingRecord({ detectionMode: undefined })).toBe(false);
  });

  it('matches the handle the picker reads against the handle the adapters stamp', () => {
    // TikTok stamps @handle; the picker strips the @. YouTube stamps the visible channel text.
    const records = [rec({ platform: 'tiktok', author: '@Alice', verdict: 'flagged' })];
    expect(countAuthorWeek(records, 'alice', 'tiktok', NOW)).toEqual({ seen: 1, charged: 1 });
    expect(sameHandle('@Alice', 'alice')).toBe(true);
    expect(sameHandle('', '')).toBe(false);
    expect(sameHandle(undefined, 'alice')).toBe(false);
  });

  it('an unknown account is zero, not an error', () => {
    expect(countAuthorWeek([rec({})], 'nobody', 'twitter', NOW)).toEqual({ seen: 0, charged: 0 });
  });
});
