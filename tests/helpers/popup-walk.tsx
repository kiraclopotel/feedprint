// A small harness for tests that walk the Receipts popup's setup like a person: a chrome storage stub
// (local and session areas), mount, find a button by its words, click, type a PIN. Used by the B2 units.
// The test file must also start with `/** @vitest-environment jsdom */`.

import { vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SetupWizard } from '../../src/ui/popup/Popup';
import { I18nProvider } from '../../src/i18n/react';
import { POPUP_STRINGS } from '../../src/i18n/popup-strings';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export const t = POPUP_STRINGS.en;
export const local: Record<string, unknown> = {};
export const session: Record<string, unknown> = {};

function area(store: Record<string, unknown>) {
  return {
    get: (keys: string | string[] | null) => {
      if (keys === null || keys === undefined) return Promise.resolve({ ...store });
      const out: Record<string, unknown> = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in store) out[k] = store[k];
      return Promise.resolve(out);
    },
    set: (obj: Record<string, unknown>) => { Object.assign(store, obj); return Promise.resolve(); },
    remove: (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
      return Promise.resolve();
    },
  };
}

export function installStorage(initial: Record<string, unknown> = {}): void {
  for (const k of Object.keys(local)) delete local[k];
  for (const k of Object.keys(session)) delete session[k];
  Object.assign(local, {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
  }, initial);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: area(local), session: area(session),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.16' }) },
  };
}

let root: Root | null = null;
export let host: HTMLElement;

export const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

export async function mount(child: ReturnType<typeof createElement>, lang: 'en' | 'es' | 'pt-BR' | 'ro' = 'en'): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(I18nProvider, { lang, children: child })); });
  await settle();
  return host;
}

export async function unmount(): Promise<void> {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
  document.body.innerHTML = '';
}

export function buttonOrNull(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find(x => x.textContent?.trim() === text);
}
export function button(text: string): HTMLButtonElement {
  const b = buttonOrNull(text);
  if (!b) throw new Error(`no button "${text}" (screen reads: ${host.textContent?.slice(0, 200)})`);
  return b;
}
export const click = async (el: HTMLElement) => { await act(async () => { el.click(); }); await settle(); };

/** Ticks "I wrote it down" under the recovery phrase, then presses the button that waited for it (stage 3, 10 Oct 2026). */
export async function keepPhraseAndContinue(): Promise<void> {
  const box = host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]');
  if (!box) throw new Error('no tick under the recovery phrase');
  await click(box);
  await click(button(t.continueBtn));
}

export async function typePin(group: number, digits: string): Promise<void> {
  const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box')).slice(group * 4, group * 4 + 4);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  for (let i = 0; i < 4; i++) {
    await act(async () => { setter.call(boxes[i], digits[i]); boxes[i].dispatchEvent(new Event('input', { bubbles: true })); });
  }
  await settle();
}

export function modeButton(label: string): HTMLElement {
  const btn = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn'))
    .find(b => b.querySelector('.label')?.textContent?.trim() === label);
  if (!btn) throw new Error(`no mode button "${label}"`);
  return btn;
}

/** Open the setup wizard and walk it to its last screen at the named level ('child' = Strict, 'teen' = Moderate). */
export async function walkSetupToLastStep(level: 'child' | 'teen', pin = '1234', onComplete: () => void = () => {}): Promise<void> {
  await mount(createElement(SetupWizard, { onComplete }));
  await click(button(t.beginSetup));
  await click(modeButton(level === 'child' ? t.modeChild : t.modeTeen));
  await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
  await typePin(0, pin);
  await typePin(1, pin);
  // The phrase screen is the last one at Strict and at Moderate; its button finishes setup.
  await click(button(t.continueBtn));
}
