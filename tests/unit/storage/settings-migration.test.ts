// FeelingWise — settings migration contract (LOOP-242)
//
// Locks the pre/post-condition for `migrateSettings()`:
//   • Legacy install (no `settingsSchemaVersion`) → stamped '1', didMigrate=true.
//   • Already at current version → no-op, didMigrate=false.
//   • Unknown future version → passed through unchanged (we never downgrade).
//   • LOOP-029 v2→v3 seeds the feature-toggle grid from the preset.
//   • LOOP-074 v3→v4 force-re-seeds features from the current mode preset.
//
// 2026-04-28 — rewritten to match current FWSettings shape after the
// multi-provider purge (DEC-012, Groq-only) and the FeatureId removals
// (`reframe-detected-manipulation`, `show-technique-explanations`,
// `grammar-correction`, `quiz-on-flagged`, `maturation-arc`,
// `replace-toxic-with-educational`, `educational-topic-pool`).

import { describe, it, expect } from 'vitest';

import {
  migrateSettings,
  CURRENT_SETTINGS_SCHEMA_VERSION,
  FWSettings,
  ALL_FEATURE_IDS,
} from '../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../src/storage/presets';

// Minimal skeleton of a FWSettings object. Only the fields the migration
// inspects matter — the rest are padding so the type checker is happy.
// Migration inputs are legacy blobs: fields the current shape dropped (for
// example the v11 `videoControls`) are part of what the migration must consume,
// so overrides accept any key and the result is asserted as FWSettings.
function makeSettings(overrides: Partial<FWSettings> & Record<string, unknown> = {}): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'teen',
    strictLanguage: false,
    hideUnrewritable: false,
    aiAnalysisEnabled: true,
    parentPin: '',
    dailyCap: 5000,
    monthlyUsdCapOverride: null,
    locale: 'en',
    outputLanguage: 'auto',
    uiLanguage: 'auto',
    totalChecksToday: 0,
    totalNeutralizedToday: 0,
    totalTokensToday: 0,
    estimatedCostToday: 0,
    lastResetDate: '',
    totalChecksThisMonth: 0,
    totalTokensThisMonth: 0,
    lastResetMonth: '',
    totalTokensAllTime: 0,
    totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0,
    estimatedCostAllTime: 0,
    features: teenPreset(),
    presets: { appliedAt: '', appliedPreset: 'teen' },
    dashboardTheme: 'dark',
    ...overrides,
  };
}

describe('migrateSettings (LOOP-242)', () => {
  it('stamps legacy installs (no schema version) with the baseline version', () => {
    const legacy = makeSettings({ settingsSchemaVersion: '' });
    const result = migrateSettings(legacy);
    expect(result.didMigrate).toBe(true);
    expect(result.fromVersion).toBe('0-pre-versioning');
    expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
    expect(result.settings.settingsSchemaVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
  });

  it('treats undefined (stripped) schema version as legacy', () => {
    const stripped = makeSettings();
    delete (stripped as unknown as Record<string, unknown>).settingsSchemaVersion;
    const result = migrateSettings(stripped as FWSettings);
    expect(result.didMigrate).toBe(true);
    expect(result.settings.settingsSchemaVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
  });

  it('is a no-op when already at current version', () => {
    const current = makeSettings();
    const result = migrateSettings(current);
    expect(result.didMigrate).toBe(false);
    expect(result.fromVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
    expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
  });

  it('does not mutate the input', () => {
    const legacy = makeSettings({ settingsSchemaVersion: '' });
    const snapshot = JSON.parse(JSON.stringify(legacy));
    migrateSettings(legacy);
    expect(legacy).toEqual(snapshot);
  });

  it('preserves unknown future versions without downgrading', () => {
    const future = makeSettings({ settingsSchemaVersion: '99' });
    const result = migrateSettings(future);
    expect(result.didMigrate).toBe(false);
    expect(result.settings.settingsSchemaVersion).toBe('99');
  });

  it('preserves non-version fields during legacy stamp', () => {
    const legacy = makeSettings({
      settingsSchemaVersion: '',
      mode: 'child',
      dailyCap: 42,
    });
    Reflect.set(legacy, 'locale', 'ro');
    const result = migrateSettings(legacy);
    expect(result.settings.mode).toBe('child');
    expect(result.settings.dailyCap).toBe(42);
    expect(result.settings.locale).toBe('ro');
  });

  // ─── v1 → v2 cost-unit conversion (USD cents → USD dollars) ───
  describe('v1 → v2 cost-unit migration', () => {
    it('divides estimatedCostToday by 100 (cents → USD)', () => {
      const v1 = makeSettings({
        settingsSchemaVersion: '1',
        estimatedCostToday: 250,
      });
      const result = migrateSettings(v1);
      expect(result.didMigrate).toBe(true);
      expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
      expect(result.settings.estimatedCostToday).toBeCloseTo(2.5, 6);
    });

    it('divides estimatedCostAllTime by 100 (cents → USD)', () => {
      const v1 = makeSettings({
        settingsSchemaVersion: '1',
        estimatedCostAllTime: 1234,
      });
      const result = migrateSettings(v1);
      expect(result.settings.estimatedCostAllTime).toBeCloseTo(12.34, 6);
    });

    it('converts a zero-valued v1 to zero-valued v2 (no surprises)', () => {
      const v1 = makeSettings({
        settingsSchemaVersion: '1',
        estimatedCostToday: 0,
        estimatedCostAllTime: 0,
      });
      const result = migrateSettings(v1);
      expect(result.settings.estimatedCostToday).toBe(0);
      expect(result.settings.estimatedCostAllTime).toBe(0);
      expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
    });

    it('legacy (pre-versioning) install runs through v1 → v2 → v3 → v4 in one pass', () => {
      const legacy = makeSettings({
        settingsSchemaVersion: '',
        estimatedCostToday: 500,
      });
      const result = migrateSettings(legacy);
      expect(result.didMigrate).toBe(true);
      expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
      expect(result.settings.estimatedCostToday).toBeCloseTo(5.0, 6);
    });

    it('already-v2 install migrates forward to current version; cost fields preserved', () => {
      const v2 = makeSettings({
        settingsSchemaVersion: '2',
        estimatedCostToday: 0.03,
        estimatedCostAllTime: 1.25,
      });
      const result = migrateSettings(v2);
      expect(result.didMigrate).toBe(true);
      expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
      expect(result.settings.estimatedCostToday).toBeCloseTo(0.03, 6);
      expect(result.settings.estimatedCostAllTime).toBeCloseTo(1.25, 6);
    });
  });

  // ─── v2 → v3 feature-composable grid migration (LOOP-029 / DEC-011) ───
  describe('v2 → v3 / v3 → v4 feature-composable grid migration', () => {
    function makeV2(
      overrides: Partial<FWSettings> & Record<string, unknown> = {},
    ): FWSettings {
      const base = makeSettings({ settingsSchemaVersion: '2', ...overrides });
      delete (base as unknown as Record<string, unknown>).features;
      delete (base as unknown as Record<string, unknown>).presets;
      return base;
    }

    it('seeds every FeatureId from the preset matching the stored mode', () => {
      const v2 = makeV2({ mode: 'child' });
      const result = migrateSettings(v2);
      expect(result.didMigrate).toBe(true);
      expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
      for (const id of ALL_FEATURE_IDS) {
        expect(result.settings.features[id], `missing ${id}`).toBeDefined();
        expect(typeof result.settings.features[id].enabled).toBe('boolean');
      }
    });

    it('child mode → child preset seeds (CYCLE N+18: maximum protection — every additional protection ON)', () => {
      const v2 = makeV2({ mode: 'child' });
      const result = migrateSettings(v2);
      // Core "Rewrite + Marker dot" feature ships ON.
      expect(result.settings.features['rewritten-comments-first'].enabled).toBe(true);
      // Silent starts with no dot to press (the owner's yes, 12 Oct 2026).
      expect(result.settings.features['show-reframe-markers'].enabled).toBe(false);
      // Every Additional protection ON for Child preset.
      expect(result.settings.features['hide-engagement-metrics'].enabled).toBe(true);
      expect(result.settings.features['hide-action-buttons'].enabled).toBe(true);
      expect(result.settings.features['block-comment-posting'].enabled).toBe(true);
      expect(result.settings.features['strip-emojis'].enabled).toBe(true);
      expect(result.settings.features['block-ai-content'].enabled).toBe(true);
      expect(result.settings.features['block-reels'].enabled).toBe(true);
      expect(result.settings.presets.appliedPreset).toBe('child');
    });

    it('teen mode → teen preset seeds (CYCLE N+18: core + 3 selective opt-ins, leaves action buttons + comment posting + reels OFF)', () => {
      const v2 = makeV2({ mode: 'teen' });
      const result = migrateSettings(v2);
      expect(result.settings.features['rewritten-comments-first'].enabled).toBe(true);
      expect(result.settings.features['show-reframe-markers'].enabled).toBe(true);
      // Teen ON: AI-content blocker + metrics hider + emoji strip.
      expect(result.settings.features['hide-engagement-metrics'].enabled).toBe(true);
      expect(result.settings.features['strip-emojis'].enabled).toBe(true);
      expect(result.settings.features['block-ai-content'].enabled).toBe(true);
      // Teen OFF (autonomy): action-button hider, comment-post block, reels-blocker.
      expect(result.settings.features['hide-action-buttons'].enabled).toBe(false);
      expect(result.settings.features['block-comment-posting'].enabled).toBe(false);
      expect(result.settings.features['block-reels'].enabled).toBe(false);
      expect(result.settings.presets.appliedPreset).toBe('teen');
    });

    it('adult mode → adult preset seeds and keeps adult as the forensic mode tag', () => {
      const v2 = makeV2({ mode: 'adult' });
      const result = migrateSettings(v2);
      expect(result.settings.mode).toBe('adult');
      expect(result.settings.features['rewritten-comments-first'].enabled).toBe(true);
      expect(result.settings.features['show-reframe-markers'].enabled).toBe(true);
      expect(result.settings.features['hide-engagement-metrics'].enabled).toBe(false);
      expect(result.settings.features['hide-action-buttons'].enabled).toBe(false);
      expect(result.settings.features['block-comment-posting'].enabled).toBe(false);
      expect(result.settings.features['block-ai-content'].enabled).toBe(false);
      expect(result.settings.presets.appliedPreset).toBe('adult');
    });

    it('unknown mode value coerces to teen preset (post-DEC-015)', () => {
      // Unknown historical values coerce to 'teen'
      // via coerceLegacyMode helper in src/storage/settings.ts.
      const v2 = makeV2();
      (v2 as unknown as Record<string, unknown>).mode = 'nonsense';
      const result = migrateSettings(v2);
      expect(result.settings.presets.appliedPreset).toBe('teen');
      expect(result.settings.features['rewritten-comments-first'].enabled).toBe(true);
      // Teen preset has the metrics-hider ON.
      expect(result.settings.features['hide-engagement-metrics'].enabled).toBe(true);
    });

    it('stamps presets.appliedAt on migration', () => {
      const v2 = makeV2({ mode: 'teen' });
      const result = migrateSettings(v2);
      expect(result.settings.presets.appliedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('end-to-end v2→current: legacy videoControls discarded in favor of preset (LOOP-074)', () => {
      const v2 = makeV2({
        mode: 'child',
        videoControls: {
          childCommentMode: 'hidden',
          childHideMetrics: false,
          childBlockPosting: false,
          childBlockActions: false,
          childBlockActionsPlatforms: { tiktok: false, instagram: false, facebook: false, twitter: false },
          teenRewriteComments: true, teenHideMetrics: true, teenShowLessons: true,
          commentAnalysisCount: 999,
            },
      });
      const result = migrateSettings(v2);
      // v4 re-seed dominates: all features match childPreset() verbatim.
      // Per CYCLE N+18 mode-driven policy: child = maximum protection,
      // every Additional protection toggle ON; comment-analysis count = 25.
      expect(result.settings.features['rewritten-comments-first'].enabled).toBe(true);
      expect(result.settings.features['show-reframe-markers'].enabled).toBe(false);
      expect(result.settings.features['hide-engagement-metrics'].enabled).toBe(true);
      expect(result.settings.features['block-comment-posting'].enabled).toBe(true);
      expect(result.settings.features['comments-to-analyze-per-video'].value).toBe(25);
    });

    it('v3 install runs the LOOP-074 re-seed forward to current version', () => {
      const v3 = makeSettings({
        settingsSchemaVersion: '3',
        mode: 'child',
        features: {
          ...childPreset(),
          'hide-engagement-metrics': { enabled: false },
          'comments-to-analyze-per-video': { enabled: true, value: 15 },
        },
      });
      const result = migrateSettings(v3);
      expect(result.didMigrate).toBe(true);
      expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
      // v3→v4 force-reseed pulls from the current child preset, which
      // under CYCLE N+18 policy defaults `hide-engagement-metrics` ON
      // (Child = maximum protection) and `comments-to-analyze-per-video.value` = 25.
      expect(result.settings.features['hide-engagement-metrics'].enabled).toBe(true);
      expect(result.settings.features['comments-to-analyze-per-video'].value).toBe(25);
      expect(result.settings.presets.appliedPreset).toBe('child');
    });

    it('is a no-op once settings are already at the current schema version', () => {
      const current = makeSettings({ settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION });
      const result = migrateSettings(current);
      expect(result.didMigrate).toBe(false);
      expect(result.toVersion).toBe(CURRENT_SETTINGS_SCHEMA_VERSION);
    });
  });

});

// ─── v11 → v12: videoControls leaves the settings shape ───
describe('v11 → v12 videoControls removal', () => {
  it('a v11 blob still carrying videoControls migrates to v12 losing nothing else', () => {
    const v11 = makeSettings({ settingsSchemaVersion: '11', mode: 'child', dailyCap: 1234 });
    Reflect.set(v11, 'videoControls', {
      childCommentMode: 'educational', childHideMetrics: true, childBlockPosting: true,
      childBlockActions: true,
      childBlockActionsPlatforms: { tiktok: true, instagram: true, facebook: true, twitter: true },
      teenRewriteComments: true, teenHideMetrics: true, teenShowLessons: true,
      commentAnalysisCount: 15,
    });
    const result = migrateSettings(v11);
    expect(result.didMigrate).toBe(true);
    expect(result.settings.settingsSchemaVersion).toBe('14');
    expect('videoControls' in result.settings).toBe(false);
    expect(result.settings.mode).toBe('child');
    expect(result.settings.dailyCap).toBe(1234);
    expect(result.settings.features).toEqual(v11.features);
  });

  it('v12 -> v13 backfills the five surface switches, off, and keeps every other feature', () => {
    const v12 = makeSettings({ settingsSchemaVersion: '12', mode: 'adult' });
    const features = { ...v12.features } as Record<string, unknown>;
    for (const id of ['hide-stories', 'hide-suggestions', 'hide-marketplace', 'hide-groups', 'hide-right-column']) delete features[id];
    v12.features = features as typeof v12.features;
    const result = migrateSettings(v12);
    expect(result.didMigrate).toBe(true);
    expect(result.settings.settingsSchemaVersion).toBe('14');
    for (const id of ['hide-stories', 'hide-suggestions', 'hide-marketplace', 'hide-groups', 'hide-right-column']) {
      expect(result.settings.features?.[id as 'hide-stories']).toEqual({ enabled: false });
    }
    expect(result.settings.features?.['block-ads']).toEqual(features['block-ads']);
  });

  it('v13 -> v14 drops the removed media-understanding flags', () => {
    const v13 = makeSettings({ settingsSchemaVersion: '13' });
    const result = migrateSettings(v13);
    expect(result.didMigrate).toBe(true);
    expect(result.settings.settingsSchemaVersion).toBe('14');
  });

  it('a clean v14 blob is a no-op', () => {
    const v14 = makeSettings({ settingsSchemaVersion: '14' });
    const result = migrateSettings(v14);
    expect(result.didMigrate).toBe(false);
  });
});
