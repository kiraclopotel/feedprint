// LOOP-029 / DEC-011 / DESIGN §10.4 — feature-gate helpers.
// Locks isFeatureEnabled + getFeatureValue precedence rules.
//
// 2026-04-28 evening — rewritten to drop references to removed FeatureIds
// (`reframe-detected-manipulation`, `show-technique-explanations`,
// `grammar-correction`, `quiz-on-flagged`, `maturation-arc`,
// `replace-toxic-with-educational`, `educational-topic-pool`) and to align
// with the post-DEC-012 (Groq-only) FWSettings shape.

import { describe, it, expect } from 'vitest';

import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
  isFeatureEnabled,
  getFeatureValue,
  applyPreset,
} from '../../../src/storage/settings';
import { teenPreset, childPreset } from '../../../src/storage/presets';

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'teen',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '',
    dailyCap: 5000,
    monthlyUsdCapOverride: null,
    locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features,
    presets: { appliedAt: '', appliedPreset: 'teen' },
    dashboardTheme: 'dark',
  };
}

describe('isFeatureEnabled (LOOP-029 / DESIGN §10.4)', () => {
  it('returns top-level enabled when no platformId provided', () => {
    const s = makeSettings(teenPreset());
    // Per CYCLE N+18: teen preset has core ON + 3 selective opt-ins;
    // hide-action-buttons stays OFF for adolescent autonomy.
    expect(isFeatureEnabled(s, 'rewritten-comments-first')).toBe(true);
    expect(isFeatureEnabled(s, 'show-reframe-markers')).toBe(true);
    expect(isFeatureEnabled(s, 'hide-action-buttons')).toBe(false);
  });

  it('returns top-level enabled when platformId provided but no perPlatform override', () => {
    const s = makeSettings(teenPreset());
    expect(isFeatureEnabled(s, 'rewritten-comments-first', 'tiktok')).toBe(true);
    expect(isFeatureEnabled(s, 'show-reframe-markers', 'tiktok')).toBe(true);
    expect(isFeatureEnabled(s, 'hide-action-buttons', 'tiktok')).toBe(false);
  });

  it('per-platform enabled=true wins over top-level enabled=false', () => {
    const features = teenPreset();
    features['hide-engagement-metrics'].enabled = false;
    features['hide-engagement-metrics'].perPlatform = {
      tiktok: { enabled: true },
    };
    const s = makeSettings(features);
    expect(isFeatureEnabled(s, 'hide-engagement-metrics', 'tiktok')).toBe(true);
    expect(isFeatureEnabled(s, 'hide-engagement-metrics', 'twitter')).toBe(false);
    expect(isFeatureEnabled(s, 'hide-engagement-metrics')).toBe(false);
  });

  it('per-platform enabled=false wins over top-level enabled=true', () => {
    const features = teenPreset();
    features['rewritten-comments-first'].enabled = true;
    features['rewritten-comments-first'].perPlatform = {
      tiktok: { enabled: false },
    };
    const s = makeSettings(features);
    expect(isFeatureEnabled(s, 'rewritten-comments-first', 'tiktok')).toBe(false);
    expect(isFeatureEnabled(s, 'rewritten-comments-first', 'twitter')).toBe(true);
  });

  it('per-platform entry present but enabled=undefined falls through to top-level', () => {
    const features = teenPreset();
    features['rewritten-comments-first'].enabled = true;
    features['rewritten-comments-first'].perPlatform = {
      tiktok: { value: 'custom' },
    };
    const s = makeSettings(features);
    expect(isFeatureEnabled(s, 'rewritten-comments-first', 'tiktok')).toBe(true);
  });

  it('strip-emojis: ON in both presets (CYCLE N+18 mode-driven defaults)', () => {
    expect(isFeatureEnabled(makeSettings(childPreset()), 'strip-emojis')).toBe(true);
    expect(isFeatureEnabled(makeSettings(teenPreset()), 'strip-emojis')).toBe(true);
  });

  it('missing feature returns false (safe default)', () => {
    const s = makeSettings(teenPreset());
    // @ts-expect-error — intentional: test missing-feature branch.
    expect(isFeatureEnabled(s, 'this-feature-does-not-exist')).toBe(false);
  });

  it('empty features record returns false for any feature', () => {
    const s = makeSettings({} as FeatureToggles);
    expect(isFeatureEnabled(s, 'rewritten-comments-first')).toBe(false);
    expect(isFeatureEnabled(s, 'hide-engagement-metrics', 'tiktok')).toBe(false);
  });
});

describe('getFeatureValue (LOOP-029 / DESIGN §10.4)', () => {
  it('returns top-level value when no platformId provided', () => {
    // 2026-04-28 evening — only `comments-to-analyze-per-video` carries a
    // value on the surviving feature set; all other toggles are boolean-only.
    const s = makeSettings(childPreset());
    expect(getFeatureValue<number>(s, 'comments-to-analyze-per-video')).toBe(25);
  });

  it('returns undefined when feature has no value', () => {
    const s = makeSettings(teenPreset());
    expect(getFeatureValue(s, 'hide-engagement-metrics')).toBeUndefined();
    expect(getFeatureValue(s, 'hide-action-buttons')).toBeUndefined();
  });

  it('per-platform value wins over top-level value when defined', () => {
    const features = teenPreset();
    features['comments-to-analyze-per-video'].perPlatform = {
      tiktok: { value: 30 },
    };
    const s = makeSettings(features);
    expect(getFeatureValue<number>(s, 'comments-to-analyze-per-video', 'tiktok')).toBe(30);
    expect(getFeatureValue<number>(s, 'comments-to-analyze-per-video', 'twitter')).toBe(25);
    expect(getFeatureValue<number>(s, 'comments-to-analyze-per-video')).toBe(25);
  });

  it('per-platform entry present but value=undefined falls through', () => {
    const features = teenPreset();
    features['comments-to-analyze-per-video'].perPlatform = {
      tiktok: { enabled: false },
    };
    const s = makeSettings(features);
    expect(getFeatureValue<number>(s, 'comments-to-analyze-per-video', 'tiktok')).toBe(25);
  });

  it('missing feature returns undefined', () => {
    const s = makeSettings(teenPreset());
    // @ts-expect-error — intentional.
    expect(getFeatureValue(s, 'this-feature-does-not-exist')).toBeUndefined();
  });
});

describe('applyPreset (LOOP-029 / DESIGN §10.3)', () => {
  it('returns the child preset with a stamped presets audit (CYCLE N+18: maximum protection)', () => {
    const patch = applyPreset('child');
    // Child preset: core ON + every Additional protection ON.
    expect(patch.features['rewritten-comments-first'].enabled).toBe(true);
    // Silent has no dot to press: the marker starts off (the owner's yes, 12 Oct 2026).
    expect(patch.features['show-reframe-markers'].enabled).toBe(false);
    expect(patch.features['hide-action-buttons'].enabled).toBe(true);
    expect(patch.features['block-comment-posting'].enabled).toBe(true);
    expect(patch.features['strip-emojis'].enabled).toBe(true);
    expect(patch.presets.appliedPreset).toBe('child');
    expect(patch.presets.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns the teen preset with a stamped presets audit (CYCLE N+18: core + 3 selective)', () => {
    const patch = applyPreset('teen');
    expect(patch.features['rewritten-comments-first'].enabled).toBe(true);
    expect(patch.features['show-reframe-markers'].enabled).toBe(true);
    // Teen ON: metrics-hide + strip-emojis + AI-content.
    expect(patch.features['hide-engagement-metrics'].enabled).toBe(true);
    expect(patch.features['strip-emojis'].enabled).toBe(true);
    expect(patch.features['block-ai-content'].enabled).toBe(true);
    // Teen OFF (autonomy).
    expect(patch.features['hide-action-buttons'].enabled).toBe(false);
    expect(patch.features['block-comment-posting'].enabled).toBe(false);
    expect(patch.presets.appliedPreset).toBe('teen');
  });

  it('returns the adult preset with a stamped presets audit', () => {
    const patch = applyPreset('adult');
    expect(patch.features['rewritten-comments-first'].enabled).toBe(true);
    expect(patch.features['show-reframe-markers'].enabled).toBe(true);
    expect(patch.features['hide-engagement-metrics'].enabled).toBe(false);
    expect(patch.features['hide-action-buttons'].enabled).toBe(false);
    expect(patch.features['block-comment-posting'].enabled).toBe(false);
    expect(patch.features['block-ai-content'].enabled).toBe(false);
    expect(patch.presets.appliedPreset).toBe('adult');
    expect(patch.presets.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('each applyPreset call returns a fresh `features` object', () => {
    const a = applyPreset('child');
    const b = applyPreset('child');
    a.features['rewritten-comments-first'].enabled = false;
    expect(b.features['rewritten-comments-first'].enabled).toBe(true);
  });
});
