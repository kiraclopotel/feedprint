/** @vitest-environment jsdom */
// The AI drawer's stored choice is read once per popup, with the settings, so Settings draws the drawer in place on
// its first frame. If Settings draws before that read lands, the drawer waits as the pill without moving and settles
// once; a press made before the read lands is the person's choice and the read does not undo it. One press writes
// storage once, even where React runs a state updater twice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { FWSettings } from '../../../../src/storage/settings';
import type { LicenseInfo } from '../../../../src/storage/license';
import { installCounterChrome, type FakeCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const KEY = 'fw_ai_drawer_open';

let fake: FakeCounterChrome;
let container: HTMLDivElement;
let root: Root;
let release: (stored: Record<string, unknown>) => void;

beforeEach(() => {
  vi.resetModules();
  fake = installCounterChrome();
  const c = (globalThis as unknown as { chrome: { storage: { local: { get: unknown }; onChanged: unknown }; tabs?: unknown; runtime: Record<string, unknown> } }).chrome;
  c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  c.tabs = { query: vi.fn(async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=x' }]) };
  c.runtime.getManifest = () => ({ version: '2.5.18' });
  // The drawer's read waits until the test lets it land; every other read answers at once.
  const plain = c.storage.local.get as (k?: unknown) => Promise<Record<string, unknown>>;
  c.storage.local.get = vi.fn((keys?: unknown) => (keys === KEY
    ? new Promise<Record<string, unknown>>((resolve) => { release = resolve; })
    : plain(keys)));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function settings() {
  const { adultPreset } = await import('../../../../src/storage/presets');
  return {
    settingsSchemaVersion: '14', mode: 'adult', features: adultPreset(), strictLanguage: false, parentPin: '', dailyCap: 0,
    uiLanguage: 'en', dashboardTheme: 'dark', aiAnalysisEnabled: true, presets: { appliedAt: '', appliedPreset: 'adult' },
  } as unknown as FWSettings;
}

async function draw(strict = false): Promise<void> {
  const { SettingsPanel } = await import('../../../../src/ui/popup/panels/SettingsPanel');
  const { I18nProvider } = await import('../../../../src/i18n/react');
  const panel = createElement(SettingsPanel, { settings: await settings(), license: PAID, onBack: () => {}, onChange: async () => {} });
  const tree = createElement(I18nProvider, { lang: 'en', children: panel });
  await act(async () => { root.render(strict ? createElement(StrictMode, null, tree) : tree); });
}
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const drawer = () => container.querySelector('.ai-drawer')!;
const head = () => container.querySelector<HTMLButtonElement>('button.ai-drawer-head')!;

describe('the AI drawer reads its stored choice once', () => {
  it('drawn before the read lands, it waits as the pill without moving, then settles open', async () => {
    await draw();
    expect(drawer().classList.contains('closed')).toBe(true);
    expect(drawer().classList.contains('unread')).toBe(true);
    expect(head().getAttribute('aria-expanded')).toBe('false');
    await act(async () => { release({}); });
    await settle();
    expect(drawer().classList.contains('closed')).toBe(false);
    expect(drawer().classList.contains('unread')).toBe(false);
    expect(head().getAttribute('aria-expanded')).toBe('true');
  });

  it('a press before the read lands wins over the read', async () => {
    await draw();
    await act(async () => { head().click(); });
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(fake.state[KEY]).toBe(true);
    await act(async () => { release({ [KEY]: false }); });
    await settle();
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(drawer().classList.contains('closed')).toBe(false);
  });

  it('once the popup has read the choice, Settings draws the drawer in place on its first frame', async () => {
    const { readAiDrawerOpen } = await import('../../../../src/ui/popup/panels/ai/AiCard');
    const read = readAiDrawerOpen();
    release({ [KEY]: false });
    expect(await read).toBe(false);
    await draw();
    // No settling here: the first frame already holds the stored choice.
    expect(drawer().classList.contains('closed')).toBe(true);
    expect(drawer().classList.contains('unread')).toBe(false);
  });

  it('one press writes storage once, even where React runs state updaters twice', async () => {
    const { readAiDrawerOpen } = await import('../../../../src/ui/popup/panels/ai/AiCard');
    const read = readAiDrawerOpen();
    release({});
    await read;
    await draw(true);
    const set = (globalThis as unknown as { chrome: { storage: { local: { set: ReturnType<typeof vi.fn> } } } }).chrome.storage.local.set;
    set.mockClear();
    await act(async () => { head().click(); });
    expect(set.mock.calls.filter(([patch]) => KEY in (patch as object))).toHaveLength(1);
    expect(fake.state[KEY]).toBe(false);
  });
});
