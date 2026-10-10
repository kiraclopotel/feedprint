/** @vitest-environment jsdom */
// M11 (F39), Receipts' Settings path: a person sets the first PIN in Settings ("Set PIN", then "I wrote it down"),
// closes the popup and opens it again at once: the PIN must be ASKED. Setting a PIN is not typing it, so no
// 15-minute grace starts; only a typed right PIN starts it. The session store is stateful here (the other
// Settings tests stub it as empty), because the grace lives there. Before M11 the mark was made on "I wrote it
// down", so the reopen let the person in (the verifier's reopen.mjs on the built package agreed).

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SettingsPanel } from '../../../../src/ui/popup/panels/SettingsPanel';
import { I18nProvider } from '../../../../src/i18n/react';
import { childPreset } from '../../../../src/storage/presets';
import {
  isPinGraceActive, verifyPin, CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey,
} from '../../../../src/storage/settings';
import type { FWSettings } from '../../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

let state: Record<string, unknown> = {};
let sessionState: Record<string, unknown> = {};

function pick(store: Record<string, unknown>, keys: string | string[] | null | undefined): Record<string, unknown> {
  if (keys === null || keys === undefined) return { ...store };
  const out: Record<string, unknown> = {};
  for (const k of Array.isArray(keys) ? keys : [keys]) if (k in store) out[k] = store[k];
  return out;
}

function installStorageStub(): void {
  state = {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  };
  sessionState = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (keys: string | string[] | null) => Promise.resolve(pick(state, keys)),
        set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
      },
      session: {
        get: (keys: string | string[] | null) => Promise.resolve(pick(sessionState, keys)),
        set: (obj: Record<string, unknown>) => { Object.assign(sessionState, obj); return Promise.resolve(); },
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.2.0' }) },
  };
}

function childSettings(): FWSettings {
  return {
    mode: 'child', threshold: 5, features: childPreset(), parentPin: '',
    dailyCap: 200, uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
  } as unknown as FWSettings;
}

let root: Root | null = null;
let host: HTMLElement;
let onChange: Mock<() => Promise<void>>;

async function renderSettings(settings: FWSettings): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onChange = vi.fn(async (): Promise<void> => {});
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SettingsPanel, {
        settings,
        license: { tier: 'free', secret: '' },
        onBack: () => {},
        onChange,
        platform: null,
      }),
    }));
  });
}

function button(text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}

function clickButton(text: string): Promise<void> {
  const btn = button(text);
  return act(async () => { btn.click(); });
}

async function typeDigits(inputs: HTMLInputElement[], pin: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (let i = 0; i < pin.length && i < inputs.length; i++) {
    await act(async () => {
      setter.call(inputs[i], pin[i]);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
}

async function settle(until: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  }
}

beforeEach(() => { installStorageStub(); });

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

describe('Receipts, Settings: the first PIN is asked at the next open', () => {
  it('after "I wrote it down" no grace is running, so the reopen asks; a typed PIN starts the grace', { timeout: 60000 }, async () => {
    await renderSettings(childSettings());

    await clickButton('Set PIN');
    const inputs = Array.from(host.querySelectorAll<HTMLInputElement>('.pin-box'));
    await typeDigits(inputs.slice(0, 4), '2468');
    await typeDigits(inputs.slice(4, 8), '2468');
    await clickButton('Set PIN');
    await settle(() => host.querySelector('[data-testid="recovery-phrase"]') !== null);
    expect(await isPinGraceActive(), 'no PIN in force yet, so no grace yet').toBe(false);

    await act(async () => { host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => host.querySelector('[data-testid="recovery-phrase"]') === null && state['parentPin'] !== undefined);

    expect(state['parentPin'], 'the PIN is in force').toBeDefined();
    expect(Object.keys(sessionState), 'setting a PIN marks nothing').toEqual([]);
    expect(await isPinGraceActive(), 'setting a PIN is not typing it: the next open asks').toBe(false);

    expect(await verifyPin('2468'), 'the PIN works').toBe(true);
    expect(await isPinGraceActive(), 'a typed right PIN starts the grace').toBe(true);
  });
});
