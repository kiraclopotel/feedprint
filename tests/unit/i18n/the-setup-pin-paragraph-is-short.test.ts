// V4 (board/units/V12.md, '08:43 lead: V4 ADDED'; WORDS.md row V4 as rewritten 08:42): the setup PIN paragraph at both levels is under the
// popup's 40 words (GROUND 1a rule 5). Today it is 58 words in en, 63 ro, 64 es, 67 pt-BR: the stranger's "Five sentences before choosing
// four digits" (M11W-3). Every claim that stays is the M11 behaviour: Settings ask the next time they are opened, fifteen minutes after
// the PIN is typed, and wiping the record always asks (leaving Strict asks again at Strict). The M11 test and the Strict pinned phrases
// are not edited here and are the guards: they keep passing by their own text.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

const MAX_WORDS = 40;
const words = (s: string): number => s.trim().split(/\s+/).length;

describe.each(UI_LANGUAGES)('V4: the setup PIN paragraph is short, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it(`Strict: at most ${MAX_WORDS} words`, () => {
    expect(words(t.setupPinBody)).toBeLessThanOrEqual(MAX_WORDS);
  });

  it(`Moderate: at most ${MAX_WORDS} words`, () => {
    expect(words(t.setupPinBodyModerate)).toBeLessThanOrEqual(MAX_WORDS);
  });

  it('what the paragraph drops is not left half there: no "4-digit", no shared-computer clause, no browser-close clause', () => {
    for (const body of [t.setupPinBody, t.setupPinBodyModerate]) {
      expect(body).not.toMatch(/4-digit|4 cifre|4 dígitos|shared computer|calculator folosit|equipo compartido|computador compartilhado|until the browser closes|se închide browserul|se cierre el navegador|até o navegador fechar/);
    }
  });

  it('no em dash', () => {
    expect(t.setupPinBody).not.toMatch(/—/);
    expect(t.setupPinBodyModerate).not.toMatch(/—/);
  });
});
