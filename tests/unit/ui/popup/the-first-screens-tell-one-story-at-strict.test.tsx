/** @vitest-environment jsdom */
// B2F (PAINT-3 P3-2, P3-3; stranger's B2 re-walk A1, A3): the tail of B2 on screen. P3-1, the license step's
// buttons, left with the license step: setup runs with no key (a-free-setup-says-no-ai-word.test.tsx).
//   P3-2  at Strict there is no FREE pill on Home, no "Free" on the License tab, and the header chip does
//         not read LICENSE (it reads the level).
//   P3-3  at Strict the three locked switches wear one locked look (a padlock) and their accessible names
//         end with "at Strict" in words.
//   A1    at Strict the phrase step's note does not talk of a server or a company reading posts.
//   A3    Home at Moderate with no key does not show "0 AI readings today".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';

import { installStorage, unmount, walkSetupToLastStep, host, t as en } from '../../../helpers/popup-walk';
import { HomeTab, KeysTab, PopHeader, SettingsPanel } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import type { FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

type Lang = (typeof UI_LANGUAGES)[number];
type Mode = 'child' | 'teen';

const PAID: LicenseInfo = { tier: 'family', secret: 'abc' } as unknown as LicenseInfo;
const FREE: LicenseInfo = { tier: 'free', secret: '' } as unknown as LicenseInfo;
const esc = (s: string) => s.replace(/'/g, '&#x27;');

function settingsWith(mode: Mode): FWSettings {
  return {
    settingsSchemaVersion: '14', mode, strictLanguage: false, hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en', outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0, estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '', totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0, metricsHiddenToday: 0, metricsHiddenAllTime: 0,
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode }, dashboardTheme: 'dark', aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

const wrap = (lang: Lang, child: ReturnType<typeof createElement>): string =>
  renderToString(createElement(I18nProvider, { lang, children: child }));
const home = (mode: Mode, license: LicenseInfo, lang: Lang) => wrap(lang, createElement(HomeTab, {
  settings: settingsWith(mode), license, probeResult: 'unknown', onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
}));
const keys = (mode: Mode, license: LicenseInfo, lang: Lang) => wrap(lang, createElement(KeysTab, {
  settings: settingsWith(mode), license, probeResult: 'unknown', onChange: async () => {},
}));
const settingsPanel = (mode: Mode, license: LicenseInfo, lang: Lang) => wrap(lang, createElement(SettingsPanel, {
  settings: settingsWith(mode), license, onBack: () => {}, onChange: async () => {},
}));
const header = (lang: Lang, props: Record<string, unknown>) => wrap(lang, createElement(PopHeader, { licenseState: 'free', ...props } as never));

beforeEach(() => { installStorage(); });
afterEach(async () => { await unmount(); });

// ─── P3-2: at Strict, no FREE pill, no "Free", no LICENSE chip ───

describe.each(UI_LANGUAGES)('Strict without a key, %s (P3-2)', (lang) => {
  const t = POPUP_STRINGS[lang];

  // Since 8 Oct 2026 no plan pill is drawn anywhere; the header chip is the one place for the key's state.
  it('Home has no plan pill', () => {
    expect(home('child', FREE, lang)).not.toContain('class="pill"');
  });

  it('the License tab has no pill', () => {
    expect(keys('child', FREE, lang)).not.toContain('class="key-pill');
  });

  it('the header chip does not read LICENSE; it reads the level, and its tooltip is the Strict sentence', () => {
    const html = header(lang, { strict: true });
    expect(html).not.toContain(`>${esc(t.licenseLabel)}<`);
    expect(html).not.toContain(esc(t.statusFree));
    expect(html).toContain(`>${esc(t.modeChild)}<`);
    expect(html).toContain(esc(t.strictNoCallsLine));
  });

  // Since 9 Oct 2026 a free install away from Strict shows no chip: it read LICENSE beside the License tab.
  it('away from Strict the free install has no chip, and Home still has no pill', () => {
    expect(home('teen', FREE, lang)).not.toContain('class="pill"');
    expect(header(lang, { strict: false })).not.toContain('status-chip');
  });

  it('a key held at Strict still says the key is saved', () => {
    const html = header(lang, { strict: true, keyHeld: true, licenseState: 'unchecked' });
    expect(html).toContain(esc(t.statusKeyHeldShort));
  });
});

// ─── P3-3: the three locked switches at Strict ───

describe.each(UI_LANGUAGES)('Settings at Strict, %s (P3-3)', (lang) => {
  const t = POPUP_STRINGS[lang];

  // Without a key there is no AI card, so the AI switch is held only where a key is.
  it.each([['free', FREE, 2], ['paid', PAID, 3]] as const)('%s: AI checks and Mask swearing name the level, and every locked switch wears a padlock', (n, license, held) => {
    const html = settingsPanel('child', license, lang);
    expect(html.includes(`aria-label="${esc(t.featAiMasterAriaStrict)}"`)).toBe(n === 'paid');
    expect(html).toContain(`aria-label="${esc(t.softenSwearingAriaChild)}"`);
    expect(html).toContain(`aria-label="${esc(t.strictLangAriaChild)}"`);
    expect(t.featAiMasterAriaStrict).toContain(t.modeChild);
    expect(t.softenSwearingAriaChild).toContain(t.modeChild);

    const doc = new DOMParser().parseFromString(html, 'text/html');
    const locked = Array.from(doc.querySelectorAll('[role="switch"][aria-disabled="true"]'));
    expect(locked.length, 'the locked switches').toBeGreaterThanOrEqual(held);
    for (const sw of locked) {
      const padlock = sw.classList.contains('locked-on') || sw.querySelector('.toggle-lock') !== null;
      expect(padlock, sw.getAttribute('aria-label') ?? '').toBe(true);
    }
  });

  // The knob is the switch's ::after, painted after its children, so a padlock without a stacking value sat
  // under it and could not be seen (critic 2, HOLD 06:16). The span must be stacked above the knob.
  it('the padlock on a locked-off switch is stacked above the knob', () => {
    const doc = new DOMParser().parseFromString(settingsPanel('child', PAID, lang), 'text/html');
    const off = Array.from(doc.querySelectorAll('[role="switch"][aria-disabled="true"]')).filter((sw) => sw.querySelector('.toggle-lock'));
    expect(off.length, 'a locked-off switch carrying a padlock').toBeGreaterThanOrEqual(1);
    for (const sw of off) {
      const lock = sw.querySelector<HTMLElement>('.toggle-lock')!;
      expect(Number(lock.style.zIndex), sw.getAttribute('aria-label') ?? '').toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── A1: at Strict the phrase step's note is about the PIN and the phrase only ───

describe('the phrase step at Strict (A1)', () => {
  it('its note holds no server and no company reading posts', { timeout: 30000 }, async () => {
    await walkSetupToLastStep('child');
    const text = host.textContent ?? '';
    expect(text).toContain(en.setupWhereSecretsNote);
    expect(en.setupWhereSecretsNote.toLowerCase()).not.toContain('server');
    expect(en.setupWhereSecretsNote.toLowerCase()).not.toContain('company');
  });

  it('every language has the note about the PIN and phrase, with no server in it', () => {
    for (const lang of UI_LANGUAGES) {
      const s = POPUP_STRINGS[lang];
      expect(typeof s.setupWhereSecretsNote, lang).toBe('string');
      expect(s.setupWhereSecretsNote, lang).not.toContain('FeelingWise');
    }
  });
});

// ─── A3: no AI count until a key is saved ───

describe.each(UI_LANGUAGES)('Home at Moderate, %s (A3)', (lang) => {
  const t = POPUP_STRINGS[lang];

  it('without a key it shows no AI readings count', () => {
    const html = home('teen', FREE, lang);
    expect(html).not.toContain('pop-hero-secondary');
    expect(html).not.toContain('class="pop-tier"');
  });
});
