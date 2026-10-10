// Account-type filter predicate + "how groups behave" aggregation (slice 2).

import { describe, it, expect } from 'vitest';
import { matchesAccountFilter, ACCOUNT_FILTER_CHIPS } from '../../../../../src/ui/dashboard/components/feed-filters';
import { computeGroupBehavior } from '../../../../../src/ui/dashboard/components/group-behavior';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function rec(p: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-06-24T00:00:00.000Z', platform: 'facebook',
    originalText: 't', originalHash: 'h', originalLength: 1, neutralizedText: '',
    author: '@a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'unknown',
    integrityHash: 'ih', chainPosition: 0,
    ...p,
  } as ForensicRecord;
}

describe('matchesAccountFilter', () => {
  it('all matches every record', () => {
    expect(matchesAccountFilter(rec({ accountType: 'group' }), 'all')).toBe(true);
    expect(matchesAccountFilter(rec({ accountType: undefined }), 'all')).toBe(true);
  });

  it('group/page/advertiser match their own accountType', () => {
    expect(matchesAccountFilter(rec({ accountType: 'group' }), 'group')).toBe(true);
    expect(matchesAccountFilter(rec({ accountType: 'page' }), 'page')).toBe(true);
    expect(matchesAccountFilter(rec({ accountType: 'advertiser' }), 'advertiser')).toBe(true);
    expect(matchesAccountFilter(rec({ accountType: 'group' }), 'page')).toBe(false);
  });

  it('person matches an explicit person AND a record with no label (default-person)', () => {
    expect(matchesAccountFilter(rec({ accountType: 'person' }), 'person')).toBe(true);
    expect(matchesAccountFilter(rec({ accountType: undefined }), 'person')).toBe(true);
    expect(matchesAccountFilter(rec({ accountType: 'group' }), 'person')).toBe(false);
  });

  it('chip order is all → people → groups → pages → ads', () => {
    expect(ACCOUNT_FILTER_CHIPS).toEqual(['all', 'person', 'group', 'page', 'advertiser']);
  });
});

describe('computeGroupBehavior', () => {
  it('groups by sourceContainer, counts posts + flagged, averages severity, picks dominant technique', () => {
    const records = [
      rec({ accountType: 'group', sourceContainer: 'Gaming Sample', verdict: 'flagged',
            techniques: [{ name: 'identity-slur', severity: 8, confidence: 0.9 }] }),
      rec({ accountType: 'group', sourceContainer: 'Gaming Sample', verdict: 'flagged-hidden',
            techniques: [{ name: 'identity-slur', severity: 6, confidence: 0.9 }] }),
      rec({ accountType: 'group', sourceContainer: 'Gaming Sample', verdict: 'pass', techniques: [] }),
      rec({ accountType: 'group', sourceContainer: 'Example Hobby Group', verdict: 'pass', techniques: [] }),
    ];
    const out = computeGroupBehavior(records);
    expect(out).toHaveLength(2);
    // Sorted by flagged count desc → Gaming Sample first.
    const gaming = out[0];
    expect(gaming.name).toBe('Gaming Sample');
    expect(gaming.postsSeen).toBe(3);
    expect(gaming.flaggedCount).toBe(2);
    // avg of the peak severities across flagged records: (8 + 6) / 2 = 7.
    expect(gaming.avgSeverity).toBe(7);
    expect(gaming.dominantTechnique).toBe('identity-slur');
    const claude = out[1];
    expect(claude.flaggedCount).toBe(0);
    expect(claude.avgSeverity).toBeNull();
    expect(claude.dominantTechnique).toBeNull();
  });

  it('ignores records without a group container', () => {
    expect(computeGroupBehavior([rec({ accountType: 'person' })])).toEqual([]);
  });
});
