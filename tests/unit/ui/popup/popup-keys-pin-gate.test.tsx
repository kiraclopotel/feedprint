/** @vitest-environment jsdom */
// SEC-G15: the Keys tab had no PIN gate. A child removed the licence key from
// the popup and every post then passed at the free tier while the mode still
// read Child. With a parent PIN set, Remove and Save now open the same PIN
// modal as Settings (grace window honoured) and the action runs only after
// the PIN verifies.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const licenseMocks = vi.hoisted(() => ({
  clearLicense: vi.fn(async () => undefined),
  setLicense: vi.fn(async () => ({ ok: true as const, license: { tier: 'starter' as const, secret: 'abc' } })),
}));
const settingsMocks = vi.hoisted(() => ({
  grace: false,
  verify: true,
}));

vi.mock('../../../../src/storage/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/license')>();
  return { ...actual, clearLicense: licenseMocks.clearLicense, setLicense: licenseMocks.setLicense };
});
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    isPinGraceActive: vi.fn(async () => settingsMocks.grace),
    verifyPin: vi.fn(async () => settingsMocks.verify),
    pinLockRemainingMs: vi.fn(async () => 0),
  };
});
vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

import { KeysTab } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { childPreset } from '../../../../src/storage/presets';
import type { FWSettings } from '../../../../src/storage/settings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function settingsWith(parentPin: string): FWSettings {
  return {
    mode: 'child', threshold: 5, features: childPreset(), parentPin, dailyCap: 200,
    uiLanguage: 'en', outputLanguage: 'auto', locale: 'en',
  } as unknown as FWSettings;
}

let root: Root | null = null;
let host: HTMLElement;

async function renderKeys(parentPin: string): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(KeysTab, {
        settings: settingsWith(parentPin),
        license: { tier: 'starter', secret: 'abc123def456' },
        probeResult: 'ok',
        onChange: async () => {},
      }),
    }));
  });
}

function clickButton(text: string): Promise<void> {
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}"`);
  return act(async () => { btn.click(); });
}

beforeEach(() => {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) }, onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.2.0' }) },
  };
  licenseMocks.clearLicense.mockClear();
  licenseMocks.setLicense.mockClear();
  settingsMocks.grace = false;
  settingsMocks.verify = true;
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

describe('Keys tab PIN gate', () => {
  it('with a parent PIN set, Remove opens the PIN modal and does not clear the licence', async () => {
    await renderKeys('sha256-of-pin');
    await clickButton('Remove license');
    await clickButton('Remove');
    expect(host.querySelector('.pin-overlay')).not.toBeNull();
    expect(licenseMocks.clearLicense).not.toHaveBeenCalled();
  });

  it('a wrong PIN keeps the licence; the right PIN removes it', async () => {
    await renderKeys('sha256-of-pin');
    await clickButton('Remove license');
    await clickButton('Remove');
    const inputs = () => Array.from(host.querySelectorAll<HTMLInputElement>('.pin-overlay input'));
    expect(inputs().length).toBeGreaterThan(0);

    settingsMocks.verify = false;
    await typePin(inputs(), '9999');
    expect(licenseMocks.clearLicense).not.toHaveBeenCalled();
    expect(host.querySelector('.pin-overlay')).not.toBeNull();

    settingsMocks.verify = true;
    await typePin(inputs(), '1234');
    expect(licenseMocks.clearLicense).toHaveBeenCalledTimes(1);
    expect(host.querySelector('.pin-overlay')).toBeNull();
  });

  it('inside the PIN grace window, Remove runs without the modal', async () => {
    settingsMocks.grace = true;
    await renderKeys('sha256-of-pin');
    await clickButton('Remove license');
    await clickButton('Remove');
    expect(host.querySelector('.pin-overlay')).toBeNull();
    expect(licenseMocks.clearLicense).toHaveBeenCalledTimes(1);
  });

  it('with no parent PIN, Remove runs directly (setup not complete)', async () => {
    await renderKeys('');
    await clickButton('Remove license');
    await clickButton('Remove');
    expect(host.querySelector('.pin-overlay')).toBeNull();
    expect(licenseMocks.clearLicense).toHaveBeenCalledTimes(1);
  });
});

async function typePin(inputs: HTMLInputElement[], pin: string): Promise<void> {
  // PinDigits renders one input per digit; set each and dispatch React's
  // onChange through the native value setter.
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (let i = 0; i < pin.length && i < inputs.length; i++) {
    await act(async () => {
      setter.call(inputs[i], pin[i]);
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  // Let the async verify settle.
  await act(async () => { await new Promise(r => setTimeout(r, 10)); });
}
