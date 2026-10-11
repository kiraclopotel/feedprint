// Which switches Feedprint runs.
//
// Feedprint is the recorder: it runs the ads, the language, the own rules, the reframe markers and the
// AI reading. The switches that take parts of a page away, the break and quiet hours, Block this, the
// hashtag and AI-label hide, comment posting and emoji belong to Off, which runs them beside Feedprint
// (content/engagement/recorder-runs.ts). Feedprint never shows or runs them, but it never rewrites what
// an install stored for them either: an "on" stays in storage unread, the picks stay readable, and the
// record's categories for Reels and AI content keep printing old records.

import type { FeatureId } from '../types/feature-id';
import type { FeatureToggles } from '../types/feature-toggles';
import type { FWSettings } from './settings-shape';

export const OFF_ONLY_FEATURE_IDS: readonly FeatureId[] = [
  'block-reels', 'hide-stories', 'hide-suggestions', 'hide-right-column', 'hide-marketplace', 'hide-groups',
  'hide-engagement-metrics', 'hide-action-buttons',
  'media-timeout',
  'block-ai-content', 'block-comment-posting', 'strip-emojis',
  'hide-home-feed', 'hide-recommended-videos',
];

export function receiptsRuns(id: FeatureId): boolean {
  return !OFF_ONLY_FEATURE_IDS.includes(id);
}

/**
 * The settings as Feedprint acts on them: every Off-only switch reads off with no value (so a quiet-hours
 * schedule has nothing to run on) and no pick is hidden. A copy; the stored object is untouched.
 */
export function withFeedprintScope(settings: FWSettings): FWSettings {
  return { ...settings, features: receiptsFeatures(settings.features), pickedBlocks: [] };
}

/** Whether the install stored any Off-only switch on, anywhere or on one site: the update line then says where it went. */
export function storedOffSwitchOn(features: FeatureToggles | undefined): boolean {
  return OFF_ONLY_FEATURE_IDS.some((id) => {
    const f = features?.[id];
    return !!f && (!!f.enabled || Object.values(f.perPlatform ?? {}).some((p) => !!p?.enabled));
  });
}

/** A preset grid for Feedprint to save: its own switches from the preset, Off's exactly as stored. */
export function presetKeepingOffOnly(preset: FeatureToggles, stored: FeatureToggles | undefined): FeatureToggles {
  // An Off switch with nothing stored stays unwritten, so a level never stores the preset's value for it.
  const grid: Partial<FeatureToggles> = { ...preset };
  for (const id of OFF_ONLY_FEATURE_IDS) {
    if (stored?.[id]) grid[id] = stored[id];
    else delete grid[id];
  }
  return grid as FeatureToggles;
}

/** The grid with every Off-only switch read as off with no value; a copy. */
export function receiptsFeatures(features: FeatureToggles): FeatureToggles {
  const scoped: FeatureToggles = { ...features };
  for (const id of OFF_ONLY_FEATURE_IDS) {
    if (scoped[id]) scoped[id] = { enabled: false };
  }
  return scoped;
}
