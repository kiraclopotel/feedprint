/** @vitest-environment jsdom */
// Off offered its recovery phrase only on Change PIN, which needs the current PIN. A person who set
// a PIN for the first time and forgot it had no phrase and no way back. Setting the first PIN now
// stores a fresh recovery phrase and shows it once, and the person confirms they have kept it,
// the way Change PIN does for an install that has none.
// M8: the PIN and the phrase take force together, when the person presses "I wrote it down". Until
// then nothing is stored (the-pin-takes-force-when-written-down.test.tsx drives the whole popup).

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { OffBody } from '../../../../src/products/off/popup/OffPopup';
import { I18nProvider } from '../../../../src/i18n/react';
import { _setProductForTesting } from '../../../../src/product';
import { adultPreset } from '../../../../src/storage/presets';
import {
  CURRENT_SETTINGS_SCHEMA_VERSION, hasRecoveryPhrase, resetPinWithRecoveryPhrase, saveSettings, setPin, setRecoveryPhrase, utcDayKey, utcMonthKey, verifyPin,
} from '../../../../src/storage/settings';
import type { FWSettings } from '../../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
          const out: Record<string, unknown> = {};
          for (const k of Array.isArray(keys) ? keys : [keys]) if (k in state) out[k] = state[k];
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
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.11' }) },
  };
}

function noPinSettings(): FWSettings {
  return {
    mode: 'adult', features: adultPreset(), parentPin: '', strictLanguage: true,
    uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
    hiddenByFeature: {},
  } as unknown as FWSettings;
}

let container: HTMLDivElement;
let root: Root;
let reload: Mock<() => Promise<void>>;

beforeEach(async () => {
  _setProductForTesting('off');
  installStorageStub();
  // A write drops the settings cache. The stub sends no change events, and the last test's reads
  // left a snapshot with its PIN in it.
  await saveSettings({ uiLanguage: 'en' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  reload = vi.fn(async (): Promise<void> => {});
  await renderWith(noPinSettings());
});

async function renderWith(settings: FWSettings): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(OffBody, { settings, reload }),
    }));
  });
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  _setProductForTesting(null);
});

function button(text: string): HTMLButtonElement {
  const b = Array.from(container.querySelectorAll('button')).find(x => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
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
  // The PIN and the phrase are hashed with PBKDF2, which takes real time in jsdom.
  for (let i = 0; i < 100 && !until(); i++) {
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
  }
}

const phraseEl = (): Element | null => container.querySelector('[data-testid="recovery-phrase"]');

async function setFirstPin(pin: string): Promise<void> {
  await act(async () => { button('Set PIN').click(); });
  const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('.pin-box'));
  expect(inputs.length).toBe(8);
  await typeDigits(inputs.slice(0, 4), pin);
  await typeDigits(inputs.slice(4, 8), pin);
  await act(async () => { button('Set PIN').click(); });
  await settle(() => phraseEl() !== null);
}

describe('Off: the first PIN comes with its recovery phrase', () => {
  it('setting the first PIN shows a recovery phrase once, and it is the one stored', { timeout: 20000 }, async () => {
    expect(await hasRecoveryPhrase()).toBe(false);
    await setFirstPin('2468');

    expect(phraseEl(), 'the phrase card is shown after the PIN is saved').not.toBeNull();
    const phrase = phraseEl()!.textContent!.trim();
    expect(phrase).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(container.textContent).toContain('Save your recovery phrase');
    // Off keeps no record, so its warning says to reinstall Off and mentions no record.
    expect(container.textContent).toContain('remove and reinstall Off');
    // M8: while the card shows, neither the PIN nor the phrase is stored.
    expect(await hasRecoveryPhrase()).toBe(false);
    expect(state['parentPin']).toBeUndefined();

    await act(async () => { container.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => phraseEl() === null && state['fw_pin_recovery'] !== undefined);
    expect(await hasRecoveryPhrase()).toBe(true);
    expect(await verifyPin('2468')).toBe(true);

    // The phrase on screen is the phrase stored: it resets the PIN.
    expect(await resetPinWithRecoveryPhrase(phrase, '1357')).toBe(true);
    expect(await verifyPin('1357')).toBe(true);
  });

  it('the phrase goes away when the person says they wrote it down, and is not shown again', { timeout: 20000 }, async () => {
    await setFirstPin('2468');
    const phrase = phraseEl()!.textContent!.trim();
    expect(reload, 'the popup is not reloaded under the card').not.toHaveBeenCalled();

    await act(async () => { container.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => phraseEl() === null);

    expect(phraseEl()).toBeNull();
    expect(container.textContent).not.toContain(phrase);
    expect(reload).toHaveBeenCalled();
  });

  // A switch flip or a theme change reloads the popup. Before the person confirms, the reload reads no
  // PIN (M8: none is stored yet) and the card must survive it; once confirmed, the reload reads the PIN
  // just stored and the row that set it turns into Change PIN.
  it('a reload before the person confirms keeps the phrase on screen', { timeout: 20000 }, async () => {
    await setFirstPin('2468');
    const phrase = phraseEl()!.textContent!.trim();

    await renderWith({ ...noPinSettings(), parentPin: (state['parentPin'] as string | undefined) ?? '' } as FWSettings);

    expect(phraseEl(), 'the card survives the reload').not.toBeNull();
    expect(phraseEl()!.textContent!.trim()).toBe(phrase);

    await act(async () => { container.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => phraseEl() === null);
    await renderWith({ ...noPinSettings(), parentPin: state['parentPin'] as string } as FWSettings);

    expect(phraseEl()).toBeNull();
    expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Change PIN'),
      'once confirmed, the row is Change PIN').toBe(true);
  });

  it('while the phrase is showing there is no Cancel that would close it unread', { timeout: 20000 }, async () => {
    await setFirstPin('2468');
    const cancels = Array.from(container.querySelectorAll('button')).filter(b => b.textContent?.trim() === 'Cancel');
    expect(cancels).toHaveLength(0);
  });

  it('a PIN already stored is never overwritten from a window that still says no PIN', { timeout: 20000 }, async () => {
    await setPin('1234');
    await setRecoveryPhrase('ABCD-EFGH');
    const storedPin = state['parentPin'];
    const storedPhrase = state['fw_pin_recovery'];

    await act(async () => { button('Set PIN').click(); });
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('.pin-box'));
    await typeDigits(inputs.slice(0, 4), '2468');
    await typeDigits(inputs.slice(4, 8), '2468');
    await act(async () => { button('Set PIN').click(); });
    await settle(() => (container.textContent ?? '').includes('A PIN is set.'));

    expect(state['parentPin']).toBe(storedPin);
    expect(state['fw_pin_recovery']).toBe(storedPhrase);
    expect(phraseEl()).toBeNull();
    expect(container.textContent).toContain('A PIN is set. Off asks for it each time it opens, except for 15 minutes after you type it.');
  });
});