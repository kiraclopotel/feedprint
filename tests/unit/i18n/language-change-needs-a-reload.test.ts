// Wiring audit 13 Sep, P14: the language setting tells the parent that pages
// already open need a reload to switch, in every interface language.
import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

describe('language setting note', () => {
  it('names the reload in all four languages', () => {
    const words: Record<string, RegExp> = { en: /reload/, ro: /reîncărcare/, es: /recargar/, 'pt-BR': /recarregar/ };
    for (const [lang, re] of Object.entries(words)) {
      expect((POPUP_STRINGS as unknown as Record<string, { uiLangDesc: string }>)[lang].uiLangDesc, lang).toMatch(re);
    }
  });
});
