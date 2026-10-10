/** @vitest-environment jsdom */
// R3 (quality loop, 29 Sep 2026): on the PIN screen, typing eight digits from the first box filled the Choose row and
// stopped: focus never moved to Confirm, Continue stayed dim and four boxes sat empty. After the fourth Choose digit,
// focus now goes to the first Confirm box.

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

async function toPinScreen(): Promise<void> {
  await click(button(t.beginSetup));
  const mode = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn')).find(b => b.querySelector('.label')?.textContent?.trim() === t.modeChild)!;
  await click(mode);
  await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
}

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));

describe('the PIN screen carries the person from Choose to Confirm', () => {
  it('after the fourth Choose digit, focus is on the first Confirm box', async () => {
    await toPinScreen();
    await typePin(0, '1234');
    expect(document.activeElement).toBe(boxes()[4]);
  });

  it('typing eight digits in a row leaves both rows filled and Continue lit', async () => {
    await toPinScreen();
    await typePin(0, '1234');
    await typePin(1, '1234');
    expect(boxes().map(b => b.value).join('')).toBe('12341234');
    expect(button(t.continueBtn).disabled).toBe(false);
  });

  it('a Choose row that is not finished does not pull focus away', async () => {
    await toPinScreen();
    const first = boxes()[0];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => { setter.call(first, '1'); first.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(boxes().slice(4).some(b => b === document.activeElement)).toBe(false);
  });
});