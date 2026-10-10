// Prose that tells a reader to look for words the product never prints.
//
// Four findings of one shape, from a read-only scan of the four language tables
// on 2026-09-19. Each is a sentence explaining a control or a banner by quoting
// it, in a language where the quotation does not match what that language's UI
// actually shows. A reader goes looking for the words and they are not there.
//
// The sharpest was `exportPartialNote`, whose entire job is to stop a reader
// panicking at a report that says PARTIALLY VERIFIED. English and Romanian
// quoted the real banner. Spanish told the reader to expect
// "VERIFICADO PARCIALMENTE" and the export prints "VERIFICADA EN PARTE";
// Portuguese told them "PARCIALMENTE VERIFICADO" against "VERIFICADA EM PARTE".
// So in two of four languages, the one sentence written to make a frightening
// banner legible pointed at nothing.
//
// Beside it, three tables told a reader to press a backup button by a name it
// does not carry, and Brazilian Portuguese called one event by two different
// verbs, one on the page and the other in the record, which is the artefact
// that is supposed to be matchable to the page.
//
// These cases hold the pairs. They compare a quotation in one table against the
// string the product actually renders, in the same language, so a future
// rewording of either half fails here rather than drifting apart quietly.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
// The export's own table is exported as I18N, keyed by ExportLocale.
import { I18N as EXPORT_STRINGS } from '../../../src/i18n/export-strings';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';

type Lang = 'en' | 'ro' | 'es' | 'pt-BR';
const LANGS: Lang[] = ['en', 'ro', 'es', 'pt-BR'];

/** The quoted run inside a sentence, however that language quotes it. */
function quoted(text: string): string[] {
  return [...text.matchAll(/["“„«]([^"”»]+)["”»]/g)].map((m) => m[1].trim());
}

describe('a note quotes what the screen says (2026-09-19)', () => {
  it('the partial-verification note names the banner the export really prints', () => {
    for (const lang of LANGS) {
      const note = DASHBOARD_STRINGS[lang].exportPartialNote;
      const banner = (EXPORT_STRINGS[lang] as unknown as { chainPartial: string }).chainPartial;
      const shouted = quoted(note).filter((q) => q === q.toUpperCase() && q.length > 6);
      expect(shouted.length, `${lang}: the note quotes the banner at all`).toBeGreaterThan(0);
      for (const q of shouted) {
        expect(
          banner,
          `${lang}: the note sends a reader looking for "${q}" and the export prints "${banner}"`,
        ).toContain(q);
      }
    }
  });

  it('the note quotes the word a report reads, as the report file prints it', () => {
    // A report states how many records it left out, under its signature, and reads the
    // selection banner. The check above only compares quotes in capitals, so this one
    // reads the mixed-case banner the note quotes, with its counts as N and M.
    for (const lang of LANGS) {
      const note = DASHBOARD_STRINGS[lang].exportPartialNote;
      const banner = (EXPORT_STRINGS[lang] as unknown as { chainVerifiedSelection: string }).chainVerifiedSelection;
      const word = banner.slice(banner.indexOf(': ') + 2).replace('{x}', 'N').replace('{y}', 'M');
      expect(quoted(note), `${lang}: the note quotes "${word}"`).toContain(word);
    }
  });

  it('every sentence that tells a reader to press the backup button uses its name', () => {
    // Three of the four tables quoted a name the button does not have. Two of
    // those were written earlier the same day, by the session that then found
    // them: a string added through a shell is a string nobody read on screen.
    for (const lang of LANGS) {
      const t = DASHBOARD_STRINGS[lang];
      const button = t.backupNowTitle;
      for (const key of ['backupNotSaved', 'backupCoverageFix'] as const) {
        const value = t[key];
        const text = typeof value === 'function' ? (value as (r: string) => string)('interrupted') : String(value);
        for (const q of quoted(text)) {
          // Only the quotations that look like a control, not a file name.
          if (q.includes('.') || q === q.toUpperCase()) continue;
          expect(button, `${lang}.${key} quotes "${q}"`).toContain(q);
        }
      }
    }
  });

  it('Portuguese calls a folded post the same thing on the page and in the record', () => {
    // `dobrar` is folding paper, and a page word that differs from the record's word cannot be matched
    // by a reader looking from one to the other. Both use `minimizar`.
    const line = MARKER_STRINGS['pt-BR'].foldedLine('teste');
    expect(line, 'the page line uses the page verb').toContain('minimiz');
    expect(line).not.toContain('dobrou');

    const action = (DASHBOARD_STRINGS['pt-BR'] as unknown as { feedDecisionAction: Record<string, string> }).feedDecisionAction;
    expect(action.collapse, 'and so does the record row').toBe('minimizado');
  });

  it('the scan-activity note quotes the two words the chart really prints', () => {
    // The note explains the chart by naming its two legend words. Found
    // 2026-09-19 in the same read as the four cases above, and left for a
    // second pass: Spanish quoted "Intervenido" where the legend says "con
    // intervención", and Spanish, Portuguese and Romanian each quoted one of
    // the two in a number or agreement the legend does not use.
    for (const lang of LANGS) {
      const t = DASHBOARD_STRINGS[lang] as unknown as {
        opsScanSub: string;
        opsActedWord: (pct: number) => string;
        opsDidntFinish: (n: string) => string;
      };
      // The legend prints the word followed by its number, so the quotation is
      // a prefix of the label rather than the whole of it.
      const legend = `${t.opsActedWord(0)} ${t.opsDidntFinish('0')}`.toLowerCase();
      const quotes = quoted(t.opsScanSub);
      expect(quotes.length, `${lang}: the note quotes the legend at all`).toBeGreaterThanOrEqual(2);
      for (const q of quotes) {
        expect(
          legend,
          `${lang}: the note sends a reader looking for "${q}" and the chart prints "${legend}"`,
        ).toContain(q.toLowerCase());
      }
    }
  });

  it('no language leaves the build label in English beside three that translated it', () => {
    // Portuguese printed "Build" where Spanish printed "Compilación" and
    // Romanian "Versiune". This panel is read by a parent sending a support
    // note, not by a developer.
    for (const lang of LANGS.filter((l) => l !== 'en')) {
      const line = (DASHBOARD_STRINGS[lang] as unknown as { opsBuildLine: (b: string, v: string) => string })
        .opsBuildLine('abc123', '');
      expect(line, `${lang} still says Build`).not.toMatch(/^Build /);
    }
  });

  it('Romanian does not leave one branch of a pair in English', () => {
    // ovSourceType translated the group branch and left the advertiser branch
    // as the English word, while the same table's filter chips call it
    // "Reclamă". One concept, two words, in one dashboard.
    const ro = DASHBOARD_STRINGS.ro as unknown as { ovSourceType: (t: string) => string };
    expect(ro.ovSourceType('advertiser')).not.toBe('advertiser');
    expect(ro.ovSourceType('group')).not.toBe('group');
  });
});
