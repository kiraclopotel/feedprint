// W2b. Two Off PIN notes that did not say what Off does.
// 1. offPinLockedNote said "Settings ask for it", but Off has no Settings screen: it asks for the PIN when the popup
//    opens. Receipts does have a Settings screen, so its own note (pinLockedNote, the old words) keeps the phrase.
// 1b. The note names the 15 minutes (the PIN grace), or it would be false while the PIN was just typed.
// 2. P2-5: after a successful PIN reset the person needs a word that it worked ("PIN changed."), in every language.

import { describe, expect, it } from 'vitest';

import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

type Lang = (typeof UI_LANGUAGES)[number];

const SETTINGS_WORD: Record<Lang, RegExp> = {
  en: /\bSettings\b/,
  es: /\bajustes\b/i,
  'pt-BR': /\bconfigurações\b/i,
  ro: /\bSetările\b|\bSetări\b/,
};

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('the Off PIN note names no Settings screen and says Off asks for the PIN', () => {
    expect(t.offPinLockedNote).not.toMatch(SETTINGS_WORD[lang]);
    expect(t.offPinLockedNote).toMatch(/\bOff\b/);
    expect(t.offPinLockedNote).not.toMatch(/—/);
  });

  // Critic 1 HOLD (W2b-CRITIC.md item 1): for 15 minutes after a PIN is set or typed (PIN_GRACE_MS in settings.ts, not
  // exported) Off opens without asking, and that is when the note is read. So the note must say the 15 minutes.
  it('the Off PIN note names the 15 minutes the grace lasts', () => {
    expect(t.offPinLockedNote).toMatch(/\b15\b/);
  });

  it('Receipts keeps its own note, which does name its Settings screen', () => {
    expect(t.pinLockedNote).toMatch(SETTINGS_WORD[lang]);
    expect(t.pinLockedNote).not.toMatch(/\bOff\b/);
  });

  it('there is a line that says the PIN was changed', () => {
    expect(t.pinChanged.length).toBeGreaterThan(5);
    expect(t.pinChanged).toMatch(/PIN/);
    expect(t.pinChanged).not.toMatch(/—/);
  });
});
