/** @vitest-environment jsdom */
// A new Receipts install opens Settings on the essentials alone: ads, strict language, the swear mask,
// the reframe markers and the own rules, all on the first card. Nothing is folded away: the switches that
// took parts of the page away, and the other hiding switches, are Off's.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

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

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mode = 'child' | 'teen' | 'adult';
const FREE = { tier: 'free' } as unknown as LicenseInfo;

function newInstall(mode: Mode): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, parentPin: '1234', locale: 'en', uiLanguage: 'auto',
    features: mode === 'child' ? childPreset() : mode === 'teen' ? teenPreset() : adultPreset(),
    presets: { appliedAt: '', appliedPreset: mode }, dashboardTheme: 'dark',
  } as unknown as FWSettings;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.0' }) },
    tabs: { query: vi.fn(async () => []) },
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(s: FWSettings, lang: (typeof UI_LANGUAGES)[number]): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(SettingsPanel, { settings: s, license: FREE, onBack: () => {}, onChange: async () => {} }),
    }));
  });
}


describe.each(UI_LANGUAGES)('a new install opens Settings on the essentials alone, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each(['child', 'teen', 'adult'] as const)('%s: every switch on the screen is on the first card, and nothing is folded', async (mode) => {
    await render(newInstall(mode), lang);
    expect(container.querySelector('details')).toBeNull();
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches.length).toBeGreaterThan(0);
    for (const s of switches) expect(s.closest('.set-essentials'), s.getAttribute('aria-label') ?? '').not.toBeNull();
  });

  it.each(['child', 'teen', 'adult'] as const)('%s: the reframe markers are a first-card switch; the counts are not in Receipts', async (mode) => {
    await render(newInstall(mode), lang);
    const labels = Array.from(container.querySelectorAll('.set-essentials [role="switch"]')).map(s => s.getAttribute('aria-label'));
    expect(labels).toContain(t.featMarkersName);
    expect(container.textContent ?? '').not.toContain(t.featHideMetricsName);
  });
});

describe('the words for your own rules say which languages work', () => {
  it.each(UI_LANGUAGES)('%s: any language written with spaces between words', (lang) => {
    // Off's long line and Receipts' one-sentence line both say it.
    for (const desc of [POPUP_STRINGS[lang].rulesDesc, POPUP_STRINGS[lang].rulesDescOne]) {
      expect(desc).toMatch(/spaces between words|spații între cuvinte|espacios entre las palabras|espaços entre as palavras/);
    }
  });
});
