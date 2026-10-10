// The recovery phrase card warns that with the PIN and the phrase both lost, the only way out is to
// reinstall. For Receipts, reinstalling deletes the signed record, and the card says so. Off keeps
// no record, so the same sentence would tell an Off user about something that does not exist. The
// card picks its text by product: Off's carries no record clause, Receipts' is unchanged.

import { describe, it, expect, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { RecoveryPhraseCard } from '../../../../src/ui/popup/controls';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { _setProductForTesting } from '../../../../src/product';

type Lang = (typeof UI_LANGUAGES)[number];

// The word for the kept record in each language's own text (the Off card must carry none of them).
const RECORD_WORD: Record<Lang, RegExp> = {
  en: /record/i,
  es: /registro/i,
  'pt-BR': /registro/i,
  ro: /registr/i,
};

// Off has no Settings screen, so its warning leaves out the phrase that names one (B3 unit 5, P9).
const SETTINGS_PHRASE: Record<Lang, string> = {
  en: ' in Settings',
  es: ' de Ajustes',
  'pt-BR': ' das Configurações',
  ro: ' din Setări',
};

function card(lang: Lang): string {
  return renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(RecoveryPhraseCard, { phrase: 'ABCD-2345', onConfirm: () => {} }),
  }));
}

const esc = (s: string) => s.replace(/'/g, '&#x27;');

afterEach(() => _setProductForTesting(null));

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('as Off, the card says nothing about a record and still warns about the reinstall', () => {
    _setProductForTesting('off');
    const html = card(lang);
    expect(html).toContain(esc(t.setupRecoveryBodyOff));
    expect(html).not.toContain(esc(t.setupRecoveryBody));
    expect(html).not.toMatch(RECORD_WORD[lang]);
    // Off says its own name, the one Chrome shows, not the maker's.
    expect(html).toMatch(/\bOff\b/);
    expect(html).not.toContain('FeelingWise');
    expect(html).toContain('ABCD-2345');
  });

  it('as Feedprint, the card keeps the record clause', () => {
    _setProductForTesting('receipts');
    const html = card(lang);
    expect(html).toContain(esc(t.setupRecoveryBody));
    expect(html).toMatch(RECORD_WORD[lang]);
    expect(html).not.toContain(esc(t.setupRecoveryBodyOff));
  });

  it('the Off text is the Feedprint text without the record clause and the Settings phrase, and has no dash or age word', () => {
    expect(t.setupRecoveryBodyOff).not.toMatch(RECORD_WORD[lang]);
    expect(t.setupRecoveryBodyOff).not.toMatch(/—/);
    // Each text names its own product, so the Off text is compared with that name swapped.
    const receiptsWithoutSettings = t.setupRecoveryBody.replace(SETTINGS_PHRASE[lang], '');
    expect(receiptsWithoutSettings).not.toBe(t.setupRecoveryBody);
    expect(receiptsWithoutSettings.startsWith(t.setupRecoveryBodyOff.replace(/\.$/, '').replace(/\bOff\b/, 'Feedprint'))).toBe(true);
  });
});
