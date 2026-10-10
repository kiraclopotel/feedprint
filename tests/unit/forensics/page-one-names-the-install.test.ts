/** @vitest-environment jsdom */
//
// Page one says how the extension that wrote the records was installed, counted from each
// record's own stamp, with the limit beside it: Chrome's answer to the extension, carried by the
// extension, so a changed copy could write anything. A file whose records state nothing prints no
// row at all.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord, InstallType } from '../../../src/types/forensic';
import { buildForensicHtmlExport } from '../../../src/forensics/html-export';
import { EVIDENCE_STRINGS } from '../../../src/forensics/export-evidence-strings';
import { readSource } from '../../helpers/read-source';

const FP = 'fd3577e462c42ebc';
const EN = EVIDENCE_STRINGS.en;

function record(position: number, installType?: InstallType): ForensicRecord {
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
    ...(installType ? { stamp: { installType } } : {}),
  } as unknown as ForensicRecord;
}

function installCell(records: ForensicRecord[]): string | null {
  const page = buildForensicHtmlExport(records, { fwVersion: 'FeelingWise V2.5.17', publicKeyJwk: {}, publicKeyFingerprint: FP, locale: 'en' });
  const m = /<dd data-fw-prov="install">([^<]*)<\/dd>/.exec(page);
  return m ? m[1] : null;
}

describe('page one names the install', () => {
  it('a store install, every record stating it', () => {
    const cell = installCell([record(0, 'normal'), record(1, 'normal')]);
    expect(cell).toContain(`${EN.installNormal}: 2 records`);
    expect(cell).toContain(EN.summaryInstallLimit.slice(0, 40));
  });

  it('a copy loaded by hand is named in plain words, and records stating nothing are counted apart', () => {
    const cell = installCell([record(0, 'development'), record(1, 'development'), record(2)]);
    expect(cell).toContain(`${EN.installDevelopment}: 2 records`);
    expect(cell).toContain(EN.summaryInstallUnstated.replace('{n}', '1'));
  });

  it('no row when no record states it', () => {
    expect(installCell([record(0), record(1)])).toBeNull();
  });

  it('the row is one of the signed page rows', () => {
    expect(readSource('src/forensics/html-export.ts')).toContain('<dt data-fw-prov="install.label">');
  });

  it('every language has the words and its slots', () => {
    for (const [locale, s] of Object.entries(EVIDENCE_STRINGS)) {
      for (const k of ['installNormal', 'installDevelopment', 'installSideload', 'installAdmin', 'installOther', 'summaryInstall', 'summaryInstallLimit'] as const) {
        expect(s[k], `${locale} ${k}`).toBeTruthy();
      }
      expect(s.summaryInstallItem, locale).toContain('{what}');
      expect(s.summaryInstallItem, locale).toContain('{n}');
      expect(s.summaryInstallUnstated, locale).toContain('{n}');
    }
  });
});
