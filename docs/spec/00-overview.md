# 00 — What FeelingWise is

The one-page model of the whole machine. Read this, then [`data-flow.md`](data-flow.md) for the
end-to-end X-ray, then a `subsystems/<name>.md` when you touch that area.

## The product, in one paragraph

FeelingWise is a Chrome MV3 extension that does two jobs on a child's, teen's, or adult's
social-media feed (TikTok, X, Instagram, YouTube, Facebook), in the reader's own browser. What
leaves it, and when, is the paragraph after the list:

1. **Protection** — it softens or hides content that carries the *form* of a manipulation
   technique (shame, fear, ragebait, body-comparison, false urgency…) or hostile language /
   harm content, and shows a small marker the reader can tap to see the original and why.
   How hard it intervenes depends on the **mode** (child / teen / adult).
2. **Record integrity** — it keeps signed, hash-linked Local Observation Records for
   supported public-feed items FeelingWise processed and the actions it took, in
   record/timestamp order. Exact platform impression order is not claimed; local observed
   order is carried by explicit observation-sequence fields where available. The retained
   record can be checked in a third party's browser with no FeelingWise software.

Free protection runs on the device; the only network traffic of a free install is the timestamp
check, a 64-character fingerprint of the record chain sent to public timestamping services
(directly, or through the FeelingWise proxy when a direct request fails,
`src/forensics/tsa-client.ts`), and, once for each signing key, the same kind of fingerprint of
that key's public half, sent the same way (`src/forensics/key-genesis.ts`). Paid AI features send
selected text, with the counts beside it and, since 2.5.15, a per-call label such as @user_A in
place of the handle that wrote each item (the map from label to handle lives in the tab's memory for
that call, and the handle is restored into the reason and the rewrite), through the FeelingWise
proxy to the AI provider, Deep Infra since 2026-09-21; names inside the text go as written; the
system is designed not to
persist content bodies. What ships and how accurate it measures: `docs/METHODOLOGY.md` and the
measured numbers it cites.

## Two products from one tree (since 2026-09-02)

The tree builds two extensions. **Receipts** (the recorder) is everything described in this
folder: `npm run build` into `dist/`. **Off** (the filter) is the free switches alone, with no
pipeline, AI, record or service worker: `npm run build:off` into `dist-off/`. The product
constant `__FW_PRODUCT__` (`src/product.ts`) switches the three shared seams that differ; the
rest is the same code. See [`subsystems/off-product.md`](subsystems/off-product.md).

## The two halves: protection-wrapper vs. record-core

- **Record-core** = the local observation chain (`src/forensics/`, internal naming). Append-only,
  signed (ECDSA P-256), hash-linked, HTML export with embedded-key checks, RFC-3161 third-party time
  anchoring, backup/restore with optional passphrase key-continuity. This is the record
  integrity pillar — see [`subsystems/forensic-chain.md`](subsystems/forensic-chain.md).
- **Protection-wrapper** = everything that decides *whether to intervene* and *renders it*:
  the detection cascade (`src/core/`, `src/ai/`, `src/analysis/`), the per-platform DOM
  extraction (`src/content/`), the engagement-hider, and the markers. The wrapper feeds the
  core: every intervention (and many passes) becomes a chain record.

The split matters because the core must stay correct even when the wrapper is weak: a
free-tier install runs **no AI** (protection is DOM-only) but the chain still records.

## The two AI roles

All AI calls go through FeelingWise's server at `api.feelingwise.org`, so the API keys never
ship in the extension. The server meters each licence's allowance and forwards each call to the
AI provider: Deep Infra since 2026-09-21, Groq before that. The
gpt-oss models are the same open weights on both.

| Role | Model | Where | What it judges |
|---|---|---|---|
| **Judge (text)** | `openai/gpt-oss-20b`; the single-post judge in Adult, since 2026-09-03, `openai/gpt-oss-120b` (`JUDGE_V1_MODEL`) | BATCH: `comment-batch-scorer.ts:scoreBatch`; COMBINED: `core/neutralizer.ts:combinedDetectAndNeutralize` | Per-comment manipulation/harm verdict + per-comment rewrite (BATCH); single-post detect+neutralize (COMBINED) |
| **Room** | `openai/gpt-oss-20b` | `comment-batch-scorer.ts:scoreRoom` (2nd parallel call) | The "environment" of a comment thread: overall tone, recidivism, amplification |

**The default text model is `openai/gpt-oss-20b`** (`src/ai/client.ts:GROQ_FAST_MODEL`, used
by `callAI` whenever a call names no model; the Adult judge names `openai/gpt-oss-120b`, see
[ai-pipeline](subsystems/ai-pipeline.md)). Switched from `llama-3.1-8b-instant`
2026-06-18 after Groq, the provider until 2026-09-21, decommissioned 8b; a blind-gold-key
bake-off (1329 real cases) picked 20b over `gpt-oss-120b`: tied F1, better precision, half the
cost. The `isGptOss` request params (`reasoning_effort:'low'`, `include_reasoning:false`) are
now live. The old-model docblocks that named `gpt-oss-120b` / `8b` as production were corrected
to `openai/gpt-oss-20b` in the 2026-06-19 purge sweep. `fastMode` is a no-op.

> The video-frame, in-video-audio and post-image roles ("eyes" and "ears", Gemini and
> Whisper) were REMOVED in 2.5.0 (`landing/updates.html`). They never worked: the image
> path failed 20 of 22 calls and about a third of Whisper calls failed. Records written
> before 2.5.0 still carry their `videoContext` / `imageContext` evidence and still verify.

## The three detection layers (VISION Promise 2)

Run in order; the deterministic floors fire before/around the AI so the obvious is caught
even when AI is off:

1. **Language layer** — slurs + profanity dictionaries (`core/profanity-filter.ts`).
2. **Harm content** — regex harm-floor categories A–I (`core/harm-floor.ts`) + coded-harm,
   dehumanization, harm-laundering catchers.
3. **Manipulation patterns** — the 20 technique classifiers (`core/techniques/index.ts`) and the AI
   judge (`ai/prompts-v2.ts buildBatchPromptV3` for BATCH, `ai/prompts.ts` for COMBINED).

Accuracy is **driven by code-side override gates as much as the prompt**
(`comment-batch-scorer.ts:applyOverrideGates` — identity-slur→hide, profanity-tier,
`target_present`, rage-format) because prompt rules measured unreliable on the 8b judge. The
litmus throughout: *does the content's pull survive a neutral rewrite?* If yes it was an
argument (leave it); if it collapses, a technique was carrying it. When unclear, **pass** —
over-flagging is the primary failure.

## Modes and presets

`Mode = 'child' | 'teen' | 'adult'` (`src/storage/presets.ts`, `presetForMode`). Child is
most protective / near-invisible; teen is transparent/teaching; adult is the lightest layer.
Mode threads through the BATCH prompt framing, the harm-floor gates, and the video gates.
The chain's `userAgeCategory` records the active mode VERBATIM (`'child' | 'teen' | 'adult'`),
so an adult session reads `'adult'` in the chain (`logger.ts:modeToAgeCategory`). The value is
per-record, so this is hash-safe: existing records keep their stored value and re-verify
unchanged. `coerceLegacyMode` (`src/storage/settings.ts`) preserves all three modes and maps only an
unknown value to `'teen'`; the v2 to v3 migration applies the adult preset to an adult install.
Every settings write into Child forces the two media-capture flags off
(`enforceChildMediaCaptureOff`), so a capture opt-in made in Teen or Adult never runs in Child.

## The local record chain in one breath

Every flagged post/comment (and passes, cancels, environment summaries, blocked videos) is
sent as a `*_LOG` message to the service worker, which serializes writes under a chain-write
lock, computes the canonical payload hash over a fixed field set (undefined-omitted for hash
stability), signs it, links it to the previous record's hash, gzip-compresses it, and writes
it to IndexedDB at the extension origin. The dashboard reads the chain back, re-verifies it,
groups records into posts, and renders a replayable feed; the parent can export a
standalone HTML file with local hash/link checks and embedded-key signature verification. See [`subsystems/forensic-chain.md`](subsystems/forensic-chain.md)
and [`data-flow.md`](data-flow.md).

## Where things live (top-level)

| Area | Path | Subsystem doc |
|---|---|---|
| DOM extraction + orchestration | `src/content/` (+ `index.ts`) | [content-extraction](subsystems/content-extraction.md) |
| Per-platform adapters | `src/content/platforms/` | [platform-adapters](subsystems/platform-adapters.md) |
| BATCH comment judge | `src/analysis/comment-batch-scorer.ts`, `src/ai/prompts-v2.ts` | [comment-batch](subsystems/comment-batch.md) |
| COMBINED single-post + AI client | `src/ai/`, `src/analysis/pipeline.ts`, `neutralizer.ts` | [ai-pipeline](subsystems/ai-pipeline.md) |
| Deterministic floors | `src/core/harm-floor.ts`, `profanity-filter.ts`, `techniques/` | [harm-floor-profanity](subsystems/harm-floor-profanity.md) |
| Local record chain | `src/forensics/` (write/sign/verify/export; internal forensics naming) | [forensic-chain](subsystems/forensic-chain.md) |
| Derived analytics (Patterns) | `src/forensics/{topics,themes,sequence,reserve,analytics}.ts` | [forensic-analytics](subsystems/forensic-analytics.md) |
| Storage / license / caps | `src/storage/` | [storage-license](subsystems/storage-license.md) |
| Dashboard (parent review) | `src/ui/dashboard/` | [dashboard](subsystems/dashboard.md) |
| Popup | `src/ui/popup/` | [popup](subsystems/popup.md) |
| Cloudflare proxy | `worker/src/proxy.ts` (private) | `subsystems/worker.md` (private) |
| Interface strings (EN/ES/PT-BR/RO) | `src/i18n/` | [i18n](subsystems/i18n.md) |
| Service worker | `src/background/service-worker.ts` | [background-sw](subsystems/background-sw.md) |
| Engagement-hider (free) | `src/content/engagement/` | [engagement-hider](subsystems/engagement-hider.md) |
| On-page markers | `src/content/{teen-marker,comment-overlay,injector}.ts` | [marker-render](subsystems/marker-render.md) |

## Build and manifest

Four Vite builds, selected by `BUILD_TARGET` (`vite.config.ts`): the main build (service
worker, popup, dashboard; ES modules, `modulePreload:false` so the document-free worker never
meets Vite's DOM preload helper, a rule `scripts/check-sw-bundle.mjs` enforces on every
`npm run build` by loading the built worker without a `document` and completing a reset), the
`bootstrap` build (a tiny document-start IIFE), the `content` build (one self-contained IIFE,
`content.js`) and the `pageworld` build (`page-world.js`, an IIFE with zero imports that runs
in the page's MAIN world). `__FW_BUILD_ID__` is defined at build time and baked into every
bundle; the service worker records each build run (`storage/build-history.ts`) and the
dashboard's Copy Diagnostics prints it.

`manifest.json`: permissions `storage`, `alarms`, `downloads`, `downloads.ui`; host permissions
for twitter.com, x.com, instagram.com, tiktok.com, facebook.com, youtube.com and
`api.feelingwise.org`; extension pages CSP `script-src 'self'`. Both the isolated-world content
script and the MAIN-world `page-world.js` carry `exclude_matches` for every DM / inbox route
(Facebook messages and messenger, Instagram direct, X / Twitter messages and i/chat, TikTok
messages and inbox), so FeelingWise never loads on a private conversation. The MAIN-world
script is registered for the four Meta / X / TikTok hosts only: YouTube gets no page-world
script.
