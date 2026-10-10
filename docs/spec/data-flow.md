# data-flow — the end-to-end X-ray

The complete path a post or comment travels, page DOM → screen + retained record. Every hop
names the file + function (symbols, not line numbers; re-verify before relying, see
[update-protocol.md](update-protocol.md)). Re-read against the code in the 2026-08-23
objective audit (spec-drift.md items 7 to 14). For per-area depth, follow the
`subsystems/<name>.md` link at each stage.

```
                          SOCIAL MEDIA PAGE (TikTok / X / IG / YT / FB)
                                        │  DOM mutations (the only source of records; the XHR/GraphQL interceptor fills gaps)
                                        ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 1. INTERCEPT   interceptor.ts  (MutationObserver on document.body)            │
  │    Child: synchronous _processNodes; Teen/Adult: rAF-drained pending Set       │
  └─────────────────────────────────────────────────────────────────────────────┘
                                        ▼
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 2. EXTRACT     platforms/{twitter,facebook,instagram,tiktok,youtube}.ts       │
  │    adapter.extractPosts(nodes) → PostContent[]  (id, text, author, kind,      │
  │    parentVideoId, depth, domRef, platform_specific)                           │
  └─────────────────────────────────────────────────────────────────────────────┘
                                        ▼  onPostDetected(post)  (index.ts)
                 ┌──────────────────────┴───────────────────────┐
       post / video kind                              comment kind (+parentVideoId)
                 ▼                                                ▼
  ┌───────────────────────────────┐        ┌────────────────────────────────────┐
  │ 3a. QUEUE   queue.ts           │        │ 3b. BATCH BUCKET comment-batch/queue│
  │   enqueue → _drain → processFn │        │   enqueueCommentForBatch →          │
  │            = pipeline.process  │        │   pendingBatches → flushBatch        │
  └───────────────────────────────┘        └────────────────────────────────────┘
                 ▼                                                ▼
  ┌───────────────────────────────┐        ┌────────────────────────────────────┐
  │ 4a. COMBINED  core/pipeline.ts │        │ 4b. BATCH  comment-batch-scorer.ts  │
  │   blocklist → floors → JUDGE   │        │   enrich → buildBatchPromptV3 →     │
  │   (neutralizer.ts) → hide/mark │        │   scoreBatch + scoreRoom            │
  └───────────────────────────────┘        └────────────────────────────────────┘
                 └──────────────────────┬───────────────────────┘
                                        ▼  result
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │ 5. CONSUME   onProcessingResult (index.ts) / flushBatch verdict loop          │
  │    anchor-revalidate → DOM mutate → terminal proof → emit *_LOG               │
  └─────────────────────────────────────────────────────────────────────────────┘
                 ┌──────────────────────┴───────────────────────┐
            what the KID sees                            what the PARENT gets
                 ▼                                                ▼
  ┌───────────────────────────────┐        ┌────────────────────────────────────┐
  │ teen-marker / comment-overlay  │        │ service-worker → forensics/store    │
  │ / injector                     │        │ → sign + hash-link → IDB chain      │
  └───────────────────────────────┘        └────────────────────────────────────┘
                                                          ▼
                                          dashboard render + HTML export with embedded-key verification

   ── parallel ──  engagement-hider (counts/buttons, free)
```

---

## Stage 1 — Intercept  ·  [content-extraction](subsystems/content-extraction.md)

1. Page DOM mutates → `MutationObserver` callback (`interceptor.ts`, the MO callback). Child mode passes
   added nodes directly to `_processNodes` in that callback so item shields mount before the
   next paint. Teen and Adult accumulate added nodes into a `_pendingNodes` Set.
2. In Teen and Adult, a `requestAnimationFrame` drain tick (`interceptor.ts` rAF drain) turns
   that Set into an `Array<Node>` batch. *(The rAF drain is the historical YouTube-OOM hazard
   when backgrounded tabs suspend rAF; see the engagement/OOM notes.)*
3. `_processNodes(nodes)` runs the URL-level DM/skip gates
   (`isPrivateMessageSurface`, `shouldSkipNodeAccumulation`) then calls
   `adapter.extractPosts(nodes)`. Each adapter rejects candidates inside a recognized chat
   dialog before reading their text or touching FW dedup stamps; public siblings continue.
   Every returned record then passes the third gate, `carriesFwInjectedText`
   (`interceptor.ts`): a node carrying FeelingWise's own rewrite, placeholder or marker is
   dropped so FW never re-classifies its own output.
4. SPA route changes are caught via the MAIN-world route notifier relay
   (`page-world/route-notifier.ts` → `fw:route-change` CustomEvent) plus `popstate` and an
   800 ms pathname-poll fallback (an isolated-world `pushState` patch cannot observe
   page-framework calls — separate History binding per world); the route key is the pathname
   plus an allowlist of query keys (`computeRouteKey`); stamps are stripped on surface change
   via `surface-detector.ts`.

The page-world fetch / XHR interceptor (`page-world/fetch-interceptor.ts`, `page-world/relay.ts`)
is installed at page load on all five platforms; the relay hands each copied payload to that
platform's parser in `wire/`, and `page-world/wire-store.ts` fills gaps from it in the record of
the same item once the DOM path captures it. The wire never makes a record of its own, so the DOM
path above is the only path that makes one on every platform.

## Stage 2 — Extract  ·  [platform-adapters](subsystems/platform-adapters.md)

5. `adapter.extractPosts(nodes)` discovers containers (`_collectArticles` /
   `_collectVideoContainers` / …) and per container extracts text, **id**, author, metrics →
   `PostContent[]` (`kind` ∈ post / video / top-comment / reply; `depth`; `parentVideoId`
   bucket key; `domRef` WeakRef; `platform_specific`).
   - TikTok wraps `extractTikTokBundle` (`src/content/platforms/tiktok-bundle.ts`) →
     `ThreadSnapshot` → `_buildSplitPosts` (`tiktok.ts`) → caption (`kind=video`) + comment
     records.
   - **id cohesion is the seed-bug surface**: `twitter.ts` falls back to
     `crypto.randomUUID()` when no coherent status identity resolves; FB/YT have the same
     pattern. Comments stamp `parentVideoId` to tie
     them to their post — when the id is random or format-mismatched, the tie breaks
     (orphan threads / duplicate posts). See the defect register `known-issues.md`, which is private; [KNOWN-LIMITS.md](KNOWN-LIMITS.md) carries what a reader outside the project needs from it.
6. Each extracted node is stamped `dataset.fwProcessed='true'`; `onPostDetected(post)` is
   called (`interceptor.ts` `_processNodes` loop).

## Stage 3 — Route  ·  [content-extraction](subsystems/content-extraction.md)

At onPostDetected, root post/video records receive observedSequence, viewportSeenAt, and surfaceSessionId. Comment rows still keep their own record order.

`onPostDetected` (`index.ts`) splits the flow:

- At `document_start`, `bootstrap.js` installs an opaque root curtain before the asynchronous
  mode read, then retains it only for an explicit Child setting. It skips private-message routes
  and releases for Teen/Adult/the absent fresh-install Teen default, storage/context failure, or a
  5-second readiness timeout. `content.js` waits
  for `document.body`, starts the interceptor, runs the initial extraction/protection pass, and
  then signals readiness so the root curtain can be removed without an initial-paint gap.
- In Child mode, first-seen batched comments receive an opaque item cover before the debounce;
  uncached posts/captions receive it before queue enqueue, and cached ACT replays receive it
  before their asynchronous DOM mutation. Known cached PASS observations remain direct. Terminal
  PASS/cancel/failure releases; a rewrite releases only after its visible-text postcondition passes.
  In Child mode, a failed rewrite commits a confirmed hide fallback; if neither rewrite nor fallback
  can be confirmed, the item cover remains. A final hard hide preserves mute; a verified collapse
  removes the cover and restores the temporary media baseline.
  Independent image and video owners join the same feed-unit lease, so a text PASS cannot expose
  media whose verdict is pending. Covered media is guarded against host-script unmute attempts,
  and the owned overlay/ARIA/inert state is reattached after same-host platform reconciliation.
  The item cover carries a visible checking label and inherits the first opaque foreground/background
  surface from the protected feed unit, rather than painting a fixed light rectangle on dark feeds.
  Each live lease also publishes a content-free, per-surface health heartbeat (host count, visible
  count, oldest age, owner scopes, and missing-overlay state) for the dashboard Issues tab.
  Mutation-added nodes take a synchronous Child extraction path; Teen/Adult retain rAF batching.
  Runtime mode changes invalidate prior classifier generations and rescan. SPA pathname or query
  changes also increment the classification generation immediately; connected public-route covers
  remain until the delayed rescan rotates them, while private routes release immediately.
  If a video bundle arrives while another provider bundle is in flight, its element is terminally
  marked, its video owner is released fail-open at queue time, and the bundle is HELD in a
  depth-one queue that drains to a real late verdict when the in-flight call finishes (the late
  verdict carries no ticket and, per the M100 guard, cannot settle any other video's cover).
  Only a displaced third video or teardown increments `videoAnalysisOverlapReleased` (each with a
  per-video unjudged chain entry); the plain overlap increments `videoAnalysisQueued`.

- **Comment** (`isCommentKind && parentVideoId`) → `enqueueCommentForBatch`
  (`comment-batch/queue.ts`); batched comments never enter `ProcessingQueue`. Before the
  enqueue, `routeBatchedComment` checks the exact-input session PASS cache and the
  `sessionCommentResolutionByKey` replay store (`late-verdict-cache.ts`): a proven hide or
  validated rewrite is re-applied to the fresh node by `reapplyResolvedComment`, which keeps
  the cover when neither lands. Then: viewport-observe →
  create/reuse the `pendingBatches` bucket keyed by `parentVideoId` → seed its caption/URL/author
  from the bounded `platform:parentId` identity cache when present → stamp current feed source,
  platform, and permalink → schedule `flushBatch` (1500 ms debounce, or immediate at batch cap = 5).
- **Parent observation** (`!isBatchedComment`) → seed only the bounded parent-identity cache when
  no comments are pending. This includes normal post/video records and an X focused reply with no
  `parentVideoId`, because visible child replies use that focused tweet as their parent. A populated
  pending batch accepts default→real fills, promotes a generic surface URL to an exact link for the
  same parent, and preserves known fields on any conflicting room. Seeding runs before every
  session-cache fast return; the observation then continues through the per-post pipeline.
- Session caches (`sessionVerdictByPostId`, `sessionPassPostIds`,
  `sessionHideCollapseByPostId`) short-circuit only the same exact classification input, including
  normalized sponsorship; late-sponsored hydration cannot inherit an earlier organic PASS.

`queue._drain()` (`queue.ts`) prunes stale items (per-item `AbortController`), sorts by a
3-tier priority (viewport state × kind × Y-position), and runs `processFn = pipeline.process`.

## Stage 4a — COMBINED single-post judge  ·  [ai-pipeline](subsystems/ai-pipeline.md)

`process(post, signal)` (`core/pipeline.ts:process`):

0. **Parent blocklist** (`core/parent-blocklist.ts`, above the dedup cache, every mode and
   tier): a hit → **HIDE** with `blocklist:<kind>:<rule>`.
1. **Deterministic floors** (after the cache lookup, before any AI):
   - `filterProfanity(tier:'slurs')` → slur match → **HIDE** (all modes).
   - `detectCodedHarm` → hide-tier category → **HIDE** (all modes, all tiers).
   - sponsored → **collapse** in all modes (category-only analysis on Adult).
   - `filterProfanity(tier:'profanity')` → child-mode HIDE; then the too-short reject; soften
     when `blanketProfanitySoften` (toggle or strictLanguage) and `softenAiAllowed`, with
     three harm re-checks on the rewrite.
   - `detectDehumanization` → HIDE.
   - `detectViolenceNarratingVideo` (video captions, child / teen) → HIDE.
   - `detect()` L1 techniques (`detector.ts`, 20 classifiers) + `computeHarmFloor` →
     synthesized collapse if floor trips with no L1 technique.
2. **Cap / tier gate**: `tierCap === 0`, cap-exhausted or the breaker holding →
   `passWith(pre-llm-*)` — **AI never runs on free tier**.
3. **JUDGE** `combinedDetectAndNeutralize` (`neutralizer.ts`): `fencePostText` →
   TRIAGE stage-1 (`callAI`, no jsonMode) → if yes/unsure → the judge prompt
   (`buildJudgeDetectNeutralizeSystem`, or the detect-only variant when `reframe-rewrites` is
   off; `callAI`, jsonMode, maxTokens 4096) → `judgeToCombinedShape` (`acts_on_reader` gate,
   `mapConcernToTechnique`, confidence default 0.5) → technique severity-floor loop →
   `validateNeutralization` (8 checks) → `NeutralizedContent`.
4. Post-LLM: not-manipulative / below-threshold → `passWith`; borderline severity reduction;
   `HIGH_RISK_PASS_THROUGH` keeps original text; no rewrite or a `validateRewriteLanguage`
   mismatch (en/ro only) → `hideOnRewriteUnavailable` ? collapse : mark →
   `PipelineResult{action, neutralized, aiMeta, cancelKind}`.

The AI client (`ai/client.ts`): `callAI` → master breaker, tier, client daily cap, proxy-cap
latch → module-private `withProxyFetchSlot` → `fetchWithDeadline` to the Worker with
`Bearer fw-{tier}-{secret}` → error classification (rate-limit retry once, json-refusal retry
once) → `recordAiCall` (one daily call plus chat token-equivalents) + telemetry → `Ok(text)`.

## Stage 4b — BATCH comment judge  ·  [comment-batch](subsystems/comment-batch.md)

`flushBatch(parentVideoId)` (`index.ts`; the batch holds at most 5 comments,
`COMMENT_BATCH_MAX_SIZE`, after a 1,500 ms debounce):

1. `takePendingBatchForFlush` deletes the pending batch while retaining its bounded parent identity
   for later batches. If parent URL is still empty, the id-gated TikTok permalink fallback fills
   and remembers it. The same prepared room snapshot supplies successful comment-record room
   fields and the environment record; failure/cancel payloads retain their separate contract.
2. `resolvePromptLanguage` (settings.outputLanguage or CLD3 auto).
3. **Viewport gate** `filterToViewed` (`index.ts`) — chain-mirror invariant: only
   comments the reader actually saw survive.
4. `buildEncounterForFlushBatch` → a platform-specific `Encounter`: X permalink adds rendered
   ancestry; TikTok, Instagram, YouTube, and Facebook assemble surface/parent/child metrics and
   flags from extract-time signals. Missing or unrecognized platform/surface signals use the
   degraded `encounterFromLegacyBatchInput` fallback.
5. `scoreBatch(encounter, mode)` (`comment-batch-scorer.ts`):
   cache key → `enrichWithHarmFloor` (per-comment `computeHarmFloor` + slur filter + emoji /
   repetition) → `isNonSupportedScript` failClosed gate → `computePreLlmRoomSignals` →
   `buildBatchPromptV3` (`prompts-v2.ts`) → `callAI` (`openai/gpt-oss-20b`, jsonMode) →
   `parseJSON` (3-tier plus truncation salvage) → per-comment `target_present` gate →
   **`applyOverrideGates`** (`comment-batch-scorer.ts`: identity-slur→hide, child profanity
   floor, profanity-tier, coded-harm, rage-format, HF≥70, ad-hominem) → Rule13/Rule14
   enrichment → `BatchScoreResult`.
   - On a failed AI call → `failClosed` computes deterministic verdicts from the floors
     so protection degrades safely.
6. `scoreRoom(encounter, mode)` runs in parallel (`index.ts`) → `RoomAnalysis`
   (claim-vs-reaction, comment-manipulation, distress, summary, + `topicLabels`: 1-3
   closed-list content-topic labels from `TOPIC_LABELS`, comment-batch-scorer.ts —
   what the POST is about; unknown values dropped at parse) → `ENVIRONMENT_LOG`
   (`environment.topicLabels`, omitted when empty — hash-stable additive).
7. Verdict loop: manipulative+hide → exact-identity DOM terminal → outcome-based
   `FORENSIC_LOG`; manipulative+rewrite-on → `flaggedToRewrite` → `neutralizeText` /
   inline rewrite → `validateRewrite` (10 guards) + `findDuplicateRewriteIndices` →
   `pendingSwaps`; an empty rewrite hides when `hideOnRewriteUnavailable` holds (Child,
   strict language, or the toggle) or the technique is on the sev>=7 allowlist; non-manipulative
   → `PASS_LOG` (profanity → soften when `blanketProfanitySoften`).

## Stage 5 — Consume + mutate + record  ·  [content-extraction](subsystems/content-extraction.md) + [marker-render](subsystems/marker-render.md)

`onProcessingResult(post, result)` (`index.ts`) and the flushBatch verdict loop:

1. `SCAN_LOG` emitted (the denominator).
2. `verifyAnchorMatch(computeAnchorKey(post), post, domRef)`
   (`anchor-revalidation.ts`) → `match` / `dom-recycled` / `dom-gone`. A recycled DOM is
   recovered via text-fingerprint (`dom-recycle-recovery.ts`); a gone DOM → cancel verdict,
   and the completed verdict is stored in `sessionLateVerdictByPostId` so a re-encounter of
   the same post.id applies it directly (act-on-re-encounter; MARK floor when no rewrite is
   in hand).
3. On match → **DOM mutation**: `injector.ts` (`injectIntoElement` / `injectCollapseOrHide` /
   `markOnlyElement`), `comment-overlay.ts` (`swapCommentTextInPlace` / `hideCommentAsFallbackTerminal`),
   `teen-marker.ts` (`renderTeenMarker` severity dot). Marker mount = `'after'` on TikTok,
   `'inside'` elsewhere; every comment marker mounts through the batch path.
   **Terminal proof** sits between the mutation and the record: `replacementIsVisible`
   (`injector.ts`) is the post-condition of every post injection, and
   `applyNeutralizedRewriteTerminal` / `applyCommentRewriteTerminal` / `applyCommentHide`
   (`index.ts`) decide from it: a Child failure converts to a hide and commits the cover, a
   double failure retains the cover and records `visualApplied:false`; every cover release
   goes through the one `settleProtection` terminal (see marker-render.md).
   Comment HIDE adds a stricter gate: Facebook recovery stays inside the exact parent post
   and requires one unique full-text + depth match, plus author when available. The chain records `hide` only
   after the hidden DOM terminal is present; a miss records `mark` and keeps a Child cover.
4. A post hide/collapse attempt records an explicit terminal disposition only after the
   async render gate finishes: `applied`, `suppressed`, or `failed`. The diagnostic also
   records concurrent same-post attempts, a later post-LLM PASS for the same platform/post
   id, and the record receipt (`accepted`, `retry-buffered`, `context-lost`, `deduplicated`,
   or `not-sent`). These are content-free counters in `fw_diagnostics`; signed-record
   semantics are unchanged (`diagnostics.ts`, `index.ts`).
5. `shouldLogForensic(text)` dedup gate (`forensic-gate.ts`) → emit `FORENSIC_LOG` /
   `PASS_LOG` / `ENVIRONMENT_LOG`; `CANCEL_LOG` dedups via the separate
   `shouldLogCancelForensic` set (a cancel never consumes the main entry — the item stays
   eligible for full handling on re-encounter). All five retained-record routes pass through
   `sendHighStakesForensicLog`: it assigns a stable delivery ID + capture time, awaits the
   service-worker enqueue acknowledgement, returns `accepted` / `retry-buffered` /
   `context-lost`, and buffers explicit or ambiguous live-context failures for bounded
   idempotent replay.

## Stage 6 — Chain write  ·  [forensic-chain](subsystems/forensic-chain.md)

Service worker routes the five `*_LOG` types through the v6 durable delivery ledger:

1. Validate `deliveryId` + capture time, normalize the payload, acquire the SW chain lock,
   and commit `deliveryOutbox`; only then acknowledge the content realm.
2. The single-flight pump reads the lowest auto-increment queue sequence (true FIFO across
   timestamp ties) and calls the matching logger with the original capture time.
3. The logger keeps the lock across `getChainState()` → record construction → required
   public-key fingerprint → canonical SHA-256 hash → `addRecord(record, deliveryId)`.
4. `getChainState()` returns genesis only after a successful empty read. Storage/read errors
   reject the delivery and leave it at the outbox head.
5. `addRecord` retries ECDSA signing at 0/100/500 ms and compresses before opening IDB.
   One transaction adds the record, deletes its outbox row, and adds a unique committed
   receipt. Transaction failure rolls all three operations back.
6. The pump advances after commit; on failure it persists attempt/error/backoff and stops.
   Worker import, new enqueue, retry timer, and the minute alarm resume it. After 8 attempts
   (`FORENSIC_DELIVERY_ATTEMPT_CEILING`) the row is quarantined in place and the pump
   continues past it; the Issues tab shows the held count.
7. Reset (and restore) require the parent PIN, verified by the service worker at its
   boundary. Reset fences stale capture times and disposes pending rows atomically. Rotation/restore
   defer while the outbox is nonempty, then publish their own cutoff with the cutover. A late
   pre-rotation capture is signed with explicit late provenance; a late pre-restore capture is
   excluded with a visible discarded receipt. Receipt and active-record pruning are bounded.
8. Sidecars + alarms: TSA anchoring revalidates the head under lock; monthly rotation has an
   atomic signed-marker + cutoff cutover; automatic backup takes a coherent locked snapshot
   before download; restore atomically replaces records + anchors + feedback, clears outgoing
   receipts, and publishes its cutoff before committing a matching staged key.

## Stage 7 — Read back: dashboard + export  ·  [dashboard](subsystems/dashboard.md) + [forensic-analytics](subsystems/forensic-analytics.md)

1. `getRecordsFirstPage()` paints the newest 400 records, then `getRecords()` (`store.ts`) →
   decompress → `ForensicRecord[]` (oldest-first); a failed read is a failed-read state
   (`lastRecordReadFailed`), never an empty chain.
2. `verifyChainIntegrity(records)` (`chain-integrity.ts`) → `IntegrityResult` → banner, and a
   verify watermark; the passive refresh (visibility / focus) drops the verdict and runs
   `extendChainIntegrity` over the appended records only; manual Verify re-walks everything
   and the archives.
3. `groupRecordsByPost` (`src/ui/dashboard/components/group-records.ts`) → `RecordGroup[]`:
   a comment keys on `${platform}:${parentVideoId}`, a post on its own id, EXCEPT a
   `parentVideoId`-less post adopts its own `${platform}:${platformPostIdFromUrl(postUrl)}`
   key when a comment or video record references it (X focused-tweet merge); groups are
   ordered newest session first, then in replay order inside a session (`observedSequence`,
   `viewportSeenAt`, serial) → `PostGroupCard` partitions post/env/comment, picks the primary
   record, renders the timeline feed + filters (`computeFeedDividers` draws the session
   dividers). *(Grouping is where seed-bug id-instability + the parentVideoId
   format split surface as duplicate posts / orphan threads — see known-issues A/B.)*
4. Patterns tab: `buildFeedTone` (`feed-tone.ts`, room-sentiment aggregate),
   `buildFeedComposition` (`feed-composition.ts`, topic+format label
   tally + label coverage), `buildSwearLeagueTable` (`lexical-diet.ts`), `buildThemes` (`topics.ts`),
   `computeNarrativePressureSignals` (`sequence.ts`), `computeReservePatterns`
   (`reserve.ts`), cached in the `feelingwise-derived` sidecar IDB (`theme-cache.ts`).
   Statistics tab runs `computeExposureTimeline` / `computeAmplificationTrend` /
   `computeRuns` (`analytics.ts`, `sequence.ts`) separately.
5. Export: `exporter.ts` (`exportHtml` / `exportEverythingHtml`;
   no tier gate, every export is free) → `buildForensicHtmlExport(records, metadata)`
   (`html-export.ts`) → a standalone HTML file
   whose embedded verifier re-hashes + ECDSA-verifies every record in the recipient's browser
   with no FeelingWise software. The verifier's canonical-payload function is kept byte-synced
   with `canonical-payload.ts` by `tests/unit/forensics/html-verifier-drift.test.ts`.

## Parallel paths

- **Engagement-hider** ([engagement-hider](subsystems/engagement-hider.md)) — started in
  parallel in `init()`; hides like/share/view counts + action buttons, blocks Reels/Shorts +
  AI content, X textless sponsored cards. Reads the same DOM but shares no extraction state.
  Free tier. Every body observer is rAF-throttled; the section-model walk was measured cheap.
- **Media Safety Signals (eyes + ears)** — REMOVED in 2.5.0. The video-frame, in-video-audio
  and post-image pipelines were deleted from the build (`landing/updates.html` 2.5.0): they
  never worked, and carrying them cost two extra United States processors in the privacy
  policy for no delivered value. Records written before 2.5.0 keep their `videoContext` /
  `imageContext` evidence and still verify.
  The comment-batch ENVIRONMENT_LOG record carries surfaceSessionId
  (from the bucket's first stamped post) — no observed order, since it
  aggregates a whole comment section.
