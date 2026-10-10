/** @vitest-environment jsdom */
// Setup sets Receipts' own switches from the chosen level and leaves what an older install stored for the
// switches that moved to Off, the same as a level change in Settings (a-level-keeps-what-off-stored.test.ts).
// Drives the real wizard to the end on the Adult path and reads what it wrote.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { adultPreset, childPreset } from '../../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, utcDayKey, utcMonthKey } from '../../../../src/storage/settings';
import { OFF_ONLY_FEATURE_IDS } from '../../../../src/storage/switch-scope';
import type { FeatureToggles } from '../../../../src/types/feature-toggles';

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

// An install that ran Strict with Off's switches on before they moved: Reels blocked, a TikTok break scheduled.
function storedByAnOlderInstall(): FeatureToggles {
  const f = childPreset();
  f['block-reels'] = { enabled: true };
  f['media-timeout'] = { enabled: false, perPlatform: { tiktok: { enabled: true, value: { schedule: [{ from: '21:00', to: '07:00' }] } } } };
  return f;
}

let root: Root | null = null;
let host: HTMLElement;

async function settle(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}
async function click(el: HTMLElement): Promise<void> {
  await act(async () => { el.click(); });
  await settle();
}
function button(text: string): HTMLButtonElement {
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
  if (!btn) throw new Error(`no button "${text}"`);
  return btn;
}

beforeEach(() => {
  local = {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    mode: 'child',
    features: storedByAnOlderInstall(),
  };
  session = {};
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: area(() => local),
      session: area(() => session),
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '2.5.18' }) },
  };
});

afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  root = null;
  document.body.innerHTML = '';
});

describe('setup keeps what the install stored for Off', () => {
  it("writes the Adult preset for Receipts' switches and leaves every Off switch as stored", async () => {
    const stored = storedByAnOlderInstall();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(I18nProvider, { lang: 'en', children: createElement(SetupWizard, { onComplete: () => {} }) }));
    });
    await settle();
    await click(button(t.beginSetup));
    const adult = Array.from(host.querySelectorAll<HTMLElement>('.mode-btn'))
      .find(b => b.querySelector('.label')?.textContent?.trim() === t.modeAdult);
    await click(adult!);
    await click(host.querySelector<HTMLElement>('[data-testid="setup-start-free"]')!);

    expect(local['mode']).toBe('adult');
    const written = local['features'] as FeatureToggles;
    expect(written['soften-swearing']).toEqual(adultPreset()['soften-swearing']);
    for (const id of OFF_ONLY_FEATURE_IDS) expect(written[id], id).toEqual(stored[id]);
  });
});
