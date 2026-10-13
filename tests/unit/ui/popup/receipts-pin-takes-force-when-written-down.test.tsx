/** @vitest-environment jsdom */
// M9 (L5, Receipts). Receipts' Settings stored the first PIN the moment "Set PIN" was pressed and only then showed
// the recovery phrase. A person who closed the popup before pressing "I wrote it down" came back to a lock, with a
// phrase they never saw. The PIN and the phrase now take force together, only at "I wrote it down" (as in Off, M8).
// Each "open" below mounts Settings afresh, as a real close and reopen does: closing the popup throws React state away.
// The setup wizard already keeps its PIN and phrase in memory until setup finishes; the last case pins that.

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SettingsPanel } from '../../../../src/ui/popup/panels/SettingsPanel';
import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { childPreset } from '../../../../src/storage/presets';
import {
  verifyPin, hasRecoveryPhrase, resetPinWithRecoveryPhrase,
  CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey,
} from '../../../../src/storage/settings';
import type { FWSettings } from '../../../../src/storage/settings';
import * as walk from '../../../helpers/popup-walk';

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

// What the popup would read from storage at open: a Child install with whatever PIN storage holds.
function childSettings(): FWSettings {
  return {
    mode: 'child', threshold: 5, features: childPreset(), parentPin: (state['parentPin'] as string) ?? '',
    dailyCap: 200, uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
  } as unknown as FWSettings;
}

let root: Root | null = null;
let host: HTMLElement;
let onChange: Mock<() => Promise<void>>;

/** Opens Settings as a browser does: a new tree, settings as storage stands. */
async function openSettings(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onChange = vi.fn(async (): Promise<void> => {});
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SettingsPanel, {
        settings: childSettings(), license: { tier: 'free', secret: '' }, onBack: () => {}, onChange, platform: null, openOn: 'device',
      }),
    }));
  });
}

/** Closes the popup: the tree and its state are gone, storage stays. */
async function closePopup(): Promise<void> {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  host?.remove();
}

const findButton = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
const click = (text: string): Promise<void> => {
  const b = findButton(text);
  if (!b) throw new Error(`no button "${text}"`);
  return act(async () => { b.click(); });
};
const pinInputs = (): HTMLInputElement[] => Array.from(host.querySelectorAll<HTMLInputElement>('.pin-box'));

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
  for (let i = 0; i < 100 && !until(); i++) await act(async () => { await new Promise(r => setTimeout(r, 50)); });
}

/** Set PIN 2468 twice and reach the phrase card; returns the phrase shown. */
async function reachPhrase(): Promise<string> {
  await click('Set PIN');
  await typeDigits(pinInputs().slice(0, 4), '2468');
  await typeDigits(pinInputs().slice(4, 8), '2468');
  await click('Set PIN');
  await settle(() => host.querySelector('[data-testid="recovery-phrase"]') !== null);
  const el = host.querySelector('[data-testid="recovery-phrase"]');
  expect(el, 'the phrase card is shown').not.toBeNull();
  return el!.textContent!.trim();
}

beforeEach(() => { installStorageStub(); });
afterEach(async () => {
  await closePopup();
  document.body.innerHTML = '';
});

describe('Receipts Settings: the first PIN takes force only when "I wrote it down" is pressed (M9)', () => {
  it('closing the popup on the phrase leaves no lock: Set PIN is offered again, with a new phrase', async () => {
    await openSettings();
    const first = await reachPhrase();

    // Nothing is in force while the phrase is on screen.
    expect(state['parentPin'], 'no PIN stored yet').toBeUndefined();
    expect(state['fw_pin_recovery'], 'no phrase stored yet').toBeUndefined();

    await closePopup();
    await openSettings();

    expect(await verifyPin('2468'), 'the closed popup left no PIN').toBe(false);
    expect(await hasRecoveryPhrase()).toBe(false);
    expect(findButton('Set PIN'), 'Set PIN is offered').toBeDefined();
    expect(findButton('Change PIN'), 'there is no PIN to change').toBeUndefined();

    const second = await reachPhrase();
    expect(second, 'a new phrase, not the one nobody read').not.toBe(first);
  });

  it('"I wrote it down" puts the PIN and the phrase in force together; the phrase shown is the one stored', async () => {
    await openSettings();
    const phrase = await reachPhrase();
    expect(state['parentPin']).toBeUndefined();

    await act(async () => { host.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { host.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    await settle(() => host.querySelector('[data-testid="recovery-phrase"]') === null);

    expect(host.querySelector('[data-testid="recovery-phrase"]')).toBeNull();
    expect(host.textContent).not.toContain(phrase);
    expect(onChange).toHaveBeenCalled();
    expect(await verifyPin('2468'), 'the right PIN opens').toBe(true);
    expect(await verifyPin('0000'), 'a wrong PIN does not').toBe(false);
    expect(await hasRecoveryPhrase()).toBe(true);
    expect(await resetPinWithRecoveryPhrase(phrase, '1357'), 'the phrase shown resets the PIN').toBe(true);
    expect(await verifyPin('1357')).toBe(true);
  });
});

describe('The setup wizard: nothing is in force before setup finishes (M9, already so)', () => {
  it('closing on the recovery phrase screen stores no PIN and no phrase', { timeout: 30000 }, async () => {
    walk.installStorage();
    await walk.mount(createElement(SetupWizard, { onComplete: () => {} }));
    await walk.click(walk.button(walk.t.beginSetup));
    await walk.click(walk.modeButton(walk.t.modeChild));
    await walk.click(walk.host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
    await walk.typePin(0, '1234');
    await walk.typePin(1, '1234');
    await walk.click(walk.button(walk.t.continueBtn));
    expect(walk.host.querySelector('[data-testid="recovery-phrase"]'), 'the phrase screen is up').not.toBeNull();

    expect(walk.local['parentPin'], 'no PIN while the phrase is on screen').toBeUndefined();
    expect(walk.local['fw_pin_recovery'], 'no phrase while it is on screen').toBeUndefined();
    expect(walk.local['setupDone']).not.toBe(true);
    await walk.unmount();
  });
});
