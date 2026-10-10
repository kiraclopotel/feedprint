// What the file tells a reader about the person who made it.
//
// An export carries no name, no address and no account of its owner, and can
// identify them anyway from what was served TO them: Facebook groups named for
// one small town, a parenting group, a second-hand market for one hobby, and
// advertisers who sell in one country. Page one said what the file does not
// prove and nothing about what it reveals.

import { describe, it, expect } from 'vitest';
import { computeDisclosure } from '../../../src/forensics/discloses';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r', timestamp: '2026-09-07T01:00:00.000Z', platform: 'facebook', originalText: 't',
    originalHash: 'h', originalLength: 1, neutralizedText: '', author: 'a', postUrl: 'https://x/1',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud',
    feedSource: 'for-you', detectionMode: 'x', prevRecordHash: 'p', chainPosition: 1,
    verdict: 'pass', kind: 'post', publicKeyFingerprint: 'f', integrityHash: 'i', signature: 's',
    ...over,
  } as ForensicRecord;
}

describe('computeDisclosure', () => {
  it('counts the personal detail the file carries', () => {
    const d = computeDisclosure([
      rec({ author: 'Neighbour A', sourceContainer: 'Noul SATU EXEMPLU Oficial', surfaceOrigin: 'https://www.facebook.com' }),
      rec({ author: 'Neighbour A', sourceContainer: 'Noul SATU EXEMPLU Oficial', surfaceOrigin: 'https://www.facebook.com' }),
      rec({ author: 'Parent B', sourceContainer: 'Părinți de exemplu, laolaltă!', feedSource: 'following' }),
      rec({ author: 'Magazin Exemplu Romania', accountType: 'advertiser' }),
      rec({ author: 'Brici Exemplu Romania', accountType: 'advertiser' }),
      rec({ author: 'Seller C', feedSource: 'profile', anchorUrl: 'https://x/c', mediaUrls: ['m1', 'm2'] }),
    ])!;
    expect(d.authors).toBe(5);
    expect(d.namedContainers).toBe(2);
    expect(d.advertisers).toBe(2);
    // What the reader went to on purpose, as against what a ranker sent.
    expect(d.chosenAccounts).toBe(2);
    expect(d.origins).toEqual(['https://www.facebook.com']);
    expect(d.mediaAddresses).toBe(2);
    // DISTINCT addresses. Five of the six records share one postUrl and one
    // carries a per-item anchor as well, so the file holds two addresses — not
    // the seven URL-bearing fields it would have counted before 2026-09-08.
    expect(d.links).toBe(2);
  });

  // The group name is the sharpest single item in the file — it can carry a
  // suburb, a school or a household — so the count comes with examples.
  it('names the busiest groups, most records first', () => {
    const d = computeDisclosure([
      rec({ sourceContainer: 'quiet group' }),
      ...Array.from({ length: 5 }, () => rec({ sourceContainer: 'busy group' })),
      ...Array.from({ length: 3 }, () => rec({ sourceContainer: 'middle group' })),
      rec({ sourceContainer: 'fourth group' }),
    ])!;
    expect(d.sampleContainers).toEqual(['busy group', 'middle group', 'fourth group']);
  });

  it('an author the platform did not name is not counted as one', () => {
    const d = computeDisclosure([rec({ author: 'unknown' }), rec({ author: '' }), rec({ author: 'Real' })])!;
    expect(d.authors).toBe(1);
  });

  it('measures the span and how much of the clock it covers', () => {
    const d = computeDisclosure([
      rec({ timestamp: '2026-09-06T14:00:00.000Z' }),
      rec({ timestamp: '2026-09-07T00:30:00.000Z' }),
      rec({ timestamp: '2026-09-08T00:42:00.000Z' }),
    ])!;
    expect(d.spanHours).toBe(34.7);
    expect(d.activeHoursUtc).toBe(2);
  });

  it('an empty file discloses nothing to count', () => {
    expect(computeDisclosure([])).toBeNull();
  });
});

// An advertiser is placed, not followed. Counting it in both sets put a paid
// placement inside the one sentence in the block that is about the reader's own
// accounts rather than about what was served to them.
describe('computeDisclosure — a paid placement is not one of your accounts', () => {
  it('an advertiser on a following surface is counted only as an advertiser', () => {
    const d = computeDisclosure([
      rec({ author: 'Magazin Exemplu Romania', accountType: 'advertiser', feedSource: 'following' }),
      rec({ author: 'A Neighbour', feedSource: 'following' }),
    ])!;
    expect(d.advertisers).toBe(1);
    expect(d.chosenAccounts).toBe(1);
  });
});

// The block says what handing the file over reveals, and that is the SET of
// addresses. Counting occurrences printed 6,300 for a file holding 4,103
// distinct ones.
describe('computeDisclosure — addresses are counted once each', () => {
  it('one post URL shared by many comments is one address', () => {
    const d = computeDisclosure([
      rec({ postUrl: 'https://x.com/a/1' }),
      rec({ postUrl: 'https://x.com/a/1' }),
      rec({ postUrl: 'https://x.com/a/1', anchorUrl: 'https://x.com/a/1/c/9' }),
      rec({ postUrl: 'https://x.com/a/2' }),
    ])!;
    expect(d.links).toBe(3);
  });

  it('the same media address on two records is one address', () => {
    const d = computeDisclosure([
      rec({ mediaUrls: ['https://cdn/1.jpg', 'https://cdn/2.jpg'] }),
      rec({ mediaUrls: ['https://cdn/1.jpg'] }),
    ])!;
    expect(d.mediaAddresses).toBe(2);
  });
});
