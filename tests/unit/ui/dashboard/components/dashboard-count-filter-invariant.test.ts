// Dashboard count↔filter invariant.
//
// The parent dashboard shows counters (FLAGGED card, technique-frequency,
// frequent-flaggers, safety categories) and lets the parent click a counter to
// filter the activity feed. The trust contract is simple: a counter that says
// "31" must click through to exactly 31 records. Before the 2026-06-03 fixes
// the technique counter and its click-filter diverged — the counter canonical-
// ized technique names over the flagged-only set, while the click-filter
// matched RAW names over ALL records, so several techniques counted >0 but
// rendered an empty feed.
//
// This test pins the invariant for each surface using the SAME exported
// helpers the production code uses:
//   • verdict (FLAGGED)        → isExposureRecord            (analytics.ts)
//   • technique frequency      → canonicalizeTechniqueForStats (store.ts)
//   • frequent flaggers        → author substring match      (search path)
//   • safety categories        → recordMatchesBucket         (SafetyCategoriesPanel)
//
// counter value === number of records the click-filter returns, for every key.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { isExposureRecord } from '../../../../../src/forensics/analytics';
import { canonicalizeTechniqueForStats } from '../../../../../src/forensics/store';
import {
  recordMatchesBucket,
  type BucketId,
} from '../../../../../src/ui/dashboard/components/SafetyCategoriesPanel';
import { matchesAccountFilter } from '../../../../../src/ui/dashboard/components/feed-filters';
import {
  type ActivityFilterState, recordPasses, matchesWhat, buildSearchIndex, computeRailCounts,
} from '../../../../../src/ui/dashboard/components/activity-filters';

function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'fr-stub',
    timestamp: '2026-05-09T00:00:00.000Z',
    platform: 'twitter',
    originalText: 'stub',
    originalHash: 'stub-hash',
    originalLength: 4,
    neutralizedText: '',
    author: '@stub',
    postUrl: 'https://x.com/.../status/0',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'unknown',
    integrityHash: 'stub-integrity',
    ...overrides,
  };
}

// ─── Production-mirrored counter math ───────────────────────────────────────
// byTechnique exactly as computeStats() builds it: flagged-only set, canonicalized
// technique names. Kept in lockstep with computeStats() in store.ts.
function counterByTechnique(records: ForensicRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records.filter(isExposureRecord)) {
    for (const t of r.techniques) {
      const c = canonicalizeTechniqueForStats(t.name);
      out[c] = (out[c] ?? 0) + 1;
    }
  }
  return out;
}

// ─── Click-filter predicates as documented; the block at the end runs the
// SAME checks through the feed's real predicate (activity-filters.ts) ────
function filterByTechnique(records: ForensicRecord[], canonical: string): ForensicRecord[] {
  return records.filter(
    (r) => isExposureRecord(r)
      && r.techniques.some((t) => canonicalizeTechniqueForStats(t.name) === canonical),
  );
}
function filterByVerdictFlagged(records: ForensicRecord[]): ForensicRecord[] {
  return records.filter(isExposureRecord);
}
function filterByAuthor(records: ForensicRecord[], handle: string): ForensicRecord[] {
  const q = handle.toLowerCase();
  return records.filter((r) => r.author?.toLowerCase().includes(q) ?? false);
}
function filterBySafetyBucket(records: ForensicRecord[], bucket: BucketId): ForensicRecord[] {
  return records.filter((r) => recordMatchesBucket(r, bucket));
}

// ─── Fixed record set: flagged posts, flagged comments w/ parentVideoId, passes
const records: ForensicRecord[] = [
  // Flagged post — canonical technique already canonical.
  rec({
    id: 'p1', kind: 'post', verdict: 'flagged', author: '@alice',
    techniques: [{ name: 'scapegoating', severity: 7, confidence: 0.9 }],
  }),
  // Flagged comment under p1 — RAW LLM-variant label that canonicalizes to
  // 'genuine-opinion'. This is the record the OLD raw-name filter missed.
  rec({
    id: 'c1', kind: 'comment', parentVideoId: 'p1', verdict: 'flagged', author: '@bob',
    techniques: [{ name: 'opinie sinceră', severity: 4, confidence: 0.7 }],
  }),
  // Another flagged comment with the canonical 'genuine-opinion' label — must
  // land in the SAME bucket as c1's variant.
  rec({
    id: 'c2', kind: 'comment', parentVideoId: 'p1', verdict: 'flagged', author: '@alice',
    techniques: [{ name: 'genuine-opinion', severity: 3, confidence: 0.6 }],
  }),
  // Flagged-hidden slur comment (exposure event) — safety bucket 'slurs'.
  rec({
    id: 'c3', kind: 'comment', parentVideoId: 'p1', verdict: 'flagged-hidden', author: '@troll',
    detectionMode: 'slur:identity',
    techniques: [{ name: 'extreme-toxicity', severity: 9, confidence: 1 }],
  }),
  // Flagged comment with profanity technique — safety bucket 'swearing'.
  rec({
    id: 'c4', kind: 'comment', parentVideoId: 'p1', verdict: 'flagged', author: '@bob',
    techniques: [{ name: 'profanity', severity: 5, confidence: 0.8 }],
  }),
  // Pass records — NOT exposure, must never be counted or filtered in.
  rec({ id: 'pass1', verdict: 'pass', author: '@alice', techniques: [{ name: 'scapegoating', severity: 1, confidence: 0.1 }] }),
  rec({ id: 'pass2', verdict: 'pass', author: '@carol' }),
];

describe('dashboard count↔filter invariant', () => {
  it('technique counter === technique click-filter result, for every technique', () => {
    const counts = counterByTechnique(records);
    // Sanity: the variant + canonical labels consolidated into one bucket.
    expect(counts['genuine-opinion']).toBe(2);
    expect(Object.keys(counts).length).toBeGreaterThan(0);
    for (const [canonical, value] of Object.entries(counts)) {
      expect(filterByTechnique(records, canonical).length).toBe(value);
    }
  });

  it('a pass record carrying a technique never leaks into the technique filter', () => {
    // pass1 carries 'scapegoating' but verdict='pass' — excluded from both.
    const counts = counterByTechnique(records);
    expect(counts['scapegoating']).toBe(1); // only p1, not pass1
    expect(filterByTechnique(records, 'scapegoating').map((r) => r.id)).toEqual(['p1']);
  });

  it('FLAGGED counter === flagged verdict click-filter result', () => {
    const counter = records.filter(isExposureRecord).length;
    expect(filterByVerdictFlagged(records).length).toBe(counter);
    expect(counter).toBe(5); // p1, c1, c2, c3, c4 — not the two passes
  });

  it('author counter === author click-filter result', () => {
    const handle = '@bob';
    const counter = records.filter((r) => r.author === handle).length;
    expect(filterByAuthor(records, handle).length).toBe(counter);
    expect(counter).toBe(2); // c1, c4
  });

  it('safety-category counter === safety-bucket click-filter result, for every bucket', () => {
    const buckets: BucketId[] = ['swearing', 'slurs', 'racial', 'extreme'];
    for (const b of buckets) {
      const counter = records.filter((r) => recordMatchesBucket(r, b)).length;
      expect(filterBySafetyBucket(records, b).length).toBe(counter);
    }
    // Concrete anchors so a future regression can't make this vacuously pass.
    expect(filterBySafetyBucket(records, 'swearing').map((r) => r.id)).toEqual(['c4']);
    expect(filterBySafetyBucket(records, 'slurs').map((r) => r.id)).toEqual(['c3']);
    expect(filterBySafetyBucket(records, 'extreme').map((r) => r.id)).toEqual(['c3']);
  });

  // Account-type axis (added 2026-07-22). Regression: the "Groups" chip counted
  // accountType over the FULL record set while clicking it filtered the CO-ACTIVE
  // (e.g. #flagged deep-link) feed, so a group PASS inflated the count but never
  // showed on the flagged feed → "Groups: 360 but no record". Fix: the account
  // counts are computed over the SAME pre-account base the click composes onto.
  it('account counter === account click-filter result under a co-active flagged filter', () => {
    const set: ForensicRecord[] = [
      rec({ id: 'g-flag', kind: 'post', verdict: 'flagged', accountType: 'group',
        techniques: [{ name: 'scapegoating', severity: 7, confidence: 0.9 }] }),
      rec({ id: 'g-pass', kind: 'post', verdict: 'pass', accountType: 'group' }),
      rec({ id: 'p-flag', kind: 'post', verdict: 'flagged', accountType: 'person',
        techniques: [{ name: 'profanity', severity: 5, confidence: 0.8 }] }),
    ];
    // Co-active verdict filter = flagged (the popup #flagged deep-link default).
    const flaggedBase = set.filter(isExposureRecord);
    // Counter (post-fix): accountType tally over the SAME base the click composes onto.
    const groupCount = flaggedBase.filter((r) => (r.accountType ?? 'person') === 'group').length;
    const groupClick = flaggedBase.filter((r) => matchesAccountFilter(r, 'group'));
    expect(groupClick.length).toBe(groupCount); // count === click
    expect(groupCount).toBe(1); // only g-flag — the group PASS must not inflate the count
    expect(groupClick.map((r) => r.id)).toEqual(['g-flag']);
  });
});

// ─── The real predicate (components/activity-filters.ts recordPasses) must
// agree with the documented predicates above, and the rail's click-through
// counts must equal what each option opens.
describe('dashboard count<->filter invariant on the real predicate', () => {
  const NONE: ActivityFilterState = {
    filter: 'all', platformFilter: 'all', accountFilter: 'all', whenFilter: 'any',
    severityFilter: null, kindFilter: null, modeFilter: null, modelFilter: null, techniqueFilter: null, hiddenCategoryFilter: null,
    safetyBucketFilter: null, recordIdsFilter: null, roomUrlFilter: null, hourRangeFilter: null,
    surfaceFilter: null, sessionFilter: null, seenBeforeFilter: null, authorFilter: null,
    search: '',
  };
  const what = (r: ForensicRecord, f: ActivityFilterState['filter']) => matchesWhat(r, f, new Map(), new Set());
  const index = buildSearchIndex(records);
  const apply = (over: Partial<ActivityFilterState>) =>
    records.filter((r) => recordPasses(r, { ...NONE, ...over }, what, index));

  it('technique filter === documented technique predicate, for every technique', () => {
    for (const canonical of Object.keys(counterByTechnique(records))) {
      expect(apply({ techniqueFilter: canonical }).map((r) => r.id))
        .toEqual(filterByTechnique(records, canonical).map((r) => r.id));
    }
    expect(apply({ techniqueFilter: 'scapegoating' }).map((r) => r.id)).toEqual(['p1']);
  });

  it('flagged filter === documented flagged predicate', () => {
    expect(apply({ filter: 'flagged' }).map((r) => r.id)).toEqual(filterByVerdictFlagged(records).map((r) => r.id));
  });

  it('safety-bucket filter === documented bucket predicate, for every bucket', () => {
    for (const b of ['swearing', 'slurs', 'racial', 'extreme'] as BucketId[]) {
      expect(apply({ safetyBucketFilter: b }).map((r) => r.id)).toEqual(filterBySafetyBucket(records, b).map((r) => r.id));
    }
  });

  it('every rail count is a click-through count (count === rows the option opens)', () => {
    const state: ActivityFilterState = { ...NONE, filter: 'flagged' };
    const passes = (r: ForensicRecord, except?: Parameters<typeof recordPasses>[4]) =>
      recordPasses(r, state, what, index, except);
    const counts = computeRailCounts(records, passes, what);
    expect(counts.what.flagged).toBe(apply({ filter: 'flagged' }).length);
    expect(counts.what.all).toBe(records.length);
    expect(counts.who.person).toBe(apply({ filter: 'flagged', accountFilter: 'person' }).length);
    expect(counts.place.all).toBe(apply({ filter: 'flagged' }).length);
  });
});
