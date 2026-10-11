/** @vitest-environment jsdom */
// Green on the closed AI drawer means the subscription's reading is at work. A tester found the same bright pill with
// AI checks off and at Strict, where nothing leaves the computer, so the pill told people the reading ran when nothing
// did. With a valid key, the pill is green only when AI checks are on at Moderate or Relaxed; otherwise it is the
// card's own quiet pill, with the same words. How each pill looks is read in a real browser
// (the-ai-drawer-moves-in-a-real-browser) and its contrast in popup-looks-contrast.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { type FWSettings, utcDayKey } from '../../../../src/storage/settings';
import { adultPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import { installCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const relaxed = {
  settingsSchemaVersion: '14', mode: 'adult', features: adultPreset(), strictLanguage: false, parentPin: '', dailyCap: 0,
  totalChecksToday: 0, totalNeutralizedToday: 0, totalNeutralizedAllTime: 0, totalTokensThisMonth: 0, lastResetDate: utcDayKey(),
  uiLanguage: 'en', dashboardTheme: 'dark', aiAnalysisEnabled: true, presets: { appliedAt: '', appliedPreset: 'adult' },
} as unknown as FWSettings;
const moderate = { ...relaxed, mode: 'teen', features: teenPreset() } as unknown as FWSettings;
const strict = { ...relaxed, mode: 'child', strictLanguage: true } as unknown as FWSettings;
const aiOff = { ...moderate, aiAnalysisEnabled: false } as unknown as FWSettings;
const noLevelYet = { ...moderate, levelChosen: false } as unknown as FWSettings;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.resetModules();
  installCounterChrome();
  const c = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  c.tabs = { query: vi.fn(async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=x' }]) };
  (c.runtime as Record<string, unknown>).getManifest = () => ({ version: '2.5.18' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function closedDrawer(settings: FWSettings): Promise<Element> {
  const { SettingsPanel } = await import('../../../../src/ui/popup/panels/SettingsPanel');
  const { I18nProvider } = await import('../../../../src/i18n/react');
  const panel = createElement(SettingsPanel, { settings, license: PAID, onBack: () => {}, onChange: async () => {} });
  await act(async () => { root.render(createElement(I18nProvider, { lang: 'en', children: panel })); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  const head = container.querySelector<HTMLButtonElement>('button.ai-drawer-head');
  expect(head, 'the drawer renders with a key').toBeTruthy();
  if (head!.getAttribute('aria-expanded') === 'true') await act(async () => { head!.click(); });
  const drawer = container.querySelector('.ai-drawer')!;
  expect(drawer.classList.contains('closed'), 'the drawer is closed to its pill').toBe(true);
  return drawer;
}

const t = POPUP_STRINGS.en;

describe('the closed AI pill is green only while the reading is at work', () => {
  it.each([['Moderate', moderate], ['Relaxed', relaxed]] as const)(
    'AI checks on at %s: the green pill', async (_l, settings) => {
      const drawer = await closedDrawer(settings);
      expect(drawer.classList.contains('idle')).toBe(false);
    });

  it.each([['AI checks off', aiOff], ['Strict', strict], ['no level chosen yet', noLevelYet]] as const)(
    '%s: the quiet pill, with the same words', async (_l, settings) => {
      const drawer = await closedDrawer(settings);
      expect(drawer.classList.contains('idle')).toBe(true);
      expect(drawer.querySelector('button.ai-drawer-head')!.textContent).toBe(`${t.groupAi}·${t.keySubActive}`);
    });
});
