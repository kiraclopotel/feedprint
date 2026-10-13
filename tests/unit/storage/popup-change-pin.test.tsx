/** @vitest-environment jsdom */
// UX-I18N-A11Y-1: the Settings panel has a Change PIN row. Changing the PIN
// needs the current PIN; an install that never received a recovery phrase
// gets one shown exactly once, and storage keeps only its salted hash.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SettingsPanel } from '../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../src/i18n/react';
import { childPreset } from '../../../src/storage/presets';
import {
  setPin, hasRecoveryPhrase, verifyPin, CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey,
} from '../../../src/storage/settings';
import type { FWSettings } from '../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

let state: Record<string, unknown> = {};

function installStorageStub(): void {
  state = {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: (keys: string | string[] | null) => {
          if (keys === null || keys === undefined) return Promise.resolve({ ...state });
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (k in state) out[k] = state[k];
          return Promise.resolve(out);
        },
        set: (obj: Record<string, unknown>) => { Object.assign(state, obj); return Promise.resolve(); },
        remove: (keys: string | string[]) => {
          for (const k of Array.isArray(keys) ? keys : [keys]) delete state[k];
          return Promise.resolve();
        },
      },
      session: { set: () => Promise.resolve(), get: () => Promise.resolve({}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.2.0' }) },
  };
}

function settingsWith(parentPin: string): FWSettings {
  return {
    mode: 'child', threshold: 5, features: childPreset(), parentPin, dailyCap: 200,
    uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
  } as unknown as FWSettings;
}

let root: Root | null = null;
let host: HTMLElement;

async function renderSettings(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SettingsPanel, {
        settings: settingsWith(state['parentPin'] as string),
        license: { tier: 'free', secret: '' },
        onBack: () => {},
        onChange: async () => {},
        openOn: 'device',
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
  // PBKDF2 at the key-wrap iteration count takes real time in jsdom; poll
  // until the panel shows the outcome instead of guessing a delay.
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  }
}

function pinInputs(): HTMLInputElement[] {
  return Array.from(host.querySelectorAll<HTMLInputElement>('.pin-box'));
}

beforeEach(async () => {
  installStorageStub();
  await setPin('1234');
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

describe('Settings: Change PIN row', () => {
  it('a wrong current PIN changes nothing and names the error', async () => {
    await renderSettings();
    await clickButton('Change PIN');
    const inputs = pinInputs();
    expect(inputs.length).toBe(12);
    await typeDigits(inputs.slice(0, 4), '0000');
    await typeDigits(inputs.slice(4, 8), '5678');
    await typeDigits(inputs.slice(8, 12), '5678');
    await clickButton('Save new PIN');
    await settle(() => (host.textContent ?? '').includes('Current PIN is incorrect.'));
    expect(host.textContent).toContain('Current PIN is incorrect.');
    expect(await verifyPin('1234')).toBe(true);
    expect(await verifyPin('5678')).toBe(false);
  });

  it('the right current PIN stores the new one; a legacy install sees its recovery phrase exactly once', async () => {
    expect(await hasRecoveryPhrase()).toBe(false);
    await renderSettings();
    await clickButton('Change PIN');
    const inputs = pinInputs();
    await typeDigits(inputs.slice(0, 4), '1234');
    await typeDigits(inputs.slice(4, 8), '5678');
    await typeDigits(inputs.slice(8, 12), '5678');
    await clickButton('Save new PIN');
    await settle(() => host.querySelector('[data-testid="recovery-phrase"]') !== null);

    const phraseEl = host.querySelector('[data-testid="recovery-phrase"]');
    expect(phraseEl).not.toBeNull();
    const phrase = phraseEl!.textContent!.trim();
    expect(phrase).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(await hasRecoveryPhrase()).toBe(true);
    // Storage never holds the phrase itself.
    expect(JSON.stringify(state)).not.toContain(phrase);
    expect(JSON.stringify(state)).not.toContain(phrase.replace('-', ''));

    await act(async () => { host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    expect(host.querySelector('[data-testid="recovery-phrase"]')).toBeNull();
    expect(host.textContent).not.toContain(phrase);

    // Opening the row again never shows the phrase: the install already has one.
    await clickButton('Change PIN');
    const again = pinInputs();
    await typeDigits(again.slice(0, 4), '5678');
    await typeDigits(again.slice(4, 8), '4321');
    await typeDigits(again.slice(8, 12), '4321');
    await clickButton('Save new PIN');
    // The row closes on success; no phrase card appears in between.
    await settle(() => host.querySelectorAll('.pin-box').length === 0);
    expect(host.querySelector('[data-testid="recovery-phrase"]')).toBeNull();
    expect(await verifyPin('4321')).toBe(true);
    expect(await verifyPin('1234')).toBe(false);
  });
});
