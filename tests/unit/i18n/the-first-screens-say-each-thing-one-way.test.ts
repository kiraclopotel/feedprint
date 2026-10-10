// Words a person meets first, kept from drifting back, in four languages:
// - a marked post carries no "beta" (the dashboard's rewrite pill keeps its own), and a rewrite still says the AI wrote it;
// - Off's switch group says what it holds, the Reels switch names both Reels and Shorts, and the language note names the
//   four languages the word filter covers instead of "all four";
// - the Brazilian Portuguese popup uses Brazilian forms, not European ones ("num", "isto", "As minhas"), outside the three
//   setup texts held as they are.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

function allStrings(table: object): string[] {
  return Object.values(table).filter((v): v is string => typeof v === 'string');
}

describe.each(LANGS)('%s: the marker', (lang) => {
  it('says "beta" nowhere', () => {
    for (const s of allStrings(MARKER_STRINGS[lang])) expect(s).not.toMatch(/beta/i);
  });

  it('still says a rewrite was written by the AI', () => {
    expect(MARKER_STRINGS[lang].greenAriaLabel).toMatch(/\b(AI|IA)\b/);
  });
});

describe.each(LANGS)('%s: Off and the switches', (lang) => {
  const t = POPUP_STRINGS[lang];
  it('the switch group names Off and what it does', () => {
    expect(t.offGroupSwitches).toContain('Off');
  });

  it('the Reels switch names Reels and Shorts, capitalised, and the coverage notes quote it as it is', () => {
    expect(t.featBlockReelsName).toMatch(/Reels/);
    expect(t.featBlockReelsName).toMatch(/Shorts/);
    expect(t.featBlockReelsName).not.toMatch(/\//);
  });

  it('the language note names the four languages', () => {
    for (const s of [t.uiLangDesc, t.uiLangDescOff]) {
      expect(s).not.toMatch(/all four|toate patru|los cuatro idiomas|os quatro idiomas/);
    }
  });
});

describe('pt-BR: Brazilian forms on the popup', () => {
  // Two setup texts stay as they are until the head's read (setup-words-leave-the-refused-text-alone.source.test.ts).
  const HELD = new Set(['setupWelcomeBody1', 'setupWhereSecretsNote']);
  it('no European forms outside the held setup texts', () => {
    const european = /\b(num|numa|isto|disto|nisto)\b|As minhas/i;
    const hits = Object.entries(POPUP_STRINGS['pt-BR'])
      .filter(([k, v]) => !HELD.has(k) && typeof v === 'string' && european.test(v))
      .map(([k]) => k);
    expect(hits).toEqual([]);
  });

  it('the record and the export quote the read button by its name', () => {
    // The popup's button is gone (9 Oct 2026); the record and the export still name it for readings already made.
    const name = 'Leia isso para mim';
    const files = ['src/i18n/dashboard/pt-br.ts', 'src/i18n/export-strings.ts'];
    for (const f of files) {
      const text = readFileSync(join(REPO_ROOT, f), 'utf8');
      expect(text, f).not.toContain('Leia isto para mim');
      expect(text, f).toContain(`botão ${name}`);
    }
  });
});
