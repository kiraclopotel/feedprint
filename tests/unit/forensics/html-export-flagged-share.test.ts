// Capability audit 2026-09-06, P0 item 2: the export's page one prints the
// flagged share of the file with its k, its n and a 95% Wilson interval, under
// the Statistics tab's counting rule (environment and system markers out,
// verdict-less records flagged, blocked decided), and says in the same sentence
// that it is a share of the file, not of the feed.

import { describe, it, expect } from 'vitest';
import { buildForensicHtmlExport, computeFlaggedShare, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { isDecidedContentRecord } from '../../../src/forensics/flag-provenance';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: overrides.id ?? 'r-1',
    timestamp: overrides.timestamp ?? '2026-04-30T12:00:00Z',
    platform: overrides.platform ?? 'twitter',
    originalText: overrides.originalText ?? 'sample post',
    originalHash: overrides.originalHash ?? 'abc123',
    originalLength: overrides.originalLength ?? 11,
    neutralizedText: overrides.neutralizedText ?? '',
    author: overrides.author ?? '@example',
    postUrl: overrides.postUrl ?? 'https://x.com/example/status/1',
    techniques: overrides.techniques ?? [{ name: 'fear-appeal', severity: 7, confidence: 8 }],
    overallScore: overrides.overallScore ?? 0.7,
    userAgeCategory: overrides.userAgeCategory ?? 'adult',
    aiSource: overrides.aiSource ?? 'cloud',
    feedSource: overrides.feedSource ?? 'for-you',
    integrityHash: overrides.integrityHash ?? 'deadbeef',
    signature: overrides.signature ?? 'sig-base64url',
    publicKeyFingerprint: overrides.publicKeyFingerprint ?? 'fp123',
    chainPosition: overrides.chainPosition ?? 0,
    ...overrides,
  };
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'a3f9c2e1deadbeef',
  locale: 'en',
};

function chain(): ForensicRecord[] {
  const out: ForensicRecord[] = [];
  let pos = 0;
  const push = (o: Partial<ForensicRecord>) => out.push(makeRecord({ ...o, id: `r-${pos}`, chainPosition: pos++ }));
  for (let i = 0; i < 6; i++) push({ verdict: 'pass', techniques: [], overallScore: 0 });
  for (let i = 0; i < 3; i++) push({ verdict: 'flagged' });
  push({ verdict: 'flagged-hidden' });
  push({ verdict: undefined });          // pre-verdict record: written only when flagged
  push({ verdict: 'blocked', techniques: [] });
  push({ verdict: 'skipped', techniques: [] });   // not decided
  push({ kind: 'environment', verdict: 'flagged' } as Partial<ForensicRecord>); // out of both sides
  return out;
}

describe('export page one: flagged share with n and interval', () => {
  it('counts under the Statistics rule', () => {
    const sh = computeFlaggedShare(chain())!;
    expect(sh.k).toBe(5);   // 3 flagged + 1 hidden + 1 verdict-less
    expect(sh.n).toBe(12);  // 6 pass + 5 flagged + 1 blocked; skipped and environment out
    expect(sh.pct).toBe(42);
    expect(sh.lowerPct).toBeLessThan(sh.pct);
    expect(sh.upperPct).toBeGreaterThan(sh.pct);
  });

  it('prints k, n, the percentage and the interval on page one, in every locale', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      const html = buildForensicHtmlExport(chain(), { ...META, locale });
      const sh = computeFlaggedShare(chain())!;
      expect(html).toContain(I18N[locale].summaryFlaggedShare);
      const expected = I18N[locale].summaryFlaggedShareValue
        .replace('{k}', '5').replace('{n}', '12').replace('{pct}', String(sh.pct))
        .replace('{lo}', String(sh.lowerPct)).replace('{hi}', String(sh.upperPct));
      // The rendered row: every placeholder resolved, the sentence intact.
      const row = html.match(new RegExp(`<dt[^>]*>${I18N[locale].summaryFlaggedShare}:</dt><dd[^>]*>([^<]*)</dd>`));
      expect(row, `row missing in ${locale}`).not.toBeNull();
      const dd = row![1].replace(/&#39;/g, "'").replace(/&quot;/g, '"');
      expect(dd).not.toMatch(/\{(k|n|pct|lo|hi)\}/);
      expect(dd).toBe(expected);
    }
  });

  it('prints the empty sentence, never 0%, when no content record has a verdict', () => {
    const html = buildForensicHtmlExport([makeRecord({ kind: 'environment' } as Partial<ForensicRecord>)], META);
    expect(computeFlaggedShare([])).toBeNull();
    expect(html).toContain(I18N.en.summaryFlaggedShareNone);
  });
});

// 2026-09-20 — page one printed "Records included: 1500" and every share as "of 1325 content
// records" without ever saying what a content record is or where the other 175 went. A recount of
// the public demo's page one against its own records found every number right and that one
// question unanswerable from the page. The fix adds one row (contentRecordsRow) whose n must be the
// SAME number the flagged-share row already prints as its denominator; that equality, not either
// number alone, is what these cases hold.
describe('export page one: what a content record is', () => {
  function mixedFixture(): ForensicRecord[] {
    const out: ForensicRecord[] = [];
    let pos = 0;
    const push = (o: Partial<ForensicRecord>) => out.push(makeRecord({ ...o, id: `m-${pos}`, chainPosition: pos++ }));
    push({ verdict: 'pass', techniques: [], overallScore: 0 });
    push({ verdict: 'pass', techniques: [], overallScore: 0 });
    push({ verdict: 'flagged' });
    push({ verdict: 'blocked', techniques: [] });
    push({ kind: 'image', verdict: 'flagged' } as Partial<ForensicRecord>);
    push({ kind: 'environment', verdict: 'flagged' } as Partial<ForensicRecord>);
    push({ kind: 'heartbeat-marker' } as Partial<ForensicRecord>);
    return out;
  }

  it('the content-records row denominator equals the flagged-share row denominator', () => {
    const records = mixedFixture();
    const n = records.filter(isDecidedContentRecord).length;
    const html = buildForensicHtmlExport(records, META);
    const row = html.match(/<dt data-fw-prov="contentRecords\.label">[^<]*<\/dt><dd data-fw-prov="contentRecords">([^<]*)<\/dd>/);
    expect(row, 'contentRecords row missing').not.toBeNull();
    expect(row![1].startsWith(`${n} of ${records.length}`), row![1]).toBe(true);
    const shareRow = html.match(/<dt data-fw-prov="flaggedShare\.label">[^<]*<\/dt><dd data-fw-prov="flaggedShare">([^<]*)<\/dd>/);
    expect(shareRow, 'flaggedShare row missing').not.toBeNull();
    const denom = shareRow![1].match(/of (\d+) content records/);
    expect(denom, shareRow![1]).not.toBeNull();
    expect(n).toBe(Number(denom![1]));
  });

  it('the row is absent when every record is a content record', () => {
    const records = chain().filter(r => isDecidedContentRecord(r));
    expect(records.length).toBeGreaterThan(0);
    const html = buildForensicHtmlExport(records, META);
    expect(html).not.toContain('data-fw-prov="contentRecords"');
  });

  it('summaryContentRecordsValue keeps both slots in every locale', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      expect(I18N[locale].summaryContentRecordsValue, locale).toContain('{n}');
      expect(I18N[locale].summaryContentRecordsValue, locale).toContain('{total}');
      expect(I18N[locale].summaryContentRecords.length, locale).toBeGreaterThan(0);
    }
  });
});
