/** @vitest-environment jsdom */
// A new Receipts install opens Settings on the level alone: the three level buttons, the list of what the chosen level
// does, and two shut folds under it, General and PIN and language, that open in place. Every switch Receipts has (ads,
// the swear mask, the reframe markers and the own rules) sits in General's one card, and nothing in it is folded away:
// the switches that took parts of the page away, and the other hiding switches, are Off's.

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
import { forgetFoldChoices } from '../../../../src/ui/popup/panels/Fold';

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
  forgetFoldChoices();
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

const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

async function press(label: string): Promise<void> {
  const b = button(label);
  if (!b) throw new Error(`no button "${label}"`);
  await act(async () => { b.click(); });
}

describe.each(UI_LANGUAGES)('a new install opens Settings on the level alone, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each(['child', 'teen', 'adult'] as const)('%s: the page holds the three level buttons and the two folds, shut, and no switch', async (mode) => {
    await render(newInstall(mode), lang);
    expect(container.querySelector('.mode-card')).not.toBeNull();
    expect(container.querySelectorAll('.mode-card .mode-seg-btn')).toHaveLength(3);
    expect(button(t.setGeneralTitle)?.getAttribute('aria-expanded'), 'the General fold, shut').toBe('false');
    expect(button(t.setDeviceTitle)?.getAttribute('aria-expanded'), 'the PIN and language fold, shut').toBe('false');
    expect(button(t.topicsFoldName)?.getAttribute('aria-expanded'), 'the Topics fold, shut').toBe('false');
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector('details')).toBeNull();
  });

  it.each(['child', 'teen', 'adult'] as const)('%s: General opens in place and holds every switch on one card, nothing folded, and the same header shuts it again', async (mode) => {
    await render(newInstall(mode), lang);
    await press(t.setGeneralTitle);
    expect(container.querySelector('details')).toBeNull();
    const switches = Array.from(container.querySelectorAll('[role="switch"]'));
    expect(switches.length).toBeGreaterThan(0);
    for (const s of switches) expect(s.closest('.set-essentials'), s.getAttribute('aria-label') ?? '').not.toBeNull();
    // No page was entered: the bar still reads Settings and the level is still in view above the open fold.
    expect(container.querySelector('.settings-bar .title')?.textContent).toBe(t.settingsTitle);
    expect(container.querySelector('.mode-card')).not.toBeNull();
    expect(button(t.setGeneralTitle)?.getAttribute('aria-expanded')).toBe('true');
    await press(t.setGeneralTitle);
    expect(button(t.setGeneralTitle)?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector<HTMLElement>('#fw-fold-general')!.hidden).toBe(true);
  });

  it.each(['child', 'teen', 'adult'] as const)('%s: the reframe markers are a General switch; the counts are not in Receipts', async (mode) => {
    await render(newInstall(mode), lang);
    await press(t.setGeneralTitle);
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
