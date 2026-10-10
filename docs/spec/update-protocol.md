# Update protocol — how this map stays true

The `docs/spec/` map is only valuable if it never drifts from the code. the old
`.brain/` docs went in circles because narrative outlived the code.
This folder is **ground-truth-from-code**, not narrative. These rules keep it that way.

## The rule

**Any code change to a subsystem updates that subsystem's
[`subsystems/<name>.md`](subsystems/) + the relevant entry in the private register `known-issues.md`
entry in the SAME commit.** A spec that lags the code by even one commit is how drift starts.

Concretely, in the same commit that changes behavior:

1. If you changed how a subsystem works → update its `subsystems/<name>.md`
   (`how it ACTUALLY works`, `invariants`, `divergences`).
2. If you fixed a bug listed in `known-issues.md` → move it to the **Resolved** section
   with the fixing commit SHA, or delete it; do not leave a fixed bug listed as open.
3. If you found a new bug / dead code / inconsistency → add a `known-issues.md` entry
   (symptom · root-cause `file:symbol` · severity · fix sketch · verification path).
4. If you changed the end-to-end flow → update [`data-flow.md`](data-flow.md) and, if a
   hop moved, the top-level map in [`README.md`](README.md).
5. If you changed a platform's DOM extraction → update its
   [`surfaces/<platform>.md`](surfaces/).

## Where this sits in a session

There is no start-up reading order; this folder is pulled on demand when a task touches mechanism. The `.brain/` docs (`VISION.md`, `BOARD.md`,
`DECISIONS.md`) remain the source for mandate, work queue, and locked calls;
`docs/spec/` is the source for *how the machine is built*. When the two disagree about a
mechanism, the code wins and `docs/spec/` is corrected; when they disagree about product
intent, `VISION.md` wins.

## Code standards and change gates (absorbed from the retired root `CONTRIBUTING.md`)

- TypeScript strict mode; path aliases for all imports (`@fw-types/`, `@core/`, `@ai/`, … — see
  `tsconfig.json` `paths`); every async function carries a typed Promise + try/catch.
- Detection: ambiguous = PASS (fail-open is the cardinal rule; deterministic safety floors are
  the exception). Neutralization must pass `validateNeutralization()` or the original is shown.
- Before commit: all tests pass (`npm run test`, vitest under `tests/`); `npx tsc --noEmit` = 0
  errors; no new dependencies without justification; detection changes include test cases
  (manipulative + benign) and follow the measurement gates below; the matching `docs/spec/`
  file updates in the same commit.

## Verification before reliance

Spec claims cite `file:symbol`, never `file:line` (the 2026-08-23 audit replaced every line
cite; a new one is drift). A cite must still be **re-verified before being relied on**:
files move, symbols get renamed. The cite is a starting point, not a guarantee. If you read
the cite and the code no longer matches, fix the spec in that commit (do not act on the
stale claim, and do not leave it for "later").

## Drift audits

A drift audit reads `docs/spec/` against the code and flags divergence (the 2026-08-23
objective audit is the reference shape: a per-file drift table, a list of undescribed
mechanisms, numbered edits, and an applied ledger). Run one:

- after a large multi-file change that touched several subsystems,
- when a fresh session suspects a spec claim is stale ("is this still true?"),
- on any "the docs and the code disagree" report.

Its job is to ensure the next session starts on truth, not on narrative.

## What does NOT go here

- Session history / "this cycle" / dated handoff sediment / session counters / work-item ids: that
  lives in `git log`. The spec is a snapshot of the current machine, not a log of how it got
  here. A commit hash beside a resolved row is the one dated reference that belongs.
- Aspirational language (`should`, `will`, `next step`, `TODO`) describing future work —
  open work lives in `STATE.md`; `known-issues.md` holds only
  verified-real defects with a root cause.
- Measured accuracy numbers: those live in the open-work list with their corpus
  + model + grader provenance stamp. The spec links to them; it does not restate them
  (a restated number drifts from its stamp).
