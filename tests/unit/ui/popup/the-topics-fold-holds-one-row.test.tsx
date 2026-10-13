/** @vitest-environment jsdom */
// The Topics fold (Topics U1, 13 Oct 2026): a shut fold under General with one lead line and one plain row, "Block gambling",
// in every language, at every level, with and without a key. The switch is the person's own: it starts off, one press turns
// it on, it is stored as the topic switch and nothing else, and it is not one of the recorder's switches the report email lists.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { receiptsSwitchIds } from '../../../../src/ui/popup/panels/SettingsPanel';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES, type ResolvedUiLanguage } from '../../../../src/i18n';
import { getSettings } from '../../../../src/storage/settings';
import type { FWSettings } from '../../../../src/storage/settings';
import { presetForMode } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import type { Mode } from '../../../../src/types/mode';
import { forgetFoldChoices } from '../../../../src/ui/popup/panels/Fold';
import { installCounterChrome } from '../../../helpers/fake-counter-chrome';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE = { tier: 'free' } as unknown as LicenseInfo;
const PAID = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;

const settings = (mode: Mode, topic = false): FWSettings => ({
  settingsSchemaVersion: '14', mode, strictLanguage: false, parentPin: '1234', locale: 'en', uiLanguage: 'en',
  features: { ...presetForMode(mode), 'topic-gambling': { enabled: topic } }, presets: { appliedAt: '', appliedPreset: mode },
  dashboardTheme: 'dark', aiAnalysisEnabled: true,
} as unknown as FWSettings);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  forgetFoldChoices();
  installCounterChrome();
  const c = (globalThis as unknown as { chrome: { storage: { onChanged: unknown }; tabs?: unknown; runtime: Record<string, unknown> } }).chrome;
  c.storage.onChanged = { addListener: vi.fn(), removeListener: vi.fn() };
  c.tabs = { query: vi.fn(async () => []) };
  c.runtime.getManifest = () => ({ version: '2.5.19' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function draw(lang: ResolvedUiLanguage, mode: Mode, license: LicenseInfo, openOn: 'main' | 'topics' = 'main', topic = false): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(SettingsPanel, { settings: settings(mode, topic), license, onBack: () => {}, onChange: async () => {}, openOn }),
    }));
  });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
const head = () => container.querySelector<HTMLButtonElement>('.fold-topics button.ai-drawer-head')!;
const body = () => container.querySelector<HTMLElement>('.fold-topics .ai-drawer-body')!;
const switches = () => Array.from(body().querySelectorAll<HTMLElement>('[role="switch"]'));

describe.each(UI_LANGUAGES)('the Topics fold in %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('is a shut fold named for the subject, with no switch drawn until it is opened', async () => {
    await draw(lang, 'adult', FREE);
    expect(head().textContent).toBe(t.topicsFoldName);
    expect(head().getAttribute('aria-expanded')).toBe('false');
    expect(switches()).toHaveLength(0);
  });

  it.each(['child', 'teen', 'adult'] as const)('at %s it opens to one lead line and one plain row, off', async (mode) => {
    await draw(lang, mode, PAID, 'topics');
    expect(head().getAttribute('aria-expanded')).toBe('true');
    expect(body().querySelector('.topics-lead')?.textContent).toBe(t.topicsFoldLead);
    expect(switches()).toHaveLength(1);
    expect(switches()[0].getAttribute('aria-checked')).toBe('false');
    expect(switches()[0].getAttribute('aria-label')).toBe(t.topicGamblingName);
    expect(body().textContent).toContain(t.topicGamblingName);
    expect(body().textContent).toContain(t.topicGamblingDesc);
  });

  it('shows the switch on when the person has it on', async () => {
    await draw(lang, 'teen', FREE, 'topics', true);
    expect(switches()[0].getAttribute('aria-checked')).toBe('true');
  });
});

describe('the switch', () => {
  it('one press turns the topic on, stored as that switch and no other', async () => {
    await draw('en', 'adult', FREE, 'topics');
    const before = (await getSettings()).features;
    await act(async () => { switches()[0].click(); });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const after = (await getSettings()).features;
    expect(after['topic-gambling']?.enabled).toBe(true);
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k as keyof typeof after]) !== JSON.stringify(before[k as keyof typeof before]));
    expect(changed).toEqual(['topic-gambling']);
  });

  it('is not one of the recorder\'s switches that the report email lists', () => {
    expect(receiptsSwitchIds()).not.toContain('topic-gambling');
  });
});
