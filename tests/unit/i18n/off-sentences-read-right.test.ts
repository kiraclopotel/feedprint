// B3 unit 6 (P12, rows O3 and O9). Two Off sentences read wrong:
// O3: "Your rules hid 0 posts, slurs hid 0." The second number is posts too: word-filter.ts hides the whole
//     post container and tallies it under 'slurs', one per post, apart from the user's own rules (critic 1,
//     30 Sep 05:5x). So it is two counts of posts, said as two short sentences that both say "posts".
//     "Slurs hidden: 3" would read as three slurs, and a post with three slurs counts once.
// O9: "A pause switch that is on still closes its site at any hour." Nothing on screen is called a pause
//     switch (the switches say "Put X on break"), and "A day here is the night that starts on it" leaves
//     the hours after midnight unexplained.

import { describe, expect, it } from 'vitest';

import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

type Lang = (typeof UI_LANGUAGES)[number];

const RULES_FIRED: Partial<Record<Lang, string>> = {
  en: 'Your rules hid 2 posts or comments. Posts or comments hidden for slurs: 1.',
  es: 'Tus reglas ocultaron 2 publicaciones o comentarios. Publicaciones o comentarios ocultos por insultos discriminatorios: 1.',
  'pt-BR': 'As suas regras ocultaram 2 publicações ou comentários. Publicações ou comentários ocultos por ofensas discriminatórias: 1.',
};

const OLD_SWITCH_NAME: Record<Lang, RegExp> = {
  en: /pause switch/i,
  es: /interruptor de pausa/i,
  'pt-BR': /botão de pausa/i,
  ro: /buton de pauză/i,
};

// What the switches themselves are called on screen (breakName), so the hint uses the same words.
const ON_BREAK: Record<Lang, string> = {
  en: 'on break',
  es: 'en pausa',
  'pt-BR': 'em pausa',
  ro: 'pe pauză',
};

const PAST_MIDNIGHT: Record<Lang, string> = {
  en: 'past midnight',
  es: 'medianoche',
  'pt-BR': 'meia-noite',
  ro: 'miezul nopții',
};

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('O3: the rules line gives the two counts as two short sentences', () => {
    const line = t.offRulesFired(2, 1);
    const expected = RULES_FIRED[lang];
    if (expected) expect(line).toBe(expected);
    // Every language, ro included (unchanged, it already said posts): two sentences that both count posts.
    expect(line).toMatch(lang === 'en' ? /posts/i : lang === 'ro' ? /postări/i : /publica/i);
    expect(line.split(/(?<=\.)\s+/).length).toBe(2);
    expect(line).not.toMatch(/—/);
    expect(line).toMatch(/2/);
    expect(line).toMatch(/1/);
  });

  it('O9: the quiet-hours hint names the switch as the screen does, and the overnight note says what runs past midnight', () => {
    expect(t.quietEditHint).not.toMatch(OLD_SWITCH_NAME[lang]);
    expect(t.quietEditHint).toContain(ON_BREAK[lang]);
    expect(t.quietEditOvernightNote).toContain(PAST_MIDNIGHT[lang]);
    expect(t.quietEditHint + t.quietEditOvernightNote).not.toMatch(/—/);
  });
});
