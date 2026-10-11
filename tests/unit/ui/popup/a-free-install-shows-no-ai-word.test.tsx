/** @vitest-environment jsdom */
// The Subscription seat's outcome, 9 Oct 2026 ("a free install shows no AI button"), in the popup: an install without
// a key reads no AI word on Home, in the header (at every level, Strict included), on the License tab or in Settings, in
// any language, but the License tab's one line on what a key adds, outside Strict. One gate decides it
// (src/ui/popup/reading-gate.ts). Every screen is read settled: mounted, its effects run, its late parts (Home's page
// status line) drawn. The reading's own words are matched without regard to case
// (reading, rewrite, model, beta and their translations); "AI" and "IA" are matched as written, because "ai" is an
// everyday Romanian word ("ce ai văzut") and "ia" an everyday Portuguese one. Each surface also has a control, so a
// pattern that matches nothing cannot pass: Home, License and Settings with a key show the words; the header shows none
// even with a key, so its control shows that the scan reaches the chip's tooltip and spoken name, where such a word
// would sit.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HomeTab, KeysTab, SettingsPanel } from '../../../../src/ui/popup/Popup';
import { PopHeader } from '../../../../src/ui/popup/panels/header';
import { I18nProvider } from '../../../../src/i18n/react';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { type FWSettings, utcDayKey } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';
import { readingOnNow } from '../../../../src/ui/popup/reading-gate';
import { installCounterChrome } from '../../../helpers/fake-counter-chrome';

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
const LEVELS: Array<[string, FWSettings]> = [
  ['Relaxed', base],
  ['Strict', { ...base, mode: 'child', strictLanguage: true } as unknown as FWSettings],
];

// The reading's words, as words (a letter before the match means another word). Case is ignored for the words; AI and
// IA are matched as written. Since 11 Oct 2026 the feature's own name, Live Rephrase, is one of the words: a free install
// never shows it, and it is what marks the surfaces where a key is held.
const WORDS: Record<Lang, string> = {
  en: 'reading|rewrit|model(?![\\p{L}])|beta|live rephrase',
  ro: 'citi|citește|rescri|model(?![\\p{L}])|beta|live rephrase',
  es: 'lectura|léeme|reescri|modelo|beta|live rephrase',
  'pt-BR': 'leitura|leia isso|reescri|modelo|beta|live rephrase',
} as Record<Lang, string>;
const ACRONYM: Record<Lang, string> = { en: 'AI', ro: 'AI', es: 'IA|AI', 'pt-BR': 'IA|AI' } as Record<Lang, string>;
// The words a person meets: the text, and the tooltips and spoken names on the tags; not class names or links.
function readable(html: string): string {
  return html.replace(/<[^>]*>/g, (tag) => ' ' + (tag.match(/(?:title|aria-label)="[^"]*"/g) ?? []).join(' ') + ' ');
}
function found(html: string, lang: Lang): string | null {
  const text = readable(html);
  for (const re of [new RegExp(`(?<![\\p{L}])(${WORDS[lang]})`, 'iu'), new RegExp(`(?<![\\p{L}])(${ACRONYM[lang]})(?![\\p{L}])`, 'u')]) {
    const m = re.exec(text);
    if (m) return `${m[0]} in: ${text.slice(Math.max(0, m.index - 80), m.index + 40)}`;
  }
  return null;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Every screen settled: mounted, its effects run, its late parts drawn.
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  installCounterChrome();
  const c = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
  c.tabs = { query: vi.fn(async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=x' }]) };
  (c.runtime as Record<string, unknown>).getManifest = () => ({ version: '2.5.18' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
async function settled(lang: Lang, el: ReturnType<typeof createElement>): Promise<string> {
  await act(async () => { root.render(createElement(I18nProvider, { lang, children: el })); });
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return container.innerHTML;
}
const home = (settings: FWSettings, license: LicenseInfo, probeResult: string) =>
  createElement(HomeTab, { settings, license, probeResult, onOpenDashboard: () => {}, onOpenDashboardSection: () => {} } as never);
const keys = (settings: FWSettings, license: LicenseInfo) =>
  createElement(KeysTab, { settings, license, probeResult: 'ok', onChange: async () => {} });
const settingsPanel = (settings: FWSettings, license: LicenseInfo) =>
  createElement(SettingsPanel, { settings, license, onBack: () => {}, onChange: async () => {} });

describe.each(UI_LANGUAGES)('an install without a key, %s', (lang) => {
  it.each(LEVELS)('Home, settled, has no AI word, at %s', async (_level, settings) => {
    const html = await settled(lang, home(settings, FREE, 'ok'));
    expect(container.querySelector('.home-status'), 'the page status line has drawn').not.toBeNull();
    expect(found(html, lang)).toBeNull();
  });

  it.each([false, true])('the header has no AI word (strict: %s)', async (strict) => {
    expect(found(await settled(lang, createElement(PopHeader, { licenseState: 'free', keyHeld: false, strict })), lang)).toBeNull();
  });

  it.each(LEVELS)('the License tab, settled, has no AI word but its one line on what a key adds, at %s', async (level, settings) => {
    const html = await settled(lang, keys(settings, FREE));
    // Outside Strict the tab says once what a key adds, beside its link; that sentence is the reading's only word here.
    const line = esc(POPUP_STRINGS[lang].keyAdds);
    expect(html.split(line).length - 1, 'the line on what a key adds').toBe(level === 'Strict' ? 0 : 1);
    expect(found(html.replace(line, ''), lang)).toBeNull();
    // Strict makes no outside call, so its License tab has no key field to keep.
    if (level !== 'Strict') expect(container.querySelector('input'), 'the key field has drawn').not.toBeNull();
  });

  it.each(LEVELS)('Settings, settled, has no AI word, at %s', async (_level, settings) => {
    const html = await settled(lang, settingsPanel(settings, FREE));
    expect(container.querySelector('.feat-row'), 'the switches have drawn').not.toBeNull();
    expect(found(html, lang)).toBeNull();
  });
});

// The controls: the same surfaces where a key is held, settled the same way, so the patterns can fail.
describe.each(UI_LANGUAGES)('the words the test looks for show where a key is held, %s', (lang) => {
  it('Home, settled, with a key the server refused, says the AI checks are off', async () => {
    expect(found(await settled(lang, home(base, PAID, 'revoked')), lang)).not.toBeNull();
  });
  it('the License tab, settled, with a key says what the key turns on', async () => {
    expect(found(await settled(lang, keys(base, PAID)), lang)).not.toBeNull();
  });
  it('Settings, settled, with a key shows the AI card', async () => {
    expect(found(await settled(lang, settingsPanel(base, PAID)), lang)).not.toBeNull();
  });
  // The header names no reading even with a key, so its control is the scan itself: it reads the chip's tooltip and
  // spoken name (where an AI word on the header would sit), and it would catch one there.
  it('the header, settled, with a refused key: the scan reads the chip\'s tooltip and would catch an AI word in it', async () => {
    const t = POPUP_STRINGS[lang];
    const html = await settled(lang, createElement(PopHeader, { licenseState: 'err', keyHeld: true, strict: false }));
    expect(readable(html)).toContain(esc(t.statusRevoked));
    const acronym = ACRONYM[lang].split('|')[0];
    expect(found(html.replace(`title="${esc(t.statusRevoked)}"`, `title="${acronym} ${esc(t.statusRevoked)}"`), lang)).not.toBeNull();
  });
});

describe('the gate', () => {
  it('reads a paid key as turning the reading on, and no key as not', () => {
    expect(readingOnNow(PAID)).toBe(true);
    expect(readingOnNow(FREE)).toBe(false);
  });
});
