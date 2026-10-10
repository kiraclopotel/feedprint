// Carrying an older install's settings forward, one schema version at a time.
//
// Cut out of src/storage/settings.ts on 2026-09-16 (PLAN-2026-09-16 item 10.3), where it sat in the
// middle of storage reads, usage counters and the PIN. This is the file to open when an install
// from an older version has to keep what it had.
//
// settings.ts re-exports migrateSettings, so nothing that called it changed.

import { FWSettings, VideoControls, SURFACE_FEATURE_IDS, coerceLegacyMode } from './settings-shape';
import type { FeatureToggles } from '../types/feature-toggles';
import { presetForMode } from './presets';

/**
 * Apply versioned settings migrations. Pure — does NOT touch chrome.storage;
 * caller is responsible for persisting the new `settingsSchemaVersion` if
 * `didMigrate` is true.
 *
 * Contract:
 *   • Missing `settingsSchemaVersion` = legacy pre-versioning install →
 *     treat as if stamped with the initial version (no data changes).
 *   • When adding a new version: append a new `case` block, transform the
 *     settings object in place, and fall through to the next case (no break
 *     between steps — migrations chain forward).
 *
 * Exported for unit testing.
 */
export function migrateSettings(input: FWSettings): {
  settings: FWSettings;
  didMigrate: boolean;
  fromVersion: string;
  toVersion: string;
} {
  const fromVersion = input.settingsSchemaVersion || '0-pre-versioning';
  const settings: FWSettings = { ...input };
  let didMigrate = false;

  // Legacy (pre-versioning) installs: stamp as '1' so the v1→v2 branch below
  // runs the cost-unit conversion. Without this, a pre-versioning user keeps
  // whatever garbage value `estimatedCostToday` has (likely 0 — see v1→v2
  // note — so no visible regression either way).
  if (!settings.settingsSchemaVersion) {
    settings.settingsSchemaVersion = '1';
    didMigrate = true;
  }

  // v1 → v2: cost fields were stored as USD cents under v1, but per-call
  // `Math.round(acc * 100) / 100` rounded sub-cent adds to zero, so in
  // practice almost every live install has `estimatedCostToday === 0`.
  // The migration still divides by 100 for correctness in case any user
  // crossed the rounding threshold.
  if (settings.settingsSchemaVersion === '1') {
    settings.estimatedCostToday = (settings.estimatedCostToday ?? 0) / 100;
    settings.estimatedCostAllTime = (settings.estimatedCostAllTime ?? 0) / 100;
    settings.settingsSchemaVersion = '2';
    didMigrate = true;
  }

  // v2 → v3 migration: seed `features` from the preset matching the stored
  // `mode` and preserve unambiguous legacy videoControls overrides into
  // their feature-toggle equivalents. `mode` stays on the settings object
  // as the forensic userAgeCategory tag.
  if (settings.settingsSchemaVersion === '2') {
    if (!settings.features || typeof settings.features !== 'object' ||
        Object.keys(settings.features).length === 0) {
      const seedMode = coerceLegacyMode(settings.mode);
      const features: FeatureToggles = presetForMode(seedMode);

      // The blob left FWSettings at v12; ancient v2 installs still carry it in
      // storage, so getSettings attaches the raw value untyped for this branch.
      const vc = (settings as unknown as Record<string, unknown>).videoControls as VideoControls | undefined;
      if (vc) {
        // Carry forward unambiguous legacy videoControls into v3 toggles.
        // Only map where the legacy field has a clear equivalent; ambiguous
        // fields default to preset values silently. No banner asks the parent
        // to revisit them: none was built, and v2 installs are two migrations
        // behind the current schema (known-issues M51, decided 2026-09-06).
        const hideMetrics =
          seedMode === 'child' ? vc.childHideMetrics
            : seedMode === 'teen' ? vc.teenHideMetrics
              : undefined;
        if (typeof hideMetrics === 'boolean') {
          features['hide-engagement-metrics'] = {
            ...features['hide-engagement-metrics'],
            enabled: hideMetrics,
          };
        }
        if (seedMode === 'child' && typeof vc.childBlockActions === 'boolean') {
          features['hide-action-buttons'] = {
            ...features['hide-action-buttons'],
            enabled: vc.childBlockActions,
          };
        }
        if (seedMode === 'child' && typeof vc.childBlockPosting === 'boolean') {
          features['block-comment-posting'] = {
            ...features['block-comment-posting'],
            enabled: vc.childBlockPosting,
          };
        }
        // Adult receives the adult preset; legacy child/teen-only controls
        // have no unambiguous adult equivalent.
        if (seedMode === 'teen' && typeof vc.teenRewriteComments === 'boolean') {
          features['rewritten-comments-first'] = {
            ...features['rewritten-comments-first'],
            enabled: vc.teenRewriteComments,
          };
        }
        if (typeof vc.commentAnalysisCount === 'number') {
          features['comments-to-analyze-per-video'] = {
            ...features['comments-to-analyze-per-video'],
            value: vc.commentAnalysisCount,
          };
        }
      }

      settings.features = features;
      settings.presets = {
        appliedAt: new Date().toISOString(),
        appliedPreset: seedMode,
      };
    }
    settings.settingsSchemaVersion = '3';
    didMigrate = true;
  }

  // v3 → v4: one-time force re-seed of `features` from the CURRENT
  // mode's preset. Earlier dev builds shipped with preset values that
  // drifted from the spec (e.g., child had 4 of 8 topics + 15
  // comments-to-analyze instead of all 8 + 25; some protection flags
  // were off). With the preset-apply UI removed, there is no
  // user-facing path to reconcile. This migration re-applies
  // `applyPreset(settings.mode)` once, overwriting any prior `features`.
  //
  // Safe because: (a) parent customizations are trivially re-made in
  // the freshly correct surface, (b) the only users at the time were
  // dev installs, (c) schema-bump gate guarantees it runs exactly once
  // per install (subsequent reads see v4 and skip this branch).
  if (settings.settingsSchemaVersion === '3') {
    const seedMode = coerceLegacyMode(settings.mode);
    settings.features = presetForMode(seedMode);
    settings.presets = {
      appliedAt: new Date().toISOString(),
      appliedPreset: seedMode,
    };
    settings.mode = seedMode;
    settings.settingsSchemaVersion = '4';
    didMigrate = true;
  }

  // v4 → v5: backfill the `block-reels` feature on installs that pre-date
  // its introduction. Only adds the missing entry; preserves any prior
  // user-touched entries on other features. Defaults to disabled,
  // matching the fresh-install factory default — the parent opts in from
  // Settings if the family wants short-form video surfaces gated.
  if (settings.settingsSchemaVersion === '4') {
    if (settings.features && !settings.features['block-reels']) {
      settings.features = {
        ...settings.features,
        'block-reels': { enabled: false },
      };
    }
    settings.settingsSchemaVersion = '5';
    didMigrate = true;
  }

  // v5 → v6: backfill the `media-timeout` feature. Defaults to disabled
  // because this is a parent-trigger (toggle on for an active timeout,
  // off for normal use); fresh installs match the preset default.
  if (settings.settingsSchemaVersion === '5') {
    if (settings.features && !settings.features['media-timeout']) {
      settings.features = {
        ...settings.features,
        'media-timeout': { enabled: false },
      };
    }
    settings.settingsSchemaVersion = '6';
    didMigrate = true;
  }

  // v6 → v7: backfill `monthlyUsdCapOverride`. Defaults to null — meaning
  // existing installs continue to use the per-tier default cap, now
  // lowered to $7/$14/$21 (Starter/Family/Extended). Parent can override
  // via the dashboard cap settings; null preserves the tier-default behavior
  // for everyone who has not opted into a custom value.
  if (settings.settingsSchemaVersion === '6') {
    if (settings.monthlyUsdCapOverride === undefined) {
      settings.monthlyUsdCapOverride = null;
    }
    settings.settingsSchemaVersion = '7';
    didMigrate = true;
  }

  // v7 → v8: backfill `outputLanguage`. Defaults to 'auto' = the Phase 1c
  // detection behavior (rewrite in same language as input). Parent picks a
  // specific ISO code in the popup to force every FW output into that
  // language regardless of input. Universal multilingual coverage via
  // chrome.i18n CLD3 + Intl.DisplayNames — no per-language modules.
  if (settings.settingsSchemaVersion === '7') {
    if (typeof settings.outputLanguage !== 'string' || settings.outputLanguage.length === 0) {
      settings.outputLanguage = 'auto';
    }
    settings.settingsSchemaVersion = '8';
    didMigrate = true;
  }

  // v8 → v9: BYOK migration. The two Groq-key fields previously stored
  // on the settings object are no longer used — the proxy at
  // api.feelingwise.org holds the master Groq key and extensions
  // authenticate with the FW license key instead. No explicit storage
  // cleanup needed: orphaned chrome.storage.local entries are harmless
  // since SETTINGS_KEYS no longer references them.
  if (settings.settingsSchemaVersion === '8') {
    settings.settingsSchemaVersion = '9';
    didMigrate = true;
  }

  // v9 → v10: backfill `dashboardTheme`. Default 'dark' preserves the
  // pre-v10 hardcoded look — existing installs see no visual change until
  // the parent opts in via the dashboard header toggle.
  if (settings.settingsSchemaVersion === '9') {
    if (settings.dashboardTheme !== 'dark' && settings.dashboardTheme !== 'light' && settings.dashboardTheme !== 'system') {
      settings.dashboardTheme = 'dark';
    }
    settings.settingsSchemaVersion = '10';
    didMigrate = true;
  }

  // v10 → v11: Child-mode media-capture consent fence (M81). Now a stamp-only
  // bump: the flags it forced off left the settings shape in v14 with the
  // pipelines they gated, and v14 deletes their storage keys outright.
  if (settings.settingsSchemaVersion === '10') {
    settings.settingsSchemaVersion = '11';
    didMigrate = true;
  }

  // v11 -> v12: videoControls leaves the settings shape. No data transform:
  // the orphaned chrome.storage.local key is harmless and stays (the BYOK
  // v8 -> v9 branch is the precedent), the v2 -> v3 branch above still maps it
  // via the raw attach in getSettings, and the clone below simply stops
  // carrying it. Stamp-only bump so the removal runs exactly once per install.
  if (settings.settingsSchemaVersion === '11') {
    delete (settings as unknown as Record<string, unknown>).videoControls;
    settings.settingsSchemaVersion = '12';
    didMigrate = true;
  }

  // v12 -> v13: backfill the five surface switches, off, on installs that
  // pre-date them; a user turns them on from the popup.
  if (settings.settingsSchemaVersion === '12') {
    if (settings.features) {
      for (const id of SURFACE_FEATURE_IDS) {
        if (!settings.features[id]) settings.features = { ...settings.features, [id]: { enabled: false } };
      }
    }
    settings.settingsSchemaVersion = '13';
    didMigrate = true;
  }

  // v13 -> v14: the video and image understanding pipelines were removed
  // (landing/updates.html 2.5.0), so their two settings flags leave the
  // shape. Stamp-only here; getSettings deletes the orphaned
  // chrome.storage.local keys once, on the same write that persists the
  // stamp, so a stale `true` cannot outlive the feature in storage.
  if (settings.settingsSchemaVersion === '13') {
    settings.settingsSchemaVersion = '14';
    didMigrate = true;
  }

  return {
    settings,
    didMigrate,
    fromVersion,
    toVersion: settings.settingsSchemaVersion,
  };
}
