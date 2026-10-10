// FeelingWise — chrome.runtime message envelopes.
//
// Canonical discriminated-union typing for the 12 message types the service
// worker handles. Pre-typing the listener used `payload?: any`; every handler
// destructured fields ad-hoc. A typo in the sender (or a renamed payload
// field) would slip past TypeScript and surface only at runtime as silent
// data loss in the forensic chain or wrong-shape IDB writes.
//
// Receiver-side typing (this file applied at `service-worker.ts:51`) catches
// handler-side bugs immediately: destructuring a non-existent field is a
// compile error. Sender-side typing — every `chrome.runtime.sendMessage(...)`
// call site adopting these types — is a follow-up roll-out; chrome.runtime
// crosses extension realms so TypeScript can't infer through the boundary,
// but call sites can opt in by typing the literal: `sendMessage(<FWMessage>{...})`.

import type { ScanEvent } from './scan-event';
import type { ResetChainResult } from './chain-reset';
// ARCHITECTURE-1 layering violation, seeded 2026-08-23 (Proposal C); do not add new markers, route new imports through the correct layer.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import type { CapturedTuple } from '../forensics/capture-prompt-io';
import type { CapturedBehavior } from './captured-behavior';
import type { AuthorProfile } from './author-profile';
import type { UsageIncrement } from './usage';
import type {
  PassEventInput,
  EnvironmentLogInput,
  CancelEventInput,
  BlockedEventInput,
  SkippedEventInput,
} from './logger-events';
import type { GapMarkerInput } from './gap-marker';
import type { ImportMarkerInput } from './import-marker';
import type { ReconcileMarkerInput } from './reconcile-marker';
import type { RepairMarkerInput } from './repair-marker';
import type { RedactionMarkerInput } from './redaction-marker';
import type { AnalysisResult } from './analysis';
import type { ConfigSnapshot, ForensicRecord } from './forensic';
import type { Mode } from './mode';
import type { Platform } from './post';

// --- SCAN_LOG -------------------------------------------------------------
interface ScanLogMessage {
  type: 'SCAN_LOG';
  payload: ScanEvent;
}

// --- CAPTURE_PROMPT_IO (capture routing through SW realm) ---------
interface CapturePromptIoMessage {
  type: 'CAPTURE_PROMPT_IO';
  payload: Omit<CapturedTuple, 'id'>;
}

// --- CAPTURE_BEHAVIOR -----------------------------------------------------
interface CaptureBehaviorMessage {
  type: 'CAPTURE_BEHAVIOR';
  payload: Omit<CapturedBehavior, 'id'>;
}

// --- NEUTRALIZATION_COMPLETE (no payload — increments daily counter) ------
interface NeutralizationCompleteMessage {
  type: 'NEUTRALIZATION_COMPLETE';
  payload?: undefined;
}

// --- PASS_LOG -------------------------------------------------------------
interface ForensicDeliveryMetadata {
  deliveryId?: string;
  deliveryCapturedAt?: string;
}

interface PassLogMessage extends ForensicDeliveryMetadata {
  type: 'PASS_LOG';
  payload: PassEventInput;
}

// --- FORENSIC_LOG ---------------------------------------------------------
// Mirror of `logForensicEvent`'s positional-args signature. All optional
// fields preserve canonical-payload back-compat (undefined keys omitted by
// JSON.stringify). The tree-relationship, harm-floor and kind/parentVideoId
// fields are optional; legacy senders that don't include them produce
// byte-identical hashes against legacy records.
export interface ForensicLogPayload {
  originalText: string;
  neutralizedText: string;
  analysis: AnalysisResult;
  mode: Mode;
  platform: Platform;
  /** Verdict source — 'cloud' (Groq), 'local' (legacy Ollama / internal markers), 'rules' (regex/dictionary gate, no LLM). */
  aiSource: 'local' | 'cloud' | 'rules';
  author?: string;
  /** Display name beside the handle, when the adapter read it separately. */
  authorName?: string;
  postUrl?: string;
  /** Per-comment deep-link, when the adapter captured one (else undefined). */
  anchorUrl?: string;
  feedSource?: ForensicRecord['feedSource'];
  aiModel?: string;
  aiProvider?: string;
  detectionMode?: string;
  configSnapshot?: ConfigSnapshot;
  kind?: 'post' | 'video' | 'comment' | 'reply' | 'image';
  parentVideoId?: string;
  // Tree-relationship + room-context fields.
  parentRecordId?: string;
  commentDepth?: number;
  roomAuthor?: string;
  roomCaption?: string;
  roomUrl?: string;
  // Per-comment harm-floor pre-classification stamp.
  harmFloor?: ForensicRecord['harmFloor'];
  // Per-item engagement metrics captured at observation time.
  metrics?: ForensicRecord['metrics'];
  // Honest override provenance — which deterministic gate set this verdict.
  overrideOrigin?: ForensicRecord['overrideOrigin'];
  // Set (false) when a hide/collapse verdict's DOM change failed to apply.
  visualApplied?: ForensicRecord['visualApplied'];
  // Source labels — WHO posted (accountType) + the named container (FB group).
  accountType?: ForensicRecord['accountType'];
  sourceContainer?: ForensicRecord['sourceContainer'];
  // Impression / exposure order — local observed order, captured pre-AI.
  observedSequence?: ForensicRecord['observedSequence'];
  viewportSeenAt?: ForensicRecord['viewportSeenAt'];
  surfaceSessionId?: ForensicRecord['surfaceSessionId'];
  // What the page carried against what the screen showed (text-fold.ts).
  textCapture?: ForensicRecord['textCapture'];
  /** 'withheld' when the recorder refused an author it could see (src/types/author-capture.ts). */
  authorCapture?: ForensicRecord['authorCapture'];
  mediaUrls?: ForensicRecord['mediaUrls'];
  // Why the product acted, and the declared reader (Stage 2, 2026-09-07).
  decision?: ForensicRecord['decision'];
  reader?: ForensicRecord['reader'];
  // Which build of the content script judged the item. Stamped once at the
  // content-side send chokepoint (content/forensic-retry.ts), never by the
  // service worker — the worker is always the current build, the tab may not
  // be (src/core/build-id.ts).
  buildId?: ForensicRecord['buildId'];
  // 'room' when the verdict was read from the comments under a text-less item
  // rather than from the item's own words (src/content/post-path/room-verdict.ts).
  verdictOrigin?: ForensicRecord['verdictOrigin'];
}
interface ForensicLogMessage extends ForensicDeliveryMetadata {
  type: 'FORENSIC_LOG';
  payload: ForensicLogPayload;
}

// --- ENVIRONMENT_LOG ------------------------------------------------------
interface EnvironmentLogMessage extends ForensicDeliveryMetadata {
  type: 'ENVIRONMENT_LOG';
  payload: EnvironmentLogInput;
}

// --- CANCEL_LOG -----------------------------------------------------------
interface CancelLogMessage extends ForensicDeliveryMetadata {
  type: 'CANCEL_LOG';
  payload: CancelEventInput;
}

// --- BLOCKED_LOG ----------------------------------------------------------
interface BlockedLogMessage extends ForensicDeliveryMetadata {
  type: 'BLOCKED_LOG';
  payload: BlockedEventInput;
}

// --- SKIPPED_LOG ----------------------------------------------------------
// The feed served an item and no verdict was reached on it (free tier, too
// short, no real prose, daily cap). See logger.ts logSkippedEvent.
interface SkippedLogMessage extends ForensicDeliveryMetadata {
  type: 'SKIPPED_LOG';
  payload: SkippedEventInput;
}

// --- GAP_LOG --------------------------------------------------------------
// A content realm's batched statement of loss (forensics/gap-marker.ts): the
// retry buffer overflowed or gave up, the interceptor dropped its backlog.
// Rides the durable outbox like every other retained record.
interface GapLogMessage extends ForensicDeliveryMetadata {
  type: 'GAP_LOG';
  payload: GapMarkerInput;
}

// --- IMPORT_MARKER --------------------------------------------------------
// Dashboard-initiated chain write after a salvage import (register item 15):
// routed through the SW so the marker lands under the same
// sharedChainWriteLock as every other chain write. See
// forensics/import-marker.ts.
interface ImportMarkerMessage {
  type: 'IMPORT_MARKER';
  payload: ImportMarkerInput;
}

// --- RECONCILE_MARKER -----------------------------------------------------
// Dashboard-initiated chain write after a reconciliation against the
// platform's own data export (register item 10): routed through the SW so the
// marker lands under the same sharedChainWriteLock as every other chain write.
// See forensics/reconcile-marker.ts. Carries counts and an archive digest and
// names nobody.
interface ReconcileMarkerMessage {
  type: 'RECONCILE_MARKER';
  payload: ReconcileMarkerInput;
}

// --- REPAIR_MARKER --------------------------------------------------------
// Dashboard-initiated chain write disclosing one heal-log event (register
// item 18), routed through the SW for the shared chain-write lock. See
// forensics/repair-marker.ts.
interface RepairMarkerMessage {
  type: 'REPAIR_MARKER';
  payload: RepairMarkerInput;
}

// --- REDACTION_MARKER -----------------------------------------------------
// Dashboard-initiated chain write withholding one record's content (register
// item 20 part 1), routed through the SW for the shared chain-write lock.
// See forensics/redaction.ts.
interface RedactionMarkerMessage {
  type: 'REDACTION_MARKER';
  payload: RedactionMarkerInput;
}

// --- CAPTURE_PERF_RECORD (perf-trace capture routing through SW realm) ----
// Content-realm perf-trace persist requests (src/diagnostics/perf-trace.ts
// `dispatchPersist`). Content scripts share the host page's origin, so
// opening the `feelingwise-pipeline-v2-metrics` IndexedDB store there trips
// the realm guard (assertExtensionRealm) and throws RealmGuardError — the
// 2026-08-24 "[FW perf-trace] persist failed" defect. SW handler in
// service-worker.ts:CAPTURE_PERF_RECORD performs the actual write at the
// extension origin. Structural mirror of `PerfRecord`
// (src/diagnostics/perf-trace.ts) with `stage` loosened to `string`: src/types may
// not import src/core (ARCHITECTURE-1), and `stage`'s producer-side union
// (`V2Stage`) is re-validated by the SW handler, not by this wire type.
interface CapturePerfRecordPayload {
  version: 1;
  timestamp: number;
  stage: string;
  ms: number;
  platform: string;
  mode: 'child' | 'teen' | 'adult';
  provider?: 'groq' | 'deepinfra' | 'deepseek' | 'other';
  cached?: boolean;
  success: boolean;
  postIdHash?: string;
  error?: string;
}
interface CapturePerfRecordMessage {
  type: 'CAPTURE_PERF_RECORD';
  payload: CapturePerfRecordPayload;
}

// --- AUTHOR_UPDATE --------------------------------------------------------
// Mirror of `updateAuthorProfile(handle, platform, flagged, techniques)`.
interface AuthorUpdateMessage {
  type: 'AUTHOR_UPDATE';
  payload: {
    author: string;
    platform: string;
    flagged: boolean;
    techniques: string[];
    /**
     * Exposure counters. Optional so every existing sender stays valid; a
     * sighting without them updates the flag counts and leaves exposure
     * untouched.
     */
    day?: string;
    textHash?: string;
  };
}

// --- USAGE_INCREMENT ------------------------------------------------------
// Counter write request. The service worker is the single writer of the
// usage counters (checks, neutralized, metrics hidden, tokens): content
// scripts, the popup and the dashboard send this instead of a
// read-modify-write of their own, which lost increments across tabs and
// carried a stale count across a UTC rollover (STORAGE-LICENCE-WORKER-7).
interface UsageIncrementMessage {
  type: 'USAGE_INCREMENT';
  payload: UsageIncrement;
}

export type UsageIncrementResponse = { ok: true } | { ok: false; error: string };

// --- GET_AUTHOR_PROFILE ---------------------------------------------------
// Content-realm read of an author profile. The profile store lives in the
// extension-origin IndexedDB that only the service worker writes, so the
// pipeline's suspicion-boost lookup asks here instead of opening the
// database in the host page's origin (where it was always empty).
interface GetAuthorProfileMessage {
  type: 'GET_AUTHOR_PROFILE';
  payload: {
    handle: string;
    /** Exact platform-namespaced lookup when known; handle-only otherwise. */
    platform?: string;
  };
}

export type GetAuthorProfileResponse =
  | { ok: true; profile: AuthorProfile | null }
  | { ok: false; error: string };

// --- GET_AUTHOR_WEEK ------------------------------------------------------
// The reading's one line from the record (content/read-this.ts): how many
// times an account came up in the last seven days and how many of those were
// charged. Counted over the chain in this realm, read-only; it feeds no
// verdict.
interface GetAuthorWeekMessage {
  type: 'GET_AUTHOR_WEEK';
  payload: {
    handle: string;
    platform: string;
  };
}

export type GetAuthorWeekResponse =
  | { ok: true; seen: number; charged: number }
  | { ok: false; error: string };

// --- RESET_FORENSIC_CHAIN -------------------------------------------------
// Dashboard-requested destructive cutover. Routed through the service worker
// so reset shares the same realm-level chain-write lock as normal log writes.
// F2 hardening: the envelope carries the parent PIN and the SW verifies it
// against the stored parentPin hash BEFORE touching the chain. The dashboard
// modal's own verifyPin() call runs client-side of the SW boundary — any
// extension realm (a content-script context, a dev-console injection) can
// post this envelope, so without the SW-side check the single most
// destructive user-reachable operation was effectively unauthenticated.
interface ResetForensicChainMessage {
  type: 'RESET_FORENSIC_CHAIN';
  payload?: {
    reason?: string;
    /**
     * Parent PIN preimage (extension-internal channel only). The SW hashes it
     * and compares against the stored parentPin hash (storage/settings
     * verifyPin). Absent or empty where a PIN is configured → the SW refuses
     * the reset. Where NO PIN is configured (an adult install, or a fresh one
     * after a reinstall) there is no secret to check and the reset proceeds
     * without one, exactly as RESTORE_FORENSIC_BACKUP does; the dashboard
     * confirms the act by having the word typed instead (14 Sep 2026).
     */
    pin?: string;
  };
}

/**
 * Response shape for RESET_FORENSIC_CHAIN. `ok:false` carries a typed
 * `errorKind` for the PIN-gate rejections so the dashboard modal can
 * distinguish "re-enter the PIN" from "the wipe itself failed".
 * Non-PIN failures (the wipe itself rejecting) keep the plain `error`
 * string with no errorKind, matching the sibling handlers' catch shape.
 */
export interface ResetForensicChainResponse {
  ok: boolean;
  /** Set when ok:true. */
  result?: ResetChainResult;
  /**
   * Set on SW-side PIN-gate rejections. 'pin-not-configured' is no longer sent
   * for a reset (14 Sep 2026: an install with no PIN resets on the typed word);
   * the member stays so an older dashboard build reading a newer worker, or the
   * reverse, still type-checks the answer it may see.
   */
  // 'reset-refused' is the store declining to clear anything, which is a
  // different fact from a failure and a much better one for the reader:
  // the record is intact. Until 2026-09-19 that outcome came back as
  // ok:true with every flag false, so the modal read it as a reset that
  // had happened with seven parts lagging.
  errorKind?: 'pin-required' | 'pin-not-configured' | 'pin-invalid' | 'reset-refused' | 'sender-refused';
  /** Human-readable diagnostic from the SW. */
  error?: string;
}

// --- GET_SIGNING_METADATA -------------------------------------------------
// Dashboard reads public metadata through the SW so first-use key generation
// cannot race an independent dashboard-realm keypair.
interface GetSigningMetadataMessage {
  type: 'GET_SIGNING_METADATA';
  payload?: undefined;
}

// --- RESTORE_FORENSIC_BACKUP ---------------------------------------------
// The entire restore runs in the SW chain-write realm, including key restore.
interface RestoreForensicBackupMessage {
  type: 'RESTORE_FORENSIC_BACKUP';
  payload: {
    raw: string;
    passphrase?: string;
    force: boolean;
    /**
     * Parent PIN preimage. When a PIN is configured the SW verifies it against
     * the stored hash before touching the chain, exactly as
     * RESET_FORENSIC_CHAIN does: a restore can replace every record and the
     * signing key, so it is gated at the realm boundary and not only in the
     * dashboard. When no PIN is configured (an adult install, or a fresh
     * install after a reinstall, which is the moment a restore exists for) the
     * gate is not there to hold anything and the restore proceeds (14 Sep 2026).
     */
    pin?: string;
    /**
     * The seal secret read from a backup folder's key file
     * (feelingwise-restore.key, backup-folder-wire.ts). Opens the folder's
     * automatic copies on any install; adopted as this install's seal secret
     * on success so the folder keeps working after the restore.
     */
    sealSecret?: string;
  };
}

/** Mirrors ResetForensicChainResponse: PIN refusals carry a typed errorKind. */
export interface RestoreForensicBackupResponse {
  ok: boolean;
  result?: import('../forensics/backup').RestoreResult;
  errorKind?: 'missing-payload' | 'pin-required' | 'pin-not-configured' | 'pin-invalid' | 'sender-refused';
  error?: string;
}

// --- MANUAL_FLAG -----------------------------------------------------------
// Dashboard-initiated chain write for a parent-flagged post. Routes through
// the SW so the addRecord call runs under the SW realm's
// sharedChainWriteLock — same realm as logger.ts entrypoints. Pre-2026-05-24
// the dashboard called `flagPostManually` directly in the dashboard realm,
// where its own `createChainWriteLock()` instance could race the SW-realm
// FORENSIC_LOG handler and stamp duplicate chainPosition. Mirrors the
// 2026-05-22 BLOCKED_LOG migration pattern. Audit A4-BLOCKER-2 / A6-BLOCKER.
interface ManualFlagMessage {
  type: 'MANUAL_FLAG';
  payload: {
    url: string;
    reason?: string;
  };
}

// --- RECHECK_RECORD --------------------------------------------------------
// Dashboard-initiated "light recheck": quietly re-open the original post in a
// background tab so the content script re-extracts fresh metrics + re-runs the
// check, writing a new metric-bearing sighting through the normal FORENSIC_LOG
// path; then close the tab. No media is fetched or stored (the heavier
// temporary video / profile-picture import is a separate, later capability —
// docs/redesign/TODO.md #1). Routed through the SW because only the SW realm
// opens/closes tabs, and the new sighting lands under the same chain path as
// every other write. The dashboard re-reads the chain on success so the new
// point appears on the post's popularity-over-time trend (grouped by postUrl).
interface RecheckRecordMessage {
  type: 'RECHECK_RECORD';
  payload: {
    /** Canonical original-post URL to re-open (resolveViewOriginalUrl output). */
    url: string;
  };
}

// --- OPEN_ORIGINAL ---------------------------------------------------------
// Dashboard-initiated "View original": the SW opens the post URL in an ACTIVE
// tab and registers that tab in the inspection registry (mode 'reveal') so the
// content script runs an observe-only inspection pass — extraction and
// forensic logging run, but no hide/cover/rewrite/marker is applied. Routed
// through the SW because only the SW realm knows the created tab's id and
// owns the registry.
interface OpenOriginalMessage {
  type: 'OPEN_ORIGINAL';
  payload: {
    /** Canonical original-post URL to open (resolveViewOriginalUrl output). */
    url: string;
  };
}

// --- IS_INSPECTION_TAB -----------------------------------------------------
// Content-script startup query: "is my tab a dashboard-originated inspection
// tab?" The SW answers from its inspection-tab registry keyed on
// sender.tab.id (TTL-bounded). The content side FAILS CLOSED: any error or
// malformed response means full protection — a normal child tab that never
// matched the registry is provably unaffected.
interface IsInspectionTabMessage {
  type: 'IS_INSPECTION_TAB';
  payload?: undefined;
}


// --- GET_CHAIN_DEBUG_STATS (verify-session diagnostic) --------------------
// Request: parameterless. SW reads the chain via getRecords() and
// returns a shape suitable for page-console logging. Gated behind
// `ff_chainDebugStats`; the orchestrator's Chrome MCP reads the resulting
// `[FW debug] chain stats: ...` line via `read_console_messages`. Only
// request/response message in the union (others are fire-and-forget or
// `{ ok: boolean }` ack); the typed response shape is exported alongside.
interface GetChainDebugStatsMessage {
  type: 'GET_CHAIN_DEBUG_STATS';
  payload?: undefined;
}

// --- RUN_RECORD_TIDY (the dashboard's button on a stale or refused prune) --
// Request: parameterless. The worker runs the nightly prune now and answers
// ok only when the prune recorded a success during this request, so the
// dashboard says Done for a run that worked and for nothing else.
interface RunRecordTidyMessage {
  type: 'RUN_RECORD_TIDY';
  payload?: undefined;
}

export interface RunRecordTidyResponse {
  ok: boolean;
}

export interface ChainDebugStatsResponse {
  ok: boolean;
  totalRecords: number;
  // All-time counts by verdict. `flagged-undefined` covers legacy records
  // written pre-Phase-1.6.2 (verdict field absent); kept separate so
  // parent + orchestrator can distinguish "no verdict written" from
  // "verdict='flagged' written explicitly."
  verdictCounts: {
    flagged: number;
    'flagged-hidden': number;
    blocked: number;
    pass: number;
    'flagged-undefined': number;
    other: number;
  };
  last10Records: Array<{
    verdict: string;
    originalText: string; // truncated to first 50 chars
    author?: string;
    technique?: string;
    timestamp: string;
  }>;
}

// --- Discriminated union ---------------------------------------------------
export type FWMessage =
  | ScanLogMessage
  | CapturePromptIoMessage
  | CaptureBehaviorMessage
  | NeutralizationCompleteMessage
  | PassLogMessage
  | ForensicLogMessage
  | EnvironmentLogMessage
  | CancelLogMessage
  | BlockedLogMessage
  | SkippedLogMessage
  | GapLogMessage
  | ImportMarkerMessage
  | ReconcileMarkerMessage
  | RepairMarkerMessage
  | RedactionMarkerMessage
  | CapturePerfRecordMessage
  | AuthorUpdateMessage
  | GetAuthorProfileMessage
  | GetAuthorWeekMessage
  | UsageIncrementMessage
  | ManualFlagMessage
  | ResetForensicChainMessage
  | GetSigningMetadataMessage
  | RestoreForensicBackupMessage
  | RecheckRecordMessage
  | OpenOriginalMessage
  | IsInspectionTabMessage
  | GetChainDebugStatsMessage
  | RunRecordTidyMessage;

/** All message-type discriminator values, useful for runtime validation. */
export const FW_MESSAGE_TYPES: ReadonlyArray<FWMessage['type']> = [
  'SCAN_LOG',
  'CAPTURE_PROMPT_IO',
  'CAPTURE_BEHAVIOR',
  'NEUTRALIZATION_COMPLETE',
  'PASS_LOG',
  'FORENSIC_LOG',
  'ENVIRONMENT_LOG',
  'CANCEL_LOG',
  'BLOCKED_LOG',
  'SKIPPED_LOG',
  'GAP_LOG',
  'IMPORT_MARKER',
  'RECONCILE_MARKER',
  'REPAIR_MARKER',
  'REDACTION_MARKER',
  'CAPTURE_PERF_RECORD',
  'AUTHOR_UPDATE',
  'GET_AUTHOR_PROFILE',
  'GET_AUTHOR_WEEK',
  'USAGE_INCREMENT',
  'MANUAL_FLAG',
  'RESET_FORENSIC_CHAIN',
  'GET_SIGNING_METADATA',
  'RESTORE_FORENSIC_BACKUP',
  'RECHECK_RECORD',
  'OPEN_ORIGINAL',
  'IS_INSPECTION_TAB',
  'GET_CHAIN_DEBUG_STATS',
  'RUN_RECORD_TIDY',
] as const;
