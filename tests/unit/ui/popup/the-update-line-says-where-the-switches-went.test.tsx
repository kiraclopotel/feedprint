/** @vitest-environment jsdom */
// After the update that moved the page switches to Off, a Receipts install that had one of them on (anywhere,
// or on one site) reads once, on the update line, that they now live in Off. The line's one × dismisses both,
// so nothing new is stored. An install that never turned one on is not told.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { UpdateNoticeLine } from '../../../../src/ui/popup/UpdateNotice';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { adultPreset } from '../../../../src/storage/presets';
import { storedOffSwitchOn } from '../../../../src/storage/switch-scope';

const line = (lang: (typeof UI_LANGUAGES)[number], switchesMoved: boolean): string =>
  renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(UpdateNoticeLine, { version: '2.5.18', onDone: () => {}, switchesMoved }),
  }));

describe('the update line after the page switches moved', () => {
  it.each(UI_LANGUAGES)('%s: says where they went when asked to, and not otherwise', (lang) => {
    const note = POPUP_STRINGS[lang].pageSwitchesMovedNote;
    expect(note).toMatch(/\bOff\b/);
    expect(line(lang, true)).toContain(note);
    expect(line(lang, false)).not.toContain(note);
  });

  it('is asked for only by an install that had an Off switch on, anywhere or on one site', () => {
    expect(storedOffSwitchOn(adultPreset())).toBe(false);
    const anywhere = adultPreset();
    anywhere['hide-stories'] = { enabled: true };
    expect(storedOffSwitchOn(anywhere)).toBe(true);
    const oneSite = adultPreset();
    oneSite['media-timeout'] = { enabled: false, perPlatform: { tiktok: { enabled: true } } };
    expect(storedOffSwitchOn(oneSite)).toBe(true);
    const receiptsOnly = adultPreset();
    receiptsOnly['block-ads'] = { enabled: true };
    expect(storedOffSwitchOn(receiptsOnly)).toBe(false);
  });
});
