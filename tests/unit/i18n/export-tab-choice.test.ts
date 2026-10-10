// The Export tab asks one question (six formats of the same size left a reader
// unsure what to download, or why). Two answers stand in front: the report to show someone,
// the whole record; the other three formats fold away. One note says that a
// report reads "VERIFIED, as a report of N of M records", and PARTIALLY VERIFIED
// when a part it needs is missing or not signed, and that a chat app's preview
// does not show the result.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const src = readFileSync(join(process.cwd(), 'src/ui/dashboard/components/ExportTab.tsx'), 'utf8');

describe('Export tab: which file', () => {
  it('the report is the one recommended card, the whole record the second, the rest folded in details', () => {
    const q = src.indexOf('{t.exportChooseTitle}');
    const report = src.indexOf('data-export="report"');
    const everything = src.indexOf('data-export="everything"');
    const details = src.indexOf('<details className="export-other">');
    const pdf = src.indexOf('data-export="pdf"');
    expect(q).toBeGreaterThan(0);
    expect(report).toBeGreaterThan(q);
    expect(everything).toBeGreaterThan(report);
    expect(details).toBeGreaterThan(everything);
    expect(pdf).toBeGreaterThan(details);
    expect(src.match(/className="export-card primary"/g)?.length).toBe(1);
    expect(src.indexOf('className="export-card primary"')).toBeLessThan(src.indexOf('data-export="report"'));
    expect(src).toContain('<p className="export-partial-note">{t.exportPartialNote}</p>');
  });

  it('every interface language carries the question, the two answers, the note and the fold', () => {
    for (const [locale, s] of Object.entries(DASHBOARD_STRINGS)) {
      const t = s as unknown as Record<string, string>;
      for (const k of ['exportChooseTitle', 'exportChooseShow', 'exportChooseShowBody', 'exportChooseAll', 'exportChooseAllBody', 'exportPartialNote', 'exportOtherFormats']) {
        expect(t[k], `${locale}.${k}`).toBeTypeOf('string');
        expect(t[k].length, `${locale}.${k}`).toBeGreaterThan(8);
      }
      expect(t.exportPartialNote).toMatch(/VERIFI|VERIFIC/);
    }
  });
});
