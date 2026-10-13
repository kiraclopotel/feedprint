// B2 unit 5 (P2, widened by WALK-2; rows B2, L6, L7, L8). The welcome screen said, before any level was chosen,
// that a fingerprint of the record goes to independent time-stamp services. At Strict nothing leaves the
// computer (makesNoOutsideCall), so the sentence was false for the level the screen sells hardest. It now
// says at which levels that happens, and that Strict sends nothing. In Spanish, Portuguese and Romanian the
// word for "fingerprint" (huella / impressão / amprentă) read first as a finger's print: it now says a code
// that identifies the record. Spanish greets in the form that is right for anyone and says "rechazar".

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

describe.each(UI_LANGUAGES)('the welcome screen, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('makes no unconditional time-stamp claim: the same sentence says Silent without a key sends nothing at all, and the next says the rephrasing needs a key', () => {
    const body = t.setupWelcomeBody1;
    expect(body).toContain(t.modeChild);
    const stamp = body.search(/time-stamp|sellado de tiempo|carimbo de tempo|marcare a timpului/);
    const silent = body.indexOf(t.modeChild);
    expect(stamp).toBeGreaterThan(-1);
    // The qualifier is in the claim's own sentence, after the semicolon, with no full stop between them.
    expect(silent).toBeGreaterThan(stamp);
    expect(body.slice(stamp, silent)).not.toMatch(/\.\s/);
    expect(body.slice(stamp, silent)).toContain(';');
    expect(body).toContain('Live Rephrase');
  });

  it('has no em dash', () => {
    for (const s of [t.setupWelcomeTitle, t.setupWelcomeBody1, t.setupWelcomeBody2]) expect(s).not.toContain('—');
  });
});

describe('Spanish, Portuguese and Romanian no longer say "fingerprint" in the welcome', () => {
  it.each([
    ['es', /huella/i, 'un código que identifica el registro'],
    ['pt-BR', /impress[ãa]o digital/i, 'um código que identifica o registro'],
    ['ro', /amprent/i, 'un cod care identifică registrul'],
  ] as const)('%s', (lang, banned, phrase) => {
    expect(POPUP_STRINGS[lang].setupWelcomeBody1).not.toMatch(banned);
    expect(POPUP_STRINGS[lang].setupWelcomeBody1).toContain(phrase);
  });
  it('ro names the services with the site\'s word, "marcare a timpului"', () => {
    expect(POPUP_STRINGS.ro.setupWelcomeBody1).toContain('servicii independente de marcare a timpului');
    expect(POPUP_STRINGS.ro.setupWelcomeBody1).not.toContain('marcare temporală');
  });
});

describe('the Spanish welcome', () => {
  it('greets with "Te damos la bienvenida" and asks to "confirmar o rechazar"', () => {
    expect(POPUP_STRINGS.es.setupWelcomeTitle).toBe('Te damos la bienvenida');
    expect(POPUP_STRINGS.es.setupWelcomeBody2).toContain('confirmar o rechazar');
    expect(POPUP_STRINGS.es.setupWelcomeBody2).not.toContain('discutir');
  });
});

describe('English keeps what is true and says who it is true for', () => {
  it('reads exactly', () => {
    expect(POPUP_STRINGS.en.setupWelcomeBody1).toBe(
      'Feedprint writes down posts, flagged items, hidden ads, and comments caught by rules and keeps that record on this computer. Only a fingerprint of it, with no post text, goes to independent time-stamp services so the record can be dated; Silent without a key sends nothing at all. The rephrasing the levels describe needs a key for Live Rephrase; without one, every level filters on this computer. You can export it as a file anyone can check.',
    );
  });
});
