// Two small surfaces that told a person less than they knew.
//
// THE EMPTY EXPORT. The Export tab's recommended card has refused to run with
// nothing flagged since 2026-09-18, and its comment says why: with an empty
// selection it built the HTML, downloaded it, and printed a SHA-256 receipt
// telling the person to paste that line into the message they send the file
// with. A fresh install, a just-rotated month, or a record of nothing but
// passes and advertisements all reach it.
//
// The three cards under "other formats" carried none of that. So the tab
// refused the export it marks RECOMMENDED and then offered the same empty file
// three more ways, each with its own success receipt. Found 2026-09-19.
//
// The Everything card is deliberately left enabled: it exports the whole
// record, and nothing flagged is exactly when somebody wants it.
//
// THE DROPPED NOTE. Every row in the AI group shows `overrideNote`, which is
// the only place the popup says a feature has been set differently on some
// platforms. One row, the comment rewrite, never reached it: its ternary
// answered the YouTube question and stopped. The two are not alternatives and
// never collide, because `overrideNote` speaks only in the general view and the
// YouTube branch only on a YouTube tab. The row was dropping a sentence it
// could always have shown.
//
// Read as source rather than rendered: both are about which expression a
// button or a row is handed, and the Export tab needs a chain, a key and a
// downloads API before it will paint.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

describe('the empty export and the dropped note (2026-09-19)', () => {
  it('every format on the Export tab refuses an empty selection, by one name', () => {
    const src = read('src/ui/dashboard/components/ExportTab.tsx');
    expect(src, 'the condition has a name').toContain('const nothingFlagged = filter.included.length === 0;');
    for (const format of ['report', 'pdf', 'json', 'csv']) {
      const button = src.match(new RegExp(`data-export="${format}"[^>]*`))?.[0] ?? '';
      expect(button, `the ${format} card is there`).not.toBe('');
      expect(button, `the ${format} card refuses an empty selection`).toContain('nothingFlagged');
    }
  });

  it('the Everything card stays enabled, because that is when it is wanted', () => {
    // The control. A fix that disabled every export on an empty record would
    // leave a person with a full chain and no way to carry it.
    const src = read('src/ui/dashboard/components/ExportTab.tsx');
    const everything = src.match(/data-export="everything"[^>]*/)?.[0]
      ?? src.match(/exportEverythingHtml[\s\S]{0,200}/)?.[0]
      ?? '';
    expect(everything, 'the Everything export exists').not.toBe('');
    expect(everything, 'and is not gated on the flag filter').not.toContain('nothingFlagged');
  });

  it('a person is told why the other formats are off', () => {
    // Disabling three buttons in silence would be the fourth
    // refusal-without-words of the day, after the hashtag box, the setup
    // Activate button and quiet hours.
    const src = read('src/ui/dashboard/components/ExportTab.tsx');
    // Since 9 Oct 2026 an install with no record at all is told that instead (an-empty-install-saves-no-whole-record).
    expect(src).toContain('{nothingFlagged && <p className="export-partial-note">{nothingRecorded ? t.exportNothingRecorded : t.exportNothingFlagged}</p>}');
  });

  it('the rewrite row shows the per-platform note as well as the YouTube one', () => {
    // The rewrite row is in the AI card, which has its own file since it left SettingsPanel.
    const src = read('src/ui/popup/panels/ai/AiCard.tsx');
    const row = src.match(/note=\{r\.id === 'rewritten-comments-first'[\s\S]{0,320}?\}\n/)?.[0] ?? '';
    expect(row, 'the row was found').not.toBe('');
    expect(row, 'the permanent limit is still said').toContain('featRewriteNotOnYouTube');
    expect(row, "and the parent's own setting is too").toContain('overrideNote(r.id)');
    expect(row, 'with the YouTube tab still getting its own sentence alone')
      .toContain('featRewriteUnavailableHere');
  });

  it('every other row in that group still reaches the note, which is what made this visible', () => {
    const src = read('src/ui/popup/panels/SettingsPanel.tsx') + read('src/ui/popup/panels/ai/AiCard.tsx');
    // Three call sites: the two groups that always passed it, and the rewrite
    // row's own branch. Fewer than three means a row has stopped asking again.
    expect((src.match(/overrideNote\(r\.id\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
