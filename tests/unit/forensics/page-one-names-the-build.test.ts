/** @vitest-environment jsdom */
//
// Page one names the code that made the file. The first question a lawyer asks of an export is
// "which code wrote this", and until this test page one answered it only when the file held two
// builds or more. Now one build is named too, and the line naming the extension that exported the
// file carries its build id and source digest (manifest version_name), not the version alone.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { buildForensicHtmlExport, I18N } from '../../../src/forensics/html-export';
import { extensionLabel } from '../../../src/forensics/extension-label';
import { EVIDENCE_STRINGS } from '../../../src/forensics/export-evidence-strings';

const FP = 'fd3577e462c42ebc';

function record(position: number, over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: `fr-${position}`,
    timestamp: new Date(Date.UTC(2026, 9, 1, 0, 0, position)).toISOString(),
    platform: 'twitter',
    originalText: `t${position}`,
    originalHash: `oh${position}`,
    originalLength: 2,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    chainPosition: position,
    integrityHash: `h${position}`,
    publicKeyFingerprint: FP,
    ...over,
  } as ForensicRecord;
}

const LABEL = 'FeelingWise V2.5.17 build fwbid-0e6a9d81aaaa-r2517 source ' + 'ab'.repeat(32);

function html(records: ForensicRecord[]): string {
  return buildForensicHtmlExport(records, {
    fwVersion: LABEL,
    publicKeyJwk: {},
    publicKeyFingerprint: FP,
    locale: 'en',
  });
}

describe('page one names the build', () => {
  it('names the one build every record carries', () => {
    const page = html([record(0, { buildId: 'fwbid-0e6a9d81aaaa-r2517' }), record(1, { buildId: 'fwbid-0e6a9d81aaaa-r2517' })]);
    expect(page).toContain(`<dt data-fw-prov="builds.label">${EVIDENCE_STRINGS.en.summaryBuildOne}:</dt>`);
    expect(page).toMatch(/<dd data-fw-prov="builds">[^<]*fwbid-0e6a9d81aaaa-r2517/);
  });

  it('says how many records name the build when some name none, never "every record"', () => {
    // Markers the extension writes about itself carry no build id, so nearly every real file is this one.
    const page = html([
      record(0, { buildId: 'fwbid-0e6a9d81aaaa-r2517' }),
      record(1, { buildId: 'fwbid-0e6a9d81aaaa-r2517' }),
      record(2, { kind: 'heartbeat-marker' }),
    ]);
    const expected = EVIDENCE_STRINGS.en.summaryBuildOneOfSomeValue
      .replace('{id}', 'fwbid-0e6a9d81aaaa-r2517').replace('{n}', '2').replace('{total}', '3').replace('{rest}', '1');
    expect(page).toContain(`<dd data-fw-prov="builds">${expected}</dd>`);
    expect(page).not.toContain(`<dd data-fw-prov="builds">${EVIDENCE_STRINGS.en.summaryBuildOneValue.replace('{id}', 'fwbid-0e6a9d81aaaa-r2517')}`);
  });

  it('says "Recorded with" when the exporting build is the one the records name', () => {
    const page = html([record(0, { buildId: 'fwbid-0e6a9d81aaaa-r2517' })]);
    expect(page).toContain(`${I18N.en.capturedBy}:</dt><dd data-fw-prov="capturedBy">${LABEL}`);
  });

  it('says "Exported with" when the records name another build than the one that exported them', () => {
    const page = html([record(0, { buildId: 'fwbid-aaaaaaaaaaaa-r2516' })]);
    expect(page).toContain(`${I18N.en.summaryExportedBy}:</dt><dd data-fw-prov="capturedBy">${LABEL}`);
  });

  it('keeps the list for two builds or more', () => {
    const page = html([record(0, { buildId: 'fwbid-aaaaaaaaaaaa-r2516' }), record(1, { buildId: 'fwbid-0e6a9d81aaaa-r2517' })]);
    expect(page).toContain(`<dt data-fw-prov="builds.label">${I18N.en.summaryBuilds}:</dt>`);
  });

  it('states no build row over records that carry none, and still names the exporting build', () => {
    const page = html([record(0), record(1)]);
    expect(page).not.toContain('data-fw-prov="builds"');
    expect(page).toContain(`<dd data-fw-prov="capturedBy">${LABEL}</dd>`);
  });

  it('has the single-build words in every locale', () => {
    for (const locale of Object.keys(I18N) as (keyof typeof I18N)[]) {
      const s = EVIDENCE_STRINGS[locale];
      expect(s.summaryBuildOne, locale).toBeTruthy();
      expect(s.summaryBuildOneValue, locale).toContain('{id}');
      for (const slot of ['{id}', '{n}', '{total}', '{rest}']) expect(s.summaryBuildOneOfSomeValue, locale).toContain(slot);
    }
  });

  it('the file carries those words in its own table, so its checker can read them', () => {
    const page = html([record(0, { buildId: 'fwbid-0e6a9d81aaaa-r2517' })]);
    expect(page).toContain(JSON.stringify(EVIDENCE_STRINGS.en.summaryBuildOneValue));
  });
});

describe('the extension label on page one', () => {
  it('carries version_name when the build set one', () => {
    expect(extensionLabel({ version: '2.5.17', version_name: '2.5.17 build fwbid-x-r2517 source abc' }))
      .toBe('FeelingWise V2.5.17 build fwbid-x-r2517 source abc');
  });

  it('falls back to the version, and to V1 with no manifest', () => {
    expect(extensionLabel({ version: '2.5.17' })).toBe('FeelingWise V2.5.17');
    expect(extensionLabel(undefined)).toBe('FeelingWise V1');
  });

  it('is what both export paths use', () => {
    const exporter = readFileSync(resolve(__dirname, '../../../src/forensics/exporter.ts'), 'utf8');
    expect(exporter.match(/extensionLabel\(/g)?.length).toBe(2);
    expect(exporter).not.toMatch(/`FeelingWise V\$\{/);
  });
});
