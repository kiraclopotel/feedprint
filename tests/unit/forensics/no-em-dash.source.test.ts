// Q64 (wiring W60): the house ban on em dashes in user-visible prose.
//
// String tables: zero em dashes in code lines (comments exempt; the bare
// placeholder glyph does not appear in the tables). html-export: the fixed
// prose sites are locked individually because its runtime script mixes
// user prose, comments, and the legitimate placeholder/marker glyphs.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSource } from '../../helpers/read-source';

/** The export builder is four files since 2026-09-16 (PLAN-2026-09-16 item 10.1): the builder, the
 *  scripts the page carries, the stylesheet, and the string table under i18n. A scan of "the
 *  export's source" reads all four through readSource, which refuses an emptied or re-export-only
 *  file, so a later split cannot turn this scan into an empty pass. */
const EXPORT_SOURCES = [
  'src/forensics/html-export.ts',
  'src/forensics/html-export-scripts.ts',
  'src/forensics/html-export-styles.ts',
  'src/i18n/export-strings.ts',
];
const exportSource = (): string => EXPORT_SOURCES.map((p) => readSource(p)).join(String.fromCharCode(10));


const EM = '—';
const HTML_EXPORT_PATH = 'src/forensics/html-export.ts';

function nonCommentEmDashLines(file: string): number[] {
  const lines = readSource(file).split('\n');
  const hits: number[] = [];
  let inBlockComment = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inBlockComment) {
      if (t.includes('*/')) inBlockComment = false;
      return;
    }
    if (t.startsWith('/*') || t.startsWith('/**')) {
      if (!t.includes('*/')) inBlockComment = true;
      return;
    }
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (line.includes(EM)) hits.push(i + 1);
  });
  return hits;
}

describe('Q64 — no em dashes in user-visible strings', () => {
  // One entry per file that holds strings a person reads. The dashboard and popup tables are a
  // file per language since PLAN-2026-09-16 item 10.2, and each one has to be named: pointing at
  // the file that assembles them would scan four imports and find nothing.
  it.each([
    'src/i18n/dashboard/en.ts',
    'src/i18n/dashboard/ro.ts',
    'src/i18n/dashboard/es.ts',
    'src/i18n/dashboard/pt-br.ts',
    'src/i18n/popup/en.ts',
    'src/i18n/popup/ro.ts',
    'src/i18n/popup/es.ts',
    'src/i18n/popup/pt-br.ts',
    'src/i18n/marker-strings.ts',
  ])('%s carries none outside comments', (file) => {
    expect(nonCommentEmDashLines(file)).toEqual([]);
  });

  it('html-export fixed prose sites stay converted', () => {
    const src = exportSource();
    expect(src).toContain('written down as it happened, with the checker inside the file.');
    expect(src).toContain('again; yours may be damaged.');
    expect(src).toContain("(local clock, diagnostic)");
    expect(src).toContain("['Comment judge: Calm");
    expect(src).toContain("['Post judge: Silent and Calm");
    expect(src).not.toContain(`judge ${EM}`);
  });
});
