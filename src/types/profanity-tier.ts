// ProfanityTier: the shape, with no behavior attached.
//
// It was declared in src/core/profanity-filter.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

/**
 * What kinds of terms to match.
 *   • 'slurs'     — identity-targeted only. Always rewrite when a
 *                   match is found, regardless of mode.
 *   • 'profanity' — casual vulgar content only. Respects mode semantics
 *                   (child rewrites, teen flags-no-rewrite, adult skips).
 *   • 'both'      — default behavior: both lists, mode-aware.
 */
export type ProfanityTier = 'slurs' | 'profanity' | 'both';
