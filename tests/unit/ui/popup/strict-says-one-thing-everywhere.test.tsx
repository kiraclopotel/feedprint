/** @vitest-environment jsdom */
// N1, 29 Sep 2026: Strict says one thing everywhere. At Strict nothing leaves the computer
// (makesNoOutsideCall, src/types/mode.ts): no AI reading, no license check, no outside time stamp.
// A fresh reader of Receipts 2.5.16 found four popup screens still speaking as if a key mattered
// there (rc-rewalk/rw2-VERDICT.md, "Other stumbles"):
//   1. setup step 5 at Strict said a key changes nothing, then offered "Save the key and finish";
//   2. the paragraph about the PIN and the recovery phrase sat under the "FeelingWise license" heading;
//   3. Strict Settings on the free tier still sold a key ("Unlock AI protection");
//   4. Strict with a key showed an "Active" pill and "0 of 2,000 AI calls today".
// Moderate keeps what is true there, so each check has its Moderate half.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import { HomeTab, KeysTab, SettingsPanel, SetupWizard } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey, type FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    settingsSchemaVersion: '14',
    mode,
    strictLanguage: false,
    hideUnrewritable: false,
    parentPin: '1234', dailyCap: 2000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    metricsHiddenToday: 0, metricsHiddenAllTime: 0,
    features: mode === 'child' ? childPreset() : teenPreset(),
    presets: { appliedAt: '', appliedPreset: mode },
    dashboardTheme: 'dark',
    aiAnalysisEnabled: true,
  } as unknown as FWSettings;
}

function wrap(lang: Lang, child: ReturnType<typeof createElement>): string {
  return renderToString(createElement(I18nProvider, { lang, children: child }));
}
const home = (mode: Mode, license: LicenseInfo, lang: Lang) => wrap(lang, createElement(HomeTab, {
  settings: settingsWith(mode), license, probeResult: 'unknown', onOpenDashboard: () => {}, onOpenDashboardSection: () => {},
}));
const keys = (mode: Mode, license: LicenseInfo, lang: Lang) => wrap(lang, createElement(KeysTab, {
  settings: settingsWith(mode), license, probeResult: 'unknown', onChange: async () => {},
}));
const settingsPanel = (mode: Mode, license: LicenseInfo, lang: Lang) => wrap(lang, createElement(SettingsPanel, {
  settings: settingsWith(mode), license, onBack: () => {}, onChange: async () => {},
}));

// ─── The setup wizard, driven in jsdom as the-license-step-says-what-strict-sends does ───

let local: Record<string, unknown> = {};
let root: Root | null = null;
let host: HTMLElement;

function area(store: () => Record<string, unknown>) {
  return {
    get: (keys: string | string[] | null) => {
      const s = store();
      if (keys === null || keys === undefined) return Promise.resolve({ ...s });
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in s) out[k] = s[k];
      return Promise.resolve(out);
    },
    set: (obj: Record<string, unknown>) => { Object.assign(store(), obj); return Promise.resolve(); },
    remove: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store()[k];
      return Promise.resolve();
    },
  };
}

beforeEach(() => {
  local = { settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() };
  const session: Record<string, unknown> = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: area(() => local), session: area(() => session), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.16' }) },
  };
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await settle();
}
function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
}
function button(text: string): HTMLButtonElement {
  const btn = findButton(text);
  if (!btn) throw new Error(`no button "${text}" (screen reads: ${host.textContent?.slice(0, 200)})`);
  return btn;
}

/**
 * Welcome, the level, the PIN twice, the phrase: the last screen setup shows at that level. At Moderate it is the
 * license step, step 5 of 5. At Strict it is the recovery-phrase screen, step 4 of 4, since B2 unit 8
 * (30 Sep 2026): nothing goes out at Strict, so setup no longer shows a license step there.
 */
async function lastStep(lang: Lang, level: 'modeChild' | 'modeTeen', onComplete: () => void = () => {}): Promise<void> {
  const t = POPUP_STRINGS[lang];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, { lang, children: createElement(SetupWizard, { onComplete }) }));
  });
  await settle();
  await click(button(t.beginSetup));
  const modeBtn = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn')).find((b) => b.querySelector('.label')?.textContent?.trim() === t[level]);
  if (!modeBtn) throw new Error(`no level button ${t[level]}`);
  await click(modeBtn);
  await click(button(t.continueBtn));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (const box of Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'))) {
    await act(async () => { setter.call(box, '7'); box.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  await click(button(t.continueBtn));
  expect((host.querySelector('.setup-step h2')?.textContent ?? '').trim()).toBe(t.setupRecoveryTitle);
  // The wizard's own progress bar says this is the last screen.
  const bar = host.querySelector('.setup-progress')!;
  expect(bar.getAttribute('aria-valuemax')).toBe('4');
  expect(bar.getAttribute('aria-valuenow')).toBe(bar.getAttribute('aria-valuemax'));
}

/** The text of the last heading that comes before the paragraph holding `text`, in document order. */
function headingAbove(text: string): string | null {
  let last: string | null = null;
  for (const el of Array.from(host.querySelectorAll('h1, h2, h3, h4, p'))) {
    if (/^H\d$/.test(el.tagName)) last = (el.textContent ?? '').trim();
    else if ((el.textContent ?? '').includes(text)) return last;
  }
  throw new Error('paragraph not on screen');
}

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const t = POPUP_STRINGS[lang];

  describe('1. the last setup screen', () => {
    it('at Strict has no key field, no key button and nothing about a key, and finishes with one plain button', async () => {
      const done = vi.fn();
      await lastStep(lang, 'modeChild', done);
      expect(host.querySelector(`input[aria-label="${t.licCardName}"]`)).toBeNull();
      expect(findButton(t.setupStartFree)).toBeUndefined();
      await click(host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!);
      await click(button(t.continueBtn));
      // The PIN and the phrase are hashed on the way (PBKDF2), which takes longer than one tick.
      await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1), { timeout: 5000 });
      expect(local['setupDone']).toBe(true);
      expect(local['mode']).toBe('child');
    });

    it('at Moderate ends the same way, with no key field', async () => {
      await lastStep(lang, 'modeTeen');
      expect(host.querySelector(`input[aria-label="${t.licCardName}"]`)).toBeNull();
      expect(host.querySelector('[data-testid="setup-recovery-confirm"]')?.textContent?.trim()).toBe(t.continueBtn);
    });
  });

  describe('2. the PIN and phrase paragraph has its own heading', () => {
    it('the heading exists in this language', () => {
      expect(t.setupWhereSecretsTitle.trim().length).toBeGreaterThan(8);
      expect(t.setupWhereSecretsTitle).not.toContain('—');
    });

    it('at Strict it sits under that heading on the phrase step, where setup ends', async () => {
      await lastStep(lang, 'modeChild');
      expect(headingAbove(t.setupWhereSecretsNote)).toBe(t.setupWhereSecretsTitle);
    });

    it('at Moderate it sits under that heading on the phrase step too', async () => {
      await lastStep(lang, 'modeTeen');
      expect(headingAbove(t.setupWhereSecretsNote)).toBe(t.setupWhereSecretsTitle);
    });
  });

  describe('3. Settings on the free tier sells no key', () => {
    it('at Strict with a key the AI row says Strict', () => {
      expect(settingsPanel('child', PAID, lang)).toContain(esc(t.featAiMasterStrictNote));
    });

    it('without a key, at Strict or Moderate, there is no AI row to explain', () => {
      for (const mode of ['child', 'teen'] as const) {
        const html = settingsPanel(mode, FREE, lang);
        expect(html).not.toContain(esc(t.featAiMasterStrictNote));
        expect(html).not.toContain(esc(t.featAiMasterName));
      }
    });
  });

  // His word, 8 Oct 2026: the key's state is said once, by the header chip; Home and the License tab carry no pill.
  describe('4. Strict with a key: the license is held, not reading', () => {
    it('the home card shows no pill and no AI call counter', () => {
      const html = home('child', PAID, lang);
      expect(html).not.toContain('class="pill"');
      expect(html).not.toContain(esc(t.metaUsage(0, 2000, 0)));
      expect(html).not.toContain(esc(t.metaMonthly(0)));
    });

    it('the License tab has no pill, and its line says the key is not checked in Strict', () => {
      const html = keys('child', PAID, lang);
      expect(html).not.toContain('class="key-pill');
      expect(html).toContain(esc(t.keySubStrict));
    });

    it('at Moderate the counter stays, on the License tab, with no pill', () => {
      const html = keys('teen', PAID, lang);
      expect(html).toContain(esc(t.metaUsage(0, 2000, 0)));
      expect(html).not.toContain('class="pill"');
    });
  });
});
