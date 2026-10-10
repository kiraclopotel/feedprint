/** @vitest-environment jsdom */
// Capability audit 2026-09-06, P1 item 5: the export says why each key exists,
// from the signing origin ledger, and says "not recorded" for keys the ledger
// never saw (every key from before the ledger, and keys recovered from other
// installs). Nothing is invented for those.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { buildForensicHtmlExport, keyOriginText, I18N, type ExportMetadata } from '../../../src/forensics/html-export';

function record(fp: string, position: number): ForensicRecord {
  return {
    id: `fr-${fp}-${position}`,
    timestamp: new Date(Date.UTC(2026, 5, 1 + position, 0, 0, 0)).toISOString(),
    platform: 'twitter', originalText: 't', originalHash: 'oh', originalLength: 1,
    neutralizedText: '', author: '', postUrl: '', aiSource: 'cloud', feedSource: 'unknown',
    techniques: [], overallScore: 0, userAgeCategory: 'adult',
    chainPosition: position, integrityHash: `h${fp}${position}`, publicKeyFingerprint: fp,
  } as ForensicRecord;
}

const ACTIVE = 'fd3577e462c42ebc';
const OLD = 'c77cfc0df6327079';
const ORIGINS: NonNullable<ExportMetadata['keyOrigins']> = [
  { fingerprint: OLD, origin: 'generated-storage-empty', at: '2026-05-02T10:00:00.000Z' },
  { fingerprint: ACTIVE, origin: 'restored-from-backup', at: '2026-06-01T09:00:00.000Z', previousFingerprint: OLD },
];

function build(records: ForensicRecord[], keyOrigins?: ExportMetadata['keyOrigins'], locale: keyof typeof I18N = 'en'): string {
  return buildForensicHtmlExport(records, {
    fwVersion: 'FeelingWise V2.5.2', publicKeyJwk: {}, publicKeyFingerprint: ACTIVE, locale, keyOrigins,
  });
}

describe('keyOriginText', () => {
  it('names the origin with its date, and says not recorded otherwise', () => {
    expect(keyOriginText(ACTIVE, ORIGINS, I18N.en)).toBe(`${I18N.en.epochWhyRestored} (2026-06-01)`);
    expect(keyOriginText(OLD, ORIGINS, I18N.en)).toBe(`${I18N.en.epochWhyGenerated} (2026-05-02)`);
    expect(keyOriginText('0000000000000000', ORIGINS, I18N.en)).toBe(I18N.en.epochWhyUnknown);
    expect(keyOriginText(ACTIVE, undefined, I18N.en)).toBe(I18N.en.epochWhyUnknown);
  });
});

describe('page one: why this key', () => {
  it('a multi-key file carries the reason as the last column, unknown keys say not recorded', () => {
    const html = build([record(ACTIVE, 0), record(OLD, 0), record('0000000000000000', 0)], ORIGINS);
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    const heads = Array.from(document.querySelectorAll('.fw-epochs thead th')).map(th => th.textContent);
    expect(heads[heads.length - 1]).toBe(I18N.en.epochColWhy);
    const rows = Array.from(document.querySelectorAll('.fw-epochs tbody tr')).map(tr => tr.textContent ?? '');
    expect(rows[0]).toContain(I18N.en.epochWhyRestored);
    expect(rows.some(r => r.includes(I18N.en.epochWhyGenerated))).toBe(true);
    expect(rows.some(r => r.includes(I18N.en.epochWhyUnknown))).toBe(true);
  });

  it('a single-key file carries one row, and without a ledger it says not recorded', () => {
    const withLedger = build([record(ACTIVE, 0), record(ACTIVE, 1)], ORIGINS);
    // The row is marked so the signed manifest can cover it as rendered
    // (register item 6, second pass).
    expect(withLedger).toContain(`${I18N.en.summaryKeyOrigin}:</dt><dd data-fw-prov="keyOrigin">${I18N.en.epochWhyRestored} (2026-06-01)</dd>`);
    const without = build([record(ACTIVE, 0), record(ACTIVE, 1)]);
    expect(without).toContain(`${I18N.en.summaryKeyOrigin}:</dt><dd data-fw-prov="keyOrigin">${I18N.en.epochWhyUnknown}</dd>`);
  });

  it('every locale renders the column', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      const html = build([record(ACTIVE, 0), record(OLD, 0)], ORIGINS, locale);
      expect(html, locale).toContain(I18N[locale].epochColWhy);
      expect(html, locale).toContain(I18N[locale].epochWhyRestored);
    }
  });
});
