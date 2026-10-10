// The numbers engine for the forensic export mode (futurestate 3b item 2).
//
// The one thing these tests must never let through: a rule wearing a judge's
// number. A blocked record carries a synthetic 'ai-content-block' technique at
// severity 10 (logger.ts), and 166 such records in the last six days would
// have read as the judge's strongest findings if anything here classified by
// severity. Every column is decided by provenance fields only.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import {
  applyFilters,
  computePlatformRows,
  contentIdentity,
  isImpression,
  isModelNamed,
  isPaidPlacement,
  isUserHidden,
  isUserRule,
  ruleLabel,
  seenBeforeIds,
  sittingByRecordId,
  surfaceBucket,
} from '../../../src/forensics/export-numbers';

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
    author: 'a',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: `ih-${n}`,
    chainPosition: n,
    verdict: 'pass',
    kind: 'post',
    ...over,
  } as ForensicRecord;
}

const judgeFlag = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'flagged', aiSource: 'cloud', detectionMode: 'combined-detect-neutralize',
  techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }], overallScore: 7, ...over,
});

/** The rule wearing a judge's number: severity 10, verdict blocked, aiSource rules. */
const aiBlock = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:ai-label:en',
  techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }], overallScore: 10,
  feedSource: 'video', ...over,
});

const sponsoredTeen = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'flagged', aiSource: 'rules', detectionMode: 'sponsored-ad',
  techniques: [{ name: 'consumer-rapid-frame', severity: 6, confidence: 0.99 }], overallScore: 6, ...over,
});

function fixture(): ForensicRecord[] {
  n = 0;
  return [
    rec({ platform: 'twitter', originalHash: 'dup' }),                    // 1 first sighting
    rec({ platform: 'twitter', originalHash: 'dup' }),                    // 2 extra copy
    rec({ platform: 'twitter', originalHash: 'dup' }),                    // 3 extra copy
    sponsoredTeen({ platform: 'twitter' }),                               // 4 paid
    aiBlock({ platform: 'twitter' }),                                     // 5 user-hidden, sev 10
    judgeFlag({ platform: 'twitter' }),                                   // 6 model-named
    rec({ platform: 'facebook', kind: 'comment' }),                       // 7
    rec({ platform: 'facebook', verdict: 'blocked', aiSource: 'rules',
      detectionMode: 'block:ads:platform-ad-marker', accountType: 'advertiser',
      techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }] }), // 8 paid, adult ad block
    rec({ platform: 'youtube', kind: 'video', originalHash: 'dup' }),     // 9 first on youtube; total: copy
    rec({ platform: 'tiktok', kind: 'reset-marker', verdict: undefined }), // 10 marker
    rec({ platform: 'tiktok', kind: 'gap-marker', verdict: undefined }),  // 11 marker
    rec({ platform: 'tiktok', kind: 'environment' }),                     // 12 room record
    rec({ platform: 'tiktok', kind: 'image' }),                           // 13 analysis record
    rec({ platform: 'instagram', verdict: 'flagged', aiSource: 'rules',
      detectionMode: 'blocklist:word:elon' }),                            // 14 word filter
  ];
}

describe('computePlatformRows', () => {
  it('gives one row per platform in fixed order plus a total', () => {
    const rows = computePlatformRows(fixture());
    expect(rows.map(r => r.platform)).toEqual(['twitter', 'facebook', 'youtube', 'tiktok', 'instagram', 'total']);
  });

  it('counts X: 6 impressions, 4 unique, 2 copies, 1 paid, 1 user-hidden, 1 model-named', () => {
    const x = computePlatformRows(fixture())[0];
    expect(x).toEqual({
      platform: 'twitter', impressions: 6, uniquePosts: 4, extraCopies: 2,
      paidPlacements: 1, userHidden: 1, modelNamed: 1,
    });
  });

  it('counts the adult ad block as paid, never as model-named or user-hidden', () => {
    const fb = computePlatformRows(fixture())[1];
    expect(fb).toEqual({
      platform: 'facebook', impressions: 2, uniquePosts: 2, extraCopies: 0,
      paidPlacements: 1, userHidden: 0, modelNamed: 0,
    });
  });

  it('excludes markers, environment and image records from every column', () => {
    const tt = computePlatformRows(fixture())[3];
    expect(tt.impressions).toBe(0);
    expect(tt.uniquePosts).toBe(0);
  });

  it('counts the word filter as user-hidden on Instagram', () => {
    const ig = computePlatformRows(fixture())[4];
    expect(ig.userHidden).toBe(1);
    expect(ig.modelNamed).toBe(0);
  });

  it('totals: copies dedupe across platforms, model-named is exactly the judge flag', () => {
    const total = computePlatformRows(fixture())[5];
    // impressions: X 6 + FB 2 + YT 1 + IG 1
    expect(total.impressions).toBe(10);
    // 'dup' appears on X and YT; globally one unique, three copies
    expect(total.uniquePosts).toBe(7);
    expect(total.extraCopies).toBe(3);
    expect(total.paidPlacements).toBe(2);
    expect(total.userHidden).toBe(2);
    expect(total.modelNamed).toBe(1);
  });

  it('never lets a severity-10 rule record into model-named', () => {
    const rows = computePlatformRows([aiBlock(), aiBlock({ aiSource: 'local' }), aiBlock({ verdict: 'flagged' })]);
    expect(rows[5].modelNamed).toBe(0);
    expect(rows[5].userHidden).toBe(3);
  });

  it('is empty-safe', () => {
    const rows = computePlatformRows([]);
    expect(rows).toHaveLength(6);
    expect(rows[5].impressions).toBe(0);
  });
});

describe('ruleLabel', () => {
  it('is null for a judge flag and for a judged pass', () => {
    expect(ruleLabel(judgeFlag())).toBeNull();
    expect(ruleLabel(rec())).toBeNull();
  });

  it('names the user rule by provenance, never by severity', () => {
    expect(ruleLabel(aiBlock())).toBe('ai-content-block');
    expect(ruleLabel(aiBlock({ detectionMode: 'block:hashtag:#aifruit' }))).toBe('hashtag-block');
    expect(ruleLabel(aiBlock({ detectionMode: 'block:reel-surface:parent-toggle' }))).toBe('reel-surface');
    expect(ruleLabel(aiBlock({ detectionMode: 'block:media-timeout:parent-toggle' }))).toBe('media-timeout');
    expect(ruleLabel(aiBlock({ detectionMode: 'block:ads:platform-ad-marker' }))).toBe('ad-marker');
    expect(ruleLabel(rec({ aiSource: 'rules', detectionMode: 'blocklist:word:elon' }))).toBe('word-filter');
    expect(ruleLabel(rec({ aiSource: 'rules', detectionMode: 'blocklist:phrase:buy now' }))).toBe('word-filter');
    expect(ruleLabel(rec({ aiSource: 'rules', detectionMode: 'blocklist:account:@x' }))).toBe('account-block');
    expect(ruleLabel(sponsoredTeen())).toBe('ad-marker');
    expect(ruleLabel(sponsoredTeen({ detectionMode: 'sponsored-ad:adult' }))).toBe('ad-marker');
  });

  it('survives the late-after-rotation delivery prefix', () => {
    expect(ruleLabel(aiBlock({ detectionMode: 'late-after-rotation:block:ai-label:ro' }))).toBe('ai-content-block');
  });

  it('a severity-10 judge flag stays a judge flag', () => {
    const r = judgeFlag({ techniques: [{ name: 'fear-appeal', severity: 10, confidence: 1 }], overallScore: 10 });
    expect(ruleLabel(r)).toBeNull();
    expect(isModelNamed(r)).toBe(true);
  });

  it('reads the decision rails and override gates', () => {
    const rail = (name: string) => rec({ verdict: 'flagged', decision: { rails: [{ name, match: '' }] } as never });
    expect(ruleLabel(rail('sponsored'))).toBe('ad-marker');
    expect(ruleLabel(rail('blocklist'))).toBe('word-filter');
    expect(ruleLabel(rail('identity-slur'))).toBe('identity-slur');
    expect(ruleLabel(judgeFlag({ overrideOrigin: 'profanity-tier' }))).toBe('profanity-tier');
    expect(ruleLabel(judgeFlag({ overrideOrigin: 'identity-slur' }))).toBe('identity-slur');
  });

  it('a manual record is manual; a rules record with no name is rule', () => {
    expect(ruleLabel(rec({ feedSource: 'manual', detectionMode: 'manual:parent' }))).toBe('manual');
    expect(ruleLabel(rec({ aiSource: 'rules', detectionMode: 'comment-batch:negative' }))).toBe('rule');
  });

  it('the user-hidden set excludes the ad marker and the product gates', () => {
    expect(isUserRule('ai-content-block')).toBe(true);
    expect(isUserRule('word-filter')).toBe(true);
    expect(isUserRule('ad-marker')).toBe(false);
    expect(isUserRule('identity-slur')).toBe(false);
    expect(isUserRule(null)).toBe(false);
    expect(isUserHidden(judgeFlag({ overrideOrigin: 'profanity-tier' }))).toBe(false);
  });
});

describe('column predicates', () => {
  it('paid placement reads mode, rail and accountType', () => {
    expect(isPaidPlacement(sponsoredTeen())).toBe(true);
    expect(isPaidPlacement(rec({ accountType: 'advertiser' }))).toBe(true);
    expect(isPaidPlacement(rec({ decision: { rails: [{ name: 'sponsored', match: '' }] } as never }))).toBe(true);
    expect(isPaidPlacement(judgeFlag())).toBe(false);
  });

  it('model-named needs a model and a flagged verdict', () => {
    expect(isModelNamed(judgeFlag())).toBe(true);
    expect(isModelNamed(judgeFlag({ verdict: 'flagged-hidden' }))).toBe(true);
    expect(isModelNamed(judgeFlag({ verdict: undefined }))).toBe(true);
    expect(isModelNamed(rec())).toBe(false);
    expect(isModelNamed(judgeFlag({ aiSource: 'rules' }))).toBe(false);
    expect(isModelNamed(judgeFlag({ overrideOrigin: 'harm-floor' }))).toBe(false);
  });

  it('a repeat-exposure mark alone is not a judge flag (gem 74)', () => {
    // verdict undefined + aiSource cloud is the shape a repeat-exposure-only
    // mark carries; isModelNamed must not read that as a judge naming a
    // technique, since a frequency mark is not a content judgment.
    const seenALot = rec({
      verdict: undefined, aiSource: 'cloud',
      techniques: [{ name: 'repeat-exposure', severity: 6, confidence: 1 }],
    });
    expect(isModelNamed(seenALot)).toBe(false);
    // a real judge flag that happens to also carry a repeat-exposure mark
    // alongside a real technique still counts.
    expect(isModelNamed(judgeFlag({
      verdict: undefined,
      techniques: [{ name: 'repeat-exposure', severity: 6, confidence: 1 }, { name: 'fear-appeal', severity: 7, confidence: 0.9 }],
    }))).toBe(true);
  });

  it('impression: DOM node kinds and legacy records only', () => {
    expect(isImpression(rec({ kind: undefined }))).toBe(true);
    for (const k of ['post', 'video', 'comment', 'top-comment', 'reply', 'reply-to-reply'] as const) {
      expect(isImpression(rec({ kind: k }))).toBe(true);
    }
    for (const k of ['image', 'environment', 'reset-marker', 'heartbeat-marker', 'prune-marker'] as const) {
      expect(isImpression(rec({ kind: k }))).toBe(false);
    }
  });

  it('a blocked placeholder caption is not a content identity', () => {
    expect(contentIdentity(rec({ originalText: '[blocked: ai-label]', originalHash: 'p' }))).toBeNull();
    expect(contentIdentity(rec({ originalHash: 'h' }))).toBe('h');
    const rows = computePlatformRows([
      rec({ originalText: '[blocked: ai-label]', originalHash: 'p' }),
      rec({ originalText: '[blocked: ai-label]', originalHash: 'p' }),
    ]);
    expect(rows[0].impressions).toBe(2);
    expect(rows[0].uniquePosts).toBe(0);
    expect(rows[0].extraCopies).toBe(0);
  });
});

describe('surface buckets', () => {
  it('maps the five named sources, keeps unknown apart, and folds the rest into other', () => {
    expect(surfaceBucket(rec({ feedSource: 'for-you' }))).toBe('for-you');
    expect(surfaceBucket(rec({ feedSource: 'following' }))).toBe('following');
    expect(surfaceBucket(rec({ feedSource: 'profile' }))).toBe('profile');
    expect(surfaceBucket(rec({ feedSource: 'permalink' }))).toBe('permalink');
    expect(surfaceBucket(rec({ feedSource: 'search' }))).toBe('search');
    expect(surfaceBucket(rec({ feedSource: 'unknown' }))).toBe('unknown');
    expect(surfaceBucket(rec({ feedSource: undefined }))).toBe('unknown');
    for (const f of ['video', 'manual'] as const) {
      expect(surfaceBucket(rec({ feedSource: f }))).toBe('other');
    }
  });
});

describe('sittings and seen-before', () => {
  it('starts a new sitting at a gap of 30 minutes or more, in array order', () => {
    const rs = [
      rec({ timestamp: '2026-09-10T10:00:00Z' }),
      rec({ timestamp: '2026-09-10T10:29:59Z' }),
      rec({ timestamp: '2026-09-10T10:59:59Z' }), // exactly 30:00 after the previous: new sitting
      rec({ timestamp: '2026-09-10T11:10:00Z', kind: 'gap-marker' }), // markers never open a sitting
      rec({ timestamp: '2026-09-10T11:20:00Z' }),
      rec({ timestamp: '2026-09-10T13:00:00Z' }),
    ];
    const s = sittingByRecordId(rs);
    expect(s[rs[0].id]).toBe(1);
    expect(s[rs[1].id]).toBe(1);
    expect(s[rs[2].id]).toBe(2);
    expect(s[rs[3].id]).toBeUndefined();
    expect(s[rs[4].id]).toBe(2);
    expect(s[rs[5].id]).toBe(3);
  });

  it('seen-before is by array order and ignores markers', () => {
    const rs = [
      rec({ originalHash: 'a' }),
      rec({ originalHash: 'a', kind: 'environment' }),
      rec({ originalHash: 'b' }),
      rec({ originalHash: 'a' }),
      rec({ originalHash: 'b' }),
    ];
    const seen = seenBeforeIds(rs);
    expect(Object.keys(seen).sort()).toEqual([rs[3].id, rs[4].id].sort());
  });
});

describe('applyFilters', () => {
  it('filters by platform, keeping markers of that platform', () => {
    const out = applyFilters(fixture(), { platforms: ['tiktok'] });
    expect(out.every(r => r.platform === 'tiktok')).toBe(true);
    expect(out).toHaveLength(4);
  });

  it('filters by surface', () => {
    const out = applyFilters(fixture(), { platforms: ['twitter'], surfaces: ['other'] });
    // the ai-content block defaults to 'video', which is other
    expect(out.map(r => r.detectionMode)).toEqual(['block:ai-label:en']);
  });

  it('filters by sitting, numbered over the whole array', () => {
    n = 0;
    const rs = [
      rec({ timestamp: '2026-09-10T10:00:00Z' }),
      rec({ timestamp: '2026-09-10T12:00:00Z' }),
      rec({ timestamp: '2026-09-10T12:05:00Z' }),
    ];
    expect(applyFilters(rs, { sittings: [2] }).map(r => r.id)).toEqual([rs[1].id, rs[2].id]);
    // sitting numbers do not shift when a platform filter removes the first sitting
    expect(applyFilters(rs, { sittings: [2], platforms: ['twitter'] })).toHaveLength(2);
  });

  it('filters by seen-before in both directions', () => {
    const rs = fixture();
    const copies = applyFilters(rs, { seenBefore: true });
    // markers pass through untouched; the impressions left are the copies
    expect(copies.filter(isImpression).map(r => r.id)).toEqual(['fr-2', 'fr-3', 'fr-9']);
    const firsts = applyFilters(rs, { seenBefore: false });
    expect(firsts.some(r => r.id === 'fr-2')).toBe(false);
    expect(firsts.some(r => r.id === 'fr-1')).toBe(true);
  });

  it('composes: X, For You, seen before', () => {
    const rows = computePlatformRows(fixture(), { platforms: ['twitter'], surfaces: ['for-you'], seenBefore: true });
    expect(rows[0].impressions).toBe(2);
    expect(rows[5].impressions).toBe(2);
    expect(rows[1].impressions).toBe(0);
  });

  it('an empty filter state changes nothing', () => {
    const rs = fixture();
    expect(applyFilters(rs, {})).toHaveLength(rs.length);
    expect(applyFilters(rs, { platforms: [], surfaces: [], sittings: [] })).toHaveLength(rs.length);
  });
});
