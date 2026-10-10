/** @vitest-environment jsdom */
// "Forgot PIN?" on an install with no recovery phrase says the only way out is to reinstall. In
// Receipts that deletes the signed record and the line says so. Off keeps no record, and its
// Set PIN card makes no recovery phrase, so this is the line Off's PIN overlay normally reaches:
// it must not name a record. The form picks its text by product, as the recovery card does.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PinRecoveryForm } from '../../../../src/ui/popup/controls';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { _setProductForTesting } from '../../../../src/product';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Lang = (typeof UI_LANGUAGES)[number];

const RECORD_WORD: Record<Lang, RegExp> = {
  en: /record/i,
  es: /registro/i,
  'pt-BR': /registro/i,
  ro: /registr/i,
};

let root: Root | null = null;
let host: HTMLElement;

beforeEach(() => {
  // No recovery phrase stored: hasRecoveryPhrase() reads false.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve(), remove: () => Promise.resolve() } },
  };
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  _setProductForTesting(null);
});

async function shown(lang: Lang): Promise<string> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang,
      children: createElement(PinRecoveryForm, { onSuccess: () => {}, onCancel: () => {} }),
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host.textContent ?? '';
}

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('as Off, the no-phrase line names no record and still says reinstalling is the way out', async () => {
    _setProductForTesting('off');
    const text = await shown(lang);
    expect(text).toContain(t.pinRecoveryNoneOff);
    expect(text).not.toContain(t.pinRecoveryNone);
    expect(text).not.toMatch(RECORD_WORD[lang]);
    // Off says its own name, the one Chrome shows, not the maker's.
    expect(text).toMatch(/\bOff\b/);
    expect(text).not.toContain('FeelingWise');
  });

  it('as Feedprint, the no-phrase line keeps the record clause', async () => {
    _setProductForTesting('receipts');
    const text = await shown(lang);
    expect(text).toContain(t.pinRecoveryNone);
    expect(text).toMatch(RECORD_WORD[lang]);
    expect(text).not.toContain(t.pinRecoveryNoneOff);
  });

  it('the Off line is the Feedprint line without the record clause, with no dash', () => {
    expect(t.pinRecoveryNoneOff).not.toMatch(RECORD_WORD[lang]);
    expect(t.pinRecoveryNoneOff).not.toMatch(/—/);
    // Each line names its own product, so the Off line is compared with that name swapped.
    expect(t.pinRecoveryNone.startsWith(t.pinRecoveryNoneOff.replace(/\.$/, '').replace(/\bOff\b/, 'Feedprint'))).toBe(true);
  });
});
