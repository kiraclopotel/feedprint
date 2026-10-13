// FeelingWise - Forensic logger
// Creates ForensicRecord for every processed post

import { ConfigSnapshot, ForensicRecord } from '../types/forensic';
import { AnalysisResult } from '../types/analysis';
import { Platform, FeedSource } from '../types/post';
import { Mode, levelOf } from '../types/mode';
import { sha256 } from './hasher';
import { withoutStuckFoldLabel } from './stuck-fold-label';
import { addRecord, getChainState } from './store';
import { finalizeRecord } from './record-stamp';
import { verdictFor } from '../core/policy/table';
// Fingerprint is part of the canonical hash. Stamp it on the partial
// BEFORE computing integrityHash so the signature transitively covers
// the fingerprint field. Per-realm fingerprint is stable (derived from
// the install's public-key JWK) so this is fast (cached after first
// ensureSigningKey call).
import { getPublicKeyFingerprint } from './signing';
// Per-chain serialization lock. Comment-batch flushes can fire 10+
// parallel logForensicEvent calls; without serialization, all of them
// read getChainState before any of them writes, stamping duplicate
// chainPositions. The lock confines getChainState → addRecord to one
// caller at a time.
// Use the per-realm singleton so all chain-write sites in the same
// realm share one lock queue. Audit A4-BLOCKER-2 closure.
import { sharedChainWriteLock as withChainWriteLock } from './chain-write-lock';
import type { ForensicDeliveryDisposition } from './delivery-outbox';
import type {
  PassEventInput,
  EnvironmentLogInput,
  BlockedEventInput,
  CancelEventInput,
  SkippedEventInput,
} from '../types/logger-events';

function modeToAgeCategory(mode: Mode): ForensicRecord['userAgeCategory'] {
  // The record signs the level the person set, not an age they never gave; the name is kept
  // because every caller reads it. What follows is why the value is safe to change for new records.
  // Record the active mode's level, never collapsed. userAgeCategory is the only universal
  // mode field on a record and it is the forensic provenance of which mode was
  // live at capture time — an adult-mode session must read 'adult', never the
  // 'teen' it used to collapse to. The value enters the canonical hash
  // (canonical-payload.ts) per-record, so recording the truth on NEW records
  // leaves every EXISTING record's stored value and integrityHash untouched:
  // each record re-verifies against its own stored value. Widening the union
  // to include 'adult' is a compile-time change only — it shifts no stored
  // bytes. (Pre-pivot 'adult' IDB rows likewise keep their stored value.)
  return levelOf(mode);
}


function resolveCaptureTimestamp(capturedAt?: string): string {
  if (capturedAt === undefined) return new Date().toISOString();
  const parsed = Date.parse(capturedAt);
  if (!Number.isFinite(parsed)) throw new Error('invalid forensic capture timestamp');
  return new Date(parsed).toISOString();
}

function deliveryDetectionMode(
  mode: string | undefined,
  disposition?: ForensicDeliveryDisposition,
): string | undefined {
  return disposition === 'late-after-rotation'
    ? `late-after-rotation:${mode ?? 'unspecified'}`
    : mode;
}

export async function logPassEvent(
  input: PassEventInput,
  deliveryId?: string,
  capturedAt?: string,
  disposition?: ForensicDeliveryDisposition,
): Promise<void> {
  // The page's button, not the author's words: stored without it (stuck-fold-label.ts).
  const originalText = withoutStuckFoldLabel(input.originalText, input.platform, input.textCapture);
  try {
    const originalHash = await sha256(originalText);
    // Even for pass records, capture the techniques the L1 detector saw
    // (sub-floor signals). The recall instrument uses these to decide
    // whether to sample-re-judge: a pass with several near-floor techniques
    // is a higher-priority sample target than a pass with all-zero scores.
    const techniques = input.analysis.techniques
      .filter(t => t.confidence > 0)
      .map(t => ({ name: t.technique, severity: t.severity, confidence: t.confidence }));

    // Chain-state read through addRecord write must be atomic per the
    // chain-write-lock contract. Without the lock, comment-batch
    // parallel flushes could all read the same nextPosition.
    await withChainWriteLock(async () => {
      const chainState = await getChainState();
      const partial: Omit<ForensicRecord, 'integrityHash'> = {
        id: `fr-pass-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: resolveCaptureTimestamp(capturedAt),
        platform: input.platform,
        originalText,
        originalHash,
        originalLength: originalText.length,
        // Pass records carry no neutralization — the post is unchanged on the
        // page. Empty string keeps the canonical-payload shape uniform.
        neutralizedText: '',
        author: input.author || '',
        authorName: input.authorName || undefined,
        postUrl: input.postUrl || '',
        // Per-comment deep-link (omitted when undefined → canonical-payload
        // skips it; export falls back to postUrl).
        anchorUrl: input.anchorUrl,
        techniques,
        overallScore: input.analysis.overallScore,
        userAgeCategory: modeToAgeCategory(input.mode),
        aiSource: input.aiSource,
        feedSource: input.feedSource ?? 'unknown',
        aiModel: input.aiModel || undefined,
        aiProvider: input.aiProvider || undefined,
        // Embed the pass reason in detectionMode so the dashboard can
        // group passes by which gate said no. Format: 'pass:<reason>'.
        detectionMode: deliveryDetectionMode(`pass:${input.passReason}`, disposition),
        configSnapshot: input.configSnapshot,
        prevRecordHash: chainState.prevRecordHash,
        chainPosition: chainState.nextPosition,
        chainAnchor: chainState.nextPosition === 0 ? 'genesis-v1' : undefined,
        verdict: 'pass',
        kind: input.kind,
        parentVideoId: input.parentVideoId,
        // Propagate tree + room-context. Optional fields,
        // canonical-payload omits undefined keys, back-compat preserved.
        parentRecordId: input.parentRecordId,
        commentDepth: input.commentDepth,
        roomAuthor: input.roomAuthor,
        roomCaption: input.roomCaption,
        roomUrl: input.roomUrl,
        // Per-comment harm-floor stamp.
        harmFloor: input.harmFloor,
        // Per-item engagement metrics (omitted when undefined).
        metrics: input.metrics,
        // Source labels — WHO posted + named container (omitted when undefined).
        accountType: input.accountType,
        sourceContainer: input.sourceContainer,
        // Impression / exposure order — local observed order (omitted when undefined).
        observedSequence: input.observedSequence,
        viewportSeenAt: input.viewportSeenAt,
        surfaceSessionId: input.surfaceSessionId,
        surfaceOrigin: input.surfaceOrigin,
        // What the page carried against what the screen showed (omitted when not checked).
        textCapture: input.textCapture,
        authorCapture: input.authorCapture,
        // Why it stood, when a judge read it (omitted when none did).
        decision: input.decision,
        reader: input.reader,
        buildId: input.buildId,
        mediaUrls: input.mediaUrls,
        // Where the verdict was read from, when it was not the item's own
        // words (omitted on every ordinary pass).
        verdictOrigin: input.verdictOrigin,
      };

      console.log(`[FeelingWise] Forensic: logging pass for post ${partial.id} (reason: ${input.passReason})`);

      // Stamp the signing identity BEFORE hashing so it is covered by both
      // the canonical hash and signature. Failure rejects this delivery; the
      // SW outbox retains it and retries instead of writing weaker evidence.
      const publicKeyFingerprint = await getPublicKeyFingerprint();
      const stamped = { ...partial, publicKeyFingerprint };
      const record: ForensicRecord = await finalizeRecord(stamped);

      await addRecord(record, deliveryId);
    });
  } catch (err) {
    // Re-throw so the SW handler's `.catch` at service-worker.ts can
    // sendResponse({ ok: false }) to the caller; pre-fix this catch
    // logged-and-swallowed, leaving the SW reporting ok:true while the
    // record silently dropped. VISION §1.1 forensic-integrity: a
    // dropped record must be visible at every persistence boundary.
    console.error('[FeelingWise] Pass-event forensic logging failed:', err);
    throw err;
  }
}

/**
 * Forensic-record input. Mirrors `ForensicLogPayload` on the SW
 * envelope (`src/types/messages.ts:67-91`) so the SW handler can pass
 * `message.payload` directly without a 21-arg explosion. Pre-2026-05-24
 * `logForensicEvent` took 21 positional arguments — adding a new
 * field required edits in 3 files (this type, the SW dispatch, the
 * logger body), and a wrong order silently wrote records with shifted
 * fields. The pre-Phase-1.6.2 `harmFloor` drop (`service-worker.ts:
 * 152-156` comment) cost 218/218 records the field. Audit A6 V1.5
 * ROADMAP rank 8 closure.
 */
export interface ForensicEventInput {
  /**
   * Which build of the content script produced this record — stamped once at
   * the content-side send chokepoint (content/forensic-retry.ts). Undefined in
   * unbaked builds (vitest, node harnesses) and on every record written before
   * the field existed. See src/core/build-id.ts.
   */
  buildId?: ForensicRecord['buildId'];
  originalText: string;
  neutralizedText: string;
  analysis: AnalysisResult;
  mode: Mode;
  platform: Platform;
  aiSource: 'local' | 'cloud' | 'rules';
  author?: string;
  /** Display name beside the handle, when the adapter read it separately. */
  authorName?: string;
  postUrl?: string;
  /** Per-comment deep-link, when captured (else undefined → falls back to postUrl in the export). */
  anchorUrl?: string;
  feedSource?: FeedSource;
  aiModel?: string;
  aiProvider?: string;
  detectionMode?: string;
  configSnapshot?: ConfigSnapshot;
  /** Split-forensic: defaults preserve legacy behavior (top-level post). */
  kind?: 'post' | 'video' | 'comment' | 'reply' | 'image';
  parentVideoId?: string;
  /**
   * Tree-relationship + room-context fields. All optional + omitted
   * from canonical payload when undefined → existing chain records
   * hash byte-identically.
   */
  parentRecordId?: string;
  commentDepth?: number;
  roomAuthor?: string;
  roomCaption?: string;
  roomUrl?: string;
  /**
   * Per-comment harm-floor pre-classification stamp. Set by
   * `content/index.ts` comment-batch dispatch from
   * `BatchScoreResult.commentHarmFloors[i]`. Per VISION §1.1 forensic
   * completeness — the recipient (judge / CPS / counselor) reads the
   * harm-floor alongside the LLM verdict for each comment record.
   */
  harmFloor?: ForensicRecord['harmFloor'];
  /** Per-item engagement metrics captured before the child saw them hidden. */
  metrics?: ForensicRecord['metrics'];
  /** Honest override provenance — which deterministic gate set this verdict, or undefined for AI-origin. */
  overrideOrigin?: ForensicRecord['overrideOrigin'];
  /** false when a hide/collapse verdict's DOM change did not apply; omitted otherwise. */
  visualApplied?: ForensicRecord['visualApplied'];
  /** Source labels — WHO posted (accountType) + named container (FB group name). */
  accountType?: ForensicRecord['accountType'];
  sourceContainer?: ForensicRecord['sourceContainer'];
  /** Impression / exposure order — local observed order captured pre-AI. */
  observedSequence?: ForensicRecord['observedSequence'];
  viewportSeenAt?: ForensicRecord['viewportSeenAt'];
  surfaceSessionId?: ForensicRecord['surfaceSessionId'];
  /**
   * Stamped by the service worker from `sender.origin`, not asserted by the
   * content script. See src/background/service-worker.ts.
   */
  surfaceOrigin?: ForensicRecord['surfaceOrigin'];
  /** What the page carried against what the screen showed (src/content/record/text-fold.ts). */
  textCapture?: ForensicRecord['textCapture'];
  /** 'withheld' when the recorder refused an author it could see (src/types/author-capture.ts). */
  authorCapture?: ForensicRecord['authorCapture'];
  mediaUrls?: ForensicRecord['mediaUrls'];
  /** Why the product acted (docs/design/DECISION-BLOCK-2026-09-07.md); omitted when the path cannot name a row. */
  decision?: ForensicRecord['decision'];
  /** The declared reader profile; omitted until a path stamps it. */
  reader?: ForensicRecord['reader'];
  /**
   * 'room' when this verdict was read from the comments under a text-less
   * item rather than from the item's own words (src/content/post-path/room-verdict.ts).
   * Omitted on every other path, and never backfilled.
   */
  verdictOrigin?: ForensicRecord['verdictOrigin'];
}

export async function logForensicEvent(
  input: ForensicEventInput,
  deliveryId?: string,
  capturedAt?: string,
  disposition?: ForensicDeliveryDisposition,
): Promise<void> {
  const {
    originalText: textAsHeld,
    neutralizedText,
    analysis,
    mode,
    platform,
    aiSource,
    author,
    authorName,
    postUrl,
    anchorUrl,
    feedSource,
    aiModel,
    aiProvider,
    detectionMode,
    configSnapshot,
    kind,
    parentVideoId,
    parentRecordId,
    commentDepth,
    roomAuthor,
    roomCaption,
    roomUrl,
    harmFloor,
    metrics,
    overrideOrigin,
    visualApplied,
    accountType,
    sourceContainer,
    observedSequence,
    viewportSeenAt,
    surfaceSessionId,
    surfaceOrigin,
    textCapture,
    authorCapture,
    decision,
    reader,
    buildId,
    mediaUrls,
    verdictOrigin,
  } = input;
  // The page's button, not the author's words: stored without it (stuck-fold-label.ts).
  const originalText = withoutStuckFoldLabel(textAsHeld, platform, textCapture);
  try {
    const originalHash = await sha256(originalText);

    // `why` is the judging model's own rationale for this technique, carried
    // through verbatim from analysis.evidence. Without it 'combined' — the
    // most common technique in real exports — is an opaque bucket: it is the
    // UNCATEGORISED RESIDUAL (the judge's free-text primary_concern matched no
    // technique enum — mapConcernToTechnique in core/neutralizer.ts), so it
    // names nothing on its own and has no components to drop. `why` is the only
    // thing that can stand behind it.
    //
    // The filter below is load-bearing and it leaves a real hole: the judge
    // schema permits primary_concern: null, which mapConcernToTechnique also
    // turns into 'combined'. Then reason is '', evidence is [''], filter(Boolean)
    // strips it, and the record carries the residual technique with NO why at
    // all. Those records are counted apart at the source
    // ('combined-no-concern' vs 'combined-with-concern', neutralizer.ts) so the
    // size of that hole is measured rather than assumed. Omitted (not
    // empty-stringed) when there is no rationale, so records without one hash
    // exactly as before.
    const confirmedTechniques = analysis.techniques
      .filter(t => t.present)
      .map(t => {
        const why = (t.evidence ?? []).map(e => String(e).trim()).filter(Boolean).join('; ');
        return {
          name: t.technique,
          severity: t.severity,
          confidence: t.confidence,
          ...(why ? { why } : {}),
        };
      });

    // Chain-state read through addRecord write must be atomic.
    // Critical for the comment-batch parallel-flush path.
    await withChainWriteLock(async () => {
      // Fetch the next chain link before computing the hash so the
      // chain fields are part of what gets signed.
      const chainState = await getChainState();

      const partial: Omit<ForensicRecord, 'integrityHash'> = {
        id: `fr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: resolveCaptureTimestamp(capturedAt),
        platform,
        originalText,
        originalHash,
        originalLength: originalText.length,
        neutralizedText,
        author: author || '',
        authorName: authorName || undefined,
        postUrl: postUrl || '',
        // Per-comment deep-link (omitted when undefined → canonical-payload
        // skips it; export falls back to postUrl).
        anchorUrl,
        techniques: confirmedTechniques,
        overallScore: analysis.overallScore,
        userAgeCategory: modeToAgeCategory(mode),
        aiSource,
        feedSource: feedSource ?? 'unknown',
        aiModel: aiModel || undefined,
        aiProvider: aiProvider || undefined,
        detectionMode: deliveryDetectionMode(detectionMode || undefined, disposition),
        configSnapshot: configSnapshot || undefined,
        prevRecordHash: chainState.prevRecordHash,
        chainPosition: chainState.nextPosition,
        // Mark the very first chain record so dashboard can label it.
        chainAnchor: chainState.nextPosition === 0 ? 'genesis-v1' : undefined,
        // Explicit verdict tag on new records. Legacy records omit
        // this field; the canonical-payload hasher omits undefined
        // keys from JSON, so legacy records hash unchanged. Slur-tier
        // hides (`analysis.action === 'hide'`) carry verdict='flagged-hidden'
        // so a parent reviewing the chain can filter "show me what FW
        // hid from the kid" distinct from "show me what FW rewrote"
        // (per the 2026-05-08 forensic-completeness mandate: even hidden
        // slurs must be on record). All other flagged records carry
        // verdict='flagged'.
        // Since 2026-09-07 a record that carries a decision block takes its
        // verdict from what the page showed (docs/design/DECISION-BLOCK-2026-09-07.md
        // section 1: allow, context, mask and record are pass; mark and soften
        // are flagged; collapse and hide are flagged-hidden), so a swear mask
        // stops counting as a flag. Without a block, the legacy rule stands.
        // A hide or collapse whose page change did not land is a mark, not a
        // hide: the item stayed on the page (wiring audit 2026-09-13, C23).
        // The decision block already says applied 'mark' on that path; the
        // legacy rule without a block said 'flagged-hidden' and every reader
        // counted the item as hidden.
        verdict: visualApplied === false
          ? 'flagged'
          : decision ? verdictFor(decision.applied) : (analysis.action === 'hide' ? 'flagged-hidden' : 'flagged'),
        // Split-forensic. Both fields optional; absent on top-level
        // text-feed posts so the canonical hash stays unchanged for
        // them.
        kind,
        parentVideoId,
        // Tree-relationship + denormalized room context. Optional +
        // undefined-omitted by canonical-payload — legacy + adapters
        // that don't populate them hash byte-identically.
        parentRecordId,
        commentDepth,
        roomAuthor,
        roomCaption,
        roomUrl,
        // Per-comment harm-floor stamp.
        harmFloor,
        // Per-item engagement metrics (omitted when undefined).
        metrics,
        // Honest override provenance — undefined for AI-origin verdicts;
        // canonical-payload omits undefined so those records hash unchanged.
        overrideOrigin,
        // Hide/collapse whose DOM change failed (omitted when it applied).
        visualApplied,
        // Source labels — WHO posted + named container (omitted when undefined).
        accountType,
        sourceContainer,
        // Impression / exposure order — local observed order (omitted when undefined).
        observedSequence,
        viewportSeenAt,
        surfaceSessionId,
        surfaceOrigin,
        // What the page carried against what the screen showed (omitted when not checked).
        textCapture,
        authorCapture,
        // Why the product acted and who was declared at the keyboard (omitted when absent).
        decision,
        reader,
        // Which build of the content script judged it (omitted in unbaked builds).
        buildId,
        // The media addresses the page carried, as read (omitted when not read).
        mediaUrls,
        // Where the verdict was read from, when it was not the item's own
        // words (omitted on every ordinary verdict).
        verdictOrigin,
      };

      console.log(`[FeelingWise] Forensic: logging neutralization for post ${partial.id}`);

      // The SW outbox retains the delivery if the signing identity cannot be
      // resolved; new evidence never lands without its signer fingerprint.
      const publicKeyFingerprint = await getPublicKeyFingerprint();
      const stamped = { ...partial, publicKeyFingerprint };
      const record: ForensicRecord = await finalizeRecord(stamped);

      await addRecord(record, deliveryId);
    });
  } catch (err) {
    console.error('[FeelingWise] Forensic logging failed:', err);
    throw err;
  }
}


export async function logEnvironmentEvent(
  input: EnvironmentLogInput,
  deliveryId?: string,
  capturedAt?: string,
  disposition?: ForensicDeliveryDisposition,
): Promise<void> {
  try {
    const sourceText = input.environment.summary || `[environment ${input.environment.label}]`;
    const originalHash = await sha256(sourceText);
    // Chain-state read through addRecord write must be atomic.
    await withChainWriteLock(async () => {
      const chainState = await getChainState();
      const partial: Omit<ForensicRecord, 'integrityHash'> = {
        id: `fr-env-${input.parentVideoId}-${Date.now()}`,
        timestamp: resolveCaptureTimestamp(capturedAt),
        platform: input.platform,
        originalText: sourceText,
        originalHash,
        originalLength: sourceText.length,
        neutralizedText: '',
        author: '',
        postUrl: input.postUrl ?? '',
        // No technique on the room record: the dominant technique lives in
        // `environment.dominantTechnique`, and a technique entry at severity 0
        // read as a detection on a record no detector made (wiring audit
        // 2026-09-13, C26). Records already written keep their entry.
        techniques: [],
        overallScore: 0,
        userAgeCategory: modeToAgeCategory(input.mode),
        aiSource: 'cloud',
        feedSource: input.feedSource ?? 'unknown',
        aiModel: input.aiModel,
        aiProvider: input.aiProvider,
        detectionMode: deliveryDetectionMode('environment-batch-aggregate', disposition),
        configSnapshot: undefined,
        prevRecordHash: chainState.prevRecordHash,
        chainPosition: chainState.nextPosition,
        chainAnchor: chainState.nextPosition === 0 ? 'genesis-v1' : undefined,
        verdict: 'pass',
        kind: 'environment',
        parentVideoId: input.parentVideoId,
        environment: input.environment,
        // Surface session — omitted when undefined so legacy environment
        // records hash byte-identically.
        surfaceSessionId: input.surfaceSessionId,
        surfaceOrigin: input.surfaceOrigin,
        // What the page carried against what the screen showed (omitted when not checked).
        textCapture: input.textCapture,
        authorCapture: input.authorCapture,
        buildId: input.buildId,
        mediaUrls: input.mediaUrls,
      };

      console.log(`[FeelingWise] Forensic: logging environment record ${partial.id} (${input.environment.label}, ${input.environment.sampled} sampled)`);

      const publicKeyFingerprint = await getPublicKeyFingerprint();
      const stamped = { ...partial, publicKeyFingerprint };
      const record: ForensicRecord = await finalizeRecord(stamped);
      await addRecord(record, deliveryId);
    });
  } catch (err) {
    console.error('[FeelingWise] Environment forensic logging failed:', err);
    throw err;
  }
}

// `EducationalRewriteLogInput` + `logEducationalRewrite` are gone. The
// `replace-toxic-with-educational` feature was retired, the
// service-worker `EDUCATIONAL_REWRITE_LOG` handler was deleted, and no
// client emits the message any more. Records that already carry
// `verdict: 'educational-reframe'` remain in the chain (append-only),
// and `verdict?: ... 'educational-reframe' ...` stays in the union so
// reads stay valid; only the writer is gone.



export async function logCancelEvent(
  input: CancelEventInput,
  deliveryId?: string,
  capturedAt?: string,
  disposition?: ForensicDeliveryDisposition,
): Promise<void> {
  // The page's button, not the author's words: stored without it (stuck-fold-label.ts).
  const originalText = withoutStuckFoldLabel(input.originalText, input.platform, input.textCapture);
  try {
    const originalHash = await sha256(originalText);
    // When the LLM ran (mid-flight + render-gate cancels), preserve the
    // techniques the detector saw so the chain record contains the
    // determination FW made even though the verdict never rendered. When the
    // LLM didn't run (cancelled-stale), techniques is empty — there was no
    // detection event to record.
    const techniques = input.analysis
      ? input.analysis.techniques
          .filter(t => t.confidence > 0)
          .map(t => ({ name: t.technique, severity: t.severity, confidence: t.confidence }))
      : [];
    const overallScore = input.analysis?.overallScore ?? 0;
    // Who produced the verdict. With an analysis the cloud call returned one
    // ('cloud': mid-flight and render-gate cancels). Without one nobody did:
    // the provider was called and did not answer (cancelled-batch-llm-failure,
    // cancelled-post-llm-failure), answered with no slot for this item
    // (cancelled-batch-truncated), or the item left the screen before any
    // call (cancelled-stale). Those said 'local' until 2026-09-05, which the
    // type reads as an on-device model's verdict; 'none' is the honest value
    // (known-issues M131). The model that was asked, when one was, stays on
    // aiModel / aiProvider.
    const aiSource: 'cloud' | 'none' = input.analysis ? 'cloud' : 'none';

    await withChainWriteLock(async () => {
      const chainState = await getChainState();
      const partial: Omit<ForensicRecord, 'integrityHash'> = {
        id: `fr-cancel-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: resolveCaptureTimestamp(capturedAt),
        platform: input.platform,
        originalText,
        originalHash,
        originalLength: originalText.length,
        neutralizedText: '',
        author: input.author || '',
        authorName: input.authorName || undefined,
        postUrl: input.postUrl || '',
        techniques,
        overallScore,
        userAgeCategory: modeToAgeCategory(input.mode),
        aiSource,
        feedSource: input.feedSource ?? 'unknown',
        aiModel: input.aiModel,
        aiProvider: input.aiProvider,
        // Embed the cancel verdict label in detectionMode so dashboard +
        // exports can group cancels by reason. Format: 'cancel:<verdict>'.
        detectionMode: deliveryDetectionMode(`cancel:${input.verdict}`, disposition),
        configSnapshot: input.configSnapshot,
        prevRecordHash: chainState.prevRecordHash,
        chainPosition: chainState.nextPosition,
        chainAnchor: chainState.nextPosition === 0 ? 'genesis-v1' : undefined,
        verdict: input.verdict,
        kind: input.kind,
        parentVideoId: input.parentVideoId,
        roomAuthor: input.roomAuthor,
        roomCaption: input.roomCaption,
        roomUrl: input.roomUrl,
        failureKind: input.failureKind,
        cap: input.cap,
        // Source labels — WHO posted + named container (omitted when undefined).
        accountType: input.accountType,
        sourceContainer: input.sourceContainer,
        // Impression / exposure order — local observed order (omitted when undefined).
        observedSequence: input.observedSequence,
        viewportSeenAt: input.viewportSeenAt,
        surfaceSessionId: input.surfaceSessionId,
        surfaceOrigin: input.surfaceOrigin,
        // What the page carried against what the screen showed (omitted when not checked).
        textCapture: input.textCapture,
        authorCapture: input.authorCapture,
        buildId: input.buildId,
        mediaUrls: input.mediaUrls,
      };

      console.log(`[FeelingWise] Forensic: logging ${input.verdict} for post ${partial.id}`);

      const publicKeyFingerprint = await getPublicKeyFingerprint();
      const stamped = { ...partial, publicKeyFingerprint };
      const record: ForensicRecord = await finalizeRecord(stamped);

      await addRecord(record, deliveryId);
    });
  } catch (err) {
    console.error('[FeelingWise] Cancel-event forensic logging failed:', err);
    throw err;
  }
}


export async function logSkippedEvent(
  input: SkippedEventInput,
  deliveryId?: string,
  capturedAt?: string,
  disposition?: ForensicDeliveryDisposition,
): Promise<void> {
  // The page's button, not the author's words: stored without it (stuck-fold-label.ts).
  const originalText = withoutStuckFoldLabel(input.originalText, input.platform, input.textCapture);
  try {
    const originalHash = await sha256(originalText);

    await withChainWriteLock(async () => {
      const chainState = await getChainState();
      const partial: Omit<ForensicRecord, 'integrityHash'> = {
        id: `fr-skp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: resolveCaptureTimestamp(capturedAt),
        platform: input.platform,
        originalText,
        originalHash,
        originalLength: originalText.length,
        // Nothing was rewritten and nothing was hidden.
        neutralizedText: '',
        author: input.author || '',
        authorName: input.authorName || undefined,
        postUrl: input.postUrl || '',
        // NO synthetic technique. The blocked path invents one so the export
        // renders a row; doing that here would put a technique name on an item
        // no detector looked at, and the export counts a technique at severity
        // 5 as a flag when no verdict is written.
        techniques: [],
        overallScore: 0,
        userAgeCategory: modeToAgeCategory(input.mode),
        // No model ran. 'rules' is the honest source: the gate that declined is
        // a rule, not a judgement.
        aiSource: 'rules',
        feedSource: input.feedSource ?? 'unknown',
        aiModel: undefined,
        aiProvider: undefined,
        detectionMode: deliveryDetectionMode(`skip:${input.skipReason}`, disposition),
        configSnapshot: input.configSnapshot,
        prevRecordHash: chainState.prevRecordHash,
        chainPosition: chainState.nextPosition,
        chainAnchor: chainState.nextPosition === 0 ? 'genesis-v1' : undefined,
        verdict: 'skipped',
        skipReason: input.skipReason,
        kind: input.kind,
        parentVideoId: input.parentVideoId,
        metrics: input.metrics,
        accountType: input.accountType,
        sourceContainer: input.sourceContainer,
        observedSequence: input.observedSequence,
        viewportSeenAt: input.viewportSeenAt,
        surfaceSessionId: input.surfaceSessionId,
        surfaceOrigin: input.surfaceOrigin,
        // What the page carried against what the screen showed (omitted when not checked).
        textCapture: input.textCapture,
        authorCapture: input.authorCapture,
        buildId: input.buildId,
        mediaUrls: input.mediaUrls,
      };

      const publicKeyFingerprint = await getPublicKeyFingerprint();
      const stamped = { ...partial, publicKeyFingerprint };
      const record: ForensicRecord = await finalizeRecord(stamped);
      await addRecord(record, deliveryId);
    });
  } catch (err) {
    console.error('[FeelingWise] Skipped-event forensic logging failed:', err);
    throw err;
  }
}

export async function logBlockedEvent(
  input: BlockedEventInput,
  deliveryId?: string,
  capturedAt?: string,
  disposition?: ForensicDeliveryDisposition,
): Promise<void> {
  try {
    // Use the caption (or a synthetic placeholder if the caption was empty)
    // as the audit "originalText" so exports show the parent what FW saw.
    const sourceText = input.caption.trim().length > 0
      ? input.caption
      : `[blocked: ${input.blockReason}]`;
    const originalHash = await sha256(sourceText);

    // Chain-state read through addRecord write must be atomic.
    await withChainWriteLock(async () => {
      const chainState = await getChainState();
      const partial: Omit<ForensicRecord, 'integrityHash'> = {
        id: `fr-blk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: resolveCaptureTimestamp(capturedAt),
        platform: input.platform,
        originalText: sourceText,
        originalHash,
        originalLength: sourceText.length,
        // Blocked records have no rewrite — the post is hidden, not replaced.
        neutralizedText: '',
        author: input.author || '',
        postUrl: input.postUrl || '',
        // No technique and no score: a rule matched, nobody read the item, and
        // a severity is a judge's number (docs/design/DECISION-BLOCK-2026-09-07.md
        // section 1). Until 2026-09-13 every blocked record carried a synthetic
        // 'ai-content-block' at severity 10 so the exporter would render a row;
        // the analyser then filed every block under sev 9-10 (wiring audit
        // C15). Records already written keep their entry; readers that
        // classify a block use detectionMode (block:<reason>:<token>).
        techniques: [],
        overallScore: 0,
        userAgeCategory: modeToAgeCategory(input.mode),
        // The rule fires DOM-side without an LLM call — no tokens, no provider.
        // 'rules', not 'local': the type reads 'local' as an ON-DEVICE MODEL's
        // verdict, and a hashtag match, an AI-content marker, a reel surface or
        // a media timeout is a regex, not a model. Said 'local' until
        // 2026-09-08. The same correction the cancel path took on 2026-09-05
        // (M131) for the same reason; the blocked path was missed in that pass.
        // Downstream this is load-bearing: forensics/flag-provenance.ts reads
        // aiSource to decide whether a judge or a rule made a call, so 'local'
        // here presented 72 deterministic blocks as model judgements.
        // aiSource is inside the canonical payload, so this changes what NEW
        // records say; records already written keep their bytes and verify
        // exactly as before.
        aiSource: 'rules',
        // 'unknown' when the caller could not read the surface, the same
        // default every other writer uses. The old 'video' default was read as
        // surface "other" by the export (wiring audit 2026-09-13, C17); a new
        // default changes only the bytes of new records, which is allowed.
        feedSource: input.feedSource ?? 'unknown',
        aiModel: undefined,
        aiProvider: undefined,
        // detectionMode embeds the trigger so the dashboard + exports can
        // group blocked records by reason (hashtag vs ai-label) + by which
        // specific token matched. Format: 'block:<reason>:<matchedToken>'.
        detectionMode: deliveryDetectionMode(
          `block:${input.blockReason}:${input.matchedToken}`,
          disposition,
        ),
        configSnapshot: input.configSnapshot,
        prevRecordHash: chainState.prevRecordHash,
        chainPosition: chainState.nextPosition,
        chainAnchor: chainState.nextPosition === 0 ? 'genesis-v1' : undefined,
        verdict: 'blocked',
        kind: input.kind,
        // Source labels + impression order. All undefined-omitted by
        // canonical-payload, so the DOM-side blockers (which can prove none of
        // them) keep writing byte-identical payloads, and blocked records
        // written before this existed re-verify unchanged. Where the caller
        // DOES hold the post, these are what let a blocked ad sit in its real
        // place in the export's replay order and carry its advertiser label.
        accountType: input.accountType,
        sourceContainer: input.sourceContainer,
        observedSequence: input.observedSequence,
        viewportSeenAt: input.viewportSeenAt,
        surfaceSessionId: input.surfaceSessionId,
        surfaceOrigin: input.surfaceOrigin,
        textCapture: input.textCapture,
        authorCapture: input.authorCapture,
        buildId: input.buildId,
        mediaUrls: input.mediaUrls,
        metrics: input.metrics,
        // Why it was blocked, when a rail names it (omitted otherwise).
        decision: input.decision,
        reader: input.reader,
      };

      // The reason only: the author's handle and the matched word stay in the record, out of the console.
      console.log(`[FeelingWise] Forensic: logging blocked video (${input.blockReason})`);

      const publicKeyFingerprint = await getPublicKeyFingerprint();
      const stamped = { ...partial, publicKeyFingerprint };
      const record: ForensicRecord = await finalizeRecord(stamped);
      await addRecord(record, deliveryId);
    });
  } catch (err) {
    console.error('[FeelingWise] Blocked-event forensic logging failed:', err);
    throw err;
  }
}

// The shape lives in src/types/logger-events.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { PassEventInput, EnvironmentLogInput, BlockedEventInput, CancelEventInput, SkippedEventInput } from '../types/logger-events';
