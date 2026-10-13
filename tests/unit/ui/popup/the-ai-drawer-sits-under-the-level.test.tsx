/** @vitest-environment jsdom */
// With a key, the AI rows open in a drawer in the list of folds under the level picker (since 12 Oct 2026 the list is
// General, the drawer, PIN and language, each of one shape), so rows that appear only once a key is stored are seen. The
// drawer is open the first time, then as the person last left it; closed, it is a green pill. Without a key nothing renders; at Strict the drawer keeps the main switch locked off with its note,
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
const drawerHead = () => container.querySelector<HTMLButtonElement>('.fold-reading button.ai-drawer-head');
const drawerBody = () => container.querySelector<HTMLElement>('#fw-ai-drawer-rows');
// What the drawer header reads: the group, and the plan after a dot only when the plan has a name of its own.
const headerText = (s: { groupAi: string; keySubActive: string }) => s.keySubActive === s.groupAi ? s.groupAi : `${s.groupAi}·${s.keySubActive}`;

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each([['Calm', moderate], ['Open', base], ['Silent', strict]] as const)(
    'with a key at %s, the drawer sits under the level picker and General under it, named and open', async (_l, settings) => {
      // The person left it open (since 13 Oct 2026 it starts shut until they open it).
      fake.state[AI_DRAWER_OPEN_KEY] = true;
      await settled(lang, settings, PAID);
      const drawer = container.querySelector('.fold-reading');
      const level = container.querySelector('.mode-card');
      const general = container.querySelector('.fold-general');
      const topics = container.querySelector('.fold-topics');
      const device = container.querySelector('.fold-device');
      expect(drawer && level && general && topics && device, 'the level, the four folds render').toBeTruthy();
      // The owner's word of 12 Oct 2026, evening: one list, with a key the drawer first, General under it, PIN and
      // language last.
      expect(before(level!, drawer!), 'the drawer under the level picker').toBe(true);
      expect(before(drawer!, general!), 'General under the drawer').toBe(true);
      expect(before(general!, topics!), 'Topics under General').toBe(true);
      expect(before(topics!, device!), 'PIN and language under Topics').toBe(true);
      expect(level!.nextElementSibling).toBe(drawer);
      expect(drawer!.nextElementSibling).toBe(general);
      expect(general!.nextElementSibling).toBe(topics);
      expect(topics!.nextElementSibling).toBe(device);
      const head = drawerHead()!;
      // The header names the group, and the plan after a dot only when the plan has a name of its own.
      expect(head.textContent).toBe(headerText(t));
      if (t.keySubActive !== t.groupAi) expect(head.querySelector('.ai-drawer-sep')?.getAttribute('aria-hidden'), 'the dot is not read aloud').toBe('true');
      else expect(head.querySelector('.ai-drawer-sep'), 'one name, no dot').toBeNull();
      expect(head.getAttribute('aria-expanded')).toBe('true');
      expect(head.getAttribute('aria-controls')).toBe('fw-ai-drawer-rows');
      expect(drawerBody()!.hidden).toBe(false);
      // The name as shown, the BETA pill and the (i) button set aside (the last word has its own span since Off U5).
      const names = [...drawerBody()!.querySelectorAll('.fr-name')].map((n) => {
        const c = n.cloneNode(true) as Element;
        c.querySelectorAll('.beta-pill, button').forEach((e) => e.remove());
        return c.textContent?.trim();
      });
      // Packet 36 (13 Oct 2026): the main switch, then the level's two switches by their plain names, then the comments
      // and the language.
      expect(names).toEqual([t.featAiMasterName, t.reframeRewritesName, t.featMarkersName, t.featRewriteName, t.outputLangName]);
    });

  it('without a key, no drawer and no AI group renders', async () => {
    await settled(lang, base, FREE);
    expect(container.querySelector('.fold-general'), 'Settings has drawn').not.toBeNull();
    expect(container.querySelector('.fold-reading')).toBeNull();
    expect(container.textContent).not.toContain(t.groupAi);
  });
});

describe('the drawer remembers how the person left it', () => {
  it('closes and opens on its button, and keeps the choice for the next opening of Settings', async () => {
    await settled('en', base, PAID);
    expect(fake.state[AI_DRAWER_OPEN_KEY]).toBeUndefined();
    // A new install: shut, the pill (13 Oct 2026); the first press opens it and is kept.
    expect(container.querySelector('.fold-reading')!.classList.contains('closed'), 'shut, it is the pill').toBe(true);
    await act(async () => { drawerHead()!.click(); });
    expect(drawerHead()!.getAttribute('aria-expanded')).toBe('true');
    expect(fake.state[AI_DRAWER_OPEN_KEY]).toBe(true);
    expect(container.querySelector('.fold-reading')!.classList.contains('closed'), 'open, it is the card').toBe(false);
    await act(async () => { drawerHead()!.click(); });
    expect(drawerHead()!.getAttribute('aria-expanded')).toBe('false');
    expect(drawerBody()!.hidden).toBe(true);
    expect(container.querySelector('.fold-reading')!.classList.contains('closed'), 'closed, it is the pill').toBe(true);
    expect(drawerHead()!.textContent).toBe(headerText(POPUP_STRINGS.en));
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
