/** @vitest-environment jsdom */
// Receipts is a recorder, so its Settings hold the few switches a clean record needs, all on the first
// card: ads, strict language, the swear mask, the reframe markers and the user's own rules. The page
// parts, the break and quiet hours, Block this, the hashtag and AI-label hide, comment posting and emoji
// are Off's and appear nowhere, even when an install stored one of them on. With a key, the AI drawer sits
// right under the level, above the switches, where rows a key adds are seen. Opening Settings, jumping to the rules
// or searching them writes nothing to storage.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings, FeatureId } from '../../../../src/storage/settings';
import { childPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import type { PopupStrings } from '../../../../src/i18n/popup-strings';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FREE = { tier: 'free' } as unknown as LicenseInfo;
const PAID = { tier: 'paid' } as unknown as LicenseInfo;
/** Every name Off holds now, as Receipts' popup used to print it. */
const offNames = (t: PopupStrings): string[] => [
  t.featBlockReelsName, t.featHideStoriesName, t.featHideSuggestionsName, t.featHideRightColumnName, t.featHideMarketplaceName,
  t.featHideGroupsName, t.featHideMetricsName, t.featHideActionsName, t.featBlockAiName, t.featBlockPostingName,
  t.featStripEmojisName, t.groupBreak, t.breakName('TikTok'), t.offPickName,
];

const writes = vi.fn();
function installChrome(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: { get: async () => ({}), set: async (o: unknown) => { writes(o); }, remove: async () => {} },
      session: { get: async () => ({}), set: async () => {} },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.0' }) },
    tabs: { query: vi.fn(async () => []) },
  };
}

function settingsWith(rules: { words?: string[]; phrases?: string[]; accounts?: string[] } = {}): FWSettings {
  const features = childPreset();
  // An install that turned Off's switches on while Receipts still had them.
  for (const id of ['hide-stories', 'media-timeout', 'block-ai-content'] as FeatureId[]) features[id] = { enabled: true };
  features['parent-blocklist'] = { enabled: true, value: { words: rules.words ?? [], phrases: rules.phrases ?? [], accounts: rules.accounts ?? [] } };
  return {
    settingsSchemaVersion: '14', mode: 'child', strictLanguage: false, parentPin: '1234', locale: 'en',
    uiLanguage: 'auto', features, presets: { appliedAt: '', appliedPreset: 'child' }, dashboardTheme: 'dark',
    hiddenByFeature: { 'rule:word:alpha': 3 },
  } as unknown as FWSettings;
}

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  installChrome();
  writes.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function render(s: FWSettings, lang: (typeof UI_LANGUAGES)[number] = 'en', license: LicenseInfo = FREE): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(SettingsPanel, { settings: s, license, onBack: () => {}, onChange: async () => {} }),
    }));
  });
}

const typeInto = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe.each(UI_LANGUAGES)('Receipts settings, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('opens on every switch it has, in order: ads, strict language, the swear mask, the markers, the own rules', async () => {
    await render(settingsWith({ words: ['alpha'] }), lang);
    const essentials = container.querySelector('.set-essentials') as HTMLElement;
    expect(essentials).not.toBeNull();
    const text = essentials.textContent ?? '';
    const order = [t.featBlockAdsName, t.softenSwearingName, t.featMarkersName, t.rulesName];
    const at = order.map(name => text.indexOf(name));
    for (const [i, name] of order.entries()) expect(at[i], name).toBeGreaterThanOrEqual(0);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).toContain(t.rulesCount(1));
    // The level leads, since its line points at "any switch below"; the switches follow it.
    const mode = container.querySelector('.mode-card') as HTMLElement;
    expect(essentials.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  });

  it("shows none of Off's switches and no fold, though some are stored on", async () => {
    await render(settingsWith(), lang);
    expect(container.querySelector('details.set-fold')).toBeNull();
    const all = container.textContent ?? '';
    for (const name of offNames(t)) expect(all, name).not.toContain(name);
  });

  it('puts the level first, the AI drawer, with a key, right under it, and then the switches', async () => {
    const s = settingsWith();
    s.mode = 'adult';
    await render(s, lang, PAID);
    const headers = Array.from(container.querySelectorAll('.grp-hdr')).map(h => h.textContent);
    expect(headers.indexOf(t.setEssentialsTitle)).toBe(0);
    const mode = container.querySelector('.mode-card') as HTMLElement;
    const drawer = container.querySelector('.ai-drawer') as HTMLElement;
    const essentials = container.querySelector('.set-essentials') as HTMLElement;
    expect(mode.nextElementSibling).toBe(drawer);
    expect(drawer.compareDocumentPosition(essentials) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).toContain(t.featRewriteName);
  });

  it('reaches the own rules in one tap from the first screen', async () => {
    await render(settingsWith({ words: ['alpha'] }), lang);
    const jump = container.querySelector('.set-essentials button.set-rules-jump') as HTMLButtonElement;
    expect(jump).not.toBeNull();
    const target = document.getElementById(jump.getAttribute('aria-controls') ?? '');
    expect(target?.querySelector('.rules')).not.toBeNull();
    const scrolled = vi.fn();
    (target as HTMLElement).scrollIntoView = scrolled;
    await act(async () => { jump.click(); });
    expect(scrolled).toHaveBeenCalled();
  });
});

describe('Receipts settings: the own rules can be searched', () => {
  it('filters words, phrases and accounts apart, each with its count, and says when nothing matches', async () => {
    const t = POPUP_STRINGS.en;
    await render(settingsWith({ words: ['alpha', 'beta'], phrases: ['al dente'], accounts: ['gamma'] }));
    const search = container.querySelector(`input[type="search"][aria-label="${t.rulesSearch}"]`) as HTMLInputElement;
    expect(search).not.toBeNull();
    await typeInto(search, 'AL');
    const chips = Array.from(container.querySelectorAll('.rules .chip')).map(c => c.firstElementChild?.textContent);
    expect(chips).toEqual(['alpha', 'al dente']);
    expect(Array.from(container.querySelectorAll('.rules-count')).map(c => c.textContent)).toEqual(['2', '1', '1']);
    expect(container.querySelector('.rules .pill-n')?.textContent).toBe('×3');
    await typeInto(search, 'zzz');
    expect(container.querySelectorAll('.rules .chip')).toHaveLength(0);
    expect(container.textContent).toContain(t.searchNoMatch);
  });

  it('shows no search box while there are no rules', async () => {
    await render(settingsWith());
    expect(container.querySelector('.rules input[type="search"]')).toBeNull();
  });

  it('writes nothing to storage when it opens with Off switches stored on, the jump is pressed or the rules are searched', async () => {
    await render(settingsWith({ words: ['alpha'] }));
    expect(writes).not.toHaveBeenCalled();
    const jump = container.querySelector('button.set-rules-jump') as HTMLButtonElement;
    const target = document.getElementById(jump.getAttribute('aria-controls') ?? '') as HTMLElement;
    target.scrollIntoView = () => {};
    await act(async () => { jump.click(); });
    await typeInto(container.querySelector('.rules input[type="search"]') as HTMLInputElement, 'a');
    expect(writes).not.toHaveBeenCalled();
  });
});
