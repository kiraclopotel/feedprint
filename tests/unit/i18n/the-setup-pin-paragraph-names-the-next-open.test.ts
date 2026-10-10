// M11 check 4b (the head's (a)): the setup PIN paragraph says what the code does. Finishing setup with a PIN does not
// start the 15-minute grace, so Settings ask for the PIN the next time they are opened; the fifteen minutes start when the
// PIN is typed. Before M11 the paragraph said "Once entered it stays open for fifteen minutes" and the code also opened
// Settings for fifteen minutes after setup; now the paragraph names the next open, in all four languages.

import { describe, expect, it } from 'vitest';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

type Lang = (typeof UI_LANGUAGES)[number];

const NEXT_OPEN: Record<Lang, RegExp> = {
  en: /Settings ask for it the next time you open them/,
  es: /Ajustes te pide el PIN la próxima vez que entres/,
  'pt-BR': /As configurações pedem o PIN na próxima vez que você as abrir/,
  ro: /Setările îl cer data viitoare când le deschizi/,
};

const FIFTEEN_AFTER_TYPING: Record<Lang, RegExp> = {
  en: /Once you type it, they stay open for fifteen minutes/,
  es: /Después de escribirlo, Ajustes queda abierto quince minutos/,
  'pt-BR': /Depois de digitá-lo, o acesso fica liberado por quinze minutos/,
  ro: /Odată ce l-ai introdus, rămân deschise cincisprezece minute/,
};

const OLD_PROMISE: Record<Lang, RegExp> = {
  en: /Once entered it stays open for fifteen minutes/,
  es: /Una vez escrito, Ajustes se queda abierto quince minutos/,
  'pt-BR': /Uma vez digitado, o acesso fica liberado por quinze minutos/,
  ro: /Odată introdus, rămâne valabil cincisprezece minute/,
};

describe.each(UI_LANGUAGES)('the setup PIN paragraph in %s', (lang) => {
  const body = POPUP_STRINGS[lang].setupPinBody;

  it('says Settings ask for the PIN the next time they are opened', () => {
    expect(body).toMatch(NEXT_OPEN[lang]);
  });

  it('starts the fifteen minutes when the PIN is typed', () => {
    expect(body).toMatch(FIFTEEN_AFTER_TYPING[lang]);
  });

  it('no longer promises the fifteen minutes from the moment it is set', () => {
    expect(body).not.toMatch(OLD_PROMISE[lang]);
  });

  it('has no em dash', () => {
    expect(body).not.toMatch(/—/);
  });
});
