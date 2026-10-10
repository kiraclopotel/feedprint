# Mode as a live wire: the complete inventory

> An inventory of the `settings.mode` enforcement branches in `src/` (forensic provenance
> stamps and UI display reads excluded, they attest or render mode rather than enforce
> with it). The reproducible count: `grep -rEn "mode (===|!==) '(child|teen|adult)'" src
> --include=*.ts --include=*.tsx | grep -v '^src/ui/'` finds 45 lines on 2026-08-23 (4 of them
> in `src/i18n/dashboard-strings.ts` are display strings, so 41 enforcement or prompt sites);
> re-run it before trusting the number. Contract being enforced: modes are presets
> that seed defaults (presets.ts), PLUS the short list of hard rails below and nothing
> else. Any new `settings.mode` branch must either join this list in the same commit or
> be a feature toggle instead.

## Hard child-safety rails (keep; mode-gated by design)

- R1 Child provisional cover lifecycle: `content/child-first-protection.ts` (all mode checks) and `content/document-start-shield.ts` page curtain. Child mode covers content until the verdict lands; the 60 s fail-open deadline bounds it.
- R2 Child protection retention: `content/index.ts` protectionsToRetain branches and the child reveal-options carve-out. A child install never re-shows content mid-judgement.
- R3 Profanity family tiers: `core/pipeline.ts` child-only profanity hide, `hideOnRewriteUnavailable(mode)` (Child only since 2026-09-07; the toggle and the strict-language implication are gone, a rewrite failure never becomes a hide in Teen or Adult; shared with the comment path's `isUnrewritable`), teen slur/attack floors, `analysis/comment-batch-scorer.ts` child text floors, `content/pre-rewrite-harm-floor-gate.ts` non-adult gate. Owner-ratified protection floors (2026-06-10 house-rule re-scope). The SPEND half of the soften path is no longer mode-gated: `blanketProfanitySoften` reads the `soften-swearing` toggle plus strictLanguage; only the visibility floors stay rails.
- R4 Ad posture: `core/pipeline.ts` sponsored branches (every mode collapses; child / teen assert the consumer-rapid-frame analysis, adult records a category-only analysis).
- R5 Violence-narrating video: `core/pipeline.ts` child+teen hide.
- R6 Media verdict hides: REMOVED in 2.5.0 with the media features themselves. C3 below is closed by the same removal.
- R7a Child media-capture fence: REMOVED in 2.5.0. There is no cloud media capture left to fence.
- R7 AI prompt calibration: `ai/prompts-v2.ts` and the image/video prompt builders phrase the audience by mode. Calibration, not a switch; no toggle should exist here.

## Convert to toggles (queued)

- C1 RESOLVED 2026-08-10: the `soften-swearing` feature toggle owns the paid soften spend (child preset ON, teen/adult OFF, strictLanguage implies it); blanketProfanitySoften reads settings+platform, mode is out of the spend gate. Popup row sits under Strict language (locked-on while strict is on). The R3 visibility floors verified unmoved (soften-swearing-toggle.test.ts). The 2026-06-10 house-rule lock restated through presets in strict-language-gate.test.ts.
- C2 RESOLVED 2026-08-10 (verified not a bug), then MOOT 2.5.0: the image path it described was removed with the media features.
- C3 CLOSED AS RAILS 2026-08-11, then MOOT 2.5.0: the media hides it governed no longer exist.

Related (not a mode wire): the calmer-rewrite spend tier became the `reframe-rewrites` feature toggle 2026-08-11 (preset ON in all three modes, per-platform overrides; spec in ai-pipeline.md "Design rule: detect always, rewrite on purpose"). Detection is never gated; mode reaches the rewrite tier only through presets.

## Enforcement note

The grep above is the baseline. A future sweep finding sites outside this list plus
presets/provenance/display is drift and goes on the open-work list.

## 2026-09-07: the swear mask replaces the swear rewrite

Ordinary swearing is no longer rewritten. `maskProfanity` (src/core/profanity-filter.ts) stars each matched vulgar word in place and changes nothing else; no model call, no cap, no tier. Posts: the pipeline branch that called the rewriter now masks, after the dehumanisation and narrated-violence gates, with `detectionMode` `profanity-mask:<n>` and `aiSource` `rules`; the harm-laundering check left with the rewriter (a mask cannot drop content). Comments: the collected passing-but-profane comments are masked through the swap path and never hidden. The popup row is "Mask swearing", outside the paid group, on every tier; Strict language still implies it. Slurs, attacks and the identity tiers are untouched. The record still carries the `profanity` label at severity 4 until the decision block writer lands (Stage 2), when a mask reads as `pass` with `household.mask` true. Design: docs/design/POLICY-TABLE-2026-09-07.md section 2.
