/** @vitest-environment jsdom */
// B3 units 2 and 3 (P6, P8): Off's first screen stops repeating "Hidden 0 times so far." under
// every switch, and every button in its popup has a name a screen reader can say.
//
// Walked 30 Sep (out/stranger/WALK-1.md C3, C4; QUALITY.md O2): on a fresh install the switch list
// says "Hidden 0 times so far." twelve times, including under "Block comment posting", which hides
// nothing that can be counted; and two buttons in the popup carry no text and no label.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { OffBody } from '../../../src/products/off/popup/OffPopup';
import { I18nProvider } from '../../../src/i18n/react';
import type { ResolvedUiLanguage } from '../../../src/i18n';
import { adultPreset } from '../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, offStartSettings, utcDayKey, utcMonthKey } from '../../../src/storage/settings';
import type { FWSettings } from '../../../src/storage/settings';

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
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.0' }) },
  };
}

function settings(hiddenByFeature: Record<string, number>): FWSettings {
  return {
    mode: 'adult', features: adultPreset(), parentPin: '', strictLanguage: true,
    uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark',
    hiddenByFeature,
  } as unknown as FWSettings;
}
const start = (hiddenByFeature: Record<string, number> = {}): FWSettings =>
  ({ ...settings(hiddenByFeature), ...offStartSettings(), hiddenByFeature } as FWSettings);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  installStorageStub();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

async function render(s: FWSettings, lang: ResolvedUiLanguage = 'en'): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, { lang, children: createElement(OffBody, { settings: s, reload: vi.fn(async () => {}) }) }));
  });
}

/** What a screen reader would say for a button: its label, else its text, else its title. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label')?.trim();
  if (label) return label;
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim();
    if (text) return text;
  }
  const text = el.textContent?.trim();
  if (text) return text;
  return el.getAttribute('title')?.trim() ?? '';
}

describe('P6: the hidden-times line appears only where it says something', () => {
  it('a fresh install shows no "so far" line under any switch', async () => {
    await render(start());
    const rows = Array.from(container.querySelectorAll('.feat-row'));
    expect(rows.length).toBeGreaterThan(10);
    const noted = rows.filter((r) => /so far/.test(r.textContent ?? '')).map((r) => r.textContent?.slice(0, 60));
    expect(noted).toEqual([]);
  });

  it('a switch that is on and has fired shows its count; the ones that never fired stay quiet', async () => {
    await render(start({ 'block-ads': 3 }));
    const withLine = Array.from(container.querySelectorAll('.feat-row')).filter((r) => /so far/.test(r.textContent ?? ''));
    expect(withLine).toHaveLength(1);
    expect(withLine[0].textContent).toContain('Hidden 3 times so far.');
  });

  it('a count on a switch that is off is not shown', async () => {
    const s = start({ 'block-reels': 5 });
    (s.features as Record<string, { enabled: boolean }>)['block-reels'] = { enabled: false };
    await render(s);
    expect(container.textContent).not.toContain('Hidden 5 times so far.');
  });

  it('Block comment posting never shows a count, whatever is stored', async () => {
    const s = start({ 'block-comment-posting': 4 });
    (s.features as Record<string, { enabled: boolean }>)['block-comment-posting'] = { enabled: true };
    await render(s);
    const row = Array.from(container.querySelectorAll('.feat-row')).find((r) => /Block comment posting/.test(r.textContent ?? ''));
    expect(row).toBeTruthy();
    expect(row?.textContent).not.toMatch(/so far/);
  });

  it('the Block this tally follows the same rule', async () => {
    await render(start());
    expect(container.querySelector('.pick-tally')?.textContent ?? '').not.toMatch(/so far/);
    await render(start({ picker: 2 }));
    expect(container.querySelector('.pick-tally')?.textContent).toContain('Hidden 2 times so far.');
  });
});

describe('P8: every button in the Off popup has a name', () => {
  it.each(['en', 'es', 'pt-BR', 'ro'] as ResolvedUiLanguage[])('%s: no button without a label, a text or a title', async (lang) => {
    await render(start({ picker: 1 }), lang);
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(15);
    const unnamed = buttons.filter((b) => nameOf(b) === '').map((b) => b.outerHTML.slice(0, 120));
    expect(unnamed).toEqual([]);
  });
});
