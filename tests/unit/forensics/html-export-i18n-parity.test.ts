// M19 — the standalone-verifier export's I18N table must carry the SAME keys
// in every locale. A missing key would render literal 'undefined' inside a
// court-facing forensic export. The ExportI18nStrings interface guards this at
// compile time; this test guards the runtime table and would fail the moment a
// key is dropped from any locale. The locale list is read from the shipped
// interface-language roster, so adding a language adds it here too.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { I18N } from '../../../src/forensics/html-export';
import { UI_LANGUAGES } from '../../../src/i18n';
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


const HTML_EXPORT_PATH = 'src/forensics/html-export.ts';

describe('html-export I18N key parity', () => {
  it('carries a table for every language the interface offers', () => {
    for (const locale of UI_LANGUAGES) {
      expect(I18N[locale], `I18N missing "${locale}"`).toBeTypeOf('object');
    }
  });

  it('every locale exposes exactly the same keys as en', () => {
    const en = Object.keys(I18N.en).sort();
    for (const locale of UI_LANGUAGES) {
      expect(Object.keys(I18N[locale]).sort(), `I18N.${locale}`).toEqual(en);
    }
  });

  it('no locale value is empty or undefined', () => {
    for (const locale of UI_LANGUAGES) {
      for (const [key, value] of Object.entries(I18N[locale])) {
        expect(typeof value, `${locale}.${key}`).toBe('string');
        expect((value as string).length, `${locale}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('fails when a key is dropped from a locale (drift guard)', () => {
    // Simulate the regression: a locale missing one of en's keys.
    const enKeys = Object.keys(I18N.en);
    const truncatedRo = { ...I18N.ro };
    delete (truncatedRo as Record<string, string>)[enKeys[0]];
    expect(Object.keys(truncatedRo).sort()).not.toEqual(enKeys.slice().sort());
  });
});

// Q60 (W57) — the inline ROOM locale table inside the exported runtime
// script is OUTSIDE the typed I18N, so its parity and RO diacritics need a
// source-level lock (a dropped RO key renders literal 'undefined' in a
// court-facing document; ASCII-folded RO stood out against the rest of the
// export table).
describe('html-export inline ROOM table (source-lock)', () => {
  const source = exportSource();
  const roomMatch = source.match(/var ROOM=\{([\s\S]*?)\};\n/);
  // Each half is `<locale>:{ ... }`; the locale key is bare or quoted ('pt-BR').
  const halves = (): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const m of roomMatch![1].matchAll(/'?([a-zA-Z-]+)'?:\{([^}]*)\}/g)) out[m[1]] = m[2];
    return out;
  };

  it('carries a half for every language the interface offers', () => {
    expect(roomMatch).not.toBeNull();
    const found = Object.keys(halves()).sort();
    expect(found).toEqual([...UI_LANGUAGES].sort());
  });

  it('every half carries exactly the same keys as en', () => {
    const h = halves();
    const keysOf = (half: string): string[] =>
      [...half.matchAll(/'([a-z-]+)':/g)].map((m) => m[1]).sort();
    const en = keysOf(h.en);
    for (const locale of UI_LANGUAGES) {
      expect(keysOf(h[locale]), `ROOM.${locale}`).toEqual(en);
    }
  });

  it('accented values keep their diacritics (no ASCII folding)', () => {
    const h = halves();
    expect(h.ro).toContain('mulțime ostilă');
    expect(h.ro).toContain('discuție sănătoasă');
    expect(h.ro).not.toContain('multime');
    expect(h.ro).not.toContain('sanatoasa');
    expect(h.es).toContain('cámara de eco');
    expect(h['pt-BR']).toContain('multidão hostil');
  });
});
