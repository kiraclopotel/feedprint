/** @vitest-environment jsdom */
// With a key, the AI rows open in a drawer right under the level picker and above the essentials, so rows that appear
// only once a key is stored are seen. The drawer is open the first time, then as the person last left it; closed, it
// is a green pill. Without a key nothing renders; at Strict the drawer keeps the main switch locked off with its note,
// as before. How it moves is read in a real browser (the-ai-drawer-moves-in-a-real-browser).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AI_DRAWER_OPEN_KEY, readingRowNames } from '../../../../src/ui/popup/panels/ai/AiCard';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { type FWSettings, utcDayKey } from '../../../../src/storage/settings';
import { adultPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Lang = (typeof UI_LANGUAGES)[number];
const FREE = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const base = {
  settingsSchemaVersion: '14', mode: 'adult', features: adultPreset(), strictLanguage: false, parentPin: '', dailyCap: 0,
  totalChecksToday: 3, totalNeutralizedToday: 2, totalNeutralizedAllTime: 40, totalTokensThisMonth: 0, lastResetDate: utcDayKey(),
  readToday: { date: utcDayKey(), youtube: { posts: 1, comments: 4, videos: 1 } },
  uiLanguage: 'en', dashboardTheme: 'dark', aiAnalysisEnabled: true, presets: { appliedAt: '', appliedPreset: 'adult' },
} as unknown as FWSettings;
const moderate = { ...base, mode: 'teen', features: teenPreset() } as unknown as FWSettings;
const strict = { ...base, mode: 'child', strictLanguage: true } as unknown as FWSettings;

let fake: FakeCounterChrome;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // The drawer keeps the stored choice it read for the rest of the popup's life; each test is a fresh popup, so the
  // modules are loaded anew and no test leans on what an earlier one read or pressed.
  vi.resetModules();
  fake = installCounterChrome();
  const c = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  c.tabs = { query: vi.fn(async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=x' }]) };
  (c.runtime as Record<string, unknown>).getManifest = () => ({ version: '2.5.18' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function settled(lang: Lang, settings: FWSettings, license: LicenseInfo): Promise<void> {
  const { SettingsPanel } = await import('../../../../src/ui/popup/panels/SettingsPanel');
  const { I18nProvider } = await import('../../../../src/i18n/react');
  const panel = createElement(SettingsPanel, { settings, license, onBack: () => {}, onChange: async () => {} });
  await act(async () => { root.render(createElement(I18nProvider, { lang, children: panel })); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Whether `a` comes before `b` in the page. */
const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const drawerHead = () => container.querySelector<HTMLButtonElement>('button.ai-drawer-head');
const drawerBody = () => container.querySelector<HTMLElement>('#fw-ai-drawer-rows');

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each([['Moderate', moderate], ['Relaxed', base]] as const)(
    'with a key at %s, the drawer sits under the level picker and above the essentials, named and open', async (_l, settings) => {
      await settled(lang, settings, PAID);
      const drawer = container.querySelector('.ai-drawer');
      const level = container.querySelector('.mode-card');
      const essentials = container.querySelector('.set-essentials');
      expect(drawer && level && essentials, 'the three cards render').toBeTruthy();
      expect(before(level!, drawer!), 'under the level picker').toBe(true);
      expect(before(drawer!, essentials!), 'above the essentials').toBe(true);
      // Nothing sits between the level card and the drawer.
      expect(level!.nextElementSibling).toBe(drawer);
      const head = drawerHead()!;
      expect(head.textContent).toBe(`${t.groupAi}·${t.keySubActive}`);
      expect(head.querySelector('.ai-drawer-sep')?.getAttribute('aria-hidden'), 'the dot is not read aloud').toBe('true');
      expect(head.getAttribute('aria-expanded')).toBe('true');
      expect(head.getAttribute('aria-controls')).toBe('fw-ai-drawer-rows');
      expect(drawerBody()!.hidden).toBe(false);
      const names = [...drawerBody()!.querySelectorAll('.fr-name')].map((n) => n.firstChild?.textContent?.trim());
      expect(names).toEqual(readingRowNames(t));
    });

  it('without a key, no drawer and no AI group renders', async () => {
    await settled(lang, base, FREE);
    expect(container.querySelector('.set-essentials'), 'Settings has drawn').not.toBeNull();
    expect(container.querySelector('.ai-drawer')).toBeNull();
    expect(container.textContent).not.toContain(t.groupAi);
  });

  it('at Strict with a key, the drawer shows the main switch locked off with its note, and no other row', async () => {
    await settled(lang, strict, PAID);
    expect(drawerHead()).not.toBeNull();
    expect(container.textContent).toContain(t.featAiMasterStrictNote);
    expect(drawerBody()!.textContent).not.toContain(t.featRewriteName);
    expect(drawerBody()!.textContent).not.toContain(t.outputLangName);
  });
});

describe('the drawer remembers how the person left it', () => {
  it('closes and opens on its button, and keeps the choice for the next opening of Settings', async () => {
    await settled('en', base, PAID);
    expect(fake.state[AI_DRAWER_OPEN_KEY]).toBeUndefined();
    expect(container.querySelector('.ai-drawer')!.classList.contains('closed'), 'open, it is the card').toBe(false);
    await act(async () => { drawerHead()!.click(); });
    expect(drawerHead()!.getAttribute('aria-expanded')).toBe('false');
    expect(drawerBody()!.hidden).toBe(true);
    expect(container.querySelector('.ai-drawer')!.classList.contains('closed'), 'closed, it is the pill').toBe(true);
    expect(drawerHead()!.textContent).toContain(POPUP_STRINGS.en.groupAi);
    expect(drawerHead()!.textContent).toContain(POPUP_STRINGS.en.keySubActive);
    expect(fake.state[AI_DRAWER_OPEN_KEY]).toBe(false);

    // Settings opened again: the drawer comes back closed.
    act(() => root.unmount());
    root = createRoot(container);
    await settled('en', base, PAID);
    expect(drawerHead()!.getAttribute('aria-expanded')).toBe('false');
    expect(drawerBody()!.hidden).toBe(true);

    await act(async () => { drawerHead()!.click(); });
    expect(drawerHead()!.getAttribute('aria-expanded')).toBe('true');
    expect(drawerBody()!.hidden).toBe(false);
    expect(fake.state[AI_DRAWER_OPEN_KEY]).toBe(true);
  });

  it('is a plain button, so Enter and Space work and a screen reader hears open or closed', async () => {
    await settled('en', base, PAID);
    const head = drawerHead()!;
    expect(head.tagName).toBe('BUTTON');
    expect(head.getAttribute('type')).toBe('button');
  });
});
