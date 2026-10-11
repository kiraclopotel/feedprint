// FeelingWise - Forensic record types

import { Platform, FeedSource, NodeKind, AccountType } from './post';
import type { AuthorCapture } from './author-capture';
import type { TextCapture } from './text-capture';
import type { RecordedMode } from './mode';

/**
 * Per-item engagement metrics captured from rendered DOM at observation time,
 * BEFORE the engagement controller hides them from the child. One flat
 * optional-everything shape holds both the post and the comment cases: post /
 * video / caption records carry the post-shaped keys; comment / reply records
 * carry the comment-shaped keys. Every sub-field is optional and the whole
 * object is omitted when no metric was extracted, so legacy / metric-less
 * records hash byte-identically (canonical-payload JSON.stringify omits
 * undefined keys). Inside the signed payload per the evidence-integrity
 * decision — tampering with a captured count breaks the recomputed hash.
 *
 * Platform-coverage note (V1): not every platform exposes every metric. Render
 * only what was captured; never zero-fill. `views` is shared between the post
 * and comment shapes (same key). `reactions_profile` is intentionally excluded
 * (FB hover-state extraction is V1.5+).
 */
export interface RecordMetrics {
  // post / video / caption shape
  primary_likes?: number;
  /** Instagram obscures the exact like count; render "likes hidden by platform". */
  likes_obscured?: boolean;
  retweets?: number;
  quote_tweets?: number;
  bookmarks?: number;
  views?: number;
  shares?: number;
  comments_count?: number;
  // comment / reply shape
  likes?: number;
  reply_count?: number;
  /** Creator-heart flag (TikTok / YouTube comment nodes). */
  is_creator_hearted?: boolean;
}

/**
 * HISTORICAL. What a paid media-understanding pipeline was doing when a record
 * was written. Added 2026-08-02 because the chain could not
 * distinguish "the feature was off" from "the feature failed".
 *
 * The video and image pipelines were removed in 2.5.0, so no record written by
 * 2.5.0 or later carries these states. The type stays because records written
 * by earlier versions do, and the export and the verifier read them.
 */
type MediaUnderstandingState =
  | 'on'
  | 'off'
  | 'unlicensed'
  | 'platform-excluded'
  | 'surface-excluded';

/**
 * Configuration in force when the verdict was reached.
 *
 * `mode` is the mode the record was JUDGED under, not the mode at read time, so
 * a mid-session mode switch never rewrites the meaning of an earlier record.
 * The two media fields are HISTORICAL (see MediaUnderstandingState): written
 * only by versions before 2.5.0, and only once a start gate had resolved.
 * `computeRecordIntegrityHash` serialises this object whole, so a record
 * written without them hashes exactly as it did before they existed. Never
 * backfill them onto an existing record — that changes its hash.
 *
 * `threshold` holds one of two things, and which one depends on the path that wrote the record.
 * The post path writes the mode's confidence cut, a value in [0, 1) (`getEffectiveThreshold`,
 * core/calibration.ts: 0.45, 0.55, 0.60). The comment path writes the severity floor on the
 * 1 to 10 scale (`MANIPULATION_SEVERITY_THRESHOLD`, core/severity-floor.ts: 6). A reader tells
 * them apart by value: below 1 is a confidence cut, 1 or above is a severity floor, which is the
 * rule `conditionsText` in forensics/html-export.ts prints by. Read on 2026-09-20 this docblock
 * said nothing about it and neither did verifier/FORMAT.md, so somebody building a second reader
 * from the public document would have printed 0.6 and 6 as one scale. The name stays: it is
 * inside the hash, and renaming it would change every record's hash.
 */
export interface ConfigSnapshot {
  mode: string;
  threshold: number;
  dailyCap: number;
  videoUnderstanding?: MediaUnderstandingState;
  imageUnderstanding?: MediaUnderstandingState;
  /**
   * Sorted ids of the feature toggles whose top-level `enabled` was true when
   * the record was captured. The mode tag alone cannot prove which
   * protections were live (a parent can strip a Child grid toggle by toggle
   * while every record keeps saying child); this field lets a chain reader
   * reconstruct the protection posture, not just its label. Same additive
   * contract as the media fields above: OPTIONAL, omitted on records that
   * predate it or whose settings read failed, so older records hash exactly
   * as before; never backfill onto an existing record. Per-platform overrides
   * are deliberately not captured — this is the top-level grid only.
   */
  enabledFeatures?: string[];
  /**
   * Present and true ONLY when the settings backing this snapshot were the
   * synthetic fail-closed fallback (chrome.storage unreadable and no cached
   * snapshot): FW protects at maximum in that window, and the snapshot's
   * `mode: 'child'` describes the protection posture, not the install's real
   * configuration. Without this flag a record written during the window
   * attests, under an integrity hash, that a child install was present when
   * the truth is "unknown, defaulted to strongest". Same additive contract
   * as the fields above: omitted on real settings and on records that
   * predate it, so historical hashes are unchanged; never backfill.
   */
  settingsReadFailed?: true;
}


/** The page-level actions the policy table can choose (src/core/policy/table.ts, same words). */
export type DecisionAction = 'allow' | 'context' | 'mark' | 'soften' | 'mask' | 'collapse' | 'hide' | 'record';

/** A deterministic rail that fired before any model call. */
export type DecisionRail = 'blocklist' | 'identity-slur' | 'coded-harm' | 'sponsored';

/**
 * Why the product acted: the record's own account of instrument, reading,
 * rails, row, action and outcome. Designed 2026-09-07
 * (docs/design/DECISION-BLOCK-2026-09-07.md). Every member is plain data so
 * the block serialises the same way everywhere it is hashed.
 */
export interface DecisionBlock {
  /** The judge that read the item, or null when none ran (free tier, cap, a rail first). */
  judge: { id: string; hash: string; model: string; provider: string } | null;
  /** What the judge returned, or null when none ran. */
  reading: { charged: boolean; family: string; severity: number; effect: string; intent: string } | null;
  /** The descriptor's reading, or null when none ran. */
  descriptor: {
    id: string; hash: string; model: string;
    target: string; speech_act: string; topic: string; protect: string; graphic: boolean; swearing: boolean;
  } | null;
  /**
   * DESCRIPTOR-V1's reading (PLAN-2026-09-15 item 1): effect, target, and the group
   * when the target is a group. Present only on records where the measured judge
   * fired and the descriptor answered; absent (not null) everywhere else, so every
   * block written before it hashes as it did.
   */
  descriptorV1?: {
    id: 'descriptor-v1';
    hash: string;
    model: string;
    effect: string;
    target: string;
    group: string;
  };
  /**
   * The paid reading's Claude reader (src/ai/claude-reader.ts ClaudeStamp), present only on a
   * record whose item it was asked about: who was asked (model, provider, the judge's hash) and
   * what came of it (`outcome` is 'read' with Haiku's five fields under `reading`, or the reason
   * there is no reading). Absent, not null, everywhere else, so every block written before it
   * hashes as it did; inside the signature on new records, so the second company that read an
   * item cannot be repainted away (11 Oct 2026).
   */
  claude?: {
    model: string;
    provider: string;
    hash: string;
    outcome: string;
    reading?: { charged: boolean; family: string; severity: number; effect: string; intent: string };
  };
  /** Every rail that fired, with at most a short match token; empty when none did. */
  rails: Array<{ name: DecisionRail; match: string }>;
  /** The household the action was chosen for. */
  household: { mode: RecordedMode; reader: string; topicRule: string | null; mask: boolean };
  /** The policy row that fired, e.g. 'R2', 'P1', 'J3', 'T1', 'D1'. */
  row: string;
  /** What the table said. */
  action: DecisionAction;
  /** What the page ended up showing; differs from `action` only with a `note`. */
  applied: DecisionAction;
  /**
   * The rewrite stage's outcome, or null when it did not run. `model` is the
   * model whose rewrite the page showed, the name the page's machine-readable
   * AI mark carried; present only when the outcome is 'applied', a model wrote
   * the text and its reply named the model. Absent on records written before it
   * existed, so they hash as they did.
   */
  rewrite: { attempted: boolean; outcome: string; model?: string } | null;
  /** One fixed sentence when `applied` differs from `action`; null otherwise. */
  note: string | null;
}

export interface ForensicRecord {
  id: string;
  timestamp: string;
  platform: Platform;
  originalText: string;
  originalHash: string;
  originalLength: number;
  neutralizedText: string;
  author: string;
  /**
   * The display name shown beside the handle, when the platform adapter
   * could read it separately (src/types/post.ts `PostContent.authorName`).
   * Absent on every record written before this field existed, and on every
   * record whose adapter reads only one string for author, so those hash
   * byte-identically. Inside the signature on new records: a repainted name
   * breaks the recomputed hash. MUST stay byte-synced with
   * verifier-core-source.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  authorName?: string;
  postUrl: string;
  /**
   * The techniques confirmed on this record.
   *
   * `why` carries the judging model's own one-line rationale for that
   * technique, verbatim. It exists because 'combined' — by far the most
   * common technique in real exports — is the UNCATEGORISED RESIDUAL: the
   * judge emits one free-text `primary_concern`, and 'combined' is what
   * `mapConcernToTechnique` returns when that phrase matches none of the
   * technique enums (src/core/neutralizer.ts, fallback return). It is NOT
   * "2+ distinct techniques present": `judgeToCombinedShape` builds a
   * one-element techniques array, so a 'combined' record has no components
   * to name, ever. Without `why`, an auditor reading 'combined, severity 8'
   * had nothing at all. Optional and undefined-omitted by JSON.stringify, so
   * records that predate it hash byte-identically and every existing
   * signature still verifies; never backfill. On new records it IS inside
   * the canonical payload, so a repainted rationale breaks the hash.
   */
  techniques: { name: string; severity: number; confidence: number; why?: string }[];
  overallScore: number;
  /**
   * The level that was set when this record was captured: 'strict', 'moderate' or 'relaxed' on new
   * records (levelOf), the old ids 'child', 'teen' or 'adult' on records written before the levels,
   * which keep them because the value is signed. The field's name is signed vocabulary too, which is
   * why it still says age: renaming it would break every older checker. Before the levels it was
   * the mode recorded verbatim ('child' | 'teen' | 'adult') as forensic provenance. The value
   * is per-record and is part of the canonical hash, so widening the union to
   * include 'adult' shifts no stored bytes: existing records keep their stored
   * value and re-verify unchanged; only new adult-mode records hash as 'adult'
   * (which is correct — they ARE adult records). Earlier builds collapsed
   * 'adult' → 'teen' here, which mislabeled every adult session in the chain.
   */
  userAgeCategory: RecordedMode;
  /**
   * Who produced the verdict on this record.
   *   'cloud' — an external LLM call returned the verdict (today: Groq).
   *   'local' — an on-device LLM call returned the verdict (historical:
   *             Ollama 8b; retained for legacy records + the manual-flag /
   *             chain-marker / reset-marker / month-rotation-marker paths
   *             that are internally-authored).
   *   'rules' — a non-LLM rules-based gate produced the verdict (regex
   *             harm-floor, slur dictionary, dehumanization filter). No
   *             network call happened. `aiModel` / `aiProvider` on these
   *             records name the specific rule engine (e.g.
   *             aiModel='fw-harm-floor-regex-v1', aiProvider='fw-rules').
   *   'none'  — nobody produced a verdict: a cancelled-* record that carries
   *             no analysis (the provider was called and did not answer, the
   *             response held no slot for this item, or the item left the
   *             screen before any call). Since 2026-09-05 (known-issues
   *             M131). `aiModel` / `aiProvider` on such a record name the
   *             model that was asked, when one was. Records written before
   *             that date carry 'local' here and keep it. Only the record
   *             type admits the value: the inputs for flagged and pass
   *             records stay three-valued, so a judged record cannot be
   *             stamped with no producer.
   */
  aiSource: 'local' | 'cloud' | 'rules' | 'none';
  feedSource: FeedSource;
  aiModel?: string;
  aiProvider?: string;
  detectionMode?: string;
  configSnapshot?: ConfigSnapshot;
  integrityHash: string;

  /**
   * VISION §9 — ECDSA P-256 signature over `integrityHash`, base64url-
   * encoded. Present on records that were signed; absent on legacy
   * records. Verified with the public key surfaced in the export's
   * "Verify this export" block (see exporter.ts).
   */
  signature?: string;

  /**
   * First 16 hex chars of SHA-256 over the signing public key's JWK
   * coordinates (`x|y`). Human-readable tag so a recipient can eyeball
   * whether two records came from the same install without comparing
   * full JWKs. NOT a security boundary — full verification requires the
   * public key embedded in the export.
   */
  publicKeyFingerprint?: string;

  /**
   * Chain integrity link.
   * SHA-256 hex of the previous record's `integrityHash`. For the first
   * record after the v2 chain anchor: equal to CHAIN_GENESIS_HASH.
   * Absent on legacy (pre-v2) records.
   */
  prevRecordHash?: string;

  /**
   * Monotonic 0-indexed chain position.
   * Set by the logger at write time via getChainState(). Pre-chain (legacy)
   * records use -1 to signal "not part of the integrity chain." Records
   * with chainPosition >= 0 form the verifiable chain.
   */
  chainPosition?: number;

  /**
   * Provenance marker.
   * 'genesis-v1' = first record after migration. 'pre-chain' = legacy
   * record signed under v1 schema; tamper-evidence is per-record only,
   * not chain-linked. 'pre-rekey' = record that was retired from the
   * active chain by the parent's "Re-anchor chain" action because its
   * signature stopped verifying under the current install's public key
   * (extension reinstall / storage clear / keypair regeneration). Content
   * integrity preserved per-record; cross-record chain link no longer
   * walks. 'month-rotation' = the first record (chainPosition 0) of a
   * monthly-rotated chain. The prior month's terminal hash is captured
   * in `priorChainHash` (same field Reset Marker uses); cross-month
   * verification walks the chain-of-chains via that link. Records
   * mid-chain leave this undefined.
   *
   * Note: chainAnchor is NOT part of the canonical payload (see
   * canonical-payload.ts) — it's advisory metadata. Adding a new value
   * does not change the hash of any existing record.
   */
  chainAnchor?: 'genesis-v1' | 'pre-chain' | 'pre-rekey' | 'month-rotation' | 'cap-prune' | 'gap' | 'heartbeat' | 'import' | 'repair' | 'redaction' | 'reconcile';

  /**
   * Pipeline-stage verdict for the scanned post. Distinguishes four classes
   * of audit record so the chain becomes a complete pipeline trace, not a
   * filtered list of positives:
   *
   *   `flagged` — L1 detector said ≥1 technique present at severity ≥
   *     floor. This is what dashboards historically counted.
   *   `pass`    — L1 detector ran, found no patterns OR all techniques
   *     below severity floor. Carries the LLM's reasoning + scores so the
   *     recall instrument can sample-re-judge for false-negative detection.
   *   `skipped` — L0 gate dropped before LLM ran (too short, dedup,
   *     daily-cap exhausted, language unsupported, etc.). Carries
   *     `skipReason`.
   *   `educational-reframe` — the comment-rewriter
   *     replaced a comment with educational text in child mode. NOT a
   *     manipulation detection — it's our own action. The forensic
   *     record exists for parent-export auditing ("what did the app
   *     replace?"), but dashboards must NOT count it as a flag,
   *     manipulation technique, or repeat-offender event. The legacy
   *     record stamps a synthetic `techniques: [{ name: 'educational-
   *     replace', severity: 0, confidence: 1 }]` which previously
   *     polluted the Repeat Offender table — filter on this verdict.
   *
   * UNDEFINED on legacy records — the canonical-payload hasher relies on
   * JSON.stringify's undefined-omission so legacy records produce the
   * same hash with or without this field declared in the type. Reader
   * code treats undefined as 'flagged' for back-compat (every legacy
   * record was a flagged record).
   *
   * 'blocked' is for records written by the rule-based AI-content blocker
   * (matched a parent blocklist hashtag or a multi-language AI-generated
   * marker on the page). Distinct from 'flagged' so dashboards can
   * separate "the detector said this is manipulative" from "a hard rule
   * pre-empted the post". `computeStats()` filters on 'flagged' only and so
   * does not inflate technique / platform counts with blocked records.
   *
   * 'harm-floor-trigger' is a forward-compat union member for the L1.5
   * harm-floor layer (see `src/core/harm-floor.ts`). Current emission
   * stays through the existing 'flagged' verdict path with
   * technique='extreme-toxicity' + harm-floor signals as evidence. The
   * union member is a typed-API contract for migration without breaking
   * the canonical-payload hash (JSON.stringify omits undefined keys;
   * only records that explicitly stamp this value see a different hash,
   * which is intentional).
   */
  /**
   * Cancel-* verdict states for the speculative streaming pipeline,
   * preserving forensic completeness per VISION §1.1.
   *
   *   'cancelled-stale'        — user scrolled past the post before classify
   *                              even started; queue dropped the item per its
   *                              adaptive stale threshold (queue.ts §4).
   *                              Chain record carries the post + cancel reason
   *                              so forensic completeness preserves the
   *                              "we observed this, didn't classify" signal.
   *   'cancelled-mid-flight'   — API call was sent, response discarded
   *                              (user already past). The verdict payload
   *                              from the completed call IS persisted to
   *                              the chain even though it never rendered —
   *                              it's evidence the parent could subpoena
   *                              ("FW saw this, made a determination, but
   *                              the user had already moved past").
   *   'cancelled-dom-recycled' — verdict returned + anchor revalidation
   *                              found the live DOM no longer matches the
   *                              enqueue-time fingerprint (platform's
   *                              virtualizer reused the node for a different
   *                              post). Verdict NOT applied to the new post;
   *                              chain record names the recycled-out post id.
   *   'cancelled-dom-gone'     — verdict returned + WeakRef.deref() returned
   *                              undefined (DOM node garbage-collected before
   *                              render gate ran). Chain record + post id
   *                              preserved.
   *
   *   'cancelled-batch-truncated' — comment-batch LLM call succeeded BUT the
   *                                 model's response stopped before emitting
   *                                 a verdict for this comment's index
   *                                 (typically max_tokens cut-off mid-array
   *                                 of a 25-comment batch). Missing slots
   *                                 were previously silently defaulted to
   *                                 technique='none' / severity=0 — silent
   *                                 downgrades on protection records that
   *                                 violate VISION §1.2. Now: chain record
   *                                 stamps this verdict with the original
   *                                 comment text + author so the export can
   *                                 say "FW observed this comment but the
   *                                 LLM response was truncated before it
   *                                 returned a verdict for it" — never as
   *                                 evidence of innocence, always as honest
   *                                 missing-classification.
   *
   *   'cancelled-batch-llm-failure' — comment-batch LLM call entirely failed:
   *                                   either the upstream Groq call threw
   *                                   (network / rate-limit / 5xx) OR the
   *                                   response was empty / unparseable JSON.
   *                                   `scoreBatch` returns a fail-closed
   *                                   `BatchScoreResult` with `failed: true`
   *                                   and every comment defaulted to
   *                                   technique='none' / severity=0. Routing
   *                                   those defaults to PASS_LOG with
   *                                   `passReason='comment-batch-neutral'`
   *                                   would mean the chain claims "FW
   *                                   analyzed these N comments and they're
   *                                   innocent" when the truth is "FW could
   *                                   not analyze them." VISION §1.2
   *                                   protection-honesty bar mandates the
   *                                   latter framing. The chain stamps this
   *                                   verdict for every comment in the
   *                                   failed batch. Mirrors the
   *                                   cancelled-batch-truncated pattern at
   *                                   batch-level instead of per-index.
   *
   *   'cancelled-post-llm-failure'  — the SINGLE-POST equivalent, added
   *                                   2026-08-02. The posts path returned a
   *                                   PASS on a genuine vendor / network
   *                                   failure and wrote nothing at all, so the
   *                                   chain could not distinguish "judged and
   *                                   fine" from "never judged" — the exact
   *                                   claim the batch entry above forbids, one
   *                                   surface over, and worse because there
   *                                   was no record to inspect. Three distinct
   *                                   states used to share the one pass reason
   *                                   and they are now separated by
   *                                   `failureKind`: the circuit breaker
   *                                   declining to call
   *                                   ('pre-llm-circuit-breaker'), a real
   *                                   vendor failure (its own AIFailure kind),
   *                                   and a fault in FeelingWise's own code
   *                                   ('internal-error'). Never evidence of
   *                                   innocence; always honest missing
   *                                   classification.
   *
   *   'cancelled-video-unjudged'    — a video was released to the child with
   *                                   no media verdict, added 2026-08-02. The
   *                                   video path had FOUR exits that released
   *                                   without one and none of them wrote a
   *                                   record: nothing judgeable (no frames and
   *                                   no caption), another analysis already in
   *                                   flight (one global `inFlight` boolean,
   *                                   no queue — the owner measured 7 in a
   *                                   day), nothing judgeable after the
   *                                   bundle, and an exception during
   *                                   analysis. Two carried a counter, two
   *                                   were entirely silent, and a counter is
   *                                   a daily total, not a record of WHICH
   *                                   video. `failureKind` names which exit.
   *                                   Deduped per video key. This records the
   *                                   gap; it does not close it — the
   *                                   concurrency limit itself is a separate
   *                                   decision.
   *
   * Forensic invariant per VISION §1.1: every observed post produces a chain
   * record. Cancellation is a first-class chain event — silent drops would
   * violate the "every observed post" guarantee. The cancelled-* records
   * appear in the chain with verdict=cancelled-* AND the original post id /
   * platform / extraction timestamp so an export can answer "what did FW
   * see during this scroll session, even on items it didn't render to?".
   *
   * 'masked' (2026-09-13, wiring audit C13): the household's swear setting
   * starred words on an item nothing charged. Written only when the decision
   * block says applied 'mask'. Before that date a mask was written as 'pass',
   * which counted starred text as untouched; records already written keep
   * that value. A masked record is decided (a reader saw it, nothing was
   * charged) but it is neither a pass nor a flag, and every rate that divides
   * by passed+flagged+blocked leaves it out.
   */
  verdict?: 'flagged' | 'flagged-hidden' | 'pass' | 'masked' | 'skipped' | 'educational-reframe' | 'blocked' | 'harm-floor-trigger'
          | 'cancelled-stale' | 'cancelled-mid-flight' | 'cancelled-dom-recycled' | 'cancelled-dom-gone'
          | 'cancelled-batch-truncated' | 'cancelled-batch-llm-failure' | 'cancelled-post-llm-failure'
          | 'cancelled-video-unjudged'
          /** An image post's Child cover hit the analysis wait cap before any verdict (image-context/trigger.ts). */
          | 'cancelled-image-unjudged';

  /**
   * Reason string for skipped records.
   * Only meaningful when `verdict === 'skipped'`. Free-form string
   * (NOT a closed union) so future skip-reason categories can be
   * added without a schema bump — the canonical-payload hasher
   * includes the literal string so any change is tamper-evident.
   *
   * Currently emitted reasons:
   *   'too-short'             — text length < L0 minimum
   *   'non-substantive'       — < 8 substantive words
   *   'duplicate'             — content hash already scanned
   *   'cache-hit'             — recent identical scan returned same verdict
   *   'cap-exhausted'         — daily LLM call cap reached
   *   'language-unsupported'  — language outside EN/RO scope
   */
  skipReason?: string;

  /**
   * Tree position. 'video' = the post's caption / title / description;
   * 'comment' = a comment under that post; 'environment' = the aggregate
   * "room" verdict for the comment section (one per video, holds sample
   * math + raw metric counts + dominant tone). Default 'post' for
   * top-level scrollable items on text feeds (Twitter, FB feed).
   *
   * UNDEFINED on legacy records — same back-compat trick as `verdict`:
   * canonical-payload omits undefined keys → hash unchanged for pre-feature
   * records. Reader code treats undefined as 'post'.
   *
   * 'reset-marker' is written as the first record (chainPosition 0) of
   * every chain following a `resetForensicChain` call. Closes the silent-
   * evidence-destruction vector: a chain that had been reset would
   * otherwise be indistinguishable from a fresh-install chain. Every
   * reset chain begins with a Reset Marker that names the prior-chain
   * hash (when known) and an optional user-supplied reason. The marker
   * is part of the cryptographic chain and cannot be removed without
   * breaking chain integrity.
   *
   * 'reply' distinguishes a reply (nested response to another comment)
   * from a top-level comment under a post/video. Pairs with
   * `parentRecordId` (id of the parent comment's chain record) and
   * `commentDepth` (0 = top-level comment, 1 = reply, 2 = reply-to-reply,
   * etc.).
   *
   * 'month-rotation-marker' is the first record (chainPosition 0) of each
   * monthly-rotated chain. Distinct from 'reset-marker' (which is a
   * parent action) — rotation markers are automatic at UTC month flip.
   * The `priorChainHash` field carries the terminal integrityHash of the
   * just-archived chain, enabling cross-month chain-of-chains verification.
   * Forensic clarity: keeping the rotation distinct from the reset in the
   * `kind` field (which IS part of the canonical payload hash) makes the
   * distinction tamper-evident, vs. relying on chainAnchor alone (which
   * is NOT in the canonical hash per canonical-payload.ts).
   */
  // Derives from the shared NodeKind base (per post.ts) so future
  // additions to the node-kind vocabulary propagate to the chain
  // automatically. Record-level markers (`image`, `environment`,
  // `reset-marker`, `month-rotation-marker`) are forensic-side only.
  // `image` marks a still-image ANALYSIS record (evidence about a post's
  // photos, grouped under the post via parentVideoId) — deliberately NOT
  // a NodeKind member: it is not a DOM node the child saw, and it must
  // never be eligible as a group's header record (group-records.ts
  // isPostKind), so an async image verdict can never displace the post's
  // own record.
  // Audit A8 V1.5 ROADMAP rank 9 closure.
  // 'gap-marker' (2026-09-06, evidence-gap register item 9) is a signed
  // record with no content that states a bound on what was lost, where and
  // why, between two instants; written by forensics/gap-marker.ts from the
  // loss sites and by the heartbeat when it finds no heartbeat before it.
  // 'heartbeat-marker' (same date) is the recorder's own signed statement
  // that it was alive across a window, with the feeds open and the positions
  // written since the previous one; forensics/heartbeat.ts.
  // 'import-marker' (same date) says that records recovered from a picked
  // file entered the record, with a digest over exactly which ones;
  // forensics/import-marker.ts.
  // 'repair-marker' (same date) discloses one heal-log event, the position
  // recovery that wrote solved positions back over signed records;
  // forensics/repair-marker.ts.
  // 'redaction-marker' (same date, owner's yes) names one record and the
  // fields withheld from every export and view; forensics/redaction.ts.
  kind?: NodeKind | 'image' | 'environment' | 'reset-marker' | 'month-rotation-marker' | 'prune-marker' | 'gap-marker' | 'heartbeat-marker' | 'import-marker' | 'repair-marker' | 'redaction-marker' | 'reconcile-marker';

  /**
   * When `kind === 'reset-marker'`, the integrityHash of the LAST record
   * in the chain that was reset (captured BEFORE the IDB clear). Allows
   * opposing counsel / verifier to demand "produce the prior chain that
   * ended with hash X." Refusal is itself probative. UNDEFINED when the
   * prior chain was empty (genesis-only reset, no records had been
   * written yet) or when capture failed.
   *
   * On any other `kind`, this field is undefined.
   */
  priorChainHash?: string;

  /**
   * When `kind === 'reset-marker'`, optional free-form reason text
   * supplied by the user via the reset-confirmation modal. Examples:
   * "sold this device", "starting fresh after settled custody
   * discussion", "testing". Empty string when the user provided no
   * reason. UNDEFINED on any other `kind` (back-compat omission).
   */
  resetReason?: string;

  /**
   * Parent video id when this record is one of the N+1 split records
   * under the same video. Same on the caption record AND every comment
   * record, so the dashboard can group "1 video + N comments" by a
   * single key. UNDEFINED on legacy + on top-level posts.
   */
  parentVideoId?: string;

  /**
   * Topic classification per post. Currently unset; topic-classification
   * prompt addition is future work. Optional field with default undefined
   * — back-compat preserved (canonical-payload omits undefined keys →
   * existing chain records still verify with same hash).
   *
   * Candidate taxonomy: "politics", "sports", "health", "fashion",
   * "news", "entertainment", "education", "lifestyle", "gaming", "tech",
   * etc.
   */
  topic?: string;

  /**
   * Identity of the parent record this record is a child of:
   *   • Top-level comment under a post/video → parentRecordId = the post/
   *     video's chain record id
   *   • Reply to a top-level comment        → parentRecordId = the
   *     top-level comment's chain record id
   *   • Reply-to-reply                      → parentRecordId = the parent
   *     reply's chain record id
   *   • Top-level post / video / room       → undefined (tree root)
   *
   * Optional, undefined on legacy records — canonical-payload omits
   * undefined keys → hash unchanged for legacy records.
   */
  parentRecordId?: string;

  /**
   * Comment depth in the discussion tree:
   *   • 0 = top-level comment under the post/video
   *   • 1 = reply to a top-level comment
   *   • 2 = reply to a reply
   *   • etc.
   *
   * UNDEFINED on top-level posts/videos and on legacy records.
   */
  commentDepth?: number;

  /**
   * Denormalized author handle of the room (the post/video this record's
   * tree is rooted under). Wired on every comment-batch flush so each
   * comment record carries the room context inline. Self-contained-record
   * requirement per VISION §1.1 §7.2: a 90-second-budget recipient must
   * understand a record without joining against another record.
   *
   * Examples: "example_video_author" (TikTok video author), "example_post_author" (Twitter
   * post author), "FB.123456" (Facebook page id when handle absent).
   *
   * UNDEFINED on the room record itself (its `author` field IS the room
   * author, no need to denormalize) and on legacy records.
   */
  roomAuthor?: string;

  /**
   * Denormalized caption / title of the room (the post/video this
   * record's tree is rooted under). Truncated to ~200 chars for chain-
   * size discipline. Per VISION §1.1 §7.2 standalone HTML verifier:
   * recipient sees what video this comment was on without needing the
   * source page open.
   *
   * Truncation policy: first 200 chars of caption, suffix "…" when
   * truncated. Recipient who wants verbatim caption can visit roomUrl
   * (the live source) or check the room record (kind='video'/'post')
   * which has the full text in `originalText`.
   *
   * UNDEFINED on the room record itself and on legacy records.
   */
  roomCaption?: string;

  /**
   * Denormalized URL of the room. Same data as the existing `postUrl`
   * field on comment records (which currently stores the video's URL,
   * not the comment's permalink). Aliased here so tree-aware code can
   * read `roomUrl` semantically without overloading `postUrl`.
   *
   * UNDEFINED on the room record itself (its postUrl IS the room URL)
   * and on legacy records.
   */
  roomUrl?: string;

  /**
   * Source-of-content classification: how this post reached the child.
   * Pairs with `feedSource` (which describes the SURFACE it appeared on)
   * to give "where did this come from" context.
   *
   *   'algorithm'  — algorithm-curated (For You feed / suggestions / etc.)
   *   'followed'   — account the child follows
   *   'friend'     — the parent has flagged this account as a friend
   *   'family'     — the parent has flagged this account as family
   *   'unknown'    — not yet classified
   *
   * NO WRITER SETS THIS FIELD (wiring audit 2026-09-13, C21). It is in the
   * canonical payload for order and in the dashboard's pill map for the day a
   * classifier exists; every record in every chain has it undefined. Do not
   * read it as "unknown source": it is "not classified", and a reader that
   * shows a label for it shows an invention. Friend/family annotation UI is
   * future work.
   */
  sourceCategory?: 'algorithm' | 'followed' | 'friend' | 'family' | 'unknown';

  /**
   * Environment-record payload. Only populated when
   * `kind === 'environment'`. Holds the aggregate "room" verdict for a
   * comment section: which label fits (hostile / pile-on / echo-chamber /
   * polarized / mostly-positive / healthy / sparse / unknown), how many
   * comments were sampled vs visible, and raw metric counts read from the
   * page DOM (likes / shares / total comments / views) — captured BEFORE
   * the engagement controller hides them from the child.
   *
   * UNDEFINED on every other record kind. Canonical-payload omits when
   * undefined → no hash change for legacy records.
   */
  environment?: {
    label: 'hostile-crowd' | 'pile-on' | 'echo-chamber' | 'polarized' | 'mostly-positive' | 'healthy-discussion' | 'sparse' | 'unknown';
    /** Free-form 1-2 sentence summary in the post's language. */
    summary: string;
    /** Dominant technique observed across the comment section (if any). */
    dominantTechnique: string | null;
    /**
     * Structured room ANALYSIS (BETA) from the separate `scoreRoom` call — the
     * room reader as a sensor, not a summarizer. Optional: omitted on
     * legacy / fail-closed / room-call-failed records so the canonical payload
     * hashes unchanged.
     */
    claimVsReaction?: 'corroborates' | 'contradicts' | 'ignores' | 'no-claim';
    commentManipulation?: 'none' | 'bandwagon' | 'pile-on' | 'astroturf';
    audienceDistress?: boolean;
    /**
     * 1-3 closed-list content-topic labels for what the POST is about
     * (TOPIC_LABELS, comment-batch-scorer.ts) — the "what the feed is made
     * of" axis, AI-interpretation. Optional + omitted when the room call
     * failed or returned none → legacy records hash unchanged.
     */
    topicLabels?: string[];
    /** Sentiment percentages (0..100). Sum should equal 100 within rounding. */
    negativePct: number;
    positivePct: number;
    neutralPct: number;
    /** Number of comments actually scored. */
    sampled: number;
    /** Total comments on the post per the platform's metric (e.g., "500" badge). undefined when not parseable. */
    totalVisible?: number;
    /** Raw metric counts from the page DOM at scan time (snapshot). */
    metrics?: {
      likes?: number;
      shares?: number;
      views?: number;
      comments?: number;
    };
    /**
     * Layer-2 room-toxicity signals computed from the per-comment
     * harm-floor pre-filter (see `src/core/harm-floor.ts` +
     * `src/core/profanity-filter.ts` slurs tier). Persists alongside
     * the existing percentage fields so the parent dashboard can
     * surface the room-narrative beyond per-comment markers.
     *
     * All optional — undefined on legacy chain records →
     * canonical-payload omits → no hash change for back-compat.
     */
    /** Composite 0-100 toxicity score. Mean per-comment harm-floor across the batch. */
    toxicityScore?: number;
    /** % of comments with harm-floor score ≥ 50 (slur/profanity-loaded). */
    slurPrevalencePct?: number;
    /** Max comments by single handle in the batch (≥3 = pile-on contributor). */
    authorRecidivism?: number;
    /** 0-100 discourse-quality score. High = rebut-by-argument; low = rebut-by-slur. */
    discourseQuality?: number;
    /**
     * Algorithmic-amplification proxy from views÷likes.
     *   'high'    — views/likes > 100 (algorithmically pushed beyond organic engagement)
     *   'normal'  — 30 ≤ ratio ≤ 100 (typical organic engagement range)
     *   'low'     — ratio < 30 (highly-engaged content; small audience by likes)
     *   'unknown' — views or likes missing
     */
    algorithmicAmplification?: 'high' | 'normal' | 'low' | 'unknown';
  };

  /**
   * Failure-kind discriminator for `cancelled-batch-llm-failure` records.
   * Mirrors `AIFailure['kind']` from `src/ai/ai-error.ts` so the dashboard's
   * Operational Events surface can distinguish rate-limit / network / auth-
   * refusal / etc. when grouping system-side failures. Optional + undefined-
   * omitted from the canonical payload, so legacy chain records (written
   * before this field existed) continue to verify with the same hash.
   * Reader code defaults missing values to 'network' for back-compat
   * (the most common failure shape pre-stamping).
   */
  failureKind?:
    | 'transient-http'
    | 'rate-limit'
    | 'json-refusal'
    | 'auth-refusal'
    /** The relay asked for the person's go-ahead for the reading and it has not been given. */
    | 'consent-required'
    | 'content-policy'
    | 'network'
    | 'aborted'
    | 'cap-exhausted'
    | 'pre-llm-circuit-breaker'
    | 'pre-llm-unsupported-language'
    /** The proxy's usage coordinator was unavailable (deploy/binding fault). */
    | 'coordinator-unavailable'
    /** A fault inside FeelingWise's own code, not the vendor's. */
    | 'internal-error'
    /**
     * Comment batch: the provider answered 2xx but neither the three-tier
     * parser nor the truncation salvage found a comments array. Stamped so a
     * repeat failure is traceable to the reply rather than guessed at from a
     * console default (2026-09-02).
     */
    | 'provider-unparseable-json'
    /**
     * Comment batch: well-formed JSON carrying zero verdicts AND no
     * environment block. A different fault from an unparseable reply and no
     * longer collapsed into it.
     */
    | 'provider-empty-verdicts'
    /** Video released because another analysis held the single in-flight slot. */
    | 'video-analysis-overlap'
    /** Video carried no frames and no caption — nothing existed to judge. */
    | 'video-nothing-to-judge'
    /** Image post released by the per-cover wait cap before the serial chain reached it. */
    | 'analysis-timeout';

  /**
   * Cap subtype for skipped records with `skipReason === 'cap-exhausted'`.
   * Pairs with `AIFailure['kind'] === 'cap-exhausted'` so the dashboard can
   * distinguish daily / monthly / tier-free exhaustion in the Operational
   * Events surface. Optional + undefined-omitted from the canonical payload,
   * preserving back-compat for legacy records that did not stamp the cap.
   */
  cap?: 'daily' | 'monthly' | 'tier-free' | 'master-off';

  /**
   * Per-comment harm-floor pre-filter signal. Stamped on comment records
   * (kind='comment'/'reply') by the comment-batch path BEFORE the BATCH
   * classifier runs. Captures the regex+structural ground-truth
   * (profanity / ad-hominem / ideology-slur / identity-slur / caps /
   * crowd-coordination) the classifier saw as input. Recipient-readable
   * evidence ("FW pre-classified this comment with a 65/100 harm-floor
   * dominated by identity-slur match") that doesn't depend on LLM output.
   *
   * UNDEFINED on top-level posts/videos, on the room record, on legacy
   * records, and on comments where harm-floor pre-filter found zero signal.
   */
  harmFloor?: {
    /** 0-100 composite score from harm-floor regex+structural signals. */
    score: number;
    /**
     * Top-contributing category (drives the prompt label). Extended
     * 2026-05-24 (audit A8 V1.5 ROADMAP rank 10) with `'emoji-pile'`
     * and `'repetition'` so the forensic record losslessly mirrors
     * `CommentHarmFloor.top_category` (post.ts:420-452). Pre-2026-05-24
     * those two values appeared in CommentHarmFloor but were absent
     * here; the emitter hand-transform silently dropped the label.
     * Optional + JSON.stringify omits undefined keys → legacy records
     * hash byte-identically (canonical-payload chain stability preserved).
     */
    topCategory?:
      | 'identity-slur'
      | 'profanity'
      | 'ad-hominem'
      | 'ideology-slur'
      | 'sustained-caps'
      | 'crowd-coordination'
      | 'punctuation-rage'
      | 'emoji-pile'
      | 'repetition';
    /** Evidence snippet from the top signal (≤60 chars). */
    topEvidence?: string;
    /** True when src/core/profanity-filter.ts slurs tier matched. */
    identitySlurMatch: boolean;
    /** Detected language hint. */
    language: 'en' | 'ro' | 'mixed' | 'unknown';
    /**
     * All firing harm-floor signal categories at extraction time, not
     * just the top one. Mirrors `CommentHarmFloor.signal_categories`
     * (post.ts:420-452). Optional + omit-when-undefined: legacy records
     * without this field hash byte-identically. Audit A8 rank 10 closure.
     */
    signalCategories?: string[];
  };

  /**
   * Per-item engagement metrics (likes / views / shares / comment count /
   * creator heart) captured at observation time. UNDEFINED on legacy records
   * and on any record where no metric was extracted — omitted from the
   * canonical payload so those records hash byte-identically. Inside the
   * signed payload: a mutated count breaks the recomputed hash. See
   * `RecordMetrics`.
   */
  metrics?: RecordMetrics;

  /**
   * Deep-link that lands the recipient ON the exact comment/reply this record
   * captured — not just the post it sits under. On platforms where a comment
   * is independently addressable this is its permalink (X reply status URL,
   * YouTube `&lc=<id>`, Facebook `?comment_id=<id>`); on platforms with no
   * stable per-comment URL (TikTok) it is UNDEFINED and the export falls back
   * to `postUrl`. UNDEFINED on legacy records, on post/video records (their
   * `postUrl` already IS the address), and wherever capture failed — omitted
   * from the canonical payload so those records hash byte-identically. Inside
   * the signed payload: a mutated address breaks the recomputed hash. MUST
   * stay byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE
   * (enforced by tests/unit/forensics/html-verifier-drift.test.ts).
   */
  anchorUrl?: string;
  /**
   * The origin of the page the item was observed on: protocol plus host, for
   * example `https://www.facebook.com`.
   *
   * Stamped by the SERVICE WORKER from `sender.origin` when the forensic
   * delivery arrives (src/background/service-worker.ts), with a fallback that
   * derives an origin from the sender URL and refuses any scheme that is not
   * http or https. It is deliberately NOT read in the content script and NOT
   * threaded up with the rest of the payload: Chrome sets `sender.origin` from
   * the frame the message came from, so the page cannot forge it and the
   * content script does not assert it. Reading `location` at write time is
   * separately the M36 trap that got an earlier attempt reverted.
   *
   * Why it is in the record at all. Nothing else in the payload ties the bytes
   * to a platform rather than to a browser. Platform attribution is one read
   * of the document host, so a hosts-file line plus a local server produces a
   * fully signed, chained and time-stamped fake feed. This does not close that
   * (an attacker who can edit hosts can also serve https with a certificate
   * their own machine trusts), but it makes the cheap version of the trick
   * visible: a record whose surface origin is `http:` was not a real session
   * on any of the five platforms, all of which are HTTPS-only.
   *
   * Omitted on every record written before 2026-09-04, and on any realm with
   * no `location`, so legacy records hash byte-identically.
   */
  surfaceOrigin?: string;

  /**
   * What the page carried against what the screen showed, for this item's
   * text (docs/design/TEXT-CAPTURE-2026-09-05.md; research-log entry 5).
   *   'whole'  — the page carried no fold control for this item: what is
   *              recorded is what was on the page and on the screen.
   *   'folded' — the page carried the whole text, which is `originalText`,
   *              and showed the first lines behind a control (YouTube and
   *              TikTok clamp by style). How many lines is a layout fact the
   *              DOM does not carry and the recorder does not measure.
   *   'cut'    — the page carried only the first part, an ellipsis and a
   *              control that loads the rest on a press (Facebook, Instagram).
   *              `originalText` is that part, `originalLength` its length; the
   *              rest was never on the page, and the recorder never presses.
   * Read once at onPostDetected from the element the adapter chose
   * (`src/content/record/text-fold.ts`). Absent on every record written before
   * 2026-09-05 and on the paths that record from something other than an
   * adapter's post; absent is "not checked", never "whole". Undefined-omitted
   * by the canonical payload, so legacy records hash byte-identically; inside
   * the signature, so a record cannot later be repainted as whole. MUST stay
   * byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  textCapture?: TextCapture;

  /**
   * How the author on this record was arrived at (src/types/author-capture.ts).
   *   absent     — the author is the one the page showed beside the item.
   *   'withheld' — the recorder saw an author and refused it, because it could
   *                not show that the header and the body belonged to the same
   *                item. On X the feed is virtualised and one article slot is
   *                reused for a new item mid-read, so a visible handle can
   *                belong to a different post than the body beneath it.
   *                `author` is empty on these and the address falls back to
   *                the page, which is what such a row honestly is.
   * The verdict is untouched: a withheld author does not move a count or a
   * share anywhere. Absent on every record written before 2026-09-17;
   * undefined-omitted by the canonical payload, so those records hash
   * byte-identically and every stored signature still verifies. Inside the
   * signature on new records, so a row cannot later be repainted as having
   * carried an author. MUST stay byte-synced with html-export.ts
   * VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  authorCapture?: AuthorCapture;

  /**
   * The media addresses the page carried for this item, exactly as read
   * (evidence-gap register item 14, 2026-09-06): http(s) sources of the
   * post's own images and videos, deduplicated, at most eight, in DOM order.
   * The bytes are not kept and not hashed (the media hosts are outside the
   * extension's permissions; see src/content/record/media-urls.ts). Absent on every
   * record written before 2026-09-06 and where the element was gone; absent
   * is "not read", never "no media". Undefined-omitted by the canonical
   * payload, so legacy records hash byte-identically; inside the signature,
   * so an address cannot later be swapped. MUST stay byte-synced with
   * html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  mediaUrls?: string[];

  /**
   * Why the product acted, on every content record it judged or acted on
   * (docs/design/DECISION-BLOCK-2026-09-07.md; Stage 2 of the 2026-09-07
   * plan). One block says which instrument read the item, what it returned,
   * which deterministic rails fired, which policy row chose the action, what
   * the page ended up showing, and, when those two differ, why. `severity` at
   * the record's top level is the judge's number and nothing else; a rail
   * carries no severity. Absent on markers, on environment records and on
   * every record written before the field existed; absent is "not stated",
   * never "allowed". Undefined-omitted by the canonical payload, so legacy
   * records hash byte-identically; inside the signature, so a row or an
   * action cannot later be repainted. MUST stay byte-synced with
   * html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  decision?: DecisionBlock;

  /**
   * The declared reader profile at the keyboard when the record was written:
   * a label the household chose ('default' until it chooses), never a real
   * name required. Declared, not proven; the export says so. Undefined on
   * every record written before the field existed (omitted from the canonical
   * payload, byte-identical hash); inside the signature on every record that
   * carries it, so the profile cannot be reassigned after the fact. MUST stay
   * byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  reader?: string;

  /**
   * Which BUILD of the content script judged this item — the id baked into
   * that bundle (src/core/build-id.ts), stamped at the one content-side send
   * chokepoint. Not the extension version: the version string is read by the
   * service worker at export time and is identical on every record however
   * old the code that produced it, which is why a record could not previously
   * answer "which code judged this row".
   *
   * It answers one question the record could not: an extension reload swaps
   * the service worker at once but leaves content scripts running in tabs
   * that are already open, so a feed left open for hours keeps judging on the
   * old build. Records from such a tab carry the OLD id beside records from
   * fresh tabs carrying the new one, and the export names the difference.
   *
   * Undefined on every record written before the field existed and in unbaked
   * test builds (omitted from the canonical payload, byte-identical hash);
   * inside the signature on every record that carries it, so a record cannot
   * be reattributed to a build that did not make it. MUST stay byte-synced
   * with verifier-core-source.ts.
   */
  buildId?: string;

  /**
   * WHERE this record's verdict was read from, when it was not read from the
   * item's own words. Sits beside the two provenance fields the record
   * already carries: `aiSource` says WHO produced the verdict (cloud, local,
   * rules, none) and `overrideOrigin` says WHICH deterministic gate set the
   * technique; this one says WHAT was read.
   *
   *   'room' — the item carried no text of its own (an empty or
   *            placeholder caption), so the first batch of comments under it
   *            was read and that verdict was applied to the item.
   *            PLAN-2026-09-14 standing decision 3; the read path is
   *            src/content/post-path/room-verdict.ts. The comments the verdict came
   *            from are in the chain in their own right, under this item's
   *            `parentVideoId`, and the room's aggregate is the
   *            `kind: 'environment'` record beside them.
   *
   * ABSENT on every other record, which is the ordinary case: the verdict was
   * read from the item's own text. Absent on every record written before the
   * field existed, and NEVER backfilled — a record that did not say where its
   * verdict came from is not made to say it afterwards. The canonical-payload
   * hasher omits undefined keys, so legacy records hash byte-identically
   * (pinned by tests/unit/forensics/canonical-payload-stability.test.ts). Inside the
   * signature on every record that carries it, so a room verdict cannot later
   * be repainted as a reading of the item's own words. MUST stay byte-synced
   * with verifier-core-source.ts.
   */
  verdictOrigin?: 'room';

  /**
   * Set only on the COPY that leaves the store (an export, a dashboard view)
   * when a signed redaction marker names this record: the fields listed were
   * removed from the copy. Never stored, never hashed (canonical-payload.ts
   * lists its fields by name), so the stored record and its signature are
   * untouched; the export's verifier accepts the blanked copy only when the
   * marker it names is in the same file and signed. See forensics/redaction.ts.
   */
  redacted?: { markerId: string; at: string; fields: string[] };

  /**
   * Honest evidence provenance: which deterministic override gate produced or
   * mutated this verdict's `technique`, or UNDEFINED when the verdict is the
   * LLM's own diagnosis. The override gate relabels `technique` (e.g. an
   * identity-slur regex match sets `technique:'shame-attack'`) to drive the flag
   * decision; without this field a recipient reading `aiSource:'cloud'` +
   * `technique:'shame-attack'` would wrongly believe the AI diagnosed it. With
   * it, the chain distinguishes "the AI judged this" from "a rule caught this"
   * — load-bearing for the record's evidentiary value. Optional +
   * undefined-omitted by canonical-payload → AI-origin and legacy records hash
   * byte-identically. MUST stay byte-synced with html-export.ts
   * VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE (enforced by the html-verifier-drift test).
   */
  overrideOrigin?: 'identity-slur' | 'profanity-tier' | 'coded-harm' | 'ad-hominem' | 'harm-floor' | 'rage-format';

  /**
   * Present (false) only when the verdict was a hide or collapse and the DOM
   * change could NOT be applied; in Child the provisional cover stays on the
   * post instead. Absent on every record whose visual landed, and on legacy
   * records, so those hash byte-identically (omit-when-undefined, same
   * contract as overrideOrigin). Without this the signed chain said "hidden"
   * for a post the child saw raw. MUST stay byte-synced with html-export.ts
   * VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  visualApplied?: false;

  /**
   * HISTORICAL. Video-context evidence derived from the video element's own
   * frames (crop-to-video privacy line). The pipeline that wrote it was
   * removed in 2.5.0; this stays so earlier records still read and verify.
   * Holds the
   * vision model's transcript of burned-in overlay text, a one-sentence
   * scene description, the content-type read, the technique signals it saw,
   * its 0-10 severity, and provenance (model id + how many keyframes were
   * sent). The frames themselves are NEVER stored — only this derived text.
   *
   * UNDEFINED on every record produced without video understanding (legacy
   * records, text posts, comments, installs with the toggle off) — omitted
   * from the canonical payload so those records hash byte-identically.
   * Inside the signed payload: mutating the captured transcript or severity
   * breaks the recomputed hash. MUST stay byte-synced with html-export.ts
   * VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE (enforced by
   * tests/unit/forensics/html-verifier-drift.test.ts).
   */
  videoContext?: {
    /* HISTORICAL: written only by versions before 2.5.0. See the note above. */
    overlayText: string;
    scene: string;
    contentType: string;
    techniques: string[];
    severity: number;
    model: string;
    frameCount: number;
    /**
     * Post caption/description from the DOM around the video element
     * (best-effort). What the POSTER wrote, distinct from the video-derived
     * fields. Omitted when none — legacy records hash byte-identically.
     */
    description?: string;
    /**
     * Speech-to-text transcript of the video's audio track (≤20s captured
     * while the video actually played). No build has written this since the
     * media path was removed; stored records still carry it and are read,
     * exported and verified with it.
     * Omitted when audio capture was unavailable or transcription failed —
     * absence means "not heard", never "nothing was said".
     */
    transcript?: string;
    /** Transcription model id (provenance), present iff transcript is. */
    audioModel?: string;
    /**
     * Whisper's auto-detected audio language, verbatim from the API
     * ('english', 'romanian', …). Present only when a transcript is.
     * Additive, omit-when-undefined: legacy records hash byte-identically;
     * new records carry it inside the signature (canonical-payload passes
     * the whole videoContext object through).
     */
    audioLanguage?: string;
  };

  /**
   * HISTORICAL. Still-image evidence for a post's photos (I1 image
   * understanding). The pipeline that wrote it was removed in 2.5.0; this
   * stays so earlier records still read and verify.
   * Same derived-text discipline as videoContext: what the vision model
   * READ off the post's image(s) — overlay-text transcription, scene
   * description, technique labels, model provenance. The pixels are NEVER
   * stored — only this derived text. Lives on the kind:'image' analysis
   * record that joins its post's dashboard group via parentVideoId.
   *
   * UNDEFINED on every record produced without image understanding
   * (legacy records, text/video records, installs with the toggle off) —
   * omitted from the canonical payload so those records hash
   * byte-identically. Inside the signed payload: mutating the captured
   * overlay text or severity breaks the recomputed hash. MUST stay
   * byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE
   * (enforced by tests/unit/forensics/html-verifier-drift.test.ts).
   */
  imageContext?: {
    /* HISTORICAL: written only by versions before 2.5.0. See the note above. */
    overlayText: string;
    scene: string;
    contentType: string;
    techniques: string[];
    severity: number;
    model: string;
    imageCount: number;
    /**
     * Post caption/description from the DOM (what the POSTER wrote,
     * distinct from the image-derived fields). Omitted when none.
     */
    description?: string;
  };

  /**
   * WHO posted the item, derived from live DOM signals (never guessed):
   *   'advertiser' — a sponsored / promoted post (`is_sponsored`, all platforms)
   *   'group'      — a Facebook group post (a `/groups/<gid>/user/` origin link)
   *   'page'       — a verified-org account (`platform_specific.isVerified`,
   *                  FB/IG/YT/TikTok; X "verified" is Blue/noisy → never 'page')
   *   'person'     — default when none of the above proves a type
   * Precedence advertiser → group → page → person. Honest coverage: a platform
   * that cannot prove a type does NOT emit one (field stays undefined).
   * Optional + undefined-omitted by canonical-payload → legacy records hash
   * byte-identically. MUST stay byte-synced with html-export.ts
   * VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE (enforced by the html-verifier-drift test).
   */
  accountType?: AccountType;

  /**
   * Named container the post lived in — the Facebook group's name when
   * `accountType === 'group'`. UNDEFINED on every other record (omitted from
   * the canonical payload so they hash byte-identically). Inside the signed
   * payload: mutating the captured group name breaks the recomputed hash. MUST
   * stay byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
   */
  sourceContainer?: string;

  /**
   * Impression / exposure order (see IMPRESSION_LAYER_V1.md). Captured locally
   * in the content script at the earliest pre-AI observation point
   * (`onPostDetected` → `stampImpressionOrder`), so the dashboard can show
   * "observed order" distinct from the chain's WRITE order (`chainPosition` /
   * `timestamp`, both stamped at record-write time, after queue + AI + media
   * latency reordered things).
   *
   *   observedSequence — monotonic 1-based counter within one surface session.
   *   viewportSeenAt    — ISO timestamp of that first local observation.
   *   surfaceSessionId  — id of one content-script load; scopes the counter.
   *
   * Honest claim: "FeelingWise locally observed this item entering view at this
   * order/time" — NEVER the platform's algorithmic serve order.
   *
   * All optional + undefined-omitted by canonical-payload → legacy records and
   * any record where capture didn't fire hash byte-identically. Inside the
   * signed payload: a mutated sequence breaks the recomputed hash. MUST stay
   * byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE
   * (enforced by tests/unit/forensics/html-verifier-drift.test.ts).
   */
  observedSequence?: number;
  viewportSeenAt?: string;
  surfaceSessionId?: string;

  /**
   * What the extension states about itself on this record: the build that wrote
   * and signed it, how it was installed, and what kind of evidence the entry is.
   * Written by the service worker through finalizeRecord (record-stamp.ts).
   * Absent on every record written before the group existed, and absent means
   * "not stated", never "store install". A writer sets it to undefined when it
   * has no sub-field, because an empty object hashes as `{}`.
   *
   * Nested on purpose: the canonical payload serialises the object whole, so a
   * sub-field added later never changes the canonical key list and a checker
   * that knows `stamp` never reads a later record as tampered. Sub-fields are
   * only ever appended. MUST stay byte-synced with verifier-core-source.ts.
   */
  stamp?: RecordStamp;

  /**
   * What the platform itself supplied for this item, kept so it can be checked
   * against the live platform later: its own ids and the hash of the raw
   * response the item was read from. Supplied by the content script; absent
   * means "not stated". Same nesting and append-only rule as `stamp`. MUST stay
   * byte-synced with verifier-core-source.ts.
   */
  provenance?: RecordProvenance;
}

/** Chrome's own word for how the extension was installed (chrome.management ExtensionInstallType). */
export type InstallType = 'normal' | 'development' | 'sideload' | 'admin' | 'other';

/**
 * How the entry came to be: read off the screen, off the platform's own
 * response, both, written by the extension about itself, or added by hand.
 */
type EvidenceKind = 'screen' | 'wire' | 'screen+wire' | 'marker' | 'manual';

export interface RecordStamp {
  /** The build id baked into the worker that wrote and signed the record (src/core/build-id.ts). */
  recorderBuildId?: string;
  installType?: InstallType;
  evidenceKind?: EvidenceKind;
}

interface RecordProvenance {
  /** The platform's own ids for the item, as the platform wrote them. */
  platformIds?: { post?: string; author?: string; ad?: string; parent?: string };
  /** SHA-256 hex and byte length of the whole raw response the item was read from. */
  raw?: { hash: string; length: number; endpoint?: string };
}

// `ForensicRecord` is the legacy internal name for a Local Observation Record:
// an on-device record of what FeelingWise observed on a supported public
// surface, plus its safety interpretation and integrity-chain fields. The name
// is part of the signed canonical payload; do not mass-rename it without a
// dedicated migration and hash-compatibility review. (An `ObservationRecord`
// alias existed until 2026-09-06 and was never imported.)

// The shape lives in src/types/text-capture.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { TextCapture } from './text-capture';
