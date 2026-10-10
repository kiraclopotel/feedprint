// FeatureId, FeatureToggle: the shape, with no behavior attached.
//
// It was declared in src/storage/settings.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

import type { PlatformId } from './platform-id';

export type FeatureId =
  // Content Replacement
  | 'rewritten-comments-first'
  // `show-reframe-markers`. Toggle for the teen-mode teaching layer: when
  // ON, the injector renders a small severity dot on every post FeelingWise
  // rewrote or folded; tapping the dot opens a compact popover with a
  // tailored explanation of what the original was doing. When OFF, all
  // interventions happen silently (matches child-mode background-protection
  // UX). Default: ON in teen preset (immunity-building), OFF in child
  // preset (silent protection at 8-11). Parent toggle so a parent of a
  // teenager who prefers pure protection without UI noise can opt out
  // without flipping the child/teen mode tag.
  | 'show-reframe-markers'
  // UI Stripping
  | 'hide-engagement-metrics'
  | 'hide-action-buttons'
  | 'block-comment-posting'
  // `strip-emojis`: emoji removal from post / comment text DOM. Auto in
  // child preset, toggle in teen. Implemented by
  // `engagement/emoji-stripper.ts` for X / TikTok / Facebook.
  | 'strip-emojis'
  // `block-ai-content`: rule-based pre-empt for AI-content trends. Hides
  // video containers whose caption matches a parent-editable hashtag
  // blocklist OR whose visible UI contains a multi-language "AI-generated
  // content" marker. Default ON in both presets; default blocklist =
  // ['ai', 'fruitdrama', 'uktiktok', 'aifruit']. Implemented by
  // `engagement/ai-content-blocker.ts` for tiktok / instagram / youtube /
  // twitter / facebook. The toggle's `value` carries
  // `{ hashtags: string[] }`.
  | 'block-ai-content'
  // `block-reels`: URL-gated hide for short-form video surfaces (Instagram
  // Reels, Facebook Reels, YouTube Shorts). Toggle has no value payload —
  // simple on/off. Implemented by `engagement/reels-blocker.ts`.
  | 'block-reels'
  // The surface switches (2026-09-03, owner idea 2): the Stories trays, the
  // suggestion blocks (Instagram's "Suggested for you", Facebook's "People
  // you may know", X's "Who to follow"), Facebook's Marketplace and Groups
  // (their nav entries and their pages), and the right column on Facebook,
  // X and Instagram. `block-reels` also takes the Reels trays and the Shorts
  // shelf. Simple on/off, off in every preset. Implemented by
  // `engagement/surface-switches.ts`, built by relationship (STRUCTURE-MAP).
  | 'hide-stories'
  | 'hide-suggestions'
  | 'hide-marketplace'
  | 'hide-groups'
  | 'hide-right-column'
  // The two YouTube feed switches: the home grid on youtube.com/, and the recommended videos beside,
  // under and at the end of a video. They hide a feed on purpose, so they have their own module,
  // `engagement/youtube-feeds.ts`, which names only YouTube's own components. Off in every preset.
  | 'hide-home-feed'
  | 'hide-recommended-videos'
  // `media-timeout`: parent-triggered platform-wide DOM block. When on,
  // overlays a full-screen opaque div on every supported platform until
  // the parent toggles it off. The toggle's `value` may carry
  // `{ schedule: QuietHoursWindow[] }` (scheduled quiet hours, added
  // 2026-08-05): with the toggle OFF the schedule drives the overlay on a
  // per-minute tick, with it ON the block is unconditional. See
  // `core/quiet-hours.ts` for the window semantics.
  // Implemented by `engagement/media-timeout.ts`.
  | 'media-timeout'
  // `block-ads`: fully remove platform-sponsored posts from the live feed —
  // no placeholder, no leftover gap, no trace — while still recording each ad
  // to the forensic chain (so the dashboard can show/analyze what it sold).
  // Detected deterministically from the platform's own ad marker
  // (post.is_sponsored, set by the adapters) and applied by `injector.ts`
  // injectAdHide (display:none on the per-platform post container). Default ON
  // in every preset. Simple on/off — no value payload.
  | 'block-ads'
  // `parent-blocklist`: the parent's own word / phrase / account rules. The
  // only rule surface in the product where the parent, not a model, decides.
  // Deterministic, free-tier, language-independent. The toggle's `value`
  // carries `{ words, phrases, accounts }`, all empty by default, and it is
  // enabled in every preset because an empty list is a no-op. Enforced as a
  // cost-zero gate at the TOP of the pipeline ladder, above the dedup cache
  // (a post cached before the parent added a word would otherwise keep its
  // old verdict). Matcher: `src/core/parent-blocklist.ts`.
  | 'parent-blocklist'
  // `soften-swearing` (wiring Q4, mode-rails C1; since 2026-09-07 the swear
  // MASK): stars ordinary swear words in place on posts and passing comments,
  // no model, every tier (core/profanity-filter.ts maskProfanity). Seeded ON in the child preset, OFF in teen
  // and adult; `strictLanguage` implies it regardless of the toggle ("no
  // swearing in this house"). The VISIBILITY floors are rails and do not
  // move with this switch: slur/attack tiers, the child profanity hide, and
  // hideOnRewriteUnavailable stay mode-gated (docs/spec/mode-rails.md R3).
  // Turning this off in Child leaves ordinary swearing visible unless a
  // floor catches it; that is the parent's explicit choice.
  | 'soften-swearing'
  // `reframe-rewrites` (wiring Q2/W44, spec: ai-pipeline.md "Q2 design"):
  // owns the calmer-rewrite spend tier and its on-screen display for the
  // per-post pipeline. Seeded ON in every preset (child, teen, adult) so
  // defaults are unchanged; per-platform overrides supported. When OFF for
  // a platform, the judge call runs DETECT-ONLY (detection quality and the
  // forensic record unchanged, rewrite output tokens saved) and confirmed
  // flags fold to the mark/collapse floor instead of a rewrite.
  // `show-reframe-markers` remains the display-layer dot toggle only.
  | 'reframe-rewrites'
  // Analysis Context. The `value` caps comments scored per video (default
  // 25). Since 2026-08-10 (wiring Q3) the `enabled` bit also gates the
  // scoreRoom auxiliary Groq call in content/index.ts — the room-sensor
  // read had no parent-visible switch before that.
  | 'comments-to-analyze-per-video';

export interface FeatureToggle {
  enabled: boolean;
  value?: unknown;
  perPlatform?: Partial<Record<PlatformId, { enabled?: boolean; value?: unknown }>>;
}
