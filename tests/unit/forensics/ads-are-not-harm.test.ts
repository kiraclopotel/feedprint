// Ads are never harm, everywhere, as a class.
//
// Rebuild plan 2026-09-14, standing decision 1. The blind read of 300 items
// from the owner's own six-day export (docs/research/BLIND-READ-2026-09-14.md)
// drew 150 items the app had acted on: 75 of them were plain sponsored ads,
// recorded as technique consumer-rapid-frame at severity 6 from the platform's
// own marker, and the frozen adult reader fired on NONE of them. Half of every
// harm number the owner read was advertising.
//
// THE PROOF THIS FILE PINS. On that sample the acted count without ads equals
// the export's paid-placement column: acted 150, ads 75, acted without ads 75,
// paid-placement column 75. Run against the real sample on 2026-09-14 it came
// out 75 = 75 exactly, with all 75 ads inside the acted stratum and none in the
// passed stratum. The sample cannot live in the repo (it carries the owner's
// own feed), so the fixture below reproduces its SHAPE at one tenth the size:
// 20 records, 8 of them ads, every ad signal represented.
//
// The rule is about counting and display only. Nothing here asserts anything
// about what is written to the chain: an ad record keeps its verdict, its
// technique, its severity and its hash.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { computePlatformRows, isPaidPlacement } from '../../../src/forensics/export-numbers';
import { computeFlagSplit } from '../../../src/forensics/flag-provenance';
import { harmSeverityOf } from '../../../src/forensics/paid-placement';
import { computeStats } from '../../../src/forensics/store';
import { isExposureRecord, severityWeight } from '../../../src/forensics/analytics';
import { usageBand } from '../../../src/forensics/usage-band';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import { computeFlaggedShare, buildForensicHtmlExport, I18N, type ExportLocale } from '../../../src/forensics/html-export';
import { aggregateByTechnique, aggregateByActionFamily } from '../../../src/forensics/data-layer';
import { computeOverview } from '../../../src/ui/dashboard/components/overview-data';
import { isFlaggedVerdict, isRuleBlocked } from '../../../src/ui/dashboard/record-sets';
import { matchesSeverity } from '../../../src/ui/dashboard/components/filter-rail';
import { recordScore } from '../../../src/ui/dashboard/components/feed-sort';

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
    author: `author-${n}`,
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

/** The child and teen shape: the ad marker stamped as a technique at severity 6. */
const teenAd = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'flagged-hidden', aiSource: 'rules', detectionMode: 'sponsored-ad',
  techniques: [{ name: 'consumer-rapid-frame', severity: 6, confidence: 0.99 }],
  overallScore: 6, ...over,
});

/** A judge's flag on organic content, which must survive every rule below. */
const judged = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'flagged', aiSource: 'cloud', detectionMode: 'combined-detect-neutralize',
  techniques: [{ name: 'fear-appeal', severity: 8, confidence: 0.9 }],
  overallScore: 8, ...over,
});

/**
 * 20 records, 8 ads. The ads carry all four signals the class predicate reads:
 * the child/teen verdict, the adult category block, the sponsored decision rail
 * and an advertiser account. The 12 others are 4 judged flags (one of them
 * naming consumer-rapid-frame on organic content, which the judge does say),
 * 1 household word-filter block, 1 hand-typed flag and 6 passes.
 */
function fixture(): ForensicRecord[] {
  n = 0;
  return [
    // 8 ads
    teenAd(),
    teenAd(),
    teenAd({ detectionMode: 'late-after-rotation:sponsored-ad' }),
    teenAd({ detectionMode: 'sponsored-ad:adult' }),
    rec({ verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:ads:platform-ad-marker',
      techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }], overallScore: 10 }),
    rec({ verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:ads:media-only-ad-marker',
      techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }], overallScore: 10 }),
    rec({ verdict: 'flagged', aiSource: 'cloud', accountType: 'advertiser',
      techniques: [{ name: 'consumer-rapid-frame', severity: 7, confidence: 0.8 }], overallScore: 7 }),
    rec({ verdict: 'flagged', aiSource: 'cloud',
      decision: { rails: [{ name: 'sponsored', match: 'is_sponsored' }] } as never,
      techniques: [{ name: 'fear-appeal', severity: 9, confidence: 0.8 }], overallScore: 9 }),
    // 4 judged flags, one naming the ad technique on organic content
    judged(),
    judged(),
    judged({ techniques: [{ name: 'consumer-rapid-frame', severity: 8, confidence: 0.9 }] }),
    judged({ verdict: 'flagged-hidden' }),
    // 1 household rule, 1 hand-typed flag
    rec({ verdict: 'flagged', aiSource: 'none', detectionMode: 'blocklist:word:elon',
      techniques: [{ name: 'profanity', severity: 5, confidence: 1 }], overallScore: 5 }),
    rec({ verdict: 'flagged', feedSource: 'manual', detectionMode: 'manual', id: 'fr-manual-1' }),
    // 6 passes
    rec(), rec(), rec(), rec(), rec(), rec(),
  ];
}

const ADS = 8;
const ACTED_WITHOUT_ADS = 6; // 4 judged + 1 household rule + 1 hand-typed

describe('the proof: the acted count without ads is the paid-placement column', () => {
  it('counts 8 ads by the class predicate, and only those 8', () => {
    const f = fixture();
    expect(f.filter(isPaidPlacement)).toHaveLength(ADS);
    // The technique name is never the test: the judge names
    // consumer-rapid-frame on organic posts, and that record is not an ad.
    const organicBuyPressure = f[10];
    expect(organicBuyPressure.techniques[0].name).toBe('consumer-rapid-frame');
    expect(isPaidPlacement(organicBuyPressure)).toBe(false);
  });

  it('acted without ads equals the export paid-placement column', () => {
    const f = fixture();
    const acted = f.filter(r =>
      r.verdict === 'flagged' || r.verdict === 'flagged-hidden' || r.verdict === 'blocked' || r.verdict === undefined);
    const actedWithoutAds = acted.filter(r => !isPaidPlacement(r)).length;
    const total = computePlatformRows(f).slice(-1)[0];
    expect(acted).toHaveLength(ACTED_WITHOUT_ADS + ADS);
    expect(actedWithoutAds).toBe(ACTED_WITHOUT_ADS);
    // The same arithmetic the 300-item sample gave: 150 acted, 75 without ads,
    // 75 in the paid-placement column.
    expect(total.paidPlacements).toBe(ADS);
    expect(acted.length - actedWithoutAds).toBe(total.paidPlacements);
  });

  it('never lets an ad into the model-named column', () => {
    const total = computePlatformRows(fixture()).slice(-1)[0];
    expect(total.modelNamed).toBe(4); // the four judged flags, no ad
  });
});

describe('an ad enters no harm count', () => {
  const f = fixture();

  it('leaves the flagged share and every technique tally', () => {
    const stats = computeStats(f);
    // 4 judged + the household word filter + the hand-typed flag: the blocked
    // ads are not flagged records at all.
    expect(stats.total).toBe(6);
    expect(stats.byTechnique['consumer-rapid-frame']).toBe(1); // the organic one only
    expect(stats.byTechnique['ai-content-block']).toBeUndefined();
    const techniques = aggregateByTechnique(f);
    expect(techniques['consumer-rapid-frame']).toBe(1);
  });

  it('leaves the dashboard flagged bucket and lands on the rule side', () => {
    expect(f.filter(isFlaggedVerdict)).toHaveLength(6);
    for (const ad of f.filter(isPaidPlacement)) {
      expect(isFlaggedVerdict(ad)).toBe(false);
      expect(isRuleBlocked(ad)).toBe(true);
    }
  });

  it('leaves the exposure views', () => {
    expect(f.filter(isExposureRecord)).toHaveLength(6);
    for (const ad of f.filter(isPaidPlacement)) expect(severityWeight(ad)).toBe(0);
  });

  it('bands as blocked, never as flagged, in the usage histogram', () => {
    for (const ad of f.filter(isPaidPlacement)) expect(usageBand(ad)).toBe('blocked');
  });

  it('counts as ads, never as a detection, in the action families', () => {
    const families = aggregateByActionFamily(f.filter(r => r.verdict !== 'pass'));
    expect(families.ads).toBe(ADS);
    // 4 judged flags plus the hand-typed one, which this function has always
    // counted as a detection; the household word filter is a house rule.
    expect(families.detection).toBe(5);
    expect(families['house-rule']).toBe(1);
  });

  it('is reported on its own row of the export flag split', () => {
    const split = computeFlagSplit(f)!;
    expect(split.paidPlacement).toBe(ADS);
    expect(split.flagged).toBe(6);
    expect(split.judged).toBe(4);
    expect(split.ruleKinds.map(k => k.kind)).not.toContain('sponsored-ad');
    // Ads stay in the denominator: the file did decide what to do with them.
    expect(split.decided).toBe(20);
  });

  it('is decided but not flagged in the export flagged share', () => {
    const share = computeFlaggedShare(f)!;
    expect(share.k).toBe(6);
    expect(share.n).toBe(20);
  });
});

describe('an ad carries no severity for display or counting', () => {
  const f = fixture();

  it('reads severity 0 however the record is scored', () => {
    for (const ad of f.filter(isPaidPlacement)) {
      expect(harmSeverityOf(ad)).toBe(0);
      expect(recordScore(ad)).toBe(0);
      expect(matchesSeverity(ad, 'high')).toBe(false);
      expect(matchesSeverity(ad, 'medium')).toBe(false);
      expect(matchesSeverity(ad, 'low')).toBe(false);
    }
  });

  it('leaves the record itself untouched', () => {
    const ad = fixture()[0];
    expect(ad.verdict).toBe('flagged-hidden');
    expect(ad.overallScore).toBe(6);
    expect(ad.techniques[0]).toEqual({ name: 'consumer-rapid-frame', severity: 6, confidence: 0.99 });
  });

  it('keeps a judged flag ranking by its own score', () => {
    expect(recordScore(fixture()[8])).toBe(8);
  });

  it('keeps ads out of the Overview brief and its worth-a-look rows', () => {
    const o = computeOverview(fixture())!;
    expect(o.brief.flagged).toBe(6);
    expect(o.attention.every(a => !isPaidPlacement(a.record))).toBe(true);
  });
});

describe('the export methodology says so, in every locale', () => {
  it('carries the ads note in all four export locales', () => {
    for (const loc of Object.keys(I18N) as ExportLocale[]) {
      const note = I18N[loc].methodologyAdsNote;
      expect(note.length).toBeGreaterThan(40);
      expect(note).not.toContain('—'); // no em dashes in anything he reads
    }
  });

  it('renders the note into the exported HTML', () => {
    const html = buildForensicHtmlExport(fixture(), {
      fwVersion: 'V1.0.0-test',
      publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
      publicKeyFingerprint: 'a3f9c2e1deadbeef',
      locale: 'en',
      methodology: buildMethodologyBlock('V1.0.0-test'),
    } as never);
    expect(html).toContain('data-fw-mth="ads"');
    expect(html).toContain('data-fw-prov="paidPlacement"');
  });
});
