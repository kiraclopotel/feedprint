/** @vitest-environment jsdom */
// Receipts sells no key. Without one, nothing is sent and nothing is spent, so an AI card would only
// show a switch that cannot move and a way to a key nobody can buy: Settings shows no AI card at all.
// The swear mask uses no model, so it sits on the first card of every install, never under the AI. With a key the AI
// card and its breaker are as before.

import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { adultPreset, childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

type Mode = 'child' | 'teen' | 'adult';
type Lang = (typeof UI_LANGUAGES)[number];
const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const MODES: Mode[] = ['child', 'teen', 'adult'];

function settingsWith(mode: Mode): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, metricsHiddenToday: 0, metricsHiddenAllTime: 0,
    features: mode === 'child' ? childPreset() : mode === 'teen' ? teenPreset() : adultPreset(),
    presets: { appliedAt: '', appliedPreset: mode }, dashboardTheme: 'dark', aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

function render(mode: Mode, license: LicenseInfo, lang: Lang, openOn: 'main' | 'general' = 'main'): Document {
  const html = renderToString(createElement(I18nProvider, {
    lang,
    children: createElement(SettingsPanel, { settings: settingsWith(mode), license, onBack: () => {}, onChange: async () => {}, openOn }),
  }));
  return new DOMParser().parseFromString(html, 'text/html');
}

const headers = (doc: Document) => Array.from(doc.querySelectorAll('.grp-hdr')).map(h => h.textContent ?? '');
const switchLabels = (doc: Document) => Array.from(doc.querySelectorAll('[role="switch"]')).map(s => s.getAttribute('aria-label') ?? '');
const swearLabels = (t: (typeof POPUP_STRINGS)[Lang]) => [t.softenSwearingName, t.softenSwearingAriaChild];

/** The card that follows a header: the header's next sibling. */
function cardUnder(doc: Document, header: string): Element | null {
  const hdr = Array.from(doc.querySelectorAll('.grp-hdr')).find(h => h.textContent === header);
  return hdr?.nextElementSibling ?? null;
}

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each(MODES)('without a key at %s: no AI header, no AI switch, no way to a key', (mode) => {
    const doc = render(mode, FREE, lang);
    // The AI group's name sits on the drawer's own button, not on a section header, so the drawer itself is checked.
    expect(doc.querySelector('.fold-reading')).toBeNull();
    expect(doc.body.textContent).not.toContain(t.groupAi);
    const labels = switchLabels(doc);
    expect(labels).not.toContain(t.featAiMasterName);
    expect(doc.body.textContent).not.toContain(t.featAiMasterDesc);
    expect(doc.body.textContent).not.toContain(t.featAiMasterOffNote);
  });

  it.each(MODES)('the swear mask sits on the General page\'s card at %s, key or no key', (mode) => {
    for (const license of [FREE, PAID]) {
      const doc = render(mode, license, lang, 'general');
      const card = doc.querySelector('.set-essentials')!;
      expect(card, 'the switches card').not.toBeNull();
      const inCard = Array.from(card.querySelectorAll('[role="switch"]')).map(s => s.getAttribute('aria-label'));
      expect(inCard.some(l => swearLabels(t).includes(l ?? '')), `${mode}: the swear mask switch`).toBe(true);
    }
  });

  it('with a key the AI card and its breaker are there', () => {
    const doc = render('teen', PAID, lang);
    // The card is a drawer whose own header button names the group.
    const card = doc.querySelector('.fold-reading')!;
    expect(card.querySelector('.fold-reading button.ai-drawer-head')?.textContent).toContain(t.groupAi);
    const inCard = Array.from(card.querySelectorAll('[role="switch"]')).map(s => s.getAttribute('aria-label'));
    expect(inCard).toContain(t.featAiMasterName);
    expect(inCard.some(l => swearLabels(t).includes(l ?? '')), 'the swear mask is not an AI row').toBe(false);
  });

});
