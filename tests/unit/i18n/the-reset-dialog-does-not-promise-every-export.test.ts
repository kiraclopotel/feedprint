// The reset dialog said the entries it moves into the monthly archives are carried by "every
// export". They are not. Only the export of the whole record (exporter.ts, exportEverythingHtml)
// and the backups the person saves themselves (backup.ts, buildBackupBlob with its history
// switched on) read the archives. The report, PDF, JSON and CSV take the active chain, and the
// automatic daily copy is written active-chain-only (buildBackupBlob(undefined, false)), so after
// a reset all of those cover only the new record. The reset also empties the theme labels
// (theme-cache.ts, clearThemeCache), which the sentence listing what is cleared left out.
// The words must say each of those things, in all four languages.

import { describe, it, expect } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

type Lang = (typeof UI_LANGUAGES)[number];

/** The promise the old text made, in the words each language used for it. */
const PROMISES_EVERY_EXPORT: Record<string, string[]> = {
  en: ['every export'],
  es: ['cada exportación'],
  'pt-BR': ['cada exportação'],
  ro: ['fiecare export'],
};

/** What names the export that does carry the archives. */
const NAMES_THE_WHOLE_RECORD_EXPORT: Record<string, string[]> = {
  en: ['export of the whole record'],
  es: ['exportación del registro completo'],
  'pt-BR': ['exportação do registro completo'],
  ro: ['exportul întregului registru'],
};

/** What names the theme labels among the things cleared. */
const NAMES_THE_THEME_LABELS: Record<string, string[]> = {
  en: ['theme labels'],
  es: ['etiquetas de temas'],
  'pt-BR': ['rótulos dos temas'],
  ro: ['etichetele de teme'],
};

const body2 = (lang: Lang): string => DASHBOARD_STRINGS[lang].resetBody2.toLowerCase();

describe('the reset dialog does not promise every export', () => {
  it('has a word list for every interface language', () => {
    for (const lang of UI_LANGUAGES) {
      expect(PROMISES_EVERY_EXPORT[lang], `${lang} promise list`).toBeDefined();
      expect(NAMES_THE_WHOLE_RECORD_EXPORT[lang], `${lang} whole-record list`).toBeDefined();
      expect(NAMES_THE_THEME_LABELS[lang], `${lang} theme-label list`).toBeDefined();
    }
  });

  it('does not say the archives are in every export', () => {
    for (const lang of UI_LANGUAGES) {
      for (const phrase of PROMISES_EVERY_EXPORT[lang]) {
        expect(body2(lang).includes(phrase), `${lang}: resetBody2 says "${phrase}"`).toBe(false);
      }
    }
  });

  it('names the export of the whole record as the one that carries them', () => {
    for (const lang of UI_LANGUAGES) {
      const named = NAMES_THE_WHOLE_RECORD_EXPORT[lang].some((p) => body2(lang).includes(p));
      expect(named, `${lang}: resetBody2 names the whole-record export`).toBe(true);
    }
  });

  it('names the theme labels among the things the reset clears', () => {
    for (const lang of UI_LANGUAGES) {
      const named = NAMES_THE_THEME_LABELS[lang].some((p) => body2(lang).includes(p));
      expect(named, `${lang}: resetBody2 names the theme labels`).toBe(true);
    }
  });
});
