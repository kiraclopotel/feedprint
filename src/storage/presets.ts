// FeelingWise — Mode presets
//
// Pure functions: (mode → FeatureToggles). Modes (child / teen / adult) are
// presets that seed default feature-toggle values on install and on
// explicit "Apply <mode> defaults" user action in Settings. After preset
// apply, any parent-edited toggle persists across mode-tag changes
// unless the parent explicitly re-applies the preset. Every feature is
// universally available on every mode; modes differ only in defaults,
// not in capability ceilings.

import type { Mode } from '../types/mode';
// Imported directly from `./block-ai-defaults` (not via `./settings`) to
// avoid a circular import — settings.ts already imports `childPreset` /
// `teenPreset` from this file at module load.
import { DEFAULT_AI_BLOCKLIST_HASHTAGS } from './block-ai-defaults';
import type { FeatureToggles } from '../types/feature-toggles';

// Per a 2026-05-10 product decision, mode-pick is no longer "forensic
// tag only" — it now seeds different default feature sets so a parent who
// picks Child gets maximum protection out of the box, and a parent who
// picks Teen gets the core protection plus three specific opt-ins
// (block-ai-content + hide-engagement-metrics + strip-emojis), leaving
// action buttons and comment posting available for adolescent autonomy.
// The parent can still override any individual toggle after the preset
// applies; mode just sets the starting point.

export function childPreset(): FeatureToggles {
  return {
    // Default protection (core) — both ON.
    'rewritten-comments-first':       { enabled: true },
    'show-reframe-markers':           { enabled: true },
    // Additional protections — ALL ON for Child mode. Younger kids
    // (8-12) benefit from maximum visible intervention; the parent dials
    // back individually if a specific feature creates friction.
    'hide-engagement-metrics':        { enabled: true },
    'hide-action-buttons':            { enabled: true },
    'block-comment-posting':          { enabled: true },
    'strip-emojis':                   { enabled: true },
    'block-ai-content':               { enabled: true, value: { hashtags: [...DEFAULT_AI_BLOCKLIST_HASHTAGS] } },
    'block-reels':                    { enabled: true },
    // media-timeout stays OFF: parent-trigger pause, not a default.
    // The surface switches: the user's own choice, off everywhere.
    'hide-stories':                   { enabled: false },
    'hide-suggestions':               { enabled: false },
    'hide-marketplace':               { enabled: false },
    'hide-groups':                    { enabled: false },
    'hide-right-column':              { enabled: false },
    // The YouTube feed switches: off until the store listing names them.
    'hide-home-feed':                 { enabled: false },
    'hide-recommended-videos':        { enabled: false },
    'media-timeout':                  { enabled: false },
    // Ads off the live feed by default in every mode — they are commercial
    // manipulation and pure noise; the dashboard still records them.
    'block-ads':                      { enabled: true },
    // The parent's own blocklist. ON in every preset with empty lists: an
    // empty list is a no-op, so a parent who adds a word does not also have
    // to hunt for a switch. See core/parent-blocklist.ts.
    'parent-blocklist':               { enabled: true, value: { words: [], phrases: [], accounts: [] } },
    // Paid soften of ordinary swearing: ON for child (background protection),
    // spend now parent-controllable (wiring Q4; floors stay rails).
    'soften-swearing':                { enabled: true },
    // Calmer-rewrite spend tier (wiring Q2/W44): ON in every preset so
    // defaults are unchanged; the switch exists so the spend has an owner.
    'reframe-rewrites':               { enabled: true },
    'comments-to-analyze-per-video':  { enabled: true, value: 25 },
  };
}

export function teenPreset(): FeatureToggles {
  return {
    // Default protection (core) — both ON.
    'rewritten-comments-first':       { enabled: true },
    'show-reframe-markers':           { enabled: true },
    // Additional protections — three ON for Teen mode (per standing
    // product policy): AI-content blocker + engagement-metric hider + emoji
    // strip. Action buttons and comment posting stay AVAILABLE so the
    // teen retains agency where reactance research is clearest.
    'hide-engagement-metrics':        { enabled: true },
    'hide-action-buttons':            { enabled: false },
    'block-comment-posting':          { enabled: false },
    'strip-emojis':                   { enabled: true },
    'block-ai-content':               { enabled: true, value: { hashtags: [...DEFAULT_AI_BLOCKLIST_HASHTAGS] } },
    // block-reels OFF for Teen — short-form video access stays open;
    // parent opts in for stricter regimes.
    'block-reels':                    { enabled: false },
    // The surface switches: the user's own choice, off everywhere.
    'hide-stories':                   { enabled: false },
    'hide-suggestions':               { enabled: false },
    'hide-marketplace':               { enabled: false },
    'hide-groups':                    { enabled: false },
    'hide-right-column':              { enabled: false },
    // The YouTube feed switches: off until the store listing names them.
    'hide-home-feed':                 { enabled: false },
    'hide-recommended-videos':        { enabled: false },
    'media-timeout':                  { enabled: false },
    // Ads off the live feed by default in every mode — they are commercial
    // manipulation and pure noise; the dashboard still records them.
    'block-ads':                      { enabled: true },
    // The parent's own blocklist. ON in every preset with empty lists: an
    // empty list is a no-op, so a parent who adds a word does not also have
    // to hunt for a switch. See core/parent-blocklist.ts.
    'parent-blocklist':               { enabled: true, value: { words: [], phrases: [], accounts: [] } },
    // OFF for teen: matches the evidence-retired always-on teen rule
    // (.brain/DECISIONS.md 2026-06-10); strictLanguage still implies it.
    'soften-swearing':                { enabled: false },
    // Calmer-rewrite spend tier (wiring Q2/W44): ON in every preset.
    'reframe-rewrites':               { enabled: true },
    'comments-to-analyze-per-video':  { enabled: true, value: 25 },
  };
}

// Adult mode (re-introduced 2026-06-05; minimal-default reframe per a
// 2026-06-13 product decision). Adults set their own protections, so the
// preset ships LIGHT: only the two visible-value features are ON by
// default — rewrite flagged
// comments (paid) + show reframe markers. Every on-device protection
// (engagement-hide, action-hide, comment-block, emoji-strip, AI-content,
// reels) defaults OFF; the adult enables what they want. media-timeout stays
// OFF (parent-trigger pause, never a default).
/**
 * Single source of truth for mode → default feature toggles. Centralizes the
 * mapping so callers don't repeat `mode === 'child' ? … : …` ternaries (and so
 * adding a future mode is one edit here, not N exhaustive ternaries).
 */
export function presetForMode(mode: Mode): FeatureToggles {
  switch (mode) {
    case 'child': return childPreset();
    case 'adult': return adultPreset();
    case 'teen':  return teenPreset();
  }
}

/**
 * Off on a fresh install: what its store listing promises first ("turn off swearing, slurs, like
 * counts, Reels, Shorts and ads"). Adult's light grid plus the counts and Reels switches; ads are
 * already on there, slurs are hidden by a rule with no switch, and swearing is `strictLanguage`,
 * which settings.ts sets beside this grid. Nothing the listing does not name is on.
 */
export function offStartPreset(): FeatureToggles {
  return {
    ...adultPreset(),
    'hide-engagement-metrics':        { enabled: true },
    'block-reels':                    { enabled: true },
  };
}

export function adultPreset(): FeatureToggles {
  return {
    // Light by default — adults enable the rest themselves.
    'rewritten-comments-first':       { enabled: true },
    'show-reframe-markers':           { enabled: true },
    'hide-engagement-metrics':        { enabled: false },
    'hide-action-buttons':            { enabled: false },
    'block-comment-posting':          { enabled: false },
    'strip-emojis':                   { enabled: false },
    'block-ai-content':               { enabled: false, value: { hashtags: [...DEFAULT_AI_BLOCKLIST_HASHTAGS] } },
    'block-reels':                    { enabled: false },
    // The surface switches: the user's own choice, off everywhere.
    'hide-stories':                   { enabled: false },
    'hide-suggestions':               { enabled: false },
    'hide-marketplace':               { enabled: false },
    'hide-groups':                    { enabled: false },
    'hide-right-column':              { enabled: false },
    // The YouTube feed switches: off until the store listing names them.
    'hide-home-feed':                 { enabled: false },
    'hide-recommended-videos':        { enabled: false },
    'media-timeout':                  { enabled: false },
    // Ads off the live feed by default in every mode — they are commercial
    // manipulation and pure noise; the dashboard still records them.
    'block-ads':                      { enabled: true },
    // The parent's own blocklist. ON in every preset with empty lists: an
    // empty list is a no-op, so a parent who adds a word does not also have
    // to hunt for a switch. See core/parent-blocklist.ts.
    'parent-blocklist':               { enabled: true, value: { words: [], phrases: [], accounts: [] } },
    'soften-swearing':                { enabled: false },
    // Calmer-rewrite spend tier (wiring Q2/W44): ON in every preset. The
    // adult preset already ships the visible-value pair (rewrites + markers).
    'reframe-rewrites':               { enabled: true },
    'comments-to-analyze-per-video':  { enabled: true, value: 25 },
  };
}
