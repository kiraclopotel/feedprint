/** @vitest-environment jsdom */
// The Tester's full test, 11 Oct 2026, small words in the popup header:
//   - the Silent chip's accessible name read "Silent: Silent: the filter runs..." (the chip's name, then a tooltip that
//     opens with the same word);
//   - an install that has not chosen its level makes no call yet, and the chip told it "Could not check the license
//     right now", which blames the network for a wait.
// Quiet hours: both time fields carry a name of their own for a screen reader.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { PopHeader } from '../../../../src/ui/popup/panels/header';
import { QuietHoursEditor } from '../../../../src/ui/popup/QuietHoursEditor';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#x27;').replace(/"/g, '&quot;');
const render = (lang: (typeof UI_LANGUAGES)[number], node: ReturnType<typeof createElement>) =>
  renderToString(createElement(I18nProvider, { lang, children: node }));

describe.each(UI_LANGUAGES)('the header chip, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('at Silent with no key, the chip names the level once', () => {
    const html = render(lang, createElement(PopHeader, { licenseState: 'free', strict: true }));
    const chip = /<button[^>]*status-chip[^>]*>/.exec(html)?.[0] ?? '';
    const aria = /aria-label="([^"]*)"/.exec(chip)?.[1] ?? '';
    expect(aria).toBe(esc(t.strictNoKeyLine));
    expect(aria.split(esc(t.modeChild)).length - 1, aria).toBeLessThanOrEqual(1);
  });

  it('a chip whose name is not the start of its tooltip keeps both', () => {
    const html = render(lang, createElement(PopHeader, { licenseState: 'ok' }));
    expect(html).toContain(`aria-label="${esc(t.licenseLabel)}: ${esc(t.statusOk)}"`);
  });

  it('a key waiting for the level choice says it waits, not that the network failed', () => {
    const html = render(lang, createElement(PopHeader, { licenseState: 'unchecked', levelPending: true }));
    expect(html).toContain(esc(t.statusLevelPending));
    expect(html).not.toContain(esc(t.statusUnchecked));
  });

  it('with the level chosen, a failed check still says so', () => {
    const html = render(lang, createElement(PopHeader, { licenseState: 'unchecked', levelPending: false }));
    expect(html).toContain(esc(t.statusUnchecked));
  });
});

describe('quiet hours: both time fields have a name', () => {
  it.each(UI_LANGUAGES)('%s', (lang) => {
    const t = POPUP_STRINGS[lang];
    const settings = { features: { 'media-timeout': { enabled: true, value: { schedule: [{ days: [1, 2, 3], startMin: 22 * 60, endMin: 7 * 60 }] } } } } as unknown as FWSettings;
    const html = render(lang, createElement(QuietHoursEditor, { settings, onChanged: async () => undefined }));
    expect(html).toContain(`aria-label="${esc(t.quietEditFrom)}"`);
    expect(html).toContain(`aria-label="${esc(t.quietEditTo)}"`);
  });
});
