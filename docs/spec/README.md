# FeelingWise — Living Specification (`docs/spec/`)

The authoritative, code-traced map of how FeelingWise is built. Read on demand when a task
touches mechanism; on any mechanism conflict this folder wins.
It exists because the logic grew across many sessions and "no one holds the whole mechanism
in view at once" — duplicate records, orphan threads, metrics that don't land, pipeline steps
that fight each other. This folder is the one place that answers *what exists, how it
connects, how it's supposed to work vs. how it actually works, and where it's broken.*

Ground-truth-from-code, not narrative. When this folder and any other document disagree about
a mechanism, **the code wins** and this folder is corrected. Product intent lives in
`BRIEF.md`, under the owner's mandate; neither is in the public copy. The plan this line named
until 2026-09-21 and the August vision before it are history
(`docs/history/2026-09/LONG-PLAN.md`, `docs/history/brain-2026-05-to-08/VISION.md`).

## How to use this folder

1. New to the codebase, or returning after a gap → read [`00-overview.md`](00-overview.md)
   (what FW is, the 4 AI roles, modes, the two halves).
2. Need the end-to-end pipeline → [`data-flow.md`](data-flow.md) (the X-ray, file+function at
   every hop).
3. Touching one area → open its [`subsystems/<name>.md`](subsystems/) before you read code.
   It gives purpose, key files, invariants, should-vs-actual, and known divergences.
4. Working a platform's DOM extraction → [`surfaces/<platform>.md`](surfaces/).
5. Hunting / fixing a bug → the defect register, `known-issues.md`. It is not in the public copy
   of this repository (it is written in the maintainer's own voice and quotes reports from named
   people); source comments cite it by entry number, and
   [`KNOWN-LIMITS.md`](KNOWN-LIMITS.md) carries what a reader outside the project needs from it.
6. About to change code → read [`update-protocol.md`](update-protocol.md) and update the spec
   in the **same commit**.

## Files

| File | What it holds |
|---|---|
| [`00-overview.md`](00-overview.md) | What FW is; 4 AI roles; modes/presets; local record chain; protection-wrapper vs. record-core |
| [`data-flow.md`](data-flow.md) | The complete pipeline, page DOM → screen + retained record, with the file at each hop |
| [`subsystems/`](subsystems/) | One file per subsystem — purpose · key files · I/O · invariants · should-vs-actual · divergences |
| [`subsystems/off-product.md`](subsystems/off-product.md) | The second extension built from this tree: the filter (Off), what the product constant switches, the word filter |
| [`subsystems/read-this.md`](subsystems/read-this.md) | Adult mode's on-demand reading in the recorder: the popup card, the shared crosshair, the measured judge asked of one item, the four lines beside it, the record line, the chain write |
| [`../../verifier/`](../../verifier/README.md) | The export checker as a separate program (Node, no dependencies), generated from the same core every export embeds; Apache-2.0, the part of the tree meant to be published on its own |
| [`AREA-MAP.md`](AREA-MAP.md) | The inventory rather than the path: the twelve source areas, which file carries the weight in each, and the six seams where two areas have to agree with nothing making them. Written 2026-09-19 from six read-only scans; read it when you do not yet know which area a question belongs to, and update it in place |
| [`STRUCTURE-MAP.md`](STRUCTURE-MAP.md) | How the extensions find things on a page that keeps changing: anchors (the disclosure word in every channel it can be drawn in, outbound links, ARIA roles), boundaries computed by relationship, the judged-versus-found canary, a per-platform table of what is verified. Written 2026-09-03 at the owner's ask; read it before adding a selector |
| [`mode-rails.md`](mode-rails.md) | The inventory of settings.mode enforcement branches: the documented hard child-safety rails vs the toggle conversions, with the grep that reproduces the count |
| [`surfaces/`](surfaces/) | Per-platform DOM extraction contracts (selectors, id + grouping scheme, lazy-render timing) |
| [`RELEASES.tsv`](RELEASES.tsv) | Every zip uploaded to the Chrome Web Store: the commit, the Node version, the hash of its files and of the zip. The public CI rebuilds each upload its source was built from and compares it with this list |
| [`KNOWN-LIMITS.md`](KNOWN-LIMITS.md) | What a checked export establishes and what it does not; what is missing from a record by construction; what the model's reading is and is not. The honest half of the specification, written for someone outside the project |
| `known-issues.md` | The prioritized, adversarially-verified bug / dead-code / inconsistency register. Private: it is in the maintainer's voice and quotes named reports, so it is not in the public copy. Source comments cite its entries by number (M1, M2, …) and those numbers are stable |
| [`update-protocol.md`](update-protocol.md) | The rule that keeps this map true |
| `AUDIT-2026-08-23-APPLIED.md` (private) | Per-item ledger of the 2026-08-23 objective audit's spec edits (applied / already resolved / superseded / skipped) |

## Top-level system map

```
   SOCIAL PAGE (TikTok · X · Instagram · YouTube · Facebook)
        │ DOM mutations (the only path that makes a record; the page-world fetch/XHR
        │ interceptor only fills gaps in those records from the platform's own JSON)
        ▼
   interceptor.ts ── MutationObserver ── route key ── carriesFwInjectedText gate
        │ adapter.extractPosts → PostContent[]
        ▼
   platforms/{twitter,facebook,instagram,tiktok,youtube}.ts        ── engagement/ (free:
        │ onPostDetected (index.ts)                                   hide counts/buttons,
        ├──────────────┬───────────────┐                          block reels/AI/ads) ─┐
        │ post/video   │ comment        │                                                 │
        ▼              ▼                                                                  │
   queue.ts       comment-batch/                                                          │
        │         queue → flushBatch                                                      │
        ▼              ▼                                                                  │
   core/pipeline  comment-batch-scorer                                                    │
   (COMBINED)     scoreBatch+scoreRoom                                                    │
        │ blocklist→floors→JUDGE                                                          │
        │ neutralizer.ts  ┌── ai/client.ts ──► Cloudflare Worker ─────────► Deep Infra    │
        │                 │   (proxy.ts, api.feelingwise.org; Durable Object caps)         │
        └────────┬────────┘                                                               │
                 ▼ result                                                                 │
   onProcessingResult (index.ts) ── anchor-revalidation ── DOM mutate ── TERMINAL PROOF ◄─┘
        │   (replacementIsVisible; Child: failed rewrite → hide, double failure keeps cover;
        │    one settleProtection release terminal; proven outcome → record)
        ├── KID:    teen-marker / comment-overlay / injector   (markers, swap, hide)
        └── PARENT: *_LOG → service-worker.ts (sender allowlist, PIN gates on reset/restore)
                         → forensics/store.ts: sign (ECDSA) + hash-link + gzip → IndexedDB chain
                              │   (durable outbox, 8-attempt quarantine)
                              ├── dashboard (Dashboard.tsx shell + components/): first page →
                              │   full read → verify (watermark on refresh) → group → feed
                              ├── Patterns: topics/themes/sequence/reserve (derived IDB)
                              └── export: html-export.ts → standalone HTML with embedded-key
                                  signature + chain checks (free on every tier)
```

The three detection layers (language → harm → manipulation) run inside `core/pipeline.ts`
(COMBINED) and `comment-batch-scorer.ts` (BATCH); deterministic floors fire before/around the
AI so the obvious is caught even on the free tier (no AI). See [`00-overview.md`](00-overview.md).

## Cross-cutting themes to watch (the whole-app risks)

These span subsystems — the reason a single-file fix never holds. Tracked in the private register
`known-issues.md` (see the table above):

- **Chain-id instability** — random-UUID / non-deterministic record ids on the post path
  break grouping, "View original" links, and post↔comment cohesion (the X
  duplicate-record / orphan-thread seed bug).
- **`parentVideoId` format split** — different writers stamp different formats; the dashboard
  groups by it, so video / caption / comment records silently split.
- **Caps**: both sides are 2000/day and $5/month. What remains: the client monthly override may be set above the tier cap (the worker enforces $5 regardless), and the client daily gate ignores the tier cap on the legacy `dailyCap=0` sentinel (the pipeline gate catches it).
- **Stale model docblocks** — RESOLVED (2026-06-19 purge sweep): the docblocks that named
  `gpt-oss-120b` / `llama-3.1-8b-instant` as production now name `openai/gpt-oss-20b`.
- **Encounter degradation on incomplete surfaces** — X permalink adds rendered ancestry and TikTok/Instagram/YouTube/Facebook have dedicated rich assemblers; X home-feed or observations missing required surface signals use the degraded legacy bridge.
- **Silent protection loss** — the historical fire-and-forget chain-write finding is resolved by the durable ingress ledger (M22); no-op rewrites and clipped markers remain separate audit themes.
- **Observer cost**: every engagement body observer is rAF-throttled and the section-model walk was measured cheap (2026-07-15); two always-on perf samplers (`[FW perf] chip-scan`, `[FW perf] periodic-rescan`) still print in production.

## Provenance

Built 2026-06-16 by a multi-agent swarm: Phase 1 mapped each subsystem from code (read-only),
Phase 2 adversarially audited + refuted each finding, Phase 3 synthesized this folder, Phase 4
reconciled the `.brain/` docs. Every claim cites a file and a symbol; re-verify before relying
(files move).

**Spec provenance, 2026-08-23.** The objective audit in
`docs/audits/2026-08-23-objective-audit/` (untracked working folder; `FINDINGS.md` section 5,
`wave1-spec/spec-drift.md` sections 1, 4 and 5, and the code-derived draft `SPEC-CURRENT.md`)
re-read every file here against the code at commit d5bb79a. Its draft was merged into this
folder section by section, file by file, rather than copied over it: each of the 111 recommended
edits and the 94 undescribed mechanisms was checked against the code as it stood after the
phase 1 to 3 commits of the same day, applied in the form true then, or recorded as already
resolved, superseded or skipped. The per-item ledger is
`AUDIT-2026-08-23-APPLIED.md` (private). Line-number cites were replaced
by symbols throughout; dated handoff prose, session counters and W/Q ids were removed.
