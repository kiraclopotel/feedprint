// The shape of the settings object, and the one helper that reads a legacy value.
//
// Cut out of src/storage/settings.ts on 2026-09-16 (PLAN-2026-09-16 item 10.3) so that the
// migrations could have their own file: they need the shape and coerceLegacyMode, and a migrations
// file importing settings.ts while settings.ts imported it back would be a cycle. This file imports
// nothing from either, and settings.ts re-exports every name below, so no call site changed.
//
// CURRENT_SETTINGS_SCHEMA_VERSION is deliberately not here. It stays in settings.ts, where the
// update gate reads it by name out of the file text.

import { Mode } from '../types/mode';
import type { FeatureId } from '../types/feature-id';
import type { FeatureToggles } from '../types/feature-toggles';
import { Platform } from '../types/post';
import type { UiLanguage } from '../i18n';

/**
 * Coerce a possibly-legacy mode value to a current `Mode`
 * ('child' | 'teen' | 'adult'). Used by every migration branch that touches
 * settings.mode + by any reader that wants to defensively narrow a value
 * pulled from chrome.storage.local. Unknown historical values still fall
 * back to 'teen' (broader-age safer fallback than 'child').
 *
 * If a future migration adds another mode boundary, edit this helper
 * rather than each migration branch — the coercion logic would otherwise
 * be duplicated across migrations.
 */
export function coerceLegacyMode(input: unknown): Mode {
  if (input === 'child' || input === 'teen' || input === 'adult') return input;
  return 'teen';
}


/**
 * Dashboard theme preference. 'system' resolves to 'dark' | 'light' at
 * Dashboard.tsx mount via window.matchMedia('(prefers-color-scheme: light)')
 * and listens for OS-level changes while 'system' is active.
 *
 * The popup currently reads tokens via prefers-color-scheme only (no JS
 * toggle) — see src/ui/shared/theme.ts. Future: extend this field's role
 * to drive the popup too; for V1 it's dashboard-only.
 */
export type DashboardTheme = 'dark' | 'light' | 'system';

/** The popup's style: a teal (every install before the choice existed), b cobalt, c graphite. */
export type PopupLook = 'a' | 'b' | 'c' | 'd' | 'e';

// ─── Feature-composable grid ─────────────────────────────────────────
//
// Every feature has exactly one implementation, gated on its toggle. Modes
// are presets that seed defaults (see ./presets.ts) — they do NOT gate
// feature availability. Most enforcement code goes through
// `isFeatureEnabled` / `getFeatureValue`, but mode is ALSO a live
// enforcement axis: hard child-safety rails branch on `settings.mode`
// directly, and none of them may be removed on the strength of this
// comment. Known mode branches: child-first protection + child
// protection-retention (src/content/protection/child-first-protection.ts,
// src/content/index.ts), profanity/slur family-safety tiers + the
// blanket-soften gate (src/analysis/pipeline.ts), media final-hide policy
// (child+teen hide, adult records-only), mode-conditioned AI prompts
// (src/ai/prompts-v2.ts and the image/video prompts), and forensic
// userAgeCategory tagging. Treat mode posture, feature preset, and
// analyzer consent as separate axes.



export const SURFACE_FEATURE_IDS: readonly FeatureId[] = [
  'hide-stories', 'hide-suggestions', 'hide-marketplace', 'hide-groups', 'hide-right-column',
];

export const ALL_FEATURE_IDS: readonly FeatureId[] = [
  'rewritten-comments-first',
  'show-reframe-markers',
  'hide-engagement-metrics',
  'hide-action-buttons',
  'block-comment-posting',
  'strip-emojis',
  'block-ai-content',
  'block-reels',
  'hide-stories',
  'hide-suggestions',
  'hide-marketplace',
  'hide-groups',
  'hide-right-column',
  'hide-home-feed',
  'hide-recommended-videos',
  'media-timeout',
  'block-ads',
  'parent-blocklist',
  'soften-swearing',
  'reframe-rewrites',
  'comments-to-analyze-per-video',
];


/** How many items of each kind one platform's pages were read for, today. */
export interface ReadCounts {
  posts: number;
  comments: number;
  videos: number;
}

/** The UTC day the counts belong to, and one entry per platform. */
export interface ReadToday {
  date: string;
  [platform: string]: ReadCounts | string;
}

export interface PresetAudit {
  /** ISO-8601 timestamp when the preset was last applied (blank = never explicitly applied since install). */
  appliedAt: string;
  /** Which preset was last applied. */
  appliedPreset: Mode;
}

// Historical shapes, retained ONLY so the v2 -> v3 migration can type the raw
// legacy blob it maps from. Removed from FWSettings at v12: the blob was
// write-never and its one runtime read was unreachable (laydown section 8).
export interface BlockActionsPlatforms {
  tiktok: boolean;
  instagram: boolean;
  facebook: boolean;
  twitter: boolean;
}

export interface VideoControls {
  childCommentMode: 'hidden' | 'educational';
  childHideMetrics: boolean;
  childBlockPosting: boolean;
  childBlockActions: boolean;
  childBlockActionsPlatforms: BlockActionsPlatforms;
  teenRewriteComments: boolean;
  teenHideMetrics: boolean;
  teenShowLessons: boolean;
  commentAnalysisCount: number;
}

export interface FWSettings {
  /** Bumped by `migrateSettings()` when the shape changes. */
  settingsSchemaVersion: string;

  mode: Mode;

  /**
   * Parent choice: soften ALL swearing regardless of mode ("no swearing
   * in this house"). When false (default), blanket profanity-softening
   * applies in child mode only; teen mode acts on slurs and detected
   * attacks, not register profanity. Evidence + decision:
   * .brain/DECISIONS.md 2026-06-10 house-rule re-scope (31/36 teen-mode
   * softenings on the real feed acted on content fine for a teen).
   */
  strictLanguage: boolean;

  /**
   * Retired 2026-09-07 and read by nothing: the "hide when a rewrite is not
   * possible" switch. Its reason was swearing left visible when a rewrite
   * failed; swearing is now masked in place without a rewrite, and a rewrite
   * failure never becomes a hide in Teen or Adult (invariant 2). Kept in the
   * shape so stored settings keep reading; the popup no longer shows it.
   */
  hideUnrewritable: boolean;

  // Parent PIN (SHA-256 hash, '' = no PIN set)
  parentPin: string;
  /**
   * The first-run screen was finished (14 Sep 2026). Until then "setup done"
   * meant "a PIN exists", which forced a PIN on every install, an adult's
   * included, and sent a fresh install back to the wizard on every popup open
   * until one was typed. An install that finished before this field existed
   * has a PIN, and a PIN still counts as done. Optional in the type so the
   * settings literals in older tests still typecheck; the defaults carry it.
   */
  setupDone?: boolean;
  /**
   * False from the moment of a fresh install until a person chooses a level (the first-run screen or
   * a level change in Settings sets true); nothing goes out while it is false (makesNoOutsideCall).
   * Absent everywhere else, which reads as chosen: an install that was running before this field
   * keeps its calls. Not setupDone, because installs finished before that field existed can have
   * neither it nor a PIN.
   */
  levelChosen?: boolean;

  // Usage controls
  dailyCap: number;

  /**
   * Parent override of the monthly Groq USD cap. When `null`, the
   * tier default from `license.MONTHLY_USD_CAP_BY_TIER` applies. When a
   * non-negative number, that value is the effective cap. Resolved at
   * read time via `license.effectiveMonthlyUsdCap` /
   * `license.effectiveMonthlyTokenCap`.
   *
   * Parent can dial higher (more spend allowed) or lower (more
   * conservative). 0 effectively pauses AI features. Cleared back to
   * tier default by writing `null`.
   */
  monthlyUsdCapOverride: number | null;

  // Language. V1 is English-only. Field retained on settings for
  // back-compat: existing installs may have 'ro' persisted from the
  // earlier EN/RO build; the field is tolerated on read but never
  // written as anything other than 'en'.
  locale: 'en';

  // Parent-pickable language for FW outputs (rewrites, marker explanations,
  // summary). 'auto' = match the input post's language automatically (Phase
  // 1c default; chrome.i18n CLD3 + Intl.DisplayNames). Specific ISO 639-1
  // code ('en', 'ro', 'es', 'fr', ...) = force every FW output into that
  // language regardless of input. Persistent across all platforms + domains.
  // Used by `detectPromptLanguageDisplayName` / `resolvePromptLanguage` in
  // src/core/lang-detect.ts.
  outputLanguage: string;

  // Interface language for FW's own surfaces (popup, dashboard, on-page
  // marker chrome). 'auto' (default) follows the browser language. Distinct
  // from `outputLanguage` (AI rewrite language) and from the legacy `locale`
  // pin above. Additive scalar with a DEFAULTS fallback — no schema bump
  // needed; getSettings() fills it on installs that predate the field.
  uiLanguage: UiLanguage;

  /**
   * Master AI breaker. When false, NO external AI call fires anywhere:
   * enforced at `callAI` (src/ai/client.ts — the single chokepoint every
   * Groq path funnels through, including per-post triage/classify, comment
   * batch, room sensor, and profanity-soften rewrites). Feature toggles gate
   * individual behaviors; this is the one switch that
   * guarantees zero spend regardless of mode, preset, or any other toggle.
   * DOM-side deterministic protections keep running. Additive scalar with a
   * DEFAULTS fallback — no schema bump needed.
   */
  aiAnalysisEnabled: boolean;

  // No user-facing model toggle. Single Groq model for every call (see
  // `src/ai/client.ts`). Legacy `aiModel` keys in chrome.storage.local on
  // existing installs are orphaned and ignored.

  // Stats — daily (reset each day)
  totalChecksToday: number;
  totalNeutralizedToday: number;
  totalTokensToday: number;         // cumulative input + output tokens
  estimatedCostToday: number;       // estimated cost in USD dollars (v2+)
  lastResetDate: string;

  // Stats — monthly (reset on UTC month flip; see utcMonthKey).
  // Used by pipeline.ts to enforce the per-tier monthly token-budget cap
  // from license.ts:MONTHLY_USD_CAP_BY_TIER. The token counter is the
  // budget-binding signal — Groq bills per token, so caps in tokens map
  // 1:1 to dollar limits. The check counter remains for back-compat /
  // diagnostics; the dollar cap is enforced via tokens.
  totalChecksThisMonth: number;
  totalTokensThisMonth: number;
  lastResetMonth: string;           // utcMonthKey format: 'YYYY-MM'

  // Stats — all-time (never reset)
  totalTokensAllTime: number;
  totalChecksAllTime: number;
  totalNeutralizedAllTime: number;
  estimatedCostAllTime: number;     // in USD dollars (v2+), never resets

  // Feature-composable grid. Seeded by the preset matching `mode` on fresh
  // install (via DEFAULTS below) or via v2 → v3 migration. Mutated only
  // through explicit parent action: a toggle change or an "Apply <mode>
  // defaults" preset-apply. Switching the `mode` tag does NOT rewrite
  // `features` — that is by design.
  features: FeatureToggles;

  /** Audit trail: when was a preset last applied, and which one. */
  presets: PresetAudit;

  // Dashboard color theme. Persists across the chrome.storage.local profile;
  // applied at Dashboard.tsx mount via document.documentElement.dataset.theme.
  // 'system' tracks OS preference. Default 'dark' (matches the pre-v10 hardcoded
  // state — existing installs see no visual change until they opt in).
  dashboardTheme: DashboardTheme;

  // The style of the popup and the dashboard, beside the theme. Optional because an install stored before it existed
  // has none: it reads the default, 'a', and opens on the look it always had.
  popupLook?: PopupLook;

  // Counter for per-element hide events fired by the engagement controller
  // (per-platform engagement.ts files: tiktok / twitter / facebook /
  // instagram). Each first-time `dataset.fwActionRail = 'hidden'` (etc.)
  // assignment increments by 1; per-element metrics-only hides increment
  // by N (one per hidden count element). Counter exists ONLY when an
  // engagement-hide feature is on; if all hide features are off, counter
  // never increments.
  //
  // Display in popup UsageCard (4th column "hidden").
  /** Count of distinct DOM elements FW hid today via engagement-controller. */
  metricsHiddenToday?: number;
  /** All-time accumulator. */
  metricsHiddenAllTime?: number;
  /**
   * The same hides split by the switch that made them, all-time on this
   * profile: 'hide-engagement-metrics', 'block-ads', 'word-filter', 'slurs',
   * 'no-swearing' (starred words, which hide nothing and are not in
   * metricsHidden) ... The Off popup shows one line per switch from it.
   */
  hiddenByFeature?: Record<string, number>;

  /**
   * What Feedprint read today, on this device (B10-1): per platform, how many posts, comments
   * and videos it accepted as read. Numbers only, with the UTC day they belong to; no id, no
   * author, no text, no address, and nothing leaves the computer. Written only by the service
   * worker (the usage counters' single writer) and replaced when the UTC day changes, so
   * yesterday is not kept. To count a comment once a day the worker also keeps short one-way
   * hashes of what it counted, in chrome.storage.session only: memory, never the disk (read-keys.ts).
   */
  readToday?: ReadToday;

  /**
   * Off's "block this" picks (2026-09-03, owner idea 1): boxes the user
   * pointed at on a page, remembered by their shape (tag, role and attribute
   * names on the path to an anchor, the child tags), never by text, and
   * hidden whenever the shape comes back. A pick on a post becomes an
   * account rule in `parent-blocklist` instead. Device-only.
   */
  pickedBlocks?: PickedBlock[];

  // Set ONLY on the synthetic fail-closed snapshot getSettings() returns when
  // storage cannot be read and no prior good snapshot exists. Never persisted
  // (deliberately absent from SETTINGS_KEYS), never true on real data: a
  // cached snapshot is real settings with bounded staleness, so it does not
  // carry this. Forensic emit sites thread it into
  // configSnapshot.settingsReadFailed so a record written during the window
  // does not attest that a child install was present when the truth is "the
  // settings were unreadable and FW protected at maximum" (laydown
  // 2026-08-04, D3).
  readFailedFallback?: true;
}


export interface PickedBlock {
  id: string;
  platform: Platform;
  /** ISO time of the pick. */
  createdAt: string;
  /** Selectors from the box up to its anchor, the box first (engagement/picker.ts shapeFor). */
  chain: string[];
  /** The box's direct children by tag, comma-joined: the second half of the shape. */
  children: string;
  /** Set when the box is named by its own heading (platform UI copy), the one text a shape carries. */
  heading?: string;
  /** What the popup shows: the box's aria-label, heading, role or tag. */
  label: string;
}
