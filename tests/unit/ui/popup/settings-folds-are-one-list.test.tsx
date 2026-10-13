/** @vitest-environment jsdom */
// The owner's word of 12 Oct 2026: General and PIN and language fold open in place exactly like Live Rephrase, as one
// vertical list, with a chevron big enough to press to close. Each fold is one header button that says whether it is open
// (aria-expanded) and what it controls (aria-controls), keeps its own choice in storage, and draws that choice in place
// the next time Settings opens. A body draws on the first opening only; what it holds is kept when it is shut.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import type { FWSettings } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import { FOLD_DEFAULT_OPEN, FOLD_KEYS, forgetFoldChoices, readAllFoldsOpen } from '../../../../src/ui/popup/panels/Fold';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;
const FREE = { tier: 'free' } as unknown as LicenseInfo;
const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;

const settings = (): FWSettings => ({
  settingsSchemaVersion: '14', mode: 'adult', strictLanguage: false, parentPin: '1234', locale: 'en', uiLanguage: 'en',
  features: adultPreset(), presets: { appliedAt: '', appliedPreset: 'adult' }, dashboardTheme: 'dark', aiAnalysisEnabled: true,
} as unknown as FWSettings);

let fake: FakeCounterChrome;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  forgetFoldChoices();
  fake = installCounterChrome();
  const c = (globalThis as unknown as { chrome: { storage: { onChanged: unknown }; tabs?: unknown; runtime: Record<string, unknown> } }).chrome;
  c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  c.tabs = { query: vi.fn(async () => []) };
  c.runtime.getManifest = () => ({ version: '2.5.19' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function draw(license: LicenseInfo, openOn?: 'main' | 'general' | 'topics' | 'device'): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SettingsPanel, { settings: settings(), license, onBack: () => {}, onChange: async () => {}, openOn }),
    }));
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
type FoldName = 'general' | 'reading' | 'topics' | 'device';
const head = (name: FoldName) => container.querySelector<HTMLButtonElement>(`.fold-${name} button.ai-drawer-head`)!;
const body = (name: FoldName) => container.querySelector<HTMLElement>(`.fold-${name} .ai-drawer-body`)!;
const press = async (name: FoldName) => { await act(async () => { head(name).click(); }); };
const setsFor = (key: string) => fake.state[key];

describe('the folds of Settings are one list of one shape', () => {
  it('General, Live Rephrase (with a key), Topics and PIN and language are four folds, each a header button that controls its own body', async () => {
    await draw(PAID);
    for (const name of ['general', 'reading', 'topics', 'device'] as const) {
      const h = head(name);
      expect(h, name).toBeTruthy();
      expect(h.getAttribute('aria-controls'), name).toBe(body(name).id);
      expect(h.querySelector('.ai-drawer-chip svg.ai-drawer-chev'), `${name}: the chevron sits in its chip`).not.toBeNull();
    }
    expect(head('general').textContent).toBe(t.setGeneralTitle);
    expect(head('topics').textContent).toBe(t.topicsFoldName);
    expect(head('device').textContent).toBe(t.setDeviceTitle);
  });

  it('every fold starts shut on a new install, the reading too (13 Oct 2026)', async () => {
    await draw(PAID);
    expect(head('general').getAttribute('aria-expanded')).toBe('false');
    expect(head('device').getAttribute('aria-expanded')).toBe('false');
    expect(head('reading').getAttribute('aria-expanded')).toBe('false');
    expect(head('topics').getAttribute('aria-expanded')).toBe('false');
    expect(FOLD_DEFAULT_OPEN).toEqual({ general: false, reading: false, topics: false, device: false });
  });

  it('a shut fold draws nothing of its body until it is opened, and keeps it drawn when it is shut again', async () => {
    await draw(FREE);
    expect(container.querySelector('.set-essentials')).toBeNull();
    expect(body('general').querySelector('.ai-drawer-rows')!.childElementCount, 'the rows wrapper is empty').toBe(0);
    await press('general');
    expect(container.querySelector('.set-essentials')).not.toBeNull();
    expect(body('general').hidden).toBe(false);
    await press('general');
    expect(body('general').hidden).toBe(true);
    expect(container.querySelector('.set-essentials'), 'what is in it stays for the next opening').not.toBeNull();
  });

  it('the chevron says which way it goes: down while shut, up while open', async () => {
    await draw(FREE);
    const chev = () => head('general').querySelector('svg.ai-drawer-chev')!;
    expect(chev().classList.contains('open')).toBe(false);
    await press('general');
    expect(chev().classList.contains('open')).toBe(true);
  });

  it('each fold writes its own choice once and nothing else, under its own key', async () => {
    await draw(PAID);
    const set = (globalThis as unknown as { chrome: { storage: { local: { set: ReturnType<typeof vi.fn> } } } }).chrome.storage.local.set;
    set.mockClear();
    await press('general');
    await press('device');
    await press('reading');
    await press('topics');
    const keys = set.mock.calls.flatMap(([patch]) => Object.keys(patch as object));
    expect(keys.sort()).toEqual([FOLD_KEYS.device, FOLD_KEYS.general, FOLD_KEYS.reading, FOLD_KEYS.topics].sort());
    expect(setsFor(FOLD_KEYS.general)).toBe(true);
    expect(setsFor(FOLD_KEYS.device)).toBe(true);
    expect(setsFor(FOLD_KEYS.reading)).toBe(true);
    expect(setsFor(FOLD_KEYS.topics)).toBe(true);
  });

  it('Settings opened again draws each fold as it was left, on the first frame', async () => {
    await draw(FREE);
    await press('device');
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(SettingsPanel, { settings: settings(), license: FREE, onBack: () => {}, onChange: async () => {} }),
      }));
    });
    // No settling: the choice is already known in this popup.
    expect(head('device').getAttribute('aria-expanded')).toBe('true');
    expect(head('general').getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.fold-device')!.classList.contains('unread')).toBe(false);
  });

  it('the popup reads all four stored choices at once as it opens', async () => {
    forgetFoldChoices();
    fake.state[FOLD_KEYS.general] = true;
    expect(await readAllFoldsOpen()).toEqual([true, FOLD_DEFAULT_OPEN.reading, FOLD_DEFAULT_OPEN.topics, false]);
  });

  it('the folds keep the list at Strict, where the reading holds only its locked switch', async () => {
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(SettingsPanel, { settings: { ...settings(), mode: 'child' } as FWSettings, license: PAID, onBack: () => {}, onChange: async () => {} }),
      }));
    });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(Array.from(container.querySelectorAll('.ai-drawer')).length).toBe(4);
  });
});
