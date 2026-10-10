# BATCH-path corpus runner — usage + regression-lock

The runner script is `scripts/research/runners/run-batch-corpus.ts`. It is the missing
measurement substrate identified in `.brain/PROJECT_AUDIT_2026-05-05.md` §10
ship-blocker #1: pre-runner, every BATCH-path detection change was judged by
single-URL MCP spot-check. The legacy `scripts/research/retired/calibration-baseline-2026-05/run-calibration.ts` needs a
local-private labeled file and is not the public npm entry point. This runner
feeds selected corpus records through
`scoreBatch(encounter)` — the production path — and emits structured
metrics that gate future prompt changes.

## How to run

```bash
# Default: 60 LLM-authored + LLM-labeled synthetic cases, mock mode (no cost).
# This is a wiring smoke set and an upper bound, not accuracy evidence.
npx tsx scripts/research/runners/run-batch-corpus.ts

# Other published corpus
npx tsx scripts/research/runners/run-batch-corpus.ts --corpus external-openai-mod-1680

# Real provider calls require a secret in the local environment and incur cost.
# Private real-feed corpora may be selected locally but are never committed.
GROQ_API_KEY=<local-secret> npx tsx scripts/research/runners/run-batch-corpus.ts
GROQ_API_KEY=<local-secret> npx tsx scripts/research/runners/run-batch-corpus.ts --corpus <local-corpus-name>
```

Output:
- Human-readable report printed to stdout.
- Machine-readable JSON written to
  `tests/calibration/batch-runner-results-<timestamp>.json`.

## Two modes

**Mock mode** (no `GROQ_API_KEY` env). Returns deterministic
`technique='none' / sev=2 / sentiment='neutral'` for every record. Used to
verify the runner WIRES UP cleanly in CI without burning tokens. Mock results
are intentionally non-flagging — they always produce F1=0 against a
ground-truth-positive corpus. Their local result files are ignored and the
aggregate regression lock never reads them.

**Real mode** (`GROQ_API_KEY` set). Hits the real Groq API via `callAI`,
incurring real cost. Whether the output is meaningful evidence depends on the
corpus provenance. The checked-in default remains synthetic smoke/upper-bound
evidence even with real model calls; it cannot support a product accuracy
claim. Daily-cap and key-pool gating are bypassed by the in-memory
chrome.storage shim the runner installs at startup.

## What the metrics mean

The runner reports binary (manipulation vs not) classification metrics
**plus** per-language and per-technique breakdowns.

A verdict counts as "manipulation predicted" when BOTH:
- `verdict.technique` is NOT in `NON_MANIPULATION_TECHNIQUES` (sarcasm /
  genuine-opinion / none / neutral / off-topic / supportive), AND
- `verdict.severity >= MANIPULATION_SEVERITY_THRESHOLD` (6).

These two gates mirror the production runtime — if the production threshold
gate changes (`src/content/index.ts`), update `MANIPULATION_SEVERITY_THRESHOLD`
in `scripts/research/runners/run-batch-corpus.ts` to keep the harness aligned.

| Metric | Meaning |
|---|---|
| **Precision** | Of the records the runner flagged as manipulation, what fraction were truly manipulation. High precision = few false alarms. |
| **Recall** | Of the records that ARE manipulation, what fraction the runner caught. High recall = few misses. |
| **F1** | Harmonic mean of precision + recall. The single number to watch when iterating prompts. The regression-lock floor is in F1 units. |
| **Accuracy** | Fraction of all records the runner classified correctly. Less load-bearing than F1 because corpora are stratified — a baseline that always outputs "not manipulation" gets misleadingly high accuracy on a corpus dominated by negatives. |
| **Per-language** | Same metrics sliced by `record.language`. Key for catching RO regressions while EN holds. |
| **Per-technique** | EXACT-match recall only when the ground-truth label exists in the production BATCH enum. Safety-category labels such as `violence-threat` are listed as unmapped and excluded rather than shown as fake 0% technique recall. |
| **Confusion matrix** | Predicted technique × ground-truth label. The first place to look when precision drops — shows which technique the runner is over-firing on. |

## Regression-lock pattern

The CI gate is `tests/gates/batch-corpus-regression.test.ts`. It loads
`tests/fixtures/calibration/batch-regression-lock.json`, an aggregate-only public lock
with no source rows, identities, URLs, or provider responses. Every registered
corpus must have a clean real aggregate at or above its floor. A missing or
malformed lock is a hard `no-run` failure; a fresh checkout cannot pass
vacuously. Local mock and record-level result files never influence this gate.

### How to update the baseline

1. Run a fresh real-mode pass on the corpus you want to lock against:
   ```bash
   GROQ_API_KEY=<local-secret> npx tsx scripts/research/runners/run-batch-corpus.ts
   ```
2. Inspect the printed report. If F1 is meaningfully better than the
   current floor in `tests/gates/regression-gate.ts`, you have a
   known-good improvement worth locking.
3. Bump that floor to the new floor — NOT the new ceiling. The
   floor is "the worst we tolerate before a CI failure." A 5pp tolerance
   below the new value usually leaves enough room for non-deterministic
   run-to-run noise without masking real regressions.
4. Keep record-level result JSON local. Add only the reviewed aggregate and
   provenance to `batch-regression-lock.json`; never publish private rows.

The pattern intentionally avoids auto-promoting the latest result to
baseline. Promotion is a deliberate choice that requires reading the report.

## What the runner does NOT do (yet)

- It does NOT extend the corpus. Audit §11 W1 P2 covers that — it requires
  a reviewer's labeling time and is a separate session.
- It does NOT touch the BATCH prompt structure. Audit §11 W1 P3 (chain-of-
  thought restructure) is gated on this runner producing a baseline first.
- It does NOT exercise per-platform rich-Encounter assemblers. Each corpus
  record is wrapped in a degraded single-comment Encounter via
  `encounterFromLegacyBatchInput`, the same bridge `flushBatch` uses when no
  rich-platform assembler matches. Per-platform rich Encounter coverage is a
  separate measurement substrate (DOM-fixture-driven, V1.5+).
