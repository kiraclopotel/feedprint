// W2 (PAINT-3 P3-4, P3-6; the stranger's A2 and A4). Four small sentences that pointed at the wrong thing:
// P3-4: Strict language's note said "the switch below stays locked", but the switch below is Mask swearing
//       (the row that is locked at Strict); it now names it.
// P3-6: the Spanish AI-off card said "funcionan sin ella", and its title, "Análisis con IA", is masculine.
// A2:   the Brazilian welcome said "Bem-vindo", which addresses one gender; "Boas-vindas" addresses everyone.
// A4:   the level row said "any toggle above can override", but the switches are below it.
// P6-1: the Spanish Off count line said "insultos" (any insult); Off hides the discriminatory ones, as the six other lines say.

import { describe, expect, it } from 'vitest';

import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

type Lang = (typeof UI_LANGUAGES)[number];

const SWITCH_BELOW: Record<Lang, RegExp> = {
  en: /switch below/i,
  es: /interruptor de abajo/i,
  'pt-BR': /interruptor abaixo/i,
  ro: /comutatorul de mai jos/i,
};

const ABOVE: Record<Lang, RegExp> = {
  en: /\babove\b/i,
  es: /de arriba/i,
  'pt-BR': /\bacima\b/i,
  ro: /de mai sus/i,
};

// The promise has an exception, since at Strict some switches below are locked or greyed (critic HOLD, W2).
const EXCEPTION: Record<Lang, string> = {
  en: 'not locked or greyed out',
  es: 'que no esté bloqueado ni en gris',
  'pt-BR': 'que não esteja travado nem cinza',
  ro: 'care nu este blocat sau gri',
};

const BELOW: Record<Lang, string> = {
  en: 'below',
  es: 'de abajo',
  'pt-BR': 'abaixo',
  ro: 'de mai jos',
};

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  // P3-4's note left with its switch on 11 Oct 2026: one switch for swearing (one-switch-for-swearing.test.tsx).
  it('P3-4: the Strict language note is gone with its switch, and the mask\'s own note points at nothing below', () => {
    expect((t as unknown as Record<string, unknown>).strictLangDescChild).toBeUndefined();
    expect(t.softenSwearingDescChild).not.toMatch(SWITCH_BELOW[lang]);
    expect(t.softenSwearingDescChild).not.toMatch(/—/);
  });

  // A4's level row line ("Change any switch below ...") left Settings on 8 Oct 2026, so it has nothing to point at.
  it('A4: the level row has no line of its own any more', () => {
    expect((t as unknown as Record<string, unknown>).modeRowDesc).toBeUndefined();
  });
});

describe('single-language words', () => {
  // P3-6's sentence (the Spanish AI-off card body) left Home on 8 Oct 2026.
  it('P3-6: the AI-off card has only its title', () => {
    expect((POPUP_STRINGS.es as unknown as Record<string, unknown>).aiOffBody).toBeUndefined();
  });

  it('A2: the Brazilian welcome is "Boas-vindas"', () => {
    expect(POPUP_STRINGS['pt-BR'].setupWelcomeTitle).toBe('Boas-vindas');
  });

  it('P6-1: the Spanish count line says "insultos discriminatorios", as the other Spanish lines do', () => {
    const line = POPUP_STRINGS.es.offRulesFired(3, 2);
    expect(line).toContain('insultos discriminatorios: 2');
    expect(POPUP_STRINGS.es.offSlursNote).toContain('insultos discriminatorios');
  });
});
