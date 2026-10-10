// A reconciliation the record carries is readable in the export. The section renders from the
// marker records the file itself carries, read back out of their own hashed line, so the sentences
// a reader sees come from the signed bytes and not from anything threaded in beside them. A file
// with no such marker prints no section, since the dashboard no longer offers to make one.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildForensicHtmlExport, reconciliationOf, I18N } from '../../../src/forensics/html-export';
import { reconcileMarkerText } from '../../../src/forensics/reconcile-marker';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ReconcileMarkerInput } from '../../../src/types/reconcile-marker';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

const INPUT: ReconcileMarkerInput = {
  archiveDigest: 'b'.repeat(64),
  platforms: ['facebook', 'instagram'],
  fromISO: '2026-08-01T09:00:00.000Z',
  toISO: '2026-08-31T21:00:00.000Z',
  windowMinutes: 15,
  corroboratedByUrl: 4,
  corroboratedByAuthorAndTime: 7,
  unmatchedRecords: 12,
  unmatchedArchiveItems: 30,
  recordsOutsideWindow: 100,
};

function marker(at = '2026-09-06T15:00:00.000Z'): ForensicRecord {
  return {
    id: `fr-reconcile-${at}`, timestamp: at, platform: 'twitter',
    originalText: reconcileMarkerText(INPUT, at, false),
    originalHash: 'h', originalLength: 10, neutralizedText: '', author: '', postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'local',
    feedSource: 'unknown', integrityHash: 'ih', signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: 0, kind: 'reconcile-marker', verdict: 'pass',
  } as unknown as ForensicRecord;
}

const META: Parameters<typeof buildForensicHtmlExport>[1] = {
  fwVersion: 'V-test', publicKeyJwk: {}, publicKeyFingerprint: 'fp', locale: 'en',
};

describe('reading a marker back out of its own line', () => {
  it('recovers every number the section prints', () => {
    const line = reconciliationOf(marker());
    expect(line).not.toBeNull();
    expect(line!.platforms).toBe('facebook, instagram');
    expect(line!.fromISO).toBe(INPUT.fromISO);
    expect(line!.toISO).toBe(INPUT.toISO);
    expect(line!.windowMinutes).toBe('15');
    expect(line!.corroborated).toBe(11);
    expect(line!.unmatchedRecords).toBe(12);
    expect(line!.unmatchedArchiveItems).toBe(30);
    expect(line!.archiveDigest).toBe(INPUT.archiveDigest);
  });

  /**
   * The reader takes each field by name out of the signed text. The fields
   * added 2026-09-18 are appended to that text, and two of them start with a
   * word an older field name is a prefix of (archive, from, to), so the pin is
   * that none of them is picked up in place of the field it resembles.
   */
  it('the fields added later do not shadow the ones the section prints', () => {
    const at = '2026-09-18T15:00:00.000Z';
    const extended = {
      ...marker(at),
      originalText: reconcileMarkerText({
        ...INPUT,
        systemMarkersExcluded: 9,
        archiveItemsOutsideCoverage: 83,
        comparedFromISO: '2026-08-24T00:00:00.000Z',
        comparedToISO: '2026-08-31T10:00:00.000Z',
      }, at, false),
    } as ForensicRecord;
    const line = reconciliationOf(extended);
    expect(line).not.toBeNull();
    expect(line!.archiveDigest).toBe(INPUT.archiveDigest);
    expect(line!.fromISO).toBe(INPUT.fromISO);
    expect(line!.toISO).toBe(INPUT.toISO);
    expect(line!.unmatchedArchiveItems).toBe(30);
    expect(line!.corroborated).toBe(11);
  });

  it('is null for anything that is not a reconciliation marker', () => {
    const other = { ...marker(), kind: 'gap-marker' } as ForensicRecord;
    expect(reconciliationOf(other)).toBeNull();
    const truncated = { ...marker(), originalText: '[reconcile-marker @ t] platforms=facebook' } as ForensicRecord;
    expect(reconciliationOf(truncated)).toBeNull();
  });
});

describe('the section in the file', () => {
  it('a file with no reconciliation prints no section: the dashboard no longer offers one', () => {
    const html = buildForensicHtmlExport([], META);
    expect(html).not.toContain('data-reconciliations=');
  });

  it('a file that carries one prints its counts, its window and the archive digest', () => {
    const html = buildForensicHtmlExport([marker()], META);
    expect(html).toContain('data-reconciliations="1"');
    expect(html).toContain('facebook, instagram');
    expect(html).toContain('11 records supported');
    expect(html).toContain('12 not mentioned in it');
    expect(html).toContain('30 listed by the platform');
    expect(html).toContain('up to 15 minutes apart');
    expect(html).toContain(INPUT.archiveDigest);
    // The whole dictionary rides in the JSON payload, so the absence has to be
    // read in the rendered section rather than in the file as a whole.
    const section = html.slice(html.indexOf('data-reconciliations="1"'));
    expect(section.slice(0, section.indexOf('</div>'))).not.toContain(I18N.en.reconcileNone);
  });

  it('the floor sentence is printed with every reconciliation', () => {
    expect(buildForensicHtmlExport([marker()], META)).toContain(I18N.en.reconcileFloor);
    expect(I18N.en.reconcileFloor).toContain('floor');
  });

  it('two reconciliations print oldest first', () => {
    const html = buildForensicHtmlExport([marker('2026-09-07T10:00:00.000Z'), marker('2026-09-05T10:00:00.000Z')], META);
    expect(html).toContain('data-reconciliations="2"');
    expect(html.indexOf('2026-09-05')).toBeLessThan(html.indexOf('2026-09-07'));
  });

  it('every interface language carries all six sentences', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      for (const key of ['reconcileHeader', 'reconcileIntro', 'reconcileNone', 'reconcileLine', 'reconcileArchive', 'reconcileFloor'] as const) {
        expect(I18N[locale][key].length, `${locale}.${key}`).toBeGreaterThan(20);
      }
      // The placeholders must survive translation or the sentence prints raw.
      for (const token of ['{at}', '{platforms}', '{from}', '{to}', '{c}', '{u}', '{a}', '{w}']) {
        expect(I18N[locale].reconcileLine, `${locale} ${token}`).toContain(token);
      }
      expect(I18N[locale].reconcileArchive).toContain('{d}');
    }
  });
});

/**
 * Found 2026-09-18 by reading the printed sentence against the line that
 * computes the number (ExportTab's runReconciliation): the digest is SHA-256
 * over the DECODED TEXT of whichever files the picker handed over, joined in
 * that order with a NUL between them. Nobody starting from the platform's own
 * download computes it, and a second request to the platform returns a
 * different file in any case. The sentence had told every reader of every
 * export ever written that they could obtain the same export and compare.
 */
describe('what the fingerprint is said to be', () => {
  const locales = Object.keys(I18N) as Array<keyof typeof I18N>;

  it('no language offers the platform\'s own copy as a way to compute it', () => {
    for (const locale of locales) {
      expect(I18N[locale].reconcileArchive, `${locale}`).not.toMatch(
        /obtains? the same export|obține același export|obtenga la misma exportación|obtiver a mesma exportação/i,
      );
    }
  });

  it('every language says where it was taken, what it was taken over, and that it is not public', () => {
    expect(I18N.en.reconcileArchive).toContain('in the order they were opened');
    expect(I18N.en.reconcileArchive).toContain('not a public identifier');
    expect(I18N.ro.reconcileArchive).toContain('în ordinea în care au fost deschise');
    expect(I18N.ro.reconcileArchive).toContain('identificator public');
    expect(I18N.es.reconcileArchive).toContain('en el orden en que se abrieron');
    expect(I18N.es.reconcileArchive).toContain('identificador público');
    expect(I18N['pt-BR'].reconcileArchive).toContain('na ordem em que foram abertos');
    expect(I18N['pt-BR'].reconcileArchive).toContain('identificador público');
  });

  it('the counts sentence does not claim to cover the whole period the export covers', () => {
    expect(I18N.en.reconcileLine).toContain('this recorder was also running');
    expect(I18N.ro.reconcileLine).toContain('acest înregistrator a funcționat');
    expect(I18N.es.reconcileLine).toContain('este registrador también estuvo funcionando');
    expect(I18N['pt-BR'].reconcileLine).toContain('este gravador também esteve funcionando');
  });

  it('nothing in the code calls the digest a hash of the archive as it arrived', () => {
    expect(read('src/types/reconcile-marker.ts')).not.toMatch(/archive files as read/);
    expect(read('src/forensics/reconcile-marker.ts')).not.toMatch(/digest of its own bytes/);
    expect(read('src/ui/dashboard/components/ExportTab.tsx')).not.toMatch(/digest of (the archive's own|its) bytes/);
  });
});
