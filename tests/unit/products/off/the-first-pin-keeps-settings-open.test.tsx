/** @vitest-environment jsdom */
// M11 (was B2 unit 1, P1), Off's half. Setting Off's first PIN is not an entry of it: no grace window starts,
// so the next open asks. Only a PIN typed right starts the 15-minute grace.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installStorage } from '../../../helpers/popup-walk';
import { OffBody } from '../../../../src/products/off/popup/OffPopup';
import { I18nProvider } from '../../../../src/i18n/react';
import { _setProductForTesting } from '../../../../src/product';
import { adultPreset } from '../../../../src/storage/presets';
import { isPinGraceActive, saveSettings } from '../../../../src/storage/settings';
import type { FWSettings } from '../../../../src/storage/settings';

function noPinSettings(): FWSettings {
  return {
    mode: 'adult', features: adultPreset(), parentPin: '', strictLanguage: true,
    uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
    hiddenByFeature: {},
  } as unknown as FWSettings;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  _setProductForTesting('off');
  installStorage();
  await saveSettings({ uiLanguage: 'en' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(OffBody, { settings: noPinSettings(), reload: vi.fn(async (): Promise<void> => {}) }),
    }));
  });
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  _setProductForTesting(null);
});

const button = (text: string): HTMLButtonElement => {
  const b = Array.from(container.querySelectorAll('button')).find(x => x.textContent?.trim() === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
};

async function typeDigits(inputs: HTMLInputElement[], pin: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  for (let i = 0; i < pin.length && i < inputs.length; i++) {
    await act(async () => { setter.call(inputs[i], pin[i]); inputs[i].dispatchEvent(new Event('input', { bubbles: true })); });
  }
}

describe('Off: the first PIN does not start the grace window (M11)', () => {
  it('after Set PIN, no grace is running: setting a PIN is not typing it', { timeout: 20000 }, async () => {
    expect(await isPinGraceActive()).toBe(false);
    await act(async () => { button('Set PIN').click(); });
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('.pin-box'));
    await typeDigits(inputs.slice(0, 4), '2468');
    await typeDigits(inputs.slice(4, 8), '2468');
    await act(async () => { button('Set PIN').click(); });
    for (let i = 0; i < 100 && !container.querySelector('[data-testid="recovery-phrase"]'); i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    }

    expect(container.querySelector('[data-testid="recovery-phrase"]'), 'the phrase is shown').not.toBeNull();
    // M8: the PIN takes force when the person says they wrote the phrase down. M11: that is not a PIN entry, so no grace starts.
    expect(await isPinGraceActive(), 'no PIN in force yet, so no grace yet').toBe(false);
    await act(async () => { container.querySelector<HTMLInputElement>('[data-testid="recovery-kept"]')!.click(); });
    await act(async () => { container.querySelector<HTMLButtonElement>('[data-testid="recovery-continue"]')!.click(); });
    for (let i = 0; i < 100 && container.querySelector('[data-testid="recovery-phrase"]'); i++) {
      await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    }
    expect(container.querySelector('[data-testid="recovery-phrase"]'), 'the card is gone').toBeNull();
    expect(await isPinGraceActive(), 'setting a PIN is not typing it: the next open asks').toBe(false);
  });
});
