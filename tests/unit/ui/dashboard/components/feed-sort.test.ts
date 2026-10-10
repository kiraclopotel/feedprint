// Activity feed display-sort contract — the "Worst first" / "As seen" toggle.
//
// Owner repro 2026-08-01: with the sort toggled the first card looked static
// and the same post appeared twice at the top under Worst first. These tests
// pin the actual contract: worst-first MUST move a lower-positioned
// max-severity entry to index 0 (index 0 is never exempt from the sort), and
// equal-severity entries keep their as-seen order (stable tie-break) — which
// also means two genuine re-records of the same post with equal top scores
// legitimately sit adjacent at the head. Records are immutable: the sort never
// dedups; both re-records stay in the output.

import { describe, it, expect } from 'vitest';
import {
  recordScore, groupPeakScore, sortGroupsWorstFirst, sortRecordsWorstFirst,
} from '../../../../../src/ui/dashboard/components/feed-sort';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { RecordGroup } from '../../../../../src/ui/dashboard/components/PostGroupCard';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-08-01T00:00:00.000Z', platform: 'tiktok',
    originalText: '', originalHash: 'h', originalLength: 0, neutralizedText: '',
    author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

function grp(key: string, post: ForensicRecord | null, children: ForensicRecord[] = []): RecordGroup {
  return {
    key, postRecord: post, roomAuthor: '', roomCaption: '', roomUrl: '',
    platform: 'tiktok', latestTs: '2026-08-01T00:00:00.000Z', children,
    flaggedCount: 0, blockedCount: 0,
    firstSeenAt: '2026-08-01T00:00:00.000Z', lastSeenAt: '2026-08-01T00:00:00.000Z', sessionKey: 'tiktok',
  };
}

describe('sortRecordsWorstFirst (flat filtered view)', () => {
  it('places the max-severity record first and reorders index 0', () => {
    const list = [
      rec({ id: 'newest', overallScore: 5 }),   // as-seen head — NOT the worst
      rec({ id: 'mid', overallScore: 7 }),
      rec({ id: 'worst', overallScore: 10 }),
      rec({ id: 'old', overallScore: 2 }),
    ];
    const out = sortRecordsWorstFirst(list);
    expect(out.map(r => r.id)).toEqual(['worst', 'mid', 'newest', 'old']);
    // index 0 must have moved — the head is never pinned.
    expect(out[0].id).not.toBe(list[0].id);
    // input untouched (sorts a copy, renders the copy).
    expect(list[0].id).toBe('newest');
  });

  it('equal scores keep as-seen order (stable tie-break) — two re-records of the same post sit adjacent, undeduped', () => {
    const list = [
      rec({ id: 'fr-13459', overallScore: 10, originalText: 'same post' }),
      rec({ id: 'other', overallScore: 6 }),
      rec({ id: 'fr-13406', overallScore: 10, originalText: 'same post' }),
    ];
    const out = sortRecordsWorstFirst(list);
    expect(out.map(r => r.id)).toEqual(['fr-13459', 'fr-13406', 'other']);
    expect(out).toHaveLength(3); // records immutable — never dedup
  });

  it('a record with a missing/NaN overallScore reads as 0 (comparator stays consistent)', () => {
    const list = [
      rec({ id: 'broken', overallScore: undefined as unknown as number }),
      rec({ id: 'nan', overallScore: NaN }),
      rec({ id: 'real', overallScore: 3 }),
    ];
    const out = sortRecordsWorstFirst(list);
    expect(out[0].id).toBe('real');
    expect(recordScore(list[0])).toBe(0);
    expect(recordScore(list[1])).toBe(0);
  });
});

describe('sortGroupsWorstFirst (grouped default view)', () => {
  it('ranks a group by its PEAK member severity — a thread is as bad as its worst item', () => {
    const calmPostBadComment = grp('g1',
      rec({ id: 'p1', overallScore: 1 }),
      [rec({ id: 'c1', overallScore: 9 })]);
    const midPost = grp('g2', rec({ id: 'p2', overallScore: 6 }));
    expect(groupPeakScore(calmPostBadComment)).toBe(9);
    const out = sortGroupsWorstFirst([midPost, calmPostBadComment]);
    expect(out.map(g => g.key)).toEqual(['g1', 'g2']);
  });

  it('reorders index 0 when a later group holds the max severity', () => {
    const groups = [
      grp('newest', rec({ id: 'a', overallScore: 4 })),
      grp('worst', rec({ id: 'b', overallScore: 10 })),
      grp('mild', rec({ id: 'c', overallScore: 2 })),
    ];
    const out = sortGroupsWorstFirst(groups);
    expect(out.map(g => g.key)).toEqual(['worst', 'newest', 'mild']);
    expect(groups[0].key).toBe('newest'); // input untouched
  });

  it('postRecord-less (orphan) groups rank by their children', () => {
    const orphan = grp('orphan', null, [rec({ id: 'c', overallScore: 8 })]);
    const post = grp('post', rec({ id: 'p', overallScore: 5 }));
    expect(sortGroupsWorstFirst([post, orphan])[0].key).toBe('orphan');
  });

  it('equal-peak groups keep as-seen order (the static-looking head is the tie-break, not a pin)', () => {
    const groups = [
      grp('seen-first', rec({ id: 'a', overallScore: 10 })),
      grp('seen-second', rec({ id: 'b', overallScore: 10 })),
      grp('lower', rec({ id: 'c', overallScore: 3 })),
    ];
    expect(sortGroupsWorstFirst(groups).map(g => g.key))
      .toEqual(['seen-first', 'seen-second', 'lower']);
  });
});

// Owner repro 2026-08-23, on a real 5,376-record chain: "Worst first" showed a
// wall of advertisements. All 65 blocked records carry overallScore 10 —
// logger.ts stamps that on every rule-based block, where 10 means "the rule
// matched exactly" and NOT "this was harmful" — so every ad tied with, and
// under a stable sort preceded, every genuine finding. Twenty-five ads sat
// above the first real safety finding at position 26.
//
// Same defect class the HTML export carried and had fixed earlier the same
// day (html-export-blocked-not-flagged.test.ts). A rule-based block is not a
// severity, so it must not rank as one.
describe('blocked records do not rank as harm', () => {
  const ad = () => rec({
    id: 'ad', verdict: 'blocked', overallScore: 10,
    detectionMode: 'block:ads:platform-ad-marker',
    techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }],
  });

  it('scores a blocked ad below a real finding, not equal to the maximum', () => {
    expect(recordScore(ad())).toBeLessThan(
      recordScore(rec({ verdict: 'flagged', overallScore: 8 })),
    );
  });

  it('keeps ads out of the head of worst-first', () => {
    const out = sortRecordsWorstFirst([
      ad(), ad(), ad(),
      rec({ id: 'real', verdict: 'flagged-hidden', overallScore: 9 }),
      rec({ id: 'mild', verdict: 'flagged', overallScore: 6 }),
    ]);
    expect(out.map(r => r.id).slice(0, 2)).toEqual(['real', 'mild']);
  });

  it('does not let one ad make a whole thread look like the worst', () => {
    const adThread = grp('ads', ad(), []);
    const realThread = grp('real', rec({ id: 'p', verdict: 'flagged', overallScore: 7 }), []);
    expect(sortGroupsWorstFirst([adThread, realThread])[0].key).toBe('real');
  });
});
