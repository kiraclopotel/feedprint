/** @vitest-environment jsdom */
// R5 (quality loop, 29 Sep 2026): on the last setup screen both finish buttons sat below the fold of a 600 px popup,
// under the long paragraph about where the PIN and the recovery phrase are kept. The paragraph is a disclosure and
// stays word for word; it now comes after the finish buttons, so the person sees how to finish before anything else.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

const t = POPUP_STRINGS.en;
let local: Record<string, unknown> = {};
let session: Record<string, unknown> = {};

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

let root: Root | null = null;
let host: HTMLElement;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(async () => {
  local = { settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey() };
  session = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: area(() => local), session: area(() => session), onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.16' }) },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, { lang: 'en', children: createElement(SetupWizard, { onComplete: vi.fn() }) }));
  });
  await settle();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null; host.remove(); document.body.innerHTML = '';
});

function button(text: string): HTMLButtonElement {
  const b = Array.from(host.querySelectorAll('button')).find(x => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}" (screen reads: ${host.textContent?.slice(0, 160)})`);
  return b;
}
const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await settle(); };

async function typePin(group: number, digits: string): Promise<void> {
  const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box')).slice(group * 4, group * 4 + 4);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  for (let i = 0; i < 4; i++) {
    await act(async () => { setter.call(boxes[i], digits[i]); boxes[i].dispatchEvent(new Event('input', { bubbles: true })); });
  }
  await settle();
}

/** Walk the wizard to its last screen at the given level: at Strict and at Moderate, the recovery phrase. */
async function toLastScreen(level: string): Promise<void> {
  await click(button(t.beginSetup));
  const mode = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn')).find(b => b.querySelector('.label')?.textContent?.trim() === level)!;
  await click(mode);
  await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
  await typePin(0, '1234');
  await typePin(1, '1234');
  await click(button(t.continueBtn));
  expect((host.querySelector('.setup-step h2')?.textContent ?? '').trim()).toBe(t.setupRecoveryTitle);
  const bar = host.querySelector('.setup-progress')!;
  expect(bar.getAttribute('aria-valuenow'), 'this is the last screen').toBe(bar.getAttribute('aria-valuemax'));
}

function heading(title: string = t.setupWhereSecretsTitle): HTMLElement {
  const h = Array.from(host.querySelectorAll<HTMLElement>('h3')).find(x => x.textContent?.trim() === title);
  if (!h) throw new Error(`the heading "${title}" is not on the screen`);
  return h;
}
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the last setup screen shows how to finish before the long note', () => {
  it.each([['Strict', t.modeChild], ['Moderate', t.modeTeen]])('at %s the finish button comes before the note about where the secrets are kept', async (_name, level) => {
    await toLastScreen(level);
    const finish = host.querySelector<HTMLElement>('[data-testid="setup-recovery-confirm"]');
    expect(finish, 'the finish button on the phrase screen').not.toBeNull();
    expect(finish!.textContent?.trim()).toBe(t.continueBtn);
    expect(before(finish!, heading())).toBe(true);
  });

  it.each([['Strict', t.modeChild], ['Moderate', t.modeTeen]])('at %s the note is there word for word, under its heading', async (_name, level) => {
    await toLastScreen(level);
    const note = Array.from(host.querySelectorAll<HTMLElement>('p')).find(p => p.textContent === t.setupWhereSecretsNote);
    expect(note, 'the note paragraph').toBeDefined();
    expect(before(heading(), note!)).toBe(true);
  });
});