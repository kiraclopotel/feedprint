/** @vitest-environment jsdom */
/**
 * Area A, turns 100-101 — the HTML report is the file most likely to reach a
 * school, a lawyer or another parent. Two things it used to get wrong:
 *
 *   1. It printed a bare record count. CSV and JSON have always written
 *      "Records included: N of M. Excluded: …", so a severity-gated subset and
 *      a complete chain produced an identical-looking line and the reader had
 *      no way to tell which they were holding.
 *   2. It answered "how many were flagged?" three different ways inside the
 *      same downloaded file, and the headline percentage used the worst of the
 *      three — one that counted records the pipeline never judged.
 */
import { describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, I18N } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-07-01T10:00:00.000Z',
    platform: 'twitter',
    originalText: 'text',
    originalHash: 'h',
    originalLength: 4,
    neutralizedText: '',
    author: '@a',
    postUrl: 'https://x.com/a/status/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    integrityHash: 'i',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

const META = {
  fwVersion: 'V1',
  publicKeyJwk: {},
  publicKeyFingerprint: 'ff',
  locale: 'en' as const,
};

describe('HTML export — what was held back', () => {
  it('names the source size and every exclusion bucket', () => {
    const html = buildForensicHtmlExport([rec()], {
      ...META,
      selection: {
        included: 1,
        totalSource: 10015,
        excludedUnreviewed: 4,
        excludedLowConfidence: 10000,
        excludedNonDetection: 10,
      },
    });
    expect(html).toContain(I18N.en.summaryDrawnFrom);
    expect(html).toContain('10015');
    expect(html).toContain(I18N.en.summaryHeldBack);
    expect(html).toContain('10014');
    expect(html).toContain('4 ' + I18N.en.summaryHeldBackUnreviewed);
    expect(html).toContain('10000 ' + I18N.en.summaryHeldBackLowSeverity);
    expect(html).toContain('10 ' + I18N.en.summaryHeldBackNonDetection);
  });

  it('states the total even when the reasons do not add up to it', () => {
    // A future gate that forgets to report its own bucket must not be able to
    // shrink the number the reader sees.
    const html = buildForensicHtmlExport([rec()], {
      ...META,
      selection: {
        included: 1, totalSource: 100,
        excludedUnreviewed: 0, excludedLowConfidence: 5, excludedNonDetection: 0,
      },
    });
    expect(html).toContain('99');
  });

  it('says so explicitly when nothing was held back — silence is never the answer', () => {
    const complete = buildForensicHtmlExport([rec()], META);
    expect(complete).toContain(I18N.en.summaryHeldBackNone);

    const unfiltered = buildForensicHtmlExport([rec()], {
      ...META,
      selection: {
        included: 1, totalSource: 1,
        excludedUnreviewed: 0, excludedLowConfidence: 0, excludedNonDetection: 0,
      },
    });
    expect(unfiltered).toContain(I18N.en.summaryHeldBackNone);
  });

  it('carries the same guarantee in Romanian', () => {
    const html = buildForensicHtmlExport([rec()], {
      ...META,
      locale: 'ro',
      selection: {
        included: 1, totalSource: 50,
        excludedUnreviewed: 0, excludedLowConfidence: 49, excludedNonDetection: 0,
      },
    });
    expect(html).toContain(I18N.ro.summaryHeldBack);
    expect(html).toContain(I18N.ro.summaryHeldBackLowSeverity);
    expect(html).toContain('50');
  });
});

describe('HTML export — one definition of flagged per file', () => {
  it('the behavior script and the feed script use byte-identical rules', () => {
    const src = buildForensicHtmlExport([rec()], META);
    // Both predicates are emitted into the page as source. If they ever drift
    // apart again, the same chain answers the same question two ways.
    const rule = "r.verdict==='flagged'||r.verdict==='flagged-hidden'||(maxSev(r)>=5)";
    const occurrences = src.split(rule).length - 1;
    expect(occurrences).toBe(2);
  });

  it('an undefined verdict is no longer counted as flagged', () => {
    const src = buildForensicHtmlExport([rec()], META);
    expect(src).not.toContain("r.verdict===undefined;");
  });

  it('a record that was never judged is excluded from the behavioral set', () => {
    const src = buildForensicHtmlExport([rec()], META);
    // Neither side of a rate: it would silently deflate every percentage.
    expect(src).toContain("function isUnjudged(r){return typeof r.verdict==='string'&&r.verdict.indexOf('cancelled')===0;}");
    expect(src).toContain('!isUnjudged(r)');
  });
});
