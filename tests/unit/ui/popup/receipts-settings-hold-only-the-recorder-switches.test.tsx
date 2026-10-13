/** @vitest-environment jsdom */
// Receipts is a recorder, so its Settings hold the few switches a clean record needs, all in General's one card: ads,
// the swear mask, the reframe markers and the user's own rules. The page parts, the break and quiet hours, Block this,
// the hashtag and AI-label hide, comment posting and emoji are Off's and appear nowhere, even when an install stored
// one of them on. Under the level the folds sit in one list, General, then with a key Live Rephrase, then PIN and
// language, each opening in place. Opening Settings, jumping to the rules or searching them writes no setting; a fold
// writes only its own open-or-shut choice.

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
import { forgetFoldChoices } from '../../../../src/ui/popup/panels/Fold';

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
  forgetFoldChoices();
  installChrome();
  writes.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

type Page = 'main' | 'general' | 'device';
async function render(s: FWSettings, lang: (typeof UI_LANGUAGES)[number] = 'en', license: LicenseInfo = FREE, openOn: Page = 'main'): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang,
      children: createElement(SettingsPanel, { settings: s, license, onBack: () => {}, onChange: async () => {}, openOn }),
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

const button = (label: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === label);

describe.each(UI_LANGUAGES)('Receipts settings, %s', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('General holds every switch it has, in order: ads, the swear mask, the markers, the own rules', async () => {
    await render(settingsWith({ words: ['alpha'] }), lang, FREE, 'general');
    const essentials = container.querySelector('.set-essentials') as HTMLElement;
    expect(essentials).not.toBeNull();
    const text = essentials.textContent ?? '';
    const order = [t.featBlockAdsName, t.softenSwearingName, t.featMarkersName, t.rulesName];
    const at = order.map(name => text.indexOf(name));
    for (const [i, name] of order.entries()) expect(at[i], name).toBeGreaterThanOrEqual(0);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(text).toContain(t.rulesCount(1));
    // No page was entered: the bar still reads Settings, with General open under the level.
    expect(container.querySelector('.settings-bar .title')?.textContent).toBe(t.settingsTitle);
    expect(button(t.setGeneralTitle)?.getAttribute('aria-expanded')).toBe('true');
  });

  it("shows none of Off's switches and no fold on either page, though some are stored on", async () => {
    for (const page of ['main', 'general', 'device'] as const) {
      await render(settingsWith(), lang, FREE, page);
      expect(container.querySelector('details.set-fold')).toBeNull();
      const all = container.textContent ?? '';
      for (const name of offNames(t)) expect(all, `${page}: ${name}`).not.toContain(name);
    }
  });

  // The owner's word of 12 Oct 2026: General, Live Rephrase and PIN and language are one list of folds of one shape,
  // one under the other, in that order; a free install has the first and the last.
  it('puts the level first and the folds right under it in one list: with a key Live Rephrase, General, Topics, then PIN and language', async () => {
    const s = settingsWith();
    s.mode = 'adult';
    const heads = () => Array.from(container.querySelectorAll('.ai-drawer')).map(f => f.querySelector('button.ai-drawer-head')?.textContent?.trim());
    await render(s, lang, PAID);
    const mode = container.querySelector('.mode-card') as HTMLElement;
    const folds = Array.from(container.querySelectorAll('.ai-drawer'));
    const reading = t.keySubActive === t.groupAi ? t.groupAi : `${t.groupAi}·${t.keySubActive}`;
    // With a key the reading leads (his word, 12 Oct 2026, evening); without one General does.
    expect(heads()).toEqual([reading, t.setGeneralTitle, t.topicsFoldName, t.setDeviceTitle]);
    expect(mode.nextElementSibling).toBe(folds[0]);
    expect(folds[0].nextElementSibling).toBe(folds[1]);
    expect(folds[1].nextElementSibling).toBe(folds[2]);
    expect(folds[2].nextElementSibling).toBe(folds[3]);
    expect(container.querySelector('.set-pages'), 'no row of page buttons').toBeNull();
    expect(container.textContent).toContain(t.featRewriteName);
    expect(container.querySelector('.set-essentials'), 'General is shut and not drawn yet').toBeNull();
    await render(s, lang, FREE);
    expect(heads()).toEqual([t.setGeneralTitle, t.topicsFoldName, t.setDeviceTitle]);
  });

  it('reaches the own rules in one tap from the General page', async () => {
    await render(settingsWith({ words: ['alpha'] }), lang, FREE, 'general');
    const jump = container.querySelector('.set-essentials button.set-rules-jump') as HTMLButtonElement;
    expect(jump).not.toBeNull();
    const target = document.getElementById(jump.getAttribute('aria-controls') ?? '');
    expect(target?.querySelector('.rules')).not.toBeNull();
    const scrolled = vi.fn();
    (target as HTMLElement).scrollIntoView = scrolled;
    await act(async () => { jump.click(); });
    expect(scrolled).toHaveBeenCalled();
  });

  it('PIN and language opens in place and holds the PIN row and the language picker, and the same header shuts it', async () => {
    await render(settingsWith(), lang);
    const open = button(t.setDeviceTitle);
    expect(open).toBeDefined();
    expect(container.querySelector('select')).toBeNull();
    await act(async () => { open!.click(); });
    expect(container.querySelector('.settings-bar .title')?.textContent).toBe(t.settingsTitle);
    expect(open!.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain(t.groupPin);
    expect(container.querySelector(`select[aria-label="${t.uiLangAria}"]`)).not.toBeNull();
    expect(container.querySelector('[role="switch"]')).toBeNull();
    expect(container.querySelector('.mode-card')).not.toBeNull();
    await act(async () => { open!.click(); });
    expect(open!.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector<HTMLElement>('#fw-fold-device')!.hidden).toBe(true);
  });
});

describe('Receipts settings: the own rules can be searched', () => {
  it('filters words, phrases and accounts apart, each with its count, and says when nothing matches', async () => {
    const t = POPUP_STRINGS.en;
    await render(settingsWith({ words: ['alpha', 'beta'], phrases: ['al dente'], accounts: ['gamma'] }), 'en', FREE, 'general');
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
    await render(settingsWith(), 'en', FREE, 'general');
    expect(container.querySelector('.rules input[type="search"]')).toBeNull();
  });

  it('writes no setting when it opens with Off switches stored on, a fold is opened, the jump is pressed or the rules are searched', async () => {
    // A fold keeps its own open-or-shut choice in storage (fw_fold_*), which is not a setting.
    const settingWrites = () => writes.mock.calls.filter(([o]) => Object.keys(o as object).some(k => !k.startsWith('fw_fold_')));
    await render(settingsWith({ words: ['alpha'] }));
    expect(writes).not.toHaveBeenCalled();
    const open = button(POPUP_STRINGS.en.setGeneralTitle)!;
    await act(async () => { open.click(); });
    const jump = container.querySelector('button.set-rules-jump') as HTMLButtonElement;
    const target = document.getElementById(jump.getAttribute('aria-controls') ?? '') as HTMLElement;
    target.scrollIntoView = () => {};
    await act(async () => { jump.click(); });
    await typeInto(container.querySelector('.rules input[type="search"]') as HTMLInputElement, 'a');
    expect(settingWrites()).toHaveLength(0);
    expect(writes.mock.calls.filter(([o]) => 'fw_fold_general_open' in (o as object))).toHaveLength(1);
  });
});
