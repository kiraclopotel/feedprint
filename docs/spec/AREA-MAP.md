# The area map: what the tree is, area by area

What the tree is, area by area, written so a session with no memory of this one can find the
load-bearing file in any area in under a minute, and so the places where two areas touch are named
rather than discovered.

Written 19 September 2026 from six read-only scans, one per area, plus a live drive of the public
site and the export in a real browser. It described the code at commit `0a15c107`, and the section at
the end of this file, **What moved since**, says what has changed under it since then, with the
commit each map claim should now be read against. Update it in place rather than writing a second
one; a map that is re-created per session is the defect this file spends its last section
describing.

**Its two neighbours, and how it differs from them.** `data-flow.md` follows one item through the
whole pipeline, hop by hop, with the file and function at each hop: read it when you need the path.
`STRUCTURE-MAP.md` is about a different problem entirely, how the extension finds things on a page
whose classes change weekly: read it before adding a selector. This file is neither path nor
selectors. It is the inventory: which areas exist, which file in each carries the weight, and where
two areas have to agree with nothing making them.

The defects it refers to are in `docs/audits/2026-09-19-refinements/FINDINGS.md`; this file is the
shape, that file is the list.

Counts: `src/` is 12 areas and about 420 TypeScript files. `src/content` 112, `src/forensics` 83,
`src/ui` 73, `src/core` 53, `src/types` 29, `src/storage` 18, `src/i18n` 18, `src/ai` 10,
`src/analysis` 7, `src/diagnostics` 7, `src/background` 6, `src/products` 3. Beside them: `worker/`
(a Cloudflare worker), `landing/` (53 static pages), `tests/` (714 files), `scripts/`, `verifier/`.

---

## The one-paragraph version

A content script watches a feed, hands each post or comment to a judge, and does two separate things
with the answer: it may change what the page shows, and it writes a signed, hash-chained record to
the person's own disk. Those two are deliberately not the same act and not the same code. The record
is the product; the on-page change is the part people notice. Everything downstream, the dashboard,
the export, the public checker, is a reader of that chain.

---

## Area 1: content scripts (`src/content`, 112 files)

**The path.** `bootstrap.ts` runs at `document_start` as a shield, before the DOM is ready. Then
`index.ts:init()` picks a platform adapter from `platforms/` and builds the `ContentInterceptor` in
`post-path/dom-interceptor.ts`, which owns the single body-wide `MutationObserver`, batches added
nodes on an animation frame, and calls `adapter.extractPosts(nodes)`.

**The chokepoint.** Every post and comment in the product passes through one function,
`onPostDetected` in `index.ts`. That is where wire enrichment, account type, impression order, text
folding and media addresses are each stamped exactly once. If you need to know what a record carries
before it is judged, read that function and nothing else.

**The fork after it.** Comment-kind items with a parent video go to `comment-batch/queue.ts`, which
debounces and caps, then `comment-batch/flush.ts`, which scores a batch and applies the terminals.
Everything else goes `post-path/post-queue.ts` → `analysis/pipeline.ts` →
`post-path/result-apply.ts`.

**Parallel and independent.** `engagement/controller.ts` hides metrics, buttons, ads and reels by
fixed rule. It starts once per page life, not per route, and it never consults the judge.
`protection/child-first-protection.ts` owns the Child-mode cover that brackets the window between
extraction and verdict.

**Load-bearing:** `index.ts`, `post-path/dom-interceptor.ts`, `comment-batch/flush.ts` (1,863
lines), the five platform adapters (1,000 to 1,800 lines each).

**The seams.**
- *Detection time versus emit time.* `stampMediaUrls` reads the DOM when the post is first seen;
  `mediaUrlsNow` reads it again at chain-write time, after a model round trip. A virtualized feed
  recycles nodes in that window. The guard against reading a recycled node compares the post's own
  text, so it does not run for a post with no text. See R-15.
- *Every adapter decides for itself what counts as real text*, with its own length floor and its own
  drop accounting, or none. The interceptor keeps a gap ledger for its own drops; the adapters
  mostly do not. See R-16.

---

## Area 2: the judge (`src/core` 53, `src/analysis` 7, `src/ai` 10)

**The path.** Text → `core/detector.ts` runs every deterministic classifier in `core/techniques/`
plus the combined-stack pass → optionally the AI judge, `askJudgeV1` in `core/neutralizer.ts` using
the prompt in `ai/prompts.ts` → a severity and a family → an action.

**Two frozen files.** `src/ai/prompts.ts` and `src/core/neutralizer.ts` are locked by
`.claude/rules/judge.md` and change only on the owner's word for that specific edit. Both were read
this session. Neither was touched.

**Where the action is chosen, today.** In three places, not one. `neutralizer.ts:1294` for posts
(`hide` at severity >= 8). `analysis/comment-batch-scorer.ts:544` for comments (`isManipulative` at
severity >= 6). `comment-batch-scorer.ts:558` for the on-screen marker (severity >= 5).

**The table that is not wired in.** `core/policy/table.ts` is a clean pure function meant to become
the one place a reading becomes an action. Its own header says it is not in the pipeline yet, and
grep agrees: its only caller is `content/record/decision.ts`, which builds the forensic record and
honestly logs when the table's answer differs from what was applied. It already disagrees with the
live path at severities 7 and 8. See R-18.

**The locale gate.** `core/lexicon-regional.ts` adds region-specific terms keyed on the reader's
region and withdraws cross-language homographs keyed on the reader's language. It is the best
defended file in the area: every term carries its own false-positive probe count. The plainer lists
next to it are not. See R-19 through R-21.

**The seam that matters most:** every decision is a pure function of the one item. Nothing anywhere
takes the parent post as an input to the reply's own action. So a reply can be hidden while the
claim it contests stays. That is a design property, recorded in the firmament case on 4 September,
and this scan confirms it is still true of the code that runs today.

---

## Area 3: the record (`src/forensics` 83, `src/storage` 18)

**Writing one.** `logger.ts` builds a `ForensicRecord`, takes `chainPosition` and `prevRecordHash`
from in-memory chain state, computes an integrity hash over a fixed-order serialization of about
fifty named fields (`canonical-payload.ts`), signs that hash with ECDSA P-256 (`signing.ts`), and
writes through `store.ts`, the sole IndexedDB gateway.

**Keeping it.** `store.ts` also owns `computeStats` and `pruneRecordsToCap`, which evicts only after
`archive-writer.ts` confirms the overflow landed in a per-month archive. Month rotation writes a
marker at position 0 of the new chain carrying the prior chain's hash;
`chain-integrity.ts` walks every month plus the active chain and checks those links.

**Independent time.** `chain-anchor-store.ts` asks two of three RFC 3161 authorities (`TSA_ENDPOINTS`
in `tsa-client.ts`) to timestamp the chain head. The tokens sit in a sidecar store, outside the hashed payload. In the demo export, four
anchors verify offline against certificates carried inside the file.

**Handing it over.** `exporter.ts` applies the export gate, then `html-export.ts` builds a
self-contained HTML file that embeds both the verifier source and the numbers engine, so the
recipient's browser re-derives every count and re-checks every signature with the network off.

**Two lanes, and they are not the same.** The export's numbers come from `export-numbers.ts` and its
inline twin. The dashboard's numbers come from `store.computeStats` folded with per-month summaries
from `archive-summary.ts`. A bug in the first is a courtroom problem; a bug in the second is a
dashboard-honesty problem. They are the same question asked twice, and they answer "was this ad
blocked" differently. See R-17.

**Load-bearing:** `canonical-payload.ts` (the hashed field list, must match the generated verifier
exactly, checked and currently matching), `store.ts`, `html-export-scripts.ts`, `verifier-core-source.ts`.

---

## Area 4: what the person sees (`src/ui` 73, `src/i18n` 18)

Two React roots, `dashboard` and `popup`, no server and no router beyond in-app tab state. Each tab
gets records as props and does its own aggregation in a sibling plain-TypeScript file, so the
counting is unit-testable without React.

**Three separate string systems, deliberately.** `src/i18n/dashboard` and `src/i18n/popup` are typed
against one interface per surface, so a key missing in one of the four languages is a compile error
rather than a runtime blank. `src/i18n/export-strings.ts` is a different table for the standalone
export. `_locales/` is a third, used only for the store listing; nothing in `src/` calls
`chrome.i18n.getMessage`.

**The mirror that can drift.** `src/ui/popup/coverage-map.ts` is a hand-written account of what the
content scripts actually do, per platform and per path, and it is what the popup tells a parent is
protected. It is not derived from the adapters. It has drifted before, and it has drifted again. See
R-6.

**Load-bearing:** `Dashboard.tsx`, `ActivityTab.tsx` with `activity-filters.ts` and `filter-rail.ts`
(the count-versus-list invariant everything else is measured against), `color-maps.ts`, and the two
`types.ts` files that make a missing translation a compile error.

---

## Area 5: the service worker and the server (`src/background` 6, `worker/`)

**One channel.** Content scripts talk to the service worker through a single
`chrome.runtime.sendMessage`, met by a single listener gated on `sender.id === chrome.runtime.id`
and a message-type whitelist. Some types are fire-and-forget; forensic deliveries and the PIN-gated
operations are acked.

**What the worker owns:** seven self-healing periodic alarms, chain-write serialization through a
shared lock and per-author locks, a session-backed registry of inspection tabs so a dashboard tab is
never itself protected, and a recheck ledger cleaned on restart.

**The server.** FeelingWise's server at `api.feelingwise.org` carries the paid AI reading, for a
paid install the time-stamp request when the authorities cannot be reached directly, and for every
install at Moderate or Relaxed the signed repair file (about every six hours, nothing about the
person) and the "Describe this page" report (only on a press, structure only). Its code is not in
this tree.

**Permissions.** Every host permission in both manifests corresponds to a real fetch target. The
`off` manifest is a strict subset of the recorder's.

**The seam:** Off and the recorder exclude each other with a DOM stamp and an observer, not a lock.
See R-11.

---

## Area 6: the build, the guards and the site

**Source to zip.** `npm run build` stamps a build id, runs `tsc --noEmit`, runs four Vite builds
(popup, bootstrap, content, page-world), then checks the service-worker bundle. `npm run package`
adds `scripts/package.mjs` and writes a zip and its hash into `release/`. Both packages build twice
to identical bytes.

**The guard layer.** `tests/repo/` is 33 files that are not unit tests: they read `git ls-files` and
assert about the shape of the tree itself. Root contents, layering, frozen-file hashes, CI and hook
parity, link integrity, a ledger of moved paths. Most carry a sanity assertion that the guard read
something, and several ship a self-test proving the detector fires on the historical bug it was
written for. This is a genuinely strong layer.

**Its characteristic failure, and it is a pattern not an accident.** These guards narrow by
*directory*, not by rule. `one-number-format-per-surface` walks `src/ui` and the defect it was
written for was sitting in `src/i18n` (fixed, `8596a898`).
`no-stylesheet-comment-eats-a-rule` reads `*.css` and the site ships 16 HTML files with real inline
`<style>` blocks. `one-clock-per-surface` has the same scope as the first. A guard that names a rule
and then checks one folder is a guard whose coverage nobody can read off its own header. See R-22.

**The hook chain.** `.githooks/pre-commit` runs a privacy check, a release-file-location check, a
frozen-file check, then conditionally both type lanes, the linter, the unit project, the tooling
project and the worker typecheck. `.githooks/pre-push` refuses every push without an explicit
environment variable set from the owner's own terminal.

**The site.** `landing/` is 53 static pages, largely self-contained, deployed separately, and
outside the module graph every `src` guard polices. Swept this session: every internal link and
asset resolves, every page has one `h1`, a `lang`, a description, no duplicate ids, no dead anchor
and an `alt` on every image.

---

## The seams, in one place

A seam is where two parts have to agree and nothing makes them. Twenty four found on 19 September
across four scan waves. Nineteen are closed.

**Closed (19).** The popup's coverage map against the adapters. Detection-time against emit-time DOM
reads. The export's kind labels against the dashboard's filters. The guards against the rules they
name. What the page did against what the record says, on comments and on posts. A protection wired
behind a cosmetic switch. Two policies sharing one terminal. The usage chart against the month
total. The live window against the archive, on outages. The ledger's severity against its own stated
intent. Facebook's comment signals against the element they were given. "Repeat offender" against
itself. The safety panel's denominator against every other panel's. X's edit marker against
Facebook's and Instagram's, and all three against the languages they declare. Three panels counting
techniques with one folding the spellings. The folder mirror's "written" against what it wrote. The
rewrite's target against the comment that was judged. The count-chip scan against the private-surface
rule every sibling obeys. A one-shot repair's report against what it actually wrote.

**Open (5), and every one of them is a decision rather than a slip.**

- **The export's numbers lane against the dashboard's.** `store.ts:1767` still counts blocked a third
  way.
- **The live action path against the policy table meant to replace it.** They disagree at severity 7
  and 8.
- **The cutover pair.** Two writers filing one record under two months; a reset that clears the chain
  in one transaction and its anchors in another.
- **The page's world against the extension's.** Any script on the page can put gap-filling data into
  the record. Nothing there can weaken a protection, which is the part the scan got wrong, but it
  lets a page say the feed served something nobody saw.
- **A photo-only Facebook comment against Twitter's own stated principle.** Left for want of a
  selector that can be verified rather than guessed.

**What the twenty four have in common.** Almost all are one rule with two implementations and nothing
comparing them. The most common single form, and the hardest to see, is narrower: **a rule stated in
a comment directly above code that does something else.** Six of the night's findings were that, and
in every one the comment was right and the code was wrong. Code of that shape reads as correct to
anyone who reads the comment first, which is everyone.

**The checks are not exempt.** Four findings were defects in instruments rather than in the product: a
promises check that called the product broken over a minifier's choice of name, two guards that
walked one folder while naming a surface, and a test that asserted the right thing and measured
something else. An instrument that is wrong is worse than no instrument, because it is believed.

**And a scan is not exempt either.** Two of the fourth wave's reported defects were refuted by reading
the file: one claimed a page could forge an ad flag to false, which the code cannot do, and one
called a documented, reasoned trade-off an oversight. Every finding in the list beside them was
re-checked by hand before it was written down, and three had their scope narrowed in the process.

The five still open all sit where being wrong is worst. That is not a coincidence: a slip on those
paths gets caught, and a decision does not, because it looks like it was meant.

## What moved since

**Read this before trusting a claim above that touches one of these.** The body of the map is as
written at `0a15c107`. Twenty-seven commits on the evening of 19 September changed 42 source files,
after six read-only scans of the same kind that produced this map, and these are the places where
the map's picture is now out of date. Nothing above was rewritten, because a map edited in a hurry
at the end of a long night is how a map stops being trusted; this list is the honest seam.

**Area 1, the feed.** A YouTube comment's `domRef` is its BODY element, not its thread renderer, and
the recovery walk for a comment is scoped to the thread rather than to the view-model (M285). The
replay path proves a row is still the comment that was judged before it rewrites it, through one
shared `resolveCommentRow` that the hide terminal and the rewrite branch both call (M291). Instagram
stops at the row boundary in all four of its body pickers (M293) and reads its per-comment counters
off the row's chrome rather than off the words (M292). Facebook's comment-label reading is one
function, `isFacebookCommentLabel`, and the two hand-rolled copies are gone (M294); its
comment-block stylesheet and its reply-expander scan both carry the private-surface gate (M286,
M295).

**Area 3, the record.** `getChainState` cannot hang, and closes its connection on every path (M289).
`linkToNextOk` is `linkToPreviousOk`, and its docblock says what the loop does (M308). A manual
backup waits to be told the file is on disk (M290), and the fixed-name copy records whether it was
written (M296).

**Area 5, the worker.** The archive half of the chain-height check runs at most once per browser
session rather than on every realm (M287). The update-gap marker is noted before it is written and
retried on the next realm (M309).

**Area 6, the build and the guards.** The zip carries no `build-id.json` and no baked dev secret, and
a plain `npm run package` writes `<name>-<version>.local.zip` rather than an unversioned twin
(M288, M297). Four guards read wider than they did: the guard index covers `tests/gates`, the
database-placement check reads the union of two honest patterns, the number-format check reads the
multi-language tables, and no instrument under `scripts/verify` may print SKIPPED and leave the exit
code alone (M298, M299, M300).

**Still as the map describes it:** the privacy page. Seven disagreements between it and the code were
verified and drafted rather than applied, in
`OUTBOX/2026-09-19-privacy-page-seven-corrections.md`, because they are sentences on a published
policy and the decision on one of them is a code choice the owner has not made yet.

**Area 7, the free product.** A mode switch in the free popup goes through the same machine the paid
one uses, so it asks before it throws rules away and demands the PIN inside the grace window (M310).
"No swearing" restarts the filters on the open page (M313), and two settings changes close together
can no longer leave a set of scanners nobody can stop (M313). "Block this" answers back: the page
says it took the arming, and on silence the popup stays open and says what to do (M314).

**Private conversations, across both products.** The rule is that every filter stops at a private
surface, gated by DOM region and not by URL. As of 2026-09-19 that is true of all of them. The
picker refuses a pick inside a conversation and cannot land a remembered shape on a message row
(M312); the Instagram composer sheet, the sidebar ad remover, the surface switches and the TikTok
comment block all carry the gate (M316), and each was shown to take something without it, the
sidebar ad remover taking the whole chat log. The free product now re-checks on every route change
rather than once at boot (M315), which is what made walking from the feed into Messages safe. The
URL gate remains the coarsest of the three defenses, not a replacement for the other two.

**Area 8, the export and the public checker.** The artefact a stranger receives now says what the
checker knows. A signature that was run and came back false is reported as that, not as a key the
file does not carry, and it no longer counts the file's own key among the keys it lacks (M318). A
key that travelled beside the records gets a reason instead of a bare amber headline (M318). The
green headline is offset by a sentence naming the withheld records whose hash was never recomputed
and how many of them had no signature checked (M320). The chain-seam note names both events it
counts, so a restart is no longer reported as a position held twice, and the file's one "a record
may have been replaced and re-signed" warning is spent only where that shape exists (M321). A
failure hands the verify button back and no path blames the key for a failure that came later
(M322). Four documentation sentences that described other code are corrected, including the public
README's reading of the withheld-unsigned vector (M323).

FORMAT.md's manifest-token table is held against `checkManifest` by a test, because it drifted: the
table described the check order that had the bare-envelope signature hole in it, on the day the hole
was closed (M319). **Across every fix to what the page says, `verifier/vectors/EXPECTED.json` is
byte-unchanged.** Nothing about what the checker concludes has moved this night; only what the file
tells the person holding it.

**Area 9, the child-safety promise.** A settings read that fails is retried like every other read in
the tree, and a snapshot that still cannot be confirmed no longer reports "no parent PIN": the
popup, the mode switch and both destructive service-worker handlers refuse it rather than opening
(M324). A fatal init leaves the document-start curtain to the shield's own 5s authority instead of
signalling a scan that never ran (M325). The free popup decides whether to lock before it paints,
and the engagement controller reads the new settings before it strips the page (M327). The PIN
throttle and the recovery-phrase gate share one queue, so a burst of guesses costs a miss each
(M329). Quiet hours say on screen that a day names the night it starts on (M325), Child mode holds
the soften-swearing row it was promising (M326), and a rule a parent typed is counted in both
products when its hide lands (M328).

**Still as the map describes it:** the grace window. One PIN entry buys fifteen minutes of settings
access, leaving Child demands the PIN even inside it, and a grid that diverges from its mode says so
on screen. That is the design, verified rather than assumed.
