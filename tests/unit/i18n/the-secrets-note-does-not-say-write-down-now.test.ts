// B2 unit 6 (P10; rows B9, R5). The last setup screen ends its note about where the PIN and the recovery
// phrase are kept with "Write the phrase down now: it is never shown again...". By then the phrase is two
// screens behind, so the sentence tells someone to write down what is no longer on screen; the phrase screen
// already says it. That one sentence goes, in four languages. Every other sentence of the note stays word for
// word (it is what the person reads about where things are kept and what is sent).

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

const GONE = {
  en: /Write the phrase down now/,
  es: /Anota la frase ahora/,
  'pt-BR': /Anote a frase agora/,
  ro: /Notează fraza acum/,
} as const;

// The note is the one key on the phrase step; its licence half left setup with the licence step.
describe.each(UI_LANGUAGES)('the secrets note, %s', (lang) => {
  const s = POPUP_STRINGS[lang].setupWhereSecretsNote;

  it('no longer tells the person to write the phrase down now', () => {
    expect(s).not.toMatch(GONE[lang]);
    expect(s).not.toMatch(/never shown again|no se vuelve a mostrar|nunca mais aparece|nu mai este afișată/);
  });
});
