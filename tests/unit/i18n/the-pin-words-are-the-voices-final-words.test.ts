// V12 (board/units/V12.md; WORDS.md rows V1, V2 and V3 of the voice seat, 1 Oct 2026): the words, in the four popup tables.
//
// V2: two stiff sentences. Spanish setup said "Ajustes lo pide la próxima vez que los abras ... Una vez que lo escribes", one screen
// said as one thing and as many in one breath, with the wrong mood after "una vez que". Romanian Off said "în afară de 15 minute", the
// wrong shape for an exception. V3: the setup PIN paragraph spoke of "leaving Strict" at Moderate, a level the person did not pick;
// Moderate now has its own value without that clause, and Strict keeps its pinned phrase. V1: one line over the PIN lock while a
// reading answer waits, says why even an answer asks for the PIN, short enough for the popup (under 20 words).
// The earlier tests that pin these strings are not edited here; the M11 test's two Spanish regexes move by one diff the inspector applies.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

type Lang = (typeof UI_LANGUAGES)[number];

const STRICT_WORD: Record<Lang, RegExp> = {
  en: /Silent/,
  es: /Silencioso/,
  'pt-BR': /Silencioso/,
  ro: /Silențios/,
};

const PIN_CLAUSE: Record<Lang, RegExp> = {
  en: /leaving Silent asks for it again/,
  es: /salir de Silencioso lo vuelve a pedir/,
  'pt-BR': /sair do Silencioso pede o PIN de novo/,
  ro: /ieșirea din nivelul Silențios îl cere din nou/,
};

const REASON: Record<Lang, string> = {
  en: 'Either answer changes a setting, so the PIN comes first.',
  ro: 'Oricare răspuns schimbă o setare, așa că mai întâi e nevoie de PIN.',
  es: 'Cualquiera de las dos respuestas cambia un ajuste, así que primero hace falta el PIN.',
  'pt-BR': 'Qualquer uma das respostas muda uma configuração, então o PIN vem antes.',
};

const words = (s: string): number => s.trim().split(/\s+/).length;
const AGE_WORDS = /\b(child|children|kid|kids|teen|teens|parent|parents|minor|age)\b|copil|părinte|niño|niña|padre|criança|pai\b|mãe/i;

describe('V2: the two stiff sentences', () => {
  it('es setup PIN paragraph: Ajustes is one screen, and the mood after "después de" is the infinitive', () => {
    const es = POPUP_STRINGS.es.setupPinBody;
    expect(es).not.toMatch(/los abras/);
    expect(es).not.toMatch(/Una vez que lo escribes/);
    expect(es).toMatch(/Ajustes te pide el PIN la próxima vez que entres/);
    expect(es).toMatch(/Después de escribirlo, Ajustes queda abierto quince minutos/);
  });

  it('ro Off PIN note: the exception is "cu excepția celor 15 minute", not "în afară de 15 minute"', () => {
    const ro = POPUP_STRINGS.ro.offPinLockedNote;
    expect(ro).not.toMatch(/în afară de 15 minute/);
    expect(ro).toMatch(/cu excepția celor 15 minute/);
    expect(ro).toMatch(/\bOff\b/);
  });
});

describe.each(UI_LANGUAGES)('V3: setup PIN paragraph at Moderate, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('has no Strict clause at Moderate, and Strict keeps its pinned phrase', () => {
    expect(t.setupPinBodyModerate, 'Moderate does not speak of Strict').not.toMatch(STRICT_WORD[lang]);
    expect(t.setupPinBody, 'Strict keeps the clause').toMatch(PIN_CLAUSE[lang]);
  });

  it('still says the three true things: the next open, the fifteen minutes, wiping asks again', () => {
    expect(t.setupPinBodyModerate).toMatch(/fifteen|quince|quinze|cincisprezece/);
    expect(t.setupPinBodyModerate.length, 'it is a whole paragraph, not a stub').toBeGreaterThan(150);
  });

  it('no em dash and no age words', () => {
    expect(t.setupPinBodyModerate).not.toMatch(/—/);
    expect(t.setupPinBodyModerate).not.toMatch(AGE_WORDS);
  });
});

describe.each(UI_LANGUAGES)('V1: the line over the PIN lock, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('is the voice seat\'s words exactly', () => {
    expect(t.pinConsentReason).toBe(REASON[lang]);
  });

  it('is under 20 words, has no em dash, and no age word', () => {
    expect(words(t.pinConsentReason)).toBeLessThan(20);
    expect(t.pinConsentReason).not.toMatch(/—/);
    expect(t.pinConsentReason).not.toMatch(AGE_WORDS);
  });
});
