/** @vitest-environment jsdom */
// The level card is three buttons and one sentence (the owner's yes, 12 Oct 2026): the sentence says what the chosen
// level shows, and it speaks of the rephrased or the calm version, which a key pays for, so a free install is told
// nothing under the buttons (no word of the reading reaches an install without a key). The one link under the sentence,
// Reset, is the way back to the level's defaults and appears only when a switch was changed.

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
vi.mock('../../../../src/ui/popup/reading-gate', () => ({
  useReadingOn: (license: { tier: string }) => license.tier !== 'free',
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Mode = 'child' | 'teen' | 'adult';
const FREE = { tier: 'free' } as unknown as LicenseInfo;
const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;

function install(mode: Mode, extra: Partial<FWSettings> = {}): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, parentPin: mode === 'adult' ? '' : '1234', locale: 'en', uiLanguage: 'auto',
    features: mode === 'child' ? childPreset() : mode === 'teen' ? teenPreset() : adultPreset(),
    presets: { appliedAt: '', appliedPreset: mode }, dashboardTheme: 'dark', aiAnalysisEnabled: true,
    ...extra,
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

async function render(s: FWSettings, license: LicenseInfo = FREE, lang: (typeof UI_LANGUAGES)[number] = 'en'): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(SettingsPanel, { settings: s, license, onBack: () => {}, onChange: async () => {} }),
    }));
  });
}

const t = POPUP_STRINGS.en;
const sentence = (): HTMLElement | null => container.querySelector('.mode-card .level-sentence');

describe('the level card is three buttons and one sentence', () => {
  it.each([
    ['child', t.levelSentenceChild],
    ['teen', t.levelSentenceTeen],
    ['adult', t.levelSentenceAdult],
  ] as const)('%s, with a key: the sentence of that level and nothing else under the buttons', async (mode, words) => {
    await render(install(mode), PAID);
    expect(container.querySelectorAll('.mode-seg-btn')).toHaveLength(3);
    expect(sentence()?.textContent).toBe(words);
    expect(container.querySelector('.level-list'), 'no list of rows any more').toBeNull();
  });

  it('the three buttons are named Silent, Calm and Open', async () => {
    await render(install('teen'), PAID);
    expect(Array.from(container.querySelectorAll('.mode-seg-btn')).map((b) => b.textContent)).toEqual(['Silent', 'Calm', 'Open']);
  });

  it('the buttons are described by the sentence, so a screen reader hears it on the group', async () => {
    await render(install('adult'), PAID);
    const group = container.querySelector('[role="radiogroup"]') as HTMLElement;
    const id = group.getAttribute('aria-describedby');
    expect(id).toBe('fw-level-sentence');
    expect(container.querySelector(`#${id}`)?.textContent).toBe(t.levelSentenceAdult);
  });

  it.each(['child', 'teen', 'adult'] as const)('%s, without a key: no sentence, so a free install is promised no rephrasing', async (mode) => {
    await render(install(mode), FREE);
    expect(sentence()).toBeNull();
    expect(container.querySelector('[role="radiogroup"]')?.hasAttribute('aria-describedby')).toBe(false);
    expect(container.textContent).not.toContain(t.groupAi);
  });

  it('with the switches as the level left them there is no Reset link and no "with your changes" sentence; changed, Reset alone appears', async () => {
    await render(install('teen'), PAID);
    expect(container.querySelector('.mode-state')).toBeNull();
    expect(container.textContent).not.toMatch(/with your changes/);
    const s = install('teen');
    s.features['block-ads'] = { enabled: false };
    await render(s, PAID);
    const state = container.querySelector('.mode-state') as HTMLElement;
    expect(state).not.toBeNull();
    expect(state.textContent?.trim()).toBe(t.modeStateReset);
  });
});

describe('the words', () => {
  it.each(UI_LANGUAGES)('%s: each sentence ends in a full stop, has no dash, and the old level names are gone', (lang) => {
    const s = POPUP_STRINGS[lang];
    for (const key of ['levelSentenceChild', 'levelSentenceTeen', 'levelSentenceAdult'] as const) {
      const words = s[key].trim();
      expect(words.length, `${lang}.${key}`).toBeGreaterThan(20);
      expect(words, `${lang}.${key}`).toMatch(/\.$/);
      expect(words, `${lang}.${key}`).not.toContain('—');
      expect(words, `${lang}.${key}`).not.toMatch(/Strict|Moderate|Relaxed/);
    }
  });

  it.each(UI_LANGUAGES)('%s: the dots are named by their colour, green for the calm version and red for the original', (lang) => {
    const s = POPUP_STRINGS[lang];
    const green = { en: /green/, ro: /verde/, es: /verde/, 'pt-BR': /verde/ } as Record<string, RegExp>;
    const red = { en: /red/, ro: /roșu/, es: /rojo/, 'pt-BR': /vermelho/ } as Record<string, RegExp>;
    expect(s.levelSentenceTeen).toMatch(green[lang]);
    expect(s.levelSentenceAdult).toMatch(red[lang]);
  });
});
