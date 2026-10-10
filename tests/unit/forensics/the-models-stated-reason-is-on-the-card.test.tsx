// @vitest-environment jsdom
//
// The model's one-line rationale, rendered where a reader can actually reach
// it. src/types/forensic.ts says why the field exists: 'combined' is the
// uncategorised residual, by far the most common technique in real exports, it
// names no components ever, and without this line an auditor reading
// "combined, severity 8" has nothing at all. It was rendered only as a title
// attribute on the technique tag, which reaches a mouse on a desktop and
// nothing else: not a phone, not a keyboard, and not a printed PDF, which is
// what a recipient does with this file before taking it to anybody. So the one
// line explaining the most common finding in the file was invisible in the form
// the file is most often read in (2026-09-18, register M247).
//
// The second and third cases are the guard. The same `why` field carries a
// deterministic gate's matched evidence on a rules record, where no model ran,
// and labelling that "the model's stated reason" would be a plain falsehood.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

const JUDGE_REASON = 'the poster tells the reader their life is worthless without the product';
const GATE_EVIDENCE = 'platform sponsored/ad marker';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: '2026-09-07T01:00:00Z',
    platform: 'facebook',
    originalText: 'a post somebody was shown',
    originalHash: 'h',
    originalLength: 25,
    neutralizedText: '',
    author: '@user',
    postUrl: 'https://facebook.com/p/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: `hash-${seq}`,
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'flagged',
    ...overrides,
  } as ForensicRecord;
}

function meta(locale: string): ExportMetadata {
  return {
    fwVersion: 'V1.0.0-test',
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
    publicKeyFingerprint: 'fp16',
    locale,
  } as ExportMetadata;
}

function renderFeed(records: ForensicRecord[], locale = 'en'): string {
  const html = buildForensicHtmlExport(records, meta(locale));
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).innerHTML;
}

/** The card with every tooltip removed: what a printed page or a phone shows. */
function withoutTooltips(html: string): string {
  return html.replace(/\stitle="[^"]*"/g, '');
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe("the model's stated reason", () => {
  it('is readable with every tooltip stripped, which is what a printed page is', () => {
    const judged = rec({
      aiSource: 'cloud',
      techniques: [{ name: 'combined', severity: 8, confidence: 0.8, why: JUDGE_REASON }],
      overallScore: 8,
    });
    const html = renderFeed([judged]);
    expect(html).toContain(JUDGE_REASON);

    const flat = withoutTooltips(html);
    expect(flat, 'the rationale survives with no tooltips in the page').toContain(JUDGE_REASON);
    expect(flat).toContain(I18N.en.feedWhyPrefix);
    // And the guard on the guard: stripping really did remove the attributes,
    // so the assertion above is not passing on a string it failed to touch.
    expect(flat).not.toContain('title="');
  });

  it('is not claimed for a record no model read', () => {
    const gated = rec({
      aiSource: 'rules',
      verdict: 'flagged-hidden',
      detectionMode: 'sponsored-ad',
      accountType: 'advertiser',
      techniques: [{ name: 'consumer-rapid-frame', severity: 6, confidence: 0.99, why: GATE_EVIDENCE }],
      overallScore: 6,
    });
    const html = renderFeed([gated]);
    expect(html, 'no model read this record, so nothing may be attributed to one')
      .not.toContain(I18N.en.feedWhyPrefix);
  });

  it('says nothing at all for a judged record whose technique carries no rationale', () => {
    const bare = rec({
      aiSource: 'cloud',
      techniques: [{ name: 'combined', severity: 8, confidence: 0.8 }],
      overallScore: 8,
    });
    expect(renderFeed([bare])).not.toContain(I18N.en.feedWhyPrefix);
  });

  it('carries the label in every interface language', () => {
    for (const lang of UI_LANGUAGES) {
      const judged = rec({
        aiSource: 'cloud',
        techniques: [{ name: 'combined', severity: 8, confidence: 0.8, why: JUDGE_REASON }],
        overallScore: 8,
      });
      const flat = withoutTooltips(renderFeed([judged], lang));
      expect(flat, `${lang} card carries the label`).toContain(
        (I18N[lang] as unknown as Record<string, string>).feedWhyPrefix,
      );
      expect(flat, `${lang} card carries the words themselves`).toContain(JUDGE_REASON);
    }
  });
});
