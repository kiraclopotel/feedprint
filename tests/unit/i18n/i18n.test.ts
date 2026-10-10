// UI-language resolution + string-table integrity.
//
// Table completeness (every EN key present in RO) is enforced at compile
// time by the PopupStrings interface; the runtime checks here cover the
// resolver's branching and guard the tables against empty values.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { repoPath } from '../../helpers/repo-root';
import { resolveUiLanguage, intlLocaleFor, UI_LANGUAGES, UI_LANGUAGE_LABELS } from '../../../src/i18n';
import { MARKER_STRINGS, MARKER_TITLES, MARKER_REASONS } from '../../../src/i18n/marker-strings';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

// Source-read path, hoisted so a decomposition step re-points one line.
const DASHBOARD_SHELL = 'src/ui/dashboard/Dashboard.tsx';

describe('resolveUiLanguage', () => {
  it('honors an explicit language regardless of browser locale', () => {
    expect(resolveUiLanguage('ro', 'en-US')).toBe('ro');
    expect(resolveUiLanguage('en', 'ro-RO')).toBe('en');
    expect(resolveUiLanguage('es', 'en-US')).toBe('es');
    expect(resolveUiLanguage('pt-BR', 'en-US')).toBe('pt-BR');
  });

  it("'auto' follows the browser language", () => {
    expect(resolveUiLanguage('auto', 'ro')).toBe('ro');
    expect(resolveUiLanguage('auto', 'ro-RO')).toBe('ro');
    expect(resolveUiLanguage('auto', 'en-US')).toBe('en');
    expect(resolveUiLanguage('auto', 'fr-FR')).toBe('en');
  });

  // The store dashboard on 2026-09-04: Spanish 37% of weekly users, mostly
  // Peru, with no interface until this. Every regional Spanish tag resolves.
  it("'auto' resolves every Spanish region to es", () => {
    for (const tag of ['es', 'es-PE', 'es-ES', 'es-MX', 'es-419', 'ES-pe']) {
      expect(resolveUiLanguage('auto', tag), tag).toBe('es');
    }
  });

  // Portuguese is 11%, reported as Brazil. pt-PT resolves to the Brazilian
  // table on purpose: it is far closer to a European reader than English is.
  it("'auto' resolves every Portuguese region to pt-BR, pt-PT included", () => {
    for (const tag of ['pt', 'pt-BR', 'pt-PT', 'PT-br']) {
      expect(resolveUiLanguage('auto', tag), tag).toBe('pt-BR');
    }
  });

  it('treats undefined / unknown prefs as auto', () => {
    expect(resolveUiLanguage(undefined, 'ro-RO')).toBe('ro');
    expect(resolveUiLanguage('garbage', 'ro-RO')).toBe('ro');
    expect(resolveUiLanguage(undefined, 'de-DE')).toBe('en');
    expect(resolveUiLanguage(undefined, 'hi-IN')).toBe('en');
  });

  it('matches on the subtag boundary, never a bare prefix', () => {
    expect(resolveUiLanguage('auto', 'ru-RU')).toBe('en');
    // 'esk' and 'ptx' are not Spanish or Portuguese; a bare startsWith would
    // claim them.
    expect(resolveUiLanguage('auto', 'esk')).toBe('en');
    expect(resolveUiLanguage('auto', 'ptx-XX')).toBe('en');
  });
});

describe('intlLocaleFor', () => {
  it('gives every shipped language its own formatting tag', () => {
    expect(intlLocaleFor('en')).toBe('en-US');
    expect(intlLocaleFor('ro')).toBe('ro-RO');
    expect(intlLocaleFor('es')).toBe('es-ES');
    expect(intlLocaleFor('pt-BR')).toBe('pt-BR');
  });

  it('every roster language has a label and a distinct Intl tag', () => {
    const tags = UI_LANGUAGES.map(intlLocaleFor);
    expect(new Set(tags).size).toBe(UI_LANGUAGES.length);
    for (const code of UI_LANGUAGES) {
      expect(UI_LANGUAGE_LABELS[code], code).toBeTruthy();
    }
  });
});

describe('string tables', () => {
  it('every shipped language has a popup, dashboard and marker table', () => {
    for (const lang of UI_LANGUAGES) {
      expect(POPUP_STRINGS[lang], `POPUP_STRINGS.${lang}`).toBeTypeOf('object');
      expect(DASHBOARD_STRINGS[lang], `DASHBOARD_STRINGS.${lang}`).toBeTypeOf('object');
      expect(MARKER_STRINGS[lang], `MARKER_STRINGS.${lang}`).toBeTypeOf('object');
      expect(MARKER_TITLES[lang], `MARKER_TITLES.${lang}`).toBeTypeOf('object');
      expect(MARKER_REASONS[lang], `MARKER_REASONS.${lang}`).toBeTypeOf('object');
    }
  });

  it('every language exposes the same key set as en', () => {
    const popupEn = Object.keys(POPUP_STRINGS.en).sort();
    const dashEn = Object.keys(DASHBOARD_STRINGS.en).sort();
    const markerEn = Object.keys(MARKER_STRINGS.en).sort();
    for (const lang of UI_LANGUAGES) {
      expect(Object.keys(POPUP_STRINGS[lang]).sort(), `popup.${lang}`).toEqual(popupEn);
      expect(Object.keys(DASHBOARD_STRINGS[lang]).sort(), `dashboard.${lang}`).toEqual(dashEn);
      expect(Object.keys(MARKER_STRINGS[lang]).sort(), `marker.${lang}`).toEqual(markerEn);
    }
  });

  it('no table entry is an empty string', () => {
    for (const lang of UI_LANGUAGES) {
      for (const [key, value] of Object.entries(POPUP_STRINGS[lang])) {
        if (typeof value === 'string') {
          expect(value.length, `popup ${lang}.${key}`).toBeGreaterThan(0);
        }
      }
      for (const [key, value] of Object.entries(MARKER_STRINGS[lang])) {
        if (typeof value === 'string') {
          expect(value.length, `marker ${lang}.${key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('parameterized strings interpolate their arguments in every language', () => {
    for (const lang of UI_LANGUAGES) {
      expect(POPUP_STRINGS[lang].metaUsage(5, 100, 5), lang).toContain('5');
      expect(POPUP_STRINGS[lang].breakName('TikTok'), lang).toContain('TikTok');
      expect(POPUP_STRINGS[lang].removeHashtagAria('ai'), lang).toContain('#ai');
      expect(MARKER_STRINGS[lang].hidLine('x'), lang).toContain('x');
      expect(DASHBOARD_STRINGS[lang].drillCount(3), lang).toContain('3');
    }
  });

  // Each table formats its own numbers, so a Spanish popup groups thousands
  // the Spanish way even inside an English browser. Five digits, not four:
  // es-ES leaves a bare four-digit number ungrouped, which is correct and
  // would make a 1500-based assertion test nothing.
  it('number-bearing strings format under their own locale', () => {
    expect(POPUP_STRINGS.en.metaUsage(15000, 90000, 17)).toContain('15,000');
    expect(POPUP_STRINGS.es.metaUsage(15000, 90000, 17)).toContain('15.000');
    expect(POPUP_STRINGS['pt-BR'].metaUsage(15000, 90000, 17)).toContain('15.000');
  });
});

// Source scan (same pattern as public-copy-claims.test.ts): the dashboard's
// feedback-error dismiss button must resolve its aria-label through the
// DASHBOARD_STRINGS table, not a hardcoded English literal (I18N-7).
describe('Dashboard aria-labels route through the string table', () => {
  const dashboardSource = readFileSync(repoPath(...DASHBOARD_SHELL.split(String.fromCharCode(47))), 'utf8');

  it('has no hardcoded aria-label="Dismiss"', () => {
    expect(dashboardSource).not.toContain('aria-label="Dismiss"');
    expect(dashboardSource).toContain('aria-label={t.hdrDismissAria}');
  });

  it('translates the dismiss aria-label in every language', () => {
    expect(DASHBOARD_STRINGS.en.hdrDismissAria).toBe('Dismiss');
    expect(DASHBOARD_STRINGS.ro.hdrDismissAria).toBe('Închide');
    expect(DASHBOARD_STRINGS.es.hdrDismissAria).toBe('Cerrar');
    expect(DASHBOARD_STRINGS['pt-BR'].hdrDismissAria).toBe('Fechar');
  });
});
