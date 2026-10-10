// The dashboard no longer offers to compare the record with a platform's own data download. Measured
// on one real Facebook export (scripts/research/chain/reconcile-on-archive.ts), the shape test read the
// account's own activity as a feed list, and the counts it would have signed described the platform's
// partial list rather than the record. A record that already carries a comparison keeps it: the
// export still prints every saved one, and prints nothing where there is none.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildForensicHtmlExport } from '../../../src/forensics/html-export';
import { reconcileMarkerText } from '../../../src/forensics/reconcile-marker';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { ReconcileMarkerInput } from '../../../src/types/reconcile-marker';

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

const ENTRY_KEYS = [
  'reconcileTitle', 'reconcileBody', 'reconcileComparing', 'reconcileChoose', 'reconNothingRecognised',
  'reconFileRead', 'reconFileNote', 'reconUnrecognised', 'reconNothingToCompare', 'reconCounts', 'reconFloor',
  'reconWriteFailed', 'reconWritten', 'reconUnreadable',
];

const INPUT: ReconcileMarkerInput = {
  archiveDigest: 'c'.repeat(64),
  platforms: ['facebook'],
  fromISO: '2026-08-01T09:00:00.000Z',
  toISO: '2026-08-31T21:00:00.000Z',
  windowMinutes: 15,
  corroboratedByUrl: 4,
  corroboratedByAuthorAndTime: 7,
  unmatchedRecords: 12,
  unmatchedArchiveItems: 30,
  recordsOutsideWindow: 100,
};

const saved = (): ForensicRecord => ({
  id: 'fr-reconcile-saved', timestamp: '2026-09-06T15:00:00.000Z', platform: 'facebook',
  originalText: reconcileMarkerText(INPUT, '2026-09-06T15:00:00.000Z', false),
  originalHash: 'h', originalLength: 10, neutralizedText: '', author: '', postUrl: '',
  techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'local',
  feedSource: 'unknown', integrityHash: 'ih', signature: 'sig', publicKeyFingerprint: 'fp',
  chainPosition: 0, kind: 'reconcile-marker', verdict: 'pass',
} as unknown as ForensicRecord);

const META = (locale: string) => ({ fwVersion: 'V-test', publicKeyJwk: {}, publicKeyFingerprint: 'fp', locale }) as Parameters<typeof buildForensicHtmlExport>[1];

describe('no way in', () => {
  it('the Export tab neither reads a platform archive nor writes a comparison', () => {
    const tab = read('src/ui/dashboard/components/ExportTab.tsx');
    expect(tab).not.toMatch(/forensics\/reconcile'/);
    expect(tab).not.toContain('RECONCILE_MARKER');
    expect(tab).not.toContain('data-picker="reconcile"');
  });

  it.each(UI_LANGUAGES)('%s: the dashboard carries none of the comparison card\'s sentences', (lang) => {
    for (const key of ENTRY_KEYS) expect(key in DASHBOARD_STRINGS[lang], key).toBe(false);
  });

  it('a file with no saved comparison prints no comparison section', () => {
    expect(buildForensicHtmlExport([], META('en'))).not.toContain('data-reconciliations=');
  });
});

describe('a saved comparison still reads', () => {
  it.each(UI_LANGUAGES)('%s: the export prints it, with its counts and the archive fingerprint', (lang) => {
    const html = buildForensicHtmlExport([saved()], META(lang));
    expect(html).toContain('data-reconciliations="1"');
    expect(html).toContain(INPUT.archiveDigest);
  });
});
