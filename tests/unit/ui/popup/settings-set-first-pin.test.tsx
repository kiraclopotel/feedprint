/** @vitest-environment jsdom */
// Settings offered only Change PIN, which needs the current PIN, so an install
// with no PIN (set up as Adult, switched to Child later) could never get one.
// With no PIN stored, Settings now sets one and shows a fresh recovery phrase
// once; with a PIN stored, or a snapshot that cannot say, it still asks for
// the current one.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SettingsPanel } from '../../../../src/ui/popup/panels/SettingsPanel';
import { I18nProvider } from '../../../../src/i18n/react';
import { childPreset } from '../../../../src/storage/presets';
import {
  setPin, setRecoveryPhrase, verifyPin, hasRecoveryPhrase, resetPinWithRecoveryPhrase,
  CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey,
} from '../../../../src/storage/settings';
import type { FWSettings } from '../../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
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

// A Child install whose PIN field is whatever storage holds, the shape an
// Adult setup leaves behind once the parent switches it to Child.
function childSettings(extra: Partial<FWSettings> = {}): FWSettings {
  return {
    mode: 'child', threshold: 5, features: childPreset(), parentPin: (state['parentPin'] as string) ?? '',
    dailyCap: 200, uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
    ...extra,
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

function findButton(text: string): HTMLButtonElement | undefined {
  return Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
}

function button(text: string): HTMLButtonElement {
  const btn = findButton(text);
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
  // The PIN and the phrase are hashed with PBKDF2, which takes real time in
  // jsdom; poll for the outcome instead of guessing a delay.
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  }
}

function pinInputs(): HTMLInputElement[] {
  return Array.from(host.querySelectorAll<HTMLInputElement>('.pin-box'));
}

// The PIN and the phrase are stored as `pbkdf2$<iterations>$<saltHex>$<digestHex>`.
// The salt and the digest are random hex, so a four-digit PIN can turn up inside
// them by chance and fail a correct build. With those two fields blanked, the
// rest of storage is where the secret must never appear.
const STORED_HASH = /^(pbkdf2\$\d+)\$[0-9a-f]+\$[0-9a-f]{64}$/;

function storageWithHashFieldsBlanked(): string {
  return JSON.stringify(state, (_key, value: unknown) =>
    typeof value === 'string'
      ? value.replace(STORED_HASH, (_all, head: string) => `${head}$salt$digest`)
      : value);
}

beforeEach(() => {
  installStorageStub();
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

describe('Settings: a first PIN can be set after setup', () => {
  it('with no PIN stored, Settings sets one and shows a working recovery phrase once', async () => {
    expect(state['parentPin']).toBeUndefined();
    await renderSettings(childSettings());

    await clickButton('Set PIN');
    const inputs = pinInputs();
    expect(inputs.length).toBe(8);
    await typeDigits(inputs.slice(0, 4), '2468');
    await typeDigits(inputs.slice(4, 8), '2468');
    await clickButton('Set PIN');
    await settle(() => host.querySelector('[data-testid="recovery-phrase"]') !== null);

    const phraseEl = host.querySelector('[data-testid="recovery-phrase"]');
    expect(phraseEl).not.toBeNull();
    const phrase = phraseEl!.textContent!.trim();
    expect(phrase).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);

    // M9: Set PIN only shows the phrase. The PIN and the phrase are stored together at
    // "I wrote it down", so while the card shows nothing is in force yet.
    expect(state['parentPin']).toBeUndefined();
    expect(state['fw_pin_recovery']).toBeUndefined();
    expect(await hasRecoveryPhrase()).toBe(false);

    await act(async () => { host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    // Storing is asynchronous (PBKDF2), so wait for the card to go before asserting on storage.
    await settle(() => host.querySelector('[data-testid="recovery-phrase"]') === null);

    expect(await verifyPin('2468')).toBe(true);
    expect(await verifyPin('0000')).toBe(false);

    expect(await hasRecoveryPhrase()).toBe(true);
    // Storage keeps hashes only, never the PIN or the phrase.
    expect(state['parentPin']).toMatch(STORED_HASH);
    expect(state['fw_pin_recovery']).toMatch(STORED_HASH);
    const stored = storageWithHashFieldsBlanked();
    expect(stored).not.toContain('2468');
    expect(stored).not.toContain(phrase);
    expect(stored).not.toContain(phrase.replace('-', ''));

    expect(host.querySelector('[data-testid="recovery-phrase"]')).toBeNull();
    expect(host.textContent).not.toContain(phrase);
    expect(onChange).toHaveBeenCalled();

    // The phrase shown is the one stored: it resets the PIN.
    expect(await resetPinWithRecoveryPhrase(phrase, '1357')).toBe(true);
    expect(await verifyPin('1357')).toBe(true);
  });

  it('two different PINs store nothing and say why the button is off', async () => {
    await renderSettings(childSettings());
    await clickButton('Set PIN');
    const inputs = pinInputs();
    await typeDigits(inputs.slice(0, 4), '2468');
    await typeDigits(inputs.slice(4, 8), '2486');
    expect(button('Set PIN').disabled).toBe(true);
    expect(host.textContent).toContain('The two PINs do not match.');
    expect(state['parentPin']).toBeUndefined();
    expect(await hasRecoveryPhrase()).toBe(false);
  });

  it('with a PIN stored, Settings offers only Change PIN, which needs the current one', async () => {
    await setPin('1234');
    await renderSettings(childSettings());
    expect(findButton('Set PIN')).toBeUndefined();
    expect(findButton('Change PIN')).toBeDefined();
  });

  it('a snapshot that could not be read does not offer to set a PIN over one that may exist', async () => {
    await setPin('1234');
    await renderSettings(childSettings({ parentPin: '', readFailedFallback: true }));
    expect(findButton('Set PIN')).toBeUndefined();
    expect(findButton('Change PIN')).toBeDefined();
  });

  // The popup does not reload when parentPin changes, so a window opened before
  // another one set a PIN still renders "no PIN" and offers Set PIN.
  async function submitOverStaleSnapshot(): Promise<void> {
    await clickButton('Set PIN');
    const inputs = pinInputs();
    await typeDigits(inputs.slice(0, 4), '2468');
    await typeDigits(inputs.slice(4, 8), '2468');
    await clickButton('Set PIN');
    await settle(() => host.querySelector('[data-testid="recovery-phrase"]') !== null
      || (host.textContent ?? '').includes('A PIN is set.')
      || (host.textContent ?? '').includes('could not read its local settings'));
  }

  it('a stale snapshot that says no PIN does not overwrite the PIN and phrase stored since', async () => {
    await setPin('1234');
    await setRecoveryPhrase('ABCD-EFGH');
    const storedPin = state['parentPin'];
    const storedPhrase = state['fw_pin_recovery'];
    await renderSettings(childSettings({ parentPin: '' }));

    await submitOverStaleSnapshot();

    expect(state['parentPin']).toBe(storedPin);
    expect(state['fw_pin_recovery']).toBe(storedPhrase);
    expect(host.querySelector('[data-testid="recovery-phrase"]')).toBeNull();
    expect(host.textContent).toContain('A PIN is set. Settings ask for it.');
  });

  it('a stale snapshot whose fresh read fails stores nothing and says the settings could not be read', async () => {
    await setPin('1234');
    const storedPin = state['parentPin'];
    await renderSettings(childSettings({ parentPin: '' }));
    const storage = (globalThis as unknown as { chrome: { storage: { local: { get: unknown } } } }).chrome.storage.local;
    storage.get = () => Promise.reject(new Error('storage busy'));

    await submitOverStaleSnapshot();

    expect(state['parentPin']).toBe(storedPin);
    expect(state['fw_pin_recovery']).toBeUndefined();
    expect(host.querySelector('[data-testid="recovery-phrase"]')).toBeNull();
    expect(host.textContent).toContain('Feedprint could not read its local settings.');
  });
});
