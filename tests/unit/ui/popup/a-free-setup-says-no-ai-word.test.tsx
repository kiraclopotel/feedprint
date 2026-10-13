/** @vitest-environment jsdom */
// Setup always runs with no key, so no screen of it may name the AI reading: a free install shows no AI word, nor
// the reading, a rewrite, the model or a BETA label, in any of the four languages, up to and after the last button. Setup
// used to end, at Moderate, on a license screen that said what a key turns on; it now ends on the recovery phrase at
// Strict and Moderate, and on the level screen for Relaxed, with no key field anywhere. A key goes in the License tab.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../../src/storage/settings';
import { screenWords } from '../../../helpers/screen-words';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

type Lang = (typeof UI_LANGUAGES)[number];

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

function button(text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}" (screen reads: ${host.textContent?.slice(0, 160)})`);
  return btn;
}

/** AI and IA as words, in capitals: "ia" is an ordinary Romanian verb. */
const AI_WORD = /\b(AI|IA)\b/;

/**
 * What else names the AI reading, in each language, as word starts: the reading, a rewrite, the model, the BETA
 * label. A regression that brought any of them back onto a setup screen fails here.
 */
const AI_STEMS: Record<Lang, string[]> = {
  en: ['reading', 'rewrit', 'model', 'beta'],
  ro: ['analiz', 'citire', 'rescri', 'model', 'beta'],
  es: ['análisis', 'lectura', 'reescri', 'modelo', 'beta'],
  'pt-BR': ['análise', 'leitura', 'reescrev', 'modelo', 'beta'],
};
const aiWords = (lang: Lang) => new RegExp(`(^|[^\\p{L}])(${AI_STEMS[lang].join('|')})`, 'iu');

/** Welcome, the level, the PIN twice, the phrase: every screen setup shows at that level, read as it stands. */
async function walkSetup(lang: Lang, level: 'modeChild' | 'modeTeen' | 'modeAdult'): Promise<string[]> {
  const t = POPUP_STRINGS[lang];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, { lang, children: createElement(SetupWizard, { onComplete: () => {} }) }));
  });
  await settle();
  const screens: string[] = [screenWords(host)];
  await click(button(t.beginSetup));
  const modeBtn = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn')).find((b) => b.querySelector('.label')?.textContent?.trim() === t[level]);
  if (!modeBtn) throw new Error(`no level button ${t[level]}`);
  await click(modeBtn);
  screens.push(screenWords(host));
  if (level === 'modeAdult') {
    await click(button(t.setupStartFree));
    await vi.waitFor(() => expect(local['setupDone']).toBe(true), { timeout: 5000 });
    // The screen itself has re-rendered after the press: its finish button now reads as working.
    await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[data-testid="setup-start-free"]')?.disabled).toBe(true), { timeout: 5000 });
    screens.push(screenWords(host));
    return screens;
  }
  await click(button(t.continueBtn));
  screens.push(screenWords(host));
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (const box of Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'))) {
    await act(async () => { setter.call(box, '7'); box.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  await click(button(t.continueBtn));
  screens.push(screenWords(host));
  expect((host.querySelector('.setup-step h2')?.textContent ?? '').trim()).toBe(t.setupRecoveryTitle);
  const bar = host.querySelector('.setup-progress')!;
  expect(bar.getAttribute('aria-valuenow'), 'the phrase is the last screen').toBe(bar.getAttribute('aria-valuemax'));
  await click(host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!);
  await click(host.querySelector<HTMLButtonElement>('[data-testid="setup-recovery-confirm"]')!);
  await vi.waitFor(() => expect(local['setupDone']).toBe(true), { timeout: 5000 });
  await vi.waitFor(() => expect(host.querySelector<HTMLButtonElement>('[data-testid="setup-recovery-confirm"]')?.disabled).toBe(true), { timeout: 5000 });
  screens.push(screenWords(host));
  return screens;
}

describe.each(UI_LANGUAGES)('%s: a free setup', (lang) => {
  const t = POPUP_STRINGS[lang];

  it.each(['modeChild', 'modeTeen', 'modeAdult'] as const)('at %s names no AI on any screen and asks for no key', async (level) => {
    const screens = await walkSetup(lang, level);
    // The level lines say what the person sees at a level (posts arrive rephrased), which is the level's behaviour and
    // not a pitch for a key; so does the welcome, whose one clause says the rephrasing the levels describe needs a key
    // and that without one every level filters on this computer (12 Oct 2026, packet 33: the Tester's twenty-first read
    // found the wizard promising rephrasing while saying nothing is sent). Every other word on the screens is still
    // held to the stems.
    const levelLines = [t.setupLevelChildLine, t.setupLevelTeenLine, t.setupLevelAdultLine, t.levelSentenceChild, t.levelSentenceTeen, t.levelSentenceAdult, t.setupWelcomeBody1];
    for (const [i, text] of screens.entries()) {
      expect(text, `screen ${i + 1}`).not.toMatch(AI_WORD);
      const rest = levelLines.reduce((acc, line) => acc.split(line).join(' '), text);
      expect(rest, `screen ${i + 1}`).not.toMatch(aiWords(lang));
    }
    expect(host.querySelector(`input[aria-label="${t.licCardName}"]`)).toBeNull();
  });
});
