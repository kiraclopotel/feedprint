// @vitest-environment jsdom
//
// The Facebook and Instagram engagement starters wire two scanners to two
// switches (2026-09-03): the structural finder runs under hide-action-buttons,
// the count-chip finder under hide-engagement-metrics, both when both are on,
// neither when neither is (the earlier either/or gap left a bare "2.4K" chip
// visible with both switches on, and the still-earlier unconditional scan
// left inline hides in place after the switches went off). Stop tears every
// scanner down. Named by no test until 2026-09-06.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset } from '../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../src/storage/settings';

const stopStructural = vi.fn();
const stopChips = vi.fn();
const startStructuralEngagementScan = vi.fn(() => stopStructural);
const startCountChipScan = vi.fn(() => stopChips);

vi.mock('../../../src/content/engagement/structural-finder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/engagement/structural-finder')>();
  return { ...actual, startStructuralEngagementScan: (...a: unknown[]) => startStructuralEngagementScan(...(a as [])) };
});
vi.mock('../../../src/content/engagement/section-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/engagement/section-model')>();
  return { ...actual, startCountChipScan: (...a: unknown[]) => startCountChipScan(...(a as [])) };
});

import { startFacebookEngagementControl } from '../../../src/content/engagement/facebook-engagement';
import { startInstagramEngagementControl } from '../../../src/content/engagement/instagram-engagement';

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'adult',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  };
}

function withSwitches(opts: { metrics: boolean; actions: boolean; posting?: boolean }): FeatureToggles {
  const f = adultPreset();
  for (const key of Object.keys(f)) f[key as keyof typeof f].enabled = false;
  f['hide-engagement-metrics'] = { enabled: opts.metrics };
  f['hide-action-buttons'] = { enabled: opts.actions };
  f['block-comment-posting'] = { enabled: opts.posting ?? false };
  return f;
}

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  startStructuralEngagementScan.mockClear();
  startCountChipScan.mockClear();
  stopStructural.mockClear();
  stopChips.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const cases = [
  ['Facebook', startFacebookEngagementControl],
  ['Instagram', startInstagramEngagementControl],
] as const;

describe.each(cases)('%s engagement starter', (_name, start) => {
  it('runs only the structural finder under hide-action-buttons alone', () => {
    const stop = start(makeSettings(withSwitches({ metrics: false, actions: true })));
    expect(startStructuralEngagementScan).toHaveBeenCalledTimes(1);
    expect(startCountChipScan).not.toHaveBeenCalled();
    stop();
    expect(stopStructural).toHaveBeenCalledTimes(1);
  });

  it('runs only the count-chip finder under hide-engagement-metrics alone', () => {
    const stop = start(makeSettings(withSwitches({ metrics: true, actions: false })));
    expect(startCountChipScan).toHaveBeenCalledTimes(1);
    expect(startStructuralEngagementScan).not.toHaveBeenCalled();
    stop();
    expect(stopChips).toHaveBeenCalledTimes(1);
  });

  it('runs both when both switches are on, and stops both', () => {
    const stop = start(makeSettings(withSwitches({ metrics: true, actions: true })));
    expect(startStructuralEngagementScan).toHaveBeenCalledTimes(1);
    expect(startCountChipScan).toHaveBeenCalledTimes(1);
    stop();
    expect(stopStructural).toHaveBeenCalledTimes(1);
    expect(stopChips).toHaveBeenCalledTimes(1);
  });

  it('starts no scanner when neither hide switch is on, even with another engagement switch on', () => {
    const stop = start(makeSettings(withSwitches({ metrics: false, actions: false, posting: true })));
    expect(startStructuralEngagementScan).not.toHaveBeenCalled();
    expect(startCountChipScan).not.toHaveBeenCalled();
    stop();
  });

  it('removes every style tag it added on stop', () => {
    const stop = start(makeSettings(withSwitches({ metrics: true, actions: true, posting: true })));
    expect(document.head.querySelectorAll('style').length).toBeGreaterThan(0);
    stop();
    expect(document.head.querySelectorAll('style').length).toBe(0);
  });
});
