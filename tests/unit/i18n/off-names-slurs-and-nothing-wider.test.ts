// F60 (O3). Off hides slurs and nothing wider (word-filter.ts:9), and a promise that says "insults" or "swear words" in
// the same breath as "always hidden" is a claim a person can test in a minute and find untrue. In ro, es and pt-BR the six
// places that name what Off always hides now name slurs only, with one word per language; and the count line says what the
// code counts: posts or comments (word-filter.ts:9 and :214), as Receipts' own rulesHit does.

import { describe, expect, it } from 'vitest';

import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { MARKER_REASONS } from '../../../src/i18n/marker-strings';

type Lang = 'ro' | 'es' | 'pt-BR';

// The slurs word of each language (the voice's, F60 card, 1 Oct 15:43), as the sentences use it (with or without the article).
const SLURS: Record<Lang, RegExp> = {
  ro: /insulte(le)? discriminatorii/i,
  es: /insultos discriminatorios/i,
  'pt-BR': /ofensas discriminatórias/i,
};
// What the old words promised: any insult, or any swear word.
const WIDER: Record<Lang, RegExp> = {
  ro: /cuvint(e|ele) jignitoare/i,
  es: /insultos(?! discriminatorios)/i,
  'pt-BR': /xingamentos/i,
};

const LANGS: Lang[] = ['ro', 'es', 'pt-BR'];

// The six places: the "what is hidden" name, the swearing switch's description, its two notes, the count line, the reason line.
function sixPlaces(lang: Lang): Array<[string, string]> {
  const t = POPUP_STRINGS[lang];
  return [
    ['offWhat.slurs', t.offWhat.slurs],
    ['offNoSwearingDesc', t.offNoSwearingDesc],
    ['offSlursNote', t.offSlursNote],
    ['offSlursNoteOn', t.offSlursNoteOn],
    ['offRulesFired', t.offRulesFired(3, 2)],
    ['combined-stack reason', MARKER_REASONS[lang]['combined-stack']],
  ];
}

describe.each(LANGS)('Off names slurs and nothing wider, %s', (lang) => {
  it.each(sixPlaces(lang))('%s says slurs, with the language\'s one word', (_key, text) => {
    expect(text).toMatch(SLURS[lang]);
  });

  it.each(sixPlaces(lang))('%s promises nothing wider than slurs', (_key, text) => {
    expect(text).not.toMatch(WIDER[lang]);
  });
});

describe('the count line says what the code counts: posts or comments', () => {
  it.each(['en', 'ro', 'es', 'pt-BR'] as const)('%s', (lang) => {
    const line = POPUP_STRINGS[lang].offRulesFired(2, 1);
    expect(line).toMatch(/comment|coment[aá]ri/i);
    // Both sentences name comments: the first (how many hid) and the second (how many for slurs).
    expect(line.match(/comment|coment[aá]ri/gi)?.length).toBe(2);
  });
});
