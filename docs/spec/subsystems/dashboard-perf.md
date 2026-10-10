# Dashboard performance + data-at-scale — spec + design direction

Status: **implemented in code**: levers 1+2 (windowed feed through use-virtual-scroll.ts), the progressive first paint, the offsets cache and the incremental verify watermark are all in the tree; levers 3 to 5 were assessed not worth building yet. It started from a report that the dashboard lagged and froze on a large record, and a request for storage that holds huge amounts of data without a single freeze.

## The numbers (the owner's live diagnostics, 2026-06-20)
- **`forensicIntegrity.chainLength: 10051`** — the chain is **10k records and growing daily**. This is the dashboard-lag root cause: boot loads/decompresses/verifies/renders against the whole chain.
- Chain is HEALTHY: 10051/10051 verified, 0 broken/unsigned. Integrity is fine — the problem is purely SCALE handling.
- **Content-script memory (separate concern, same diagnostics):** on TikTok during scroll, `usedMB` peaks **371 MB** (`peakMB`), sustains ~210 MB on a single left-open video for ~40 min, `interceptor.pendingNodesPeak: 65`, `batchesDrained: 1598`. High for a content script — retained DOM refs / captured frames / observer state not fully released. Bounded (plateaus ~210) but high. Distinct from dashboard lag; both are "memory/perf at scale."
- Healthy signals (not the problem): selectors all-primary 0-miss; canary all 4 platforms green; groq 100/100 ok (gpt-oss-20b, P50 183ms); video cost ~$0.95/mo.

## Current architecture (the lag source) — code map
- Store: chain in IndexedDB, compressed (`src/forensics/store.ts`). Boot decompresses records, verifies chain (per-record SHA-256 + ECDSA walk), computes stats, renders cards (`src/ui/dashboard/Dashboard.tsx`).
- Prior fix (Stage 1.1, `43fcf3a`): killed the double-decompress (getRecords + getStats both decompressed) and moved `verifyChainIntegrity` + calibration OFF the boot paint path. Helped boot, but **10k records still = heavy load + full render** → the lag the owner still sees.
- `computeStats(records)` (`store.ts`) runs over the records the dashboard already holds, so no count reads the chain again. The recheck path (`Dashboard.tsx` handleRecheck) and the passive refresh on every visibility / focus tick each read the chain once with `getRecordsDetailed()`. `OperationalEventsPanel` still runs its own `getRecordsDetailed()` each time it mounts, a second full read beside the dashboard's own.

## Zero-lag design direction (levers 1 and 2 built; 3 to 5 assessed below)
The goal: render + interact in O(viewport), never O(chain). Five levers, in priority order:
1. **Virtualized rendering (biggest win).** Render only the ~10-20 visible cards via a windowing list (e.g. `@tanstack/virtual`/`react-window`). NEVER mount 10k DOM nodes. Kills render/scroll lag independent of record count. This is the single highest-leverage change.
2. **Windowed/paged data load.** Don't hold all 10k in memory. Load a bounded page (most-recent N, or a time window — the owner's own idea: about 12 hours loaded, older records fetched on scroll). Page older records via an IndexedDB cursor keyed by timestamp/chainPosition. Keep a bounded in-memory window with eviction.
3. **Off-main-thread verification.** Move the chain-integrity walk (10k SHA-256 + ECDSA) into a Web Worker, incremental, non-blocking. Feed renders immediately from stored records; a quiet "verifying…/verified" indicator updates when done. (The chain is already verified-valid; verification is for tamper-evidence, not render-blocking.)
4. **Incremental / cached aggregate stats.** Maintain the dashboard's summary counts (by technique/platform/verdict/day) INCREMENTALLY as records are appended (persisted running summary), or compute in the worker. Never a full 10k re-scan on each open.
5. **IndexedDB-as-source-of-truth, queried lazily.** Use indexed cursors (timestamp, platform, verdict) for filter/sort/paginate instead of load-all-then-filter-in-JS. Add the indexes the dashboard's filters need.

Acceptance: smooth 60fps scroll + instant open at 50k+ records; memory bounded regardless of chain length; never blocks the main thread > a frame.

## Prototype-measured decision (2026-06-20) — port target = windowed append + content-visibility
A standalone prototype (faithful post-group cards, real `--fw-*` tokens, deterministic synthetic feed; the file is no longer in the tree) was browser-verified. Three strategies, same automated top→bottom scroll sweep:

| Strategy | Mount (10k) | DOM nodes | Worst frame | Scroll FPS |
|---|---|---|---|---|
| A · naive (today's `fc-timeline` `groups.map`) | 1459 ms | 301,250 | 87 ms | 15 |
| B · `content-visibility:auto` on every card | 532 ms | 301,252 | 98 ms | 20 |
| **C · windowed append (IntersectionObserver) + cv** | **35 ms** | **1,797** | **11 ms** | **354** |

(FPS uncapped in the headless preview — read the WORST-FRAME column, which is vsync-independent: 60fps budget = 16.7 ms. The same harness measures all three, so the deltas are apples-to-apples.)

Findings:
- **Naive is the confirmed lag** — 1.5 s blocking mount + 301k DOM nodes + 87 ms scroll frames at 10k. This is what the owner sees.
- **content-visibility ALONE is NOT enough at 10k** (lever 1 by itself). It halves mount but the 301k nodes stay, and large scroll jumps still force mass layout → 98 ms worst frame. A surprise the prototype caught — `content-visibility` is a complement, not the fix.
- **Windowed wins decisively and is the SIMPLEST robust option.** Bounds mount + DOM at O(viewport). At 50k records it stays flat (11 ms mount, 7 ms worst frame, ~480 cards rendered after a full sweep). No virtualization library; handles variable-height, expandable post-group cards natively; matches the owner's own model (recent records loaded, older ones fetched on scroll).

**PORTED (2026-06-20, landed in code, not live-verified on the real extension dashboard).** Levers 1+2 landed in `src/ui/dashboard/components/ActivityTab.tsx`: the feed uses `useVirtualScroll()` (`src/ui/dashboard/components/use-virtual-scroll.ts`, extracted from Dashboard.tsx per Proposal B step 2) to render only the visible range, with top/bottom spacer divs preserving total scroll height. Row heights are measured by `ResizeObserver` on `data-fw-key` rows, stale measurements are pruned by active row identity, and `computeFeedDividers` (components/activity-drill.ts) still reads the full `groups` so dividers are correct. CSS (`dashboard-design.css`): scroll position is held by NATIVE browser anchoring — `overflow-anchor:none` is set ONLY on `.fc-virtual-spacer` (so a zero-content spacer is never chosen as the anchor); the `.fc-timeline` container + rows use the default `overflow-anchor:auto`. The earlier hand-rolled JS `anchorScrollDelta` + `window.scrollTo` compensator was DELETED (2026-06-28b, known-issues M34) — it raced the rAF scroll handler and yanked the feed up a row mid-scroll. **`content-visibility:auto` + `contain-intrinsic-size` were also REMOVED from the timeline rows (2026-06-28, known-issues M34):** layered on the already-windowed rows they were a redundant second virtualizer whose intrinsic↔real height flip at the viewport edge made media-heavy cards pop/jump/disappear on scroll (record #412). Removing them does NOT regress the 10k numbers — the win is the windowed node bound (301k→1.8k), and the table above (strategy B) already showed `content-visibility` ALONE leaves the 301k nodes mounted, i.e. it is not the lever. Targeted FeedCard render tests cover the media/comment status labels; full extension behavior still needs live-verify on the owner's machine: 10k-record feed opens instantly, scrolls smoothly with NO card pop/jump near the latest records (incl. after Ctrl+0), older posts remain reachable, filters/search still match the header count.

**Height-map poisoning fixed (2026-07-01, the owner's post-reset feed flicker/skip).** A row unmounted by the windowing gets a FINAL `ResizeObserver` tick with `contentRect` 0×0; the callback stored that 0, and `heights.get(key) ?? FEED_ESTIMATED_H` does NOT rescue a stored 0 — so once the user scrolled far enough for unmounts to begin, every previously-unmounted row counted as 0px, the feed's total height collapsed/restored at rAF rate, and native scroll anchoring converted it into self-sustaining whole-feed flicker, skipped rows, and scroll teleports (jump-park probe: parked at 20000px, feed dragged itself to 0 with continuous recompute churn; guarded: motionless, 0 recomputes — browser-verified in `docs/redesign/mockups/2026-07-01/feed-divider-oscillation.html`). Fix: `if (!el.isConnected) continue;` before the height store in the RO callback (`Dashboard.tsx` `useVirtualScroll`) — a disconnected element is never a real measurement. Math-invariant locked in `tests/unit/ui/dashboard/components/feed-virtualization-guard.test.ts`; the guard itself is a behavior test that mounts the hook with a fake ResizeObserver, `tests/unit/ui/dashboard/components/use-virtual-scroll.test.ts`. Secondary finding from the same probe, NOT fixed (minor): session/platform divider rows are unkeyed direct children of `.fc-timeline`, so their ~34-60px is absent from the spacer math — with correct row heights this is bounded geometry drift absorbed by anchoring (glide backflips at no-divider baseline), not an oscillator.

**Current tradeoff:** full-height virtualization gives a proportional scrollbar, but it depends on estimated row heights until each card is measured. Row heights are keyed by active record identity (so stale estimates are pruned), and the browser's NATIVE scroll-anchoring absorbs the residual estimate→measured shift (rows are anchor candidates; only the zero-content `.fc-virtual-spacer` divs set `overflow-anchor:none` so they're never chosen as the anchor). Levers 3–5 (off-thread verify, incremental stats, IndexedDB cursors) remain separate slices.

## Boot decompress — the OTHER half of a slow dashboard entry (FIXED 2026-06-20)
After the render fix shipped, the dashboard still took 1 to 2 seconds to enter or to switch tabs. The render fix bounds the DOM but NOT the boot data load. Measured (offline, 10k synthetic envelopes): `getRecords()` did `Promise.all(entries.map(unwrapStoredEntry))`, and `decompressRecord` spins up one `DecompressionStream` + `ReadableStream` + `Response` PER record → **~800ms of stream-setup churn at 10k**, linear (so ~2.3s at 30k, ~4s at 50k — and the chain grows daily). This is the bulk of the felt "entering" latency; the in-memory data-prep (`computeStats`, `groupRecordsByPost`, `buildGrowthByRecordId`, `computeRecidivistSet`) was checked and is all cheap O(n) (single-digit ms at 10k), and `DashHeader` only reads `records.length` — neither is the cost.

**RETRACTED 2026-08-03: the batched-stream fix never worked in Chrome.** The
paragraph that stood here claimed `unwrapStoredEntries` decodes every envelope through one
`DecompressionStream` over concatenated gzip payloads, "measured 800ms → 55ms at 10k (~15x)",
five unit tests green. Probed directly in Chromium (playwright, `CompressionStream`-built
two-member concatenation): **Chrome's `DecompressionStream('gzip') rejects data after the first
gzip member** — the batch path could only ever throw and fall back to per-record streams. The
passing tests ran under Node, whose zlib DOES decode concatenated members: an environment
mismatch, the same defect class as seeding raw records into a gzip-envelope store. The current
tree contains no batch path at all (`unwrapStoredEntries` is a plain per-record loop); the
2026-08-02 CPU profile (822 ms, per-record stream machinery visible) is the Chrome reality.
Isolated cost of the per-record loop in Chromium: ~211 ms per 10k records — real but a minority
of the load, so a working batch (e.g. bundling a sync inflater) is an optimization, not the
lever. The lever that shipped instead is the progressive first paint below.

## Progressive first paint (landed in code 2026-08-03) — lever 2, honesty-constrained

The 2026-08-02 profile (`docs/measurements/2026-08-02-dashboard-perf.md`) put reload-to-list at
822 ms at 13.5k records, all components scaling with N (native IDB read + inflate ~300 ms,
stream machinery ~120 ms, store JS ~126 ms, GC ~70 ms). The change: paint the Activity feed
from the newest page first, finish the archive behind it.

- `getRecordsFirstPage(limit)` (`store.ts`): one `getAllKeys` + one ranged `getAll` over the
  key-space tail (autoIncrement keys are insertion order = chain order), unwraps only that page.
  Returns null on any failure; it never touches `recordReadFailed` — the full `getRecords()`
  remains the only source of truth and always runs.
- `Dashboard.tsx load()`: phase A sets `firstPage` (newest 400) and clears the spinner; phase B
  runs the authoritative full read, then stats, then the post-paint verify walk as before.
  INVARIANT: `records` state only ever holds the full set or []; only the Activity feed reads
  `firstPage`. Export, verify, reset, every other tab, and every stated total wait for phase B
  (non-activity tabs show the loading note; header Verify/Reset stay disabled on empty
  `records`).
- **The count-honesty constraint, designed in:** while `firstPage` is live the trust line reads
  "Showing the newest {n} records while the full archive loads…" (EN+RO), stating no chain
  total; the header RECORDS chip and every rail count render a pending "…" glyph
  (`countsPending` / `RailOptionSpec.count: null`). No surface states a total the page has not
  actually loaded.
- **Measured (2026-08-03, same instrument + seeded 13.5k profile, two runs):** reload → first
  list paint **832 ms → 247-248 ms**; reload → full-archive line 832 ms → 1008-1058 ms (the
  full unwrap now runs behind a visible feed and the page is unwrapped twice; that regression
  is the accepted price of the 3.4x first paint). Live-verified in Chromium
  (`.verify/progressive-probe.mjs`): partial state shows the loading line, no full total
  anywhere in the DOM, 32/32 rail counts pending; full state restores "Showing 13500 of 13500
  records" with zero pending glyphs. Screenshots `.verify/perf/progressive-{partial,full}.png`.
- Tests: `tests/unit/forensics/records-first-page.test.ts` (newest-N slice order, short-chain, empty
  store + failed-flag isolation).

**Levers 3–5 assessed NOT worth building now (2026-06-20) — do not gold-plate.** After the render fix, the boot path was re-checked against the actual code:
- **Lever 4 (incremental/cached stats):** `computeStats` (`store.ts`) is a few linear passes (3 filters + one loop over flagged + one over blocked, integer counters + one string-canonicalize per technique) — single-digit ms over 10k records, negligible vs the 1.5s→35ms render win. A persisted incremental-stats cache adds invalidation + append-hook + persistence complexity for ~5 ms. SKIP until a profile shows it matters.
- **Lever 3 (off-thread verify):** `verifyChainIntegrity` ALREADY runs after first paint (`Dashboard.tsx load()`, phase B after the spinner clears) — it does not block the felt experience. A Web Worker would only help if the post-paint walk janks interaction; no evidence it does. Real MV3-worker + crypto-in-worker + message-passing complexity. SKIP until a profile shows post-paint jank.
- **Lever 5 (IndexedDB cursors):** load-all-into-memory only bites at year-scale (50k+). At 10k it's fine. SKIP until the chain is materially larger.
Re-open any of these only with a profile that shows the specific cost. The felt lag (render) is fixed; the rest is speculative until measured.

## Content-script memory (separate to-do) — peaks 371 MB on TikTok scroll
Audit the content script's retained state on long social-feed sessions (peaks 371 MB; sustains ~210 MB on one left-open video for ~40 min). Cross-ref the OOM lesson `2026-06-05-youtube-renderer-oom-background-raf` + the hidden-tab drop backstop. Goal: bound + release on scroll-away so a long session stays flat.

**FIXED 2026-06-20, then MOOT 2.5.0** — the audio-capture path that leaked `captureStream()` tracks was removed with the media features.

**Remaining retained-state to audit (lower-priority; each needs the live profile to confirm impact — do NOT blind-refactor the safety-critical path without it):**
- `sessionVerdictByPostId` / `sessionHideCollapseByPostId` (cap 500), `addGuard` MAX_GUARDS 500, MutationObserver-retained nodes (`pendingNodesPeak 65`) — all already bounded; verify release-on-scroll-away in the live profile.

## Interaction-path fixes (landed 2026-08-10)

Three synchronous main-thread costs in the open dashboard, each removed without changing results:

- **Search debounce.** The raw input state echoes instantly; the O(N)-per-record `passes` predicate reads a 150 ms debounced copy, so one keystroke no longer re-scans the whole chain three times (list + railCounts + groups) per character. `components/ActivityTab.tsx` `debouncedSearch`; locked by `tests/unit/ui/dashboard/components/activity-tab-render.test.ts`.
- **Issues tab reuses the integrity verdict.** `OperationalEventsPanel` accepts the Dashboard's already-computed `integrity` prop and only runs its own full crypto walk when no current verdict exists (which preserves the honesty rule: no verdict means walk, never means stale shield).
- **Virtual-scroll offsets cache.** `buildOffsets` is extracted from `computeVirtualRange`; the hook caches its result keyed on (count, keyAt identity, heightsVersion) where heightsVersion bumps on every heights-map set/delete. The per-frame scroll path is now the O(log n) search over cached offsets instead of a 10k-lookup + 10k-slot allocation per animation frame. Equivalence locked in `virtual-scroll.test.ts` (prebuilt vs inline identical ranges); the reuse itself (no rebuild across scroll frames, one rebuild per height change or row-set change) is locked by `tests/unit/ui/dashboard/components/use-virtual-scroll.test.ts`.

## Incremental verify watermark (landed 2026-08-11)

The passive refresh (visibility/focus/settle) used to drop the integrity verdict on any chain growth and leave the banner unverified until a manual O(chain) re-walk. Now `chain-integrity.ts` exports a watermark API: `chainWatermarkFrom(records, fullWalkResult)` checkpoints the verified tip (id, hash, position, first position, full result), and `extendChainIntegrity(records, watermark)` verifies ONLY the appended segment (full SHA-256 + signature crypto) and merges the verdict, after proving the prefix unchanged by shape: same tip id/hash/position, same first position, same count, every prefix id known to the prior walk, and the first appended record linking to the verified tip. Any shape movement (prune, re-anchor, substitution, prior break) makes it refuse (`null`) and the caller falls back to unverified-until-Verify.

Honesty contract, stated plainly: the extension does not re-hash the already-verified prefix, so retroactive prefix tampering between two refreshes surfaces at the next FULL walk — which still runs on every dashboard load and every manual Verify (both also refresh the watermark). The refresh still drops the verdict FIRST and only then extends (drop-first order, locked in `verify-watermark.test.ts` alongside the API's unit tests).

Still open: moving the initial verify walk off the main thread, and the three double-read sites named above.
