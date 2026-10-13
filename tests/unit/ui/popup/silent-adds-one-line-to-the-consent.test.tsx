/** @vitest-environment jsdom */
// At Silent the Reading consent screen names the level in one paragraph (the owner's yes, 12 Oct 2026): the posts are read so
// they can arrive calm, account names are replaced by letters. The hash stored with the agreement is over the words the
// person saw, so it covers that paragraph at Silent and is the ordinary hash at the other two levels.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ReadingConsentScreen, readingConsentText } from '../../../../src/ui/popup/panels/ReadingConsentScreen';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PROVIDER = 'Example Provider Inc., USA';
let root: Root | null = null;
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = null; document.body.innerHTML = ''; });

async function show(lang: (typeof UI_LANGUAGES)[number], atSilent: boolean, onStart = vi.fn()): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang,
      children: createElement(ReadingConsentScreen, { provider: PROVIDER, atSilent, onStart, onNotNow: vi.fn() }),
    }));
  });
  return host;
}

describe('the consent screen at Silent', () => {
  it.each(UI_LANGUAGES)('%s: the Silent paragraph is on the screen right after the title, and only at Silent', async (lang) => {
    const t = POPUP_STRINGS[lang];
    const at = await show(lang, true);
    const line = at.querySelector('[data-testid="consent-silent-line"]');
    expect(line?.textContent).toBe(t.consentStrictLine);
    const text = at.textContent ?? '';
    expect(text.indexOf(t.consentTitle)).toBeLessThan(text.indexOf(t.consentStrictLine));
    expect(text.indexOf(t.consentStrictLine)).toBeLessThan(text.indexOf(t.consentWhy));
    await act(async () => { root!.unmount(); });
    document.body.innerHTML = '';
    const other = await show(lang, false);
    expect(other.querySelector('[data-testid="consent-silent-line"]')).toBeNull();
    expect(other.textContent).not.toContain(t.consentStrictLine);
  });

  it('the text the agreement is hashed over contains the paragraph at Silent and is unchanged elsewhere', () => {
    const t = POPUP_STRINGS.en;
    expect(readingConsentText(t, PROVIDER, null, true)).toContain(t.consentStrictLine);
    expect(readingConsentText(t, PROVIDER)).not.toContain(t.consentStrictLine);
    expect(readingConsentText(t, PROVIDER, null, false)).toBe(readingConsentText(t, PROVIDER));
  });

  it('Start hands over the words that were shown, the Silent paragraph included', async () => {
    const onStart = vi.fn();
    const host = await show('en', true, onStart);
    await act(async () => { (host.querySelector('[data-testid="consent-start"]') as HTMLButtonElement).click(); });
    expect(onStart).toHaveBeenCalledWith(readingConsentText(POPUP_STRINGS.en, PROVIDER, null, true), PROVIDER, null);
  });
});
