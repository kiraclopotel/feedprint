// LOOP-029 Phase 2 — engagement controller activation predicate.
// Locks the contract: engagement runs iff ANY of the engagement-shaped
// features (hide-engagement-metrics / hide-action-buttons /
// block-comment-posting / rewritten-comments-first / strip-emojis) is
// enabled for the current platform. Per-platform overrides are honored
// (LOOP-029 core: feature-composable grid means a feature can be on for
// one platform, off for another).
//
// 2026-04-28 evening — rewritten for the post-DEC-012 (Groq-only) FWSettings
// shape and after `replace-toxic-with-educational` was retired alongside the
// educational-topic-pool feature. The new `strip-emojis` toggle is also
// covered.

import { describe, it, expect } from 'vitest';

import { shouldControlEngagement } from '../../../src/content/engagement/controller';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../src/storage/presets';

function makeSettings(features: FeatureToggles): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'teen',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
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

describe('shouldControlEngagement — LOOP-029 feature-driven activation', () => {
  // 2026-04-25 (DEC-015): the original "adult preset → no engagement"
  // test is removed. Adult preset is gone; both family modes have at least
  // one engagement feature ON by default (hide-engagement-metrics on for
  // both child + teen). The "all features OFF → no engagement" invariant
  // is still covered explicitly below in the per-feature block.

  it('child preset → engagement on tiktok (multiple features on)', () => {
    const s = makeSettings(childPreset());
    expect(shouldControlEngagement('tiktok', s)).toBe(true);
    expect(shouldControlEngagement('twitter', s)).toBe(true);
  });

  it('teen preset → engagement on tiktok (hide-engagement-metrics on)', () => {
    const s = makeSettings(teenPreset());
    expect(shouldControlEngagement('tiktok', s)).toBe(true);
  });

  describe('per-feature activation (each toggle alone activates)', () => {
    function withOnly(featureId: string, value: boolean): FWSettings {
      const features = teenPreset();
      // Reset everything off, then turn one on.
      for (const key of Object.keys(features)) {
        features[key as keyof typeof features].enabled = false;
      }
      features[featureId as keyof typeof features].enabled = value;
      return makeSettings(features);
    }

    it('hide-engagement-metrics ON → activates', () => {
      expect(shouldControlEngagement('tiktok', withOnly('hide-engagement-metrics', true))).toBe(true);
    });

    it('each YouTube feed switch alone activates on YouTube', () => {
      expect(shouldControlEngagement('youtube', withOnly('hide-home-feed', true))).toBe(true);
      expect(shouldControlEngagement('youtube', withOnly('hide-recommended-videos', true))).toBe(true);
    });
    it('hide-action-buttons ON → activates (LOOP-026 bug (a) fix)', () => {
      expect(shouldControlEngagement('tiktok', withOnly('hide-action-buttons', true))).toBe(true);
    });
    it('block-comment-posting ON → activates', () => {
      expect(shouldControlEngagement('tiktok', withOnly('block-comment-posting', true))).toBe(true);
    });
    it('rewritten-comments-first ON → activates', () => {
      expect(shouldControlEngagement('tiktok', withOnly('rewritten-comments-first', true))).toBe(true);
    });
    it('strip-emojis ON → activates (cosmetic stripper runs alongside engagement modules)', () => {
      expect(shouldControlEngagement('tiktok', withOnly('strip-emojis', true))).toBe(true);
    });
    it('all engagement features OFF → does not activate', () => {
      const features = teenPreset();
      for (const key of Object.keys(features)) {
        features[key as keyof typeof features].enabled = false;
      }
      const s = makeSettings(features);
      expect(shouldControlEngagement('tiktok', s)).toBe(false);
      expect(shouldControlEngagement('twitter', s)).toBe(false);
    });
  });

  describe('per-platform overrides', () => {
    // 2026-04-25 (DEC-015): rewrote per-platform tests against an all-off
    // baseline instead of teenPreset(). Teen preset has multiple engagement
    // features ON, so a single-feature per-platform override doesn't fully
    // toggle activation — the contract being tested (per-platform precedence
    // for ONE feature) needs an isolated minimal fixture, not a populated
    // preset. Builds a clean blank features object then sets exactly the
    // feature under test.
    function blankFeatures(): ReturnType<typeof teenPreset> {
      const features = teenPreset();
      for (const key of Object.keys(features)) {
        features[key as keyof typeof features].enabled = false;
      }
      return features;
    }

    it('feature ON top-level + per-platform OFF for tiktok → no activation on tiktok', () => {
      const features = blankFeatures();
      features['hide-engagement-metrics'].enabled = true;
      features['hide-engagement-metrics'].perPlatform = {
        tiktok: { enabled: false },
      };
      const s = makeSettings(features);
      expect(shouldControlEngagement('tiktok', s)).toBe(false);
      expect(shouldControlEngagement('twitter', s)).toBe(true);
    });

    it('feature OFF top-level + per-platform ON for twitter → activation on twitter only', () => {
      const features = blankFeatures();
      features['hide-engagement-metrics'].enabled = false;
      features['hide-engagement-metrics'].perPlatform = {
        twitter: { enabled: true },
      };
      const s = makeSettings(features);
      expect(shouldControlEngagement('twitter', s)).toBe(true);
      expect(shouldControlEngagement('tiktok', s)).toBe(false);
    });
  });
});
