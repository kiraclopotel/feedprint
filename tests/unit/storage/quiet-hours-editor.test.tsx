/** @vitest-environment jsdom */
// The quiet-hours control (2026-09-15): the engine blocked pages on a stored
// schedule, but no screen could write one while the site promised quiet hours.
// These tests pin what the control writes and that the engine reads it back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { OffBody } from '../../../src/products/off/popup/OffPopup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../helpers/repo-root';
import {
  DEFAULT_QUIET_WINDOW,
  editWindow,
  isRefusal,
  minutesToTime,
  timeToMinutes,
} from '../../../src/ui/popup/QuietHoursEditor';
import { EN as POPUP_EN } from '../../../src/i18n/popup/en';
import { RO as POPUP_RO } from '../../../src/i18n/popup/ro';
import { ES as POPUP_ES } from '../../../src/i18n/popup/es';
import { PT_BR as POPUP_PT_BR } from '../../../src/i18n/popup/pt-br';
import { I18nProvider } from '../../../src/i18n/react';
import { adultPreset } from '../../../src/storage/presets';
import {
  CURRENT_SETTINGS_SCHEMA_VERSION,
  getFeatureValue,
  utcDayKey,
  utcMonthKey,
  type FWSettings,
} from '../../../src/storage/settings';
import { isWithinQuietHours, readQuietHoursSchedule } from '../../../src/core/quiet-hours';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('quiet hours: the pure edits', () => {
  it('turns minutes into the time field and back', () => {
    expect(minutesToTime(22 * 60)).toBe('22:00');
    expect(minutesToTime(7 * 60 + 5)).toBe('07:05');
    expect(minutesToTime(1440)).toBe('00:00');
    expect(timeToMinutes('21:30')).toBe(21 * 60 + 30);
    expect(timeToMinutes('')).toBeNull();
    expect(timeToMinutes('24:00')).toBeNull();
  });

  it('spells an end of midnight as 1440 and refuses windows the engine would drop', () => {
    // The refusals say WHICH one they are since 2026-09-19. Both used to be the
    // same null and the screen dropped it: no write, no message, the chip
    // snapping back. A parent unticking their last day and a parent setting an
    // end equal to the start need different sentences, so the two are named.
    const kept = editWindow(DEFAULT_QUIET_WINDOW, { endMin: 0 });
    expect(isRefusal(kept)).toBe(false);
    if (!isRefusal(kept)) expect(kept.endMin).toBe(1440);

    expect(editWindow(DEFAULT_QUIET_WINDOW, { startMin: 7 * 60 })).toBe('same-time');
    const oneDay = { ...DEFAULT_QUIET_WINDOW, days: [3] };
    expect(editWindow(oneDay, { toggleDay: 3 })).toBe('no-days');

    const twoDays = editWindow(oneDay, { toggleDay: 5 });
    expect(isRefusal(twoDays)).toBe(false);
    if (!isRefusal(twoDays)) expect(twoDays.days).toEqual([3, 5]);
  });

  it('has a sentence for each refusal, in four languages', () => {
    // The half the old null could not carry. A control that refuses in silence
    // is a control a person presses again.
    for (const [lang, table] of [['en', POPUP_EN], ['ro', POPUP_RO], ['es', POPUP_ES], ['pt-BR', POPUP_PT_BR]] as const) {
      expect(table.quietNeedsADay, `${lang} says why a day is needed`).toBeTruthy();
      expect(table.quietNeedsALength, `${lang} says why a length is needed`).toBeTruthy();
      expect(table.quietNeedsADay).not.toBe(table.quietNeedsALength);
    }
  });

  it('the screen shows the one that happened, and clears it on the next good edit', () => {
    const src = readFileSync(join(REPO_ROOT, 'src/ui/popup/QuietHoursEditor.tsx'), 'utf8');
    expect(src, 'the refusal is kept').toContain('setRefused(next)');
    expect(src, 'and cleared when an edit lands').toContain('setRefused(null)');
    expect(src, 'and the right sentence is chosen')
      .toContain("refused === 'no-days' ? t.quietNeedsADay : t.quietNeedsALength");
  });

  it('writes a default the engine keeps and reads as a school night', () => {
    const schedule = readQuietHoursSchedule({ schedule: [DEFAULT_QUIET_WINDOW] });
    expect(schedule).toHaveLength(1);
    expect(isWithinQuietHours(schedule, new Date(2026, 8, 15, 23, 0))).toBe(true);
    expect(isWithinQuietHours(schedule, new Date(2026, 8, 16, 6, 59))).toBe(true);
    expect(isWithinQuietHours(schedule, new Date(2026, 8, 16, 12, 0))).toBe(false);
  });
});

let state: Record<string, unknown> = {};
let container: HTMLDivElement;
let root: Root;

function install(): void {
  state = {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    lastResetDate: utcDayKey(),
    lastResetMonth: utcMonthKey(),
    features: adultPreset(),
    mode: 'adult',
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
        remove: () => Promise.resolve(),
      },
      session: { set: () => Promise.resolve(), get: () => Promise.resolve({}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    runtime: { sendMessage: vi.fn(async () => undefined), getManifest: () => ({ version: '1.0.0' }) },
  };
}

function currentSettings(): FWSettings {
  return {
    mode: 'adult', features: state.features, parentPin: '', strictLanguage: true,
    uiLanguage: 'en', outputLanguage: 'auto', locale: 'en', dashboardTheme: 'dark', hiddenByFeature: {},
  } as unknown as FWSettings;
}

async function render(): Promise<void> {
  const reload = async () => { await render(); };
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(OffBody, { settings: currentSettings(), reload }) }));
  });
}

function quietToggle(): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>('.quiet-hours button[role="switch"]');
  if (!el) throw new Error('no quiet-hours switch');
  return el;
}

beforeEach(() => {
  install();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe('quiet hours: the control in the Off popup', () => {
  it('is off with no schedule, and turning it on stores 22:00 to 07:00 every day for all sites', async () => {
    await render();
    expect(quietToggle().getAttribute('aria-checked')).toBe('false');
    expect(container.querySelector('.qh-body')).toBeNull();

    await act(async () => { quietToggle().click(); });

    const stored = readQuietHoursSchedule(getFeatureValue(currentSettings(), 'media-timeout'));
    expect(stored).toEqual([DEFAULT_QUIET_WINDOW]);
    // A global value reaches every platform that has no value of its own.
    expect(readQuietHoursSchedule(getFeatureValue(currentSettings(), 'media-timeout', 'tiktok'))).toEqual([DEFAULT_QUIET_WINDOW]);
    expect(quietToggle().getAttribute('aria-checked')).toBe('true');
    const times = container.querySelectorAll<HTMLInputElement>('.qh-times input');
    expect([...times].map(i => i.value)).toEqual(['22:00', '07:00']);
  });

  it('takes a day out, keeps the pause switches untouched, and turning off removes the schedule', async () => {
    await render();
    await act(async () => { quietToggle().click(); });
    const sunday = [...container.querySelectorAll<HTMLButtonElement>('.qh-day')].find(b => b.textContent === 'Sun');
    expect(sunday?.getAttribute('aria-pressed')).toBe('true');
    await act(async () => { sunday!.click(); });
    expect(readQuietHoursSchedule(getFeatureValue(currentSettings(), 'media-timeout'))[0].days).toEqual([1, 2, 3, 4, 5, 6]);

    const features = state.features as Record<string, { enabled: boolean }>;
    expect(features['media-timeout'].enabled).toBe(false);

    await act(async () => { quietToggle().click(); });
    expect(readQuietHoursSchedule(getFeatureValue(currentSettings(), 'media-timeout'))).toEqual([]);
    expect(container.querySelector('.qh-body')).toBeNull();
  });
});
