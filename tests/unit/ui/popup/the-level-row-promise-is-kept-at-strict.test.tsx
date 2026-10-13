/** @vitest-environment jsdom */
// W2 critic HOLD (A4). The level row promises the person can change the switches below it. At Strict that is not
// true of every switch: Mask swearing is locked (AI checks is live since Silent reads with a key, 12 Oct 2026). The row now says
// "any switch below that is not locked or greyed out"; this checks the exception is real, on the screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SettingsPanel } from '../../../../src/ui/popup/panels/SettingsPanel';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { childPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../../src/storage/settings';
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
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.16' }) },
  };
}

let root: Root | null = null;
let host: HTMLElement;

async function renderSettings(settings: FWSettings): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(SettingsPanel, {
        settings,
        license: { tier: 'free', secret: '' },
        onBack: () => {},
        onChange: async () => {},
        platform: null,
        openOn: 'general',
      }),
    }));
  });
}

const strictSettings = (): FWSettings => ({
  mode: 'child', threshold: 5, features: childPreset(), parentPin: '', dailyCap: 200,
  uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
} as unknown as FWSettings);

function toggle(label: string): HTMLElement | null {
  return host.querySelector(`[role="switch"][aria-label="${label}"]`);
}

beforeEach(() => { installStorageStub(); });
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

describe('Settings at Strict: the level row promises only what the switches below keep', () => {
  // The row's line left Settings on 8 Oct 2026 (his word: too much explanation); the lock on each switch says it.
  it('the row makes no promise about the switches below', async () => {
    await renderSettings(strictSettings());
    expect(host.textContent).not.toContain('any switch below');
  });

  it('at Strict, Strict language and Mask swearing are the switches that are locked', async () => {
    const t = POPUP_STRINGS.en;
    await renderSettings(strictSettings());
    for (const label of [t.softenSwearingAriaChild]) {
      const el = toggle(label);
      expect(el, `the switch "${label}" is on the screen`).not.toBeNull();
      expect(el!.getAttribute('aria-disabled'), `"${label}" is locked or greyed at Strict`).toBe('true');
    }
    // Without a key there is no AI card, so no AI switch to lock.
    expect(toggle(t.featAiMasterName)).toBeNull();
  });
});
