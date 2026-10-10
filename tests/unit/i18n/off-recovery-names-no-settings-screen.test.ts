// B3 unit 5 (P9). Off's recovery-phrase warning said "no switch in Settings can be changed again", but
// Off has no Settings screen: its switches are on the popup itself. A warning that names a place the
// person cannot find is untrue. Receipts does have a Settings screen, so its warning keeps the word.

import { describe, expect, it } from 'vitest';

import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

// The word for the Settings screen in each language, in every form the two warnings use.
const SETTINGS_WORD: Record<string, RegExp> = {
  en: /\bSettings\b/,
  es: /\bAjustes\b/,
  'pt-BR': /\bConfigurações\b/,
  ro: /\bSetări\b/,
};

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('the Off recovery warning names no Settings screen, and still says every switch stays locked and how to get out', () => {
    expect(t.setupRecoveryBodyOff).not.toMatch(SETTINGS_WORD[lang]);
    expect(t.setupRecoveryBodyOff).toMatch(/\bOff\b/);
    expect(t.setupRecoveryBodyOff.length).toBeGreaterThan(200);
  });

  it('the Receipts warning keeps its Settings screen, since Receipts has one', () => {
    expect(t.setupRecoveryBody).toMatch(SETTINGS_WORD[lang]);
  });
});
