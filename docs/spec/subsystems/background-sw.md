# Subsystem: background service worker

> Code-derived map. Internal `forensic` names remain in file/schema identifiers; parent-facing copy uses Local Observation Record. Re-read against the code in the 2026-08-23 objective audit (spec-drift.md item 105).

## Purpose

The MV3 service worker is the extension-origin coordinator for automatic record delivery, chain writes, signing identity, destructive cutovers, maintenance alarms, and the daily badge. Content scripts cannot safely own this work because they run in separate host-page realms and can disappear at any time.

The five automatic record types first enter a durable IndexedDB outbox. The service worker acknowledges only after that enqueue commits. A single FIFO pump then performs fingerprinting, canonical hashing, signing, compression, and the atomic record/outbox/receipt transaction under the service-worker realm's shared chain lock.

## Key files

- `src/background/service-worker.ts` — lifecycle, alarms, typed message router, recheck coordination
- `src/background/inspection-registry.ts`: the durable (chrome.storage.session, 120 s TTL) grant store for dashboard-opened tabs (`reveal` / `observe`)
- `src/background/recheck-tab-ledger.ts`: rememberRecheckTab / forgetRecheckTab / sweepOrphanRecheckTabs: every read-modify-write on the ledger of open recheck tabs runs through one serialized chain, and the worker sweeps orphaned tabs at start-up
- `src/background/dev-reload.ts`: development-install-only self reload: gated on `chrome.management.getSelf().installType === 'development'`, polls a 127.0.0.1 token server (`DEV_RELOAD_TOKEN_URL`, port 8790) for a newer build id on a 30 s alarm, and does nothing when no server answers; also exports getBakedBuildId. The reload also requires the baked secret to equal the server's; since 2026-09-02 that secret comes from `.fw-dev-secret` at the repo root (per machine, gitignored, created by `vite.config.ts` on first build) because a per-build random secret (2d1ff26) meant the reload never fired after any rebuild (M127)
- `src/storage/build-history.ts`: noteBuildRun: the SW boot hook records each build run (baked build id, first-seen time) so the dashboard's Copy Diagnostics provenance can name the code that produced a record
- `src/types/messages.ts` — `FWMessage` discriminated union and delivery metadata
- `src/content/record/forensic-retry.ts` — stable delivery IDs plus bounded fallback when durable enqueue itself cannot be acknowledged
- `src/forensics/delivery-outbox.ts` — outbox, receipts, destructive/rotation fences, status, and receipt pruning
- `src/forensics/forensic-delivery-pump.ts` — single-flight FIFO dispatcher
- `src/forensics/chain-write-lock.ts` — shared SW-realm FIFO mutex
- `src/forensics/logger.ts` — five automatic record constructors
- `src/forensics/store.ts` — v6 IDB schema, signed record commit, reset, record pruning
- `src/forensics/chain-rotation.ts` — locked monthly archive/cutover
- `src/forensics/backup.ts` — coherent auto-backup snapshot and locked restore
- `src/forensics/signing.ts` — first-use identity, metadata, staged key restore

## Inputs

Content scripts send `SCAN_LOG`, `CAPTURE_PROMPT_IO`, `CAPTURE_BEHAVIOR`, `CAPTURE_PERF_RECORD`, `NEUTRALIZATION_COMPLETE`, `FORENSIC_LOG`, `PASS_LOG`, `ENVIRONMENT_LOG`, `CANCEL_LOG`, `BLOCKED_LOG`, `AUTHOR_UPDATE`, the profile read `GET_AUTHOR_PROFILE`, the reading's week count `GET_AUTHOR_WEEK`, the counter write `USAGE_INCREMENT`, and the startup query `IS_INSPECTION_TAB`. The popup and dashboard also send `USAGE_INCREMENT` when they meter anything. The dashboard sends `RESET_FORENSIC_CHAIN`, `GET_SIGNING_METADATA`, `RESTORE_FORENSIC_BACKUP`, `RECHECK_RECORD` and `OPEN_ORIGINAL`. `MANUAL_FLAG` has a handler and a message type but no sender under src/ui. `GET_CHAIN_DEBUG_STATS` is sent by the content script's `flushBatch` under the `chainDebugStats` dev flag, not by the dashboard.

Chrome supplies `onInstalled`, six periodic alarms, and `storage.onChanged` events.

## Outputs

- Durable outbox acknowledgements: `{ok:true, deliveryId, state:'pending'|'committed'|'discarded'}`
- Explicit `{ok:false,error}` on validation/enqueue/route failures
- Signed compressed Local Observation Records plus delivery receipts in `feelingwise-forensics`
- Dashboard/manual-route responses, badge updates, maintenance logs, downloads, and TSA requests. Response shapes live in `src/types/messages.ts`: `ResetForensicChainResponse` and `RestoreForensicBackupResponse` carry a typed `errorKind` (`pin-required` / `pin-not-configured` / `pin-invalid`, restore also `missing-payload`) so the dashboard modal can tell a refused PIN from a failed cutover; `ChainDebugStatsResponse`. Recheck-record acks `{recorded: boolean}`, open-original acks `{ok, error?}`, and the inspection-tab query answers `{inspection: boolean, mode?: 'reveal' | 'observe'}` — none of the three has its own named response interface (only the request message types do; the dead response interfaces were removed in the 2026-08-23 knip cleanup).

## Invariants and contracts

1. Every `FORENSIC_LOG`, `PASS_LOG`, `ENVIRONMENT_LOG`, `CANCEL_LOG`, and `BLOCKED_LOG` requires a nonblank stable `deliveryId`. A supplied capture timestamp must parse; it is canonicalized once and later becomes the signed record timestamp.
2. Automatic enqueue runs under `sharedChainWriteLock`, overlapping reset/rotation/restore checks cannot race it, and the response is sent only after the outbox transaction commits.
3. The outbox's auto-increment primary key is FIFO authority. Timestamp ties cannot reorder observations by random delivery ID.
4. A pump success adds the signed record, deletes the outbox row, and adds the committed receipt in one transaction. A repeat delivery ID returns its existing final state without adding a second record.
5. The pump stops on the first failure, persists attempts/error/backoff, and resumes on worker import, a new pending enqueue, its retry timer, or the one-minute alarm. After `FORENSIC_DELIVERY_ATTEMPT_CEILING` (8) attempts the row is quarantined in place (kept as evidence, never deleted): the pump walks past it, `pendingCount` excludes it so rotation unblocks, and the Issues tab shows the held count.
6. Reset, rotation, restore, record pruning, manual flag, signing metadata, and automatic enqueue share the SW chain lock. Restore also owns its lock internally; callers must not wrap it again.
7. Reset atomically writes its signed marker, clears pending outbox rows, records discarded receipts, and advances the destructive capture-time cutoff. A delivery captured at or before that boundary is discarded even if it arrives later.
8. Rotation and restore refuse to cut over while durable deliveries are pending, then publish capture-time fences in the same transaction as their state swap. A pre-rotation late arrival is retained with signed `late-after-rotation:*` provenance. A pre-restore late arrival is excluded as `discarded-restore` and surfaced in Issues; restore also clears outgoing committed receipts so they cannot claim a replaced record still exists.
9. `GET_SIGNING_METADATA` ensures the key exists before reading creation time. Dashboard first use therefore cannot create a competing identity.
10. `RECHECK_RECORD` reports `recorded:true` only after the delivery has a committed receipt. Enqueue-only, discarded, failed, and timed-out attempts report false.
11. Async handlers return `true` and eventually call `sendResponse`; fire-and-forget telemetry routes intentionally return `false`.
11a. Sender and type allowlist: before any dispatch the router rejects a message whose `sender.id !== chrome.runtime.id` and a message whose `type` is not in `FW_MESSAGE_TYPES`; both are warn-logged with the offending sender id or type. Only the extension's own content scripts and pages reach the handlers (no `externally_connectable`, no `onMessageExternal`).
11b. Parent-PIN gate at the boundary: `RESET_FORENSIC_CHAIN` and `RESTORE_FORENSIC_BACKUP` carry the PIN in their payload; the worker verifies it against the stored salted PBKDF2 digest (`verifyPin`) and refuses with a typed `errorKind` when the payload has no PIN, when no PIN is configured, or when it does not verify. The popup's 15-minute grace window is not consulted here. Restore was PIN-free until f348a40; both gates are locked by `tests/unit/forensics/service-worker.test.ts`.
15. Every extension-private IndexedDB database (`feelingwise-forensics` and its monthly archives, `feelingwise-scans`, `feelingwise-authors`, `feelingwise-derived`, the two capture stores, `feelingwise-backup-folder`, `feelingwise-pipeline-v2-metrics`) is opened only behind `assertExtensionRealm` (`src/storage/realm-guard.ts`). A content realm that reaches an opener gets a refusal (read helpers degrade to empty, writers reject) instead of an empty page-origin copy of the database. Data that content realms need travels by message to this realm: v2 perf-trace records (`feelingwise-pipeline-v2-metrics`) route through `CAPTURE_PERF_RECORD`, handled here by `persistRecord` in `src/diagnostics/perf-trace.ts` — content-side `dispatchPersist` never calls `openDb`/`indexedDB.open` itself (the 2026-08-24 "[FW perf-trace] persist failed RealmGuardError" defect: content realm was opening the store directly). Lock: `tests/unit/storage/store-openers-realm-guard.test.ts`, `tests/unit/diagnostics/perf-trace.test.ts`.
13. Author profiles (`feelingwise-authors`) are extension-origin IndexedDB that only this realm writes (`AUTHOR_UPDATE`) and that content realms read only by message: `GET_AUTHOR_PROFILE {handle, platform?}` answers `{ok:true, profile|null}` or `{ok:false, error}`. The store's opener calls `assertExtensionRealm` (`src/storage/realm-guard.ts`) and refuses a page origin, so a content script can no longer create an empty copy of the database in the host page's origin (EVIDENCE-PATH-2). The pipeline reads this reply through `src/forensics/author-profile-client.ts` (30 s per-realm cache) for the exposure notice only; the L1 suspicion boost it once fed was removed in 2.5.1. Lock: `tests/unit/storage/author-store-realm-guard.test.ts`, `tests/unit/storage/pipeline-harm-gates.test.ts`. The chain is the same kind of store, so the reading's one record line is counted here too: `GET_AUTHOR_WEEK {handle, platform}` runs `getRecordsOrThrow({startDate: now - 7 days})` through `countAuthorWeek` (`src/forensics/author-week.ts`) and answers `{ok:true, seen, charged}`; a failed read answers `{ok:false, error}`, never an empty week (the content side then shows no line). Read-only; it feeds no verdict. Lock: the `GET_AUTHOR_WEEK` cases in `tests/unit/forensics/service-worker.test.ts`.
14. Usage counters (`totalChecks*`, `totalNeutralized*`, `metricsHidden*`, `totalTokens*`, `estimatedCost*`) have one writer: this realm. `recordAiCall` (weighted like the proxy by `src/storage/usage-weights.ts`), `incrementNeutralized` and `incrementMetricsHidden` in `src/storage/settings.ts` send `USAGE_INCREMENT {kind, ...}` from any realm that has a `document`; the worker applies it through `applyUsageIncrement` under `counterWriteLock` and acks `{ok:true}` or `{ok:false, error}`; a sender logs a lost increment once per reason and carries on (the verdict still ships; the proxy cap remains the hard stop). Before the write the worker compares its settings snapshot's `lastResetDate`/`lastResetMonth` with the clock and re-reads storage when they are behind, so a 5 s cache that still holds the previous period can never carry its count across a UTC rollover (STORAGE-LICENCE-WORKER-7). `NEUTRALIZATION_COMPLETE` keeps its own route and badge update but writes through the same applier. Lock: `tests/unit/storage/usage-counter-single-writer.test.ts`, `tests/unit/forensics/service-worker.test.ts`.
12. Inspection-tab registry (`src/background/inspection-registry.ts`): grants for dashboard-opened tabs live in `chrome.storage.session` (survive worker eviction, never a browser restart) with a 120-second TTL. Both `OPEN_ORIGINAL` (active tab, `'reveal'`) and `RECHECK_RECORD` (background tab, `'observe'`) durably write a URL-keyed pending grant BEFORE `chrome.tabs.create`, then bind the created tab's id to it — because content scripts run at `document_start`, the `IS_INSPECTION_TAB` query can arrive before `tabs.create` resolves (the 2026-08-01 owner repro: a register-after-create in-memory Map lost the grant and the recheck tab got fully protected). `IS_INSPECTION_TAB` answers async from the registry: a tabId-bound grant wins; otherwise a pending grant whose normalized URL (http(s) only, host lowercased, `www.` dropped, twitter.com folded to x.com, query/hash stripped) exactly matches the sender's URL is bound ONE-SHOT to that tab. An unknown, expired, closed (`chrome.tabs.onRemoved` deletes the entry), URL-mismatched, or tab-less sender gets `{inspection:false}`; any storage failure also resolves `{inspection:false}` — full protection. Only dashboard actions populate the registry, so a normal child tab can never look registered. `OPEN_ORIGINAL` applies the same http(s)-only URL guard as `RECHECK_RECORD`.

## Runtime flow

1. A content realm creates `deliveryId` + `deliveryCapturedAt` and sends one of the five automatic record envelopes.
2. The router validates both fields, normalizes `FORENSIC_LOG.feedSource`, acquires the chain lock, consults the persisted cutover fences, and either commits the outbox row or a final discarded receipt.
3. The router acknowledges the sender and kicks the single-flight pump.
4. The pump reads the lowest queue sequence and calls the matching logger with payload, delivery ID, original capture time, and any late-rotation disposition.
5. The logger acquires the same lock, reads chain state, requires the public fingerprint, computes the canonical hash, and calls `addRecord`.
6. `addRecord` retries signing, compresses before opening the transaction, then atomically commits record + outbox deletion + receipt.
7. The pump advances only after commit. On failure it persists the head's backoff and stops.

Dashboard-only chain operations also route through this realm: manual flag; reset; signing metadata; and the complete staged backup restore. The recheck route writes an `'observe'` grant to the durable inspection registry, THEN opens a background tab (so the content script re-extracts without re-applying interventions even if its startup query beats the tabId binding), waits up to nine seconds for that tab's committed delivery receipt, then closes the tab and drops its grant. A recheck that times out or fails reports `recorded:false`; the dashboard surfaces that on the card as "Refresh failed" (`FeedCard` `recheckPhase:'failed'`) instead of silently resetting. `OPEN_ORIGINAL` pre-grants `'reveal'` the same way, then opens an active tab so the parent sees the post untouched while extraction and logging still run.

## Alarms

- `scan-purge` — daily, retain 30 days of scan events
- `forensic-prune` — daily, cap active records and bound delivery receipts
- `forensic-month-rotation` — daily idempotent month check
- Both daily jobs above also run when a fresh worker finds their last maintenance entry more than 25 hours old (`catchUpDailyJobs`, after the realm height check): a re-created daily alarm first fires a full day later, so an install that reloads or updates more often than daily never reached them by alarm. The dashboard's attention line can run the prune too (`RUN_RECORD_TIDY`, extension pages only), and says Done only when the prune recorded ok during that request.
- `forensic-anchor` — every six hours; TSA result commits only if the chain head still matches under lock
- `forensic-backup` — daily coherent snapshot, then download outside the chain lock. Since 2026-08-10 the auto-download runs through downloadQuietly: chrome.downloads.setUiOptions disables Chrome's download UI for the duration of the write (bounded wait, always re-enabled in finally; manifest gained the warning-free downloads.ui permission), so the daily backup never pops a bubble a child could see or cancel. History rows are kept because retention pruning finds old backups through them. Layer 2 (silent folder wire) lives in forensics/backup-folder-wire.ts + mirrorBackupToWiredFolder and runs from the dashboard Export tab: the parent picks any folder once (File System Access handle persisted in IDB), and opening the tab silently mirrors the sealed backup there with its own dedup head; a post-restart permission lapse surfaces as a one-click "Allow again". Since 2026-08-11 downloadQuietly returns the observed terminal state and ONLY a confirmed 'complete' earns the saved status, the dedup head, and the retention prune; an interrupted or unconfirmed write records a backup-health error and the next daily run retries (previously an interrupted download read as saved and retention pruned real backups against a phantom file). The recheck-tab ledger race is closed (recheck-tab-ledger.ts serializes every read-modify-write); the prune-versus-rotation-marker design is recorded in forensic-chain.md and not yet implemented; the alarm re-arm semantics and the inspection-grant window still want live confirmation. Lock: tests/unit/forensics/backup-folder-wire.test.ts.
- `forensic-outbox-drain` — every minute recovery kick

## Known bounded behavior

- `SCAN_LOG`, prompt/behavior captures, and `NEUTRALIZATION_COMPLETE` remain fire-and-forget by design. The badge increment has its own retry and lock; capture failures do not block protection.
- The router is a typed sequential `if` chain behind the sender / type allowlist (invariant 11a): an unknown or malformed type and a foreign sender are warn-logged and rejected before dispatch, never silently dropped.
- The badge counter lock is intentionally separate from the chain lock because it protects a settings read-modify-write, not chain state.
- Restore-exclusion receipts are retained by the same seven-day/10,000-row delivery-receipt bound; the Issues notice therefore describes recent exclusions, not an unbounded lifetime total.

## Cross-references

- [forensic-chain.md](forensic-chain.md)
- [data-flow.md](../data-flow.md)
- `tests/unit/forensics/service-worker.test.ts`
- `tests/unit/forensics/forensic-delivery-outbox.test.ts`
- `tests/unit/forensics/forensic-delivery-pump.test.ts`
- `tests/unit/forensics/poison-outbox-quarantine.test.ts`, `tests/unit/forensics/service-worker.test.ts` (PIN gates), `tests/unit/forensics/sw-smalls-w69.test.ts`
