// The popup's rules description, the line always shown and the detail behind its info button, shows
// what a blocked word catches besides itself with two examples, and each one is run through the
// matcher the feed uses. A limit the text promises and the matcher does not keep hides posts the
// parent was told would stay.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { matchParentBlocklist, readParentBlocklist } from '../../../src/core/parent-blocklist';

const LANGS = ['en', 'es', 'pt-BR', 'ro'] as const;

// The run-together word each language names as caught, and the longer word it names as left alone.
const EXAMPLES: Record<(typeof LANGS)[number], { caught: [string, string]; spared: [string, string] }> = {
  en: { caught: ['book', 'Facebook'], spared: ['diet', 'dietary'] },
  es: { caught: ['book', 'Facebook'], spared: ['dieta', 'dietético'] },
  'pt-BR': { caught: ['book', 'Facebook'], spared: ['dieta', 'dietético'] },
  ro: { caught: ['book', 'Facebook'], spared: ['dieta', 'dietetic'] },
};

// How each language says an ending is caught only on a longer word: a parent who blocks "gun" still
// sees "guns", so a sentence that promises every word its endings hides nothing they expected.
const FOUR_LETTERS: Record<(typeof LANGS)[number], RegExp> = {
  en: /four letters or more/,
  es: /cuatro letras o más/,
  'pt-BR': /quatro letras ou mais/,
  ro: /patru litere/,
};

function hides(word: string, text: string): boolean {
  return matchParentBlocklist(readParentBlocklist({ words: [word], phrases: [], accounts: [] }), text) !== null;
}

/** The word in any of the quote marks the four tables use. */
function quotes(text: string, word: string): boolean {
  return new RegExp(`["'“„]${word}["'”]`).test(text);
}

describe("the popup's rules description", () => {
  it.each(LANGS)('%s names a run-together word the matcher catches and a longer word it leaves alone', lang => {
    const text = POPUP_STRINGS[lang].rulesMore;
    const { caught: [blocked, joined], spared: [plain, longer] } = EXAMPLES[lang];
    for (const word of [blocked, joined, plain, longer]) expect(quotes(text, word), word).toBe(true);
    expect(hides(blocked, `I saw it on ${joined} today`)).toBe(true);
    expect(hides(plain, `some ${longer} advice`)).toBe(false);
  });

  it.each(LANGS)('%s does not say a word never catches the middle of another', lang => {
    expect(`${POPUP_STRINGS[lang].rulesDesc} ${POPUP_STRINGS[lang].rulesMore}`).not.toMatch(/never the middle|nunca el medio|nunca o meio|niciodată mijlocul/i);
  });

  it.each(LANGS)('%s says only a word of four letters or more catches its endings', lang => {
    const sentences = `${POPUP_STRINGS[lang].rulesDesc} ${POPUP_STRINGS[lang].rulesMore}`.split(/(?<=\.)\s+/);
    const endings = sentences.filter(s => /endings|terminaciones|terminações|terminațiile/.test(s));
    expect(endings).toHaveLength(1);
    expect(endings[0]).toMatch(FOUR_LETTERS[lang]);
  });

  it('the matcher gives an ending only to a word of four letters or more', () => {
    expect(hides('gun', 'more guns today')).toBe(false);
    expect(hides('vot', 'votul de azi')).toBe(false);
    expect(hides('diet', 'new diets today')).toBe(true);
    expect(hides('film', 'filmul de azi')).toBe(true);
  });
});
