// FeelingWise — defaults + value-type for the `block-ai-content` feature.
//
// Lives in its own module so `presets.ts` and `settings.ts` can both
// consume the constant without forming a circular import.
//
// Consumers:
//   • storage/presets.ts   — seeds both child + teen presets with these.
//   • storage/settings.ts  — re-exports for the wider codebase.
//   • content/engagement/ai-content-blocker.ts (via settings re-export)
//   • ui/settings/SettingsSurface.tsx           (via settings re-export)

/** Default hashtag blocklist for the `block-ai-content` feature.
 *
 * Lowercased, no `#` prefix; matched case-insensitively against caption
 * text. Despite the feature's name, scope spans the full harm-tag
 * catalog authorized 2026-05-25 — AI-generated content, emotional-
 * manipulation sadbait, manufactured-conflict ragebait, pro-eating-
 * disorder + coded-evasion variants. Each entry is sourced from documented
 * harm research; see commit history + the agent research report for per-tag
 * evidence.
 *
 * Every entry here names a HARM. The Romanian-diaspora tags that used to sit
 * at the end of this list named a people and a place instead, and shipped
 * switched on to every install in every country; they are kept below in
 * REGIONAL_TARGETING_HASHTAGS_NOT_DEFAULT with the reasoning (2026-09-18).
 *
 * Curated to "high priority" entries only — items the research surfaced
 * as medium-priority are candidates for a future strict-mode toggle but
 * not included by default to keep the false-positive surface bounded.
 * Coded variants (`thinsp0`, `th1n`) follow the documented numeric-
 * substitution evasion pattern observed when platforms block the plain
 * spelling. */
export const DEFAULT_AI_BLOCKLIST_HASHTAGS: readonly string[] = [
  // AI-generated content — self-labels + tool tags
  'ai',
  'aianimation',
  'aiart',
  'aifruit',
  'aigenerated',
  'aiimage',
  'aimade',
  'aislop',
  'brainrot',
  'brainroot',
  'fruitdrama',
  'midjourney',
  'runwayml',
  'sora',
  'stablediffusion',
  'veo3',
  // Sadbait / emotional-manipulation tags
  'brokenfamily',
  'depressionvibes',
  'emotionaldamage',
  'sadstory',
  'sadtok',
  'sadvibes',
  'traumatok',
  'trytonotcry',
  // Ragebait / manufactured-conflict tags
  'prankgonewrong',
  'publicfreakout',
  'ragebait',
  // Appearance-pressure + pro-ED tags + coded evasion variants
  'anorexia',
  'bodycheck',
  'looksmaxx',
  'looksmaxxing',
  'skinnytok',
  'th1n',
  'thinsp0',
  'thinspo',
  'whatieatinaday',
];

/**
 * Researched, and deliberately NOT shipped switched on.
 *
 * These three came out of the same 2026-05-25 harm-tag work as the list above
 * and sat inside it until 2026-09-18, which meant every install in every
 * country blocked them by default. Every other entry in that list names a
 * harm. These name a people and a place, which is a categorically different
 * act, and `uktiktok` is on its own the largest false-positive surface the
 * list had, against the file's own rule that the medium-priority items stayed
 * out "to keep the false-positive surface bounded".
 *
 * The finding is a measured one. A person seeing the product for the first
 * time picked these three out of thirty nine unaided, said they could not
 * construct any reason for them, and said they made the other thirty entries
 * harder to trust.
 *
 * Diaspora-targeting content is real and the research behind these is kept
 * here rather than deleted. The right shape for it is the one this tree
 * already uses for regional word lists: gated on the reader's own locale
 * (src/core/lexicon-regional.ts, `regionalTermsFor`). The blocklist preset is
 * seeded at install time and does not yet know a locale, so wiring that is a
 * larger change than the one that removed the harm. Until then these ship to
 * nobody, which is the safe direction.
 */
export const REGIONAL_TARGETING_HASHTAGS_NOT_DEFAULT: readonly string[] = [
  'romaniidinstrainatate',
  'romaniinuk',
  'uktiktok',
];

/** Shape of `FeatureToggle.value` for the `block-ai-content` feature. */
export interface BlockAiContentValue {
  hashtags: string[];
}
