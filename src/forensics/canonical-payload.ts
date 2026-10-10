// FeelingWise — Canonical forensic payload hashing.
//
// Single source of truth for "given a ForensicRecord, what bytes do we hash
// to produce its integrityHash?". Imported by:
//   • logger.ts            — computes hash at write time before signing
//   • chain-integrity.ts   — recomputes hash for whole-chain walk
//
// Earlier each of those files held its own copy of the canonicalization
// logic and they had to be kept in sync manually. This module extracts
// the payload contract so adding a new ForensicRecord field requires
// editing one place, not three.
//
// The payload includes the chain fields (`prevRecordHash`,
// `chainPosition`) so the ECDSA signature on integrityHash transitively
// covers the chain link — an attacker can't swap a record's
// prevRecordHash without breaking the signature. That's what makes the
// chain tamper-evident.

import type { ForensicRecord } from '../types/forensic';
import type { RecordSubject, SubjectKind, UnhashedSubjectRecord } from '../types/record-subject';
import { sha256 } from './hasher';

/** On the record, outside the hash: the hash itself, what signs it, and the advisory anchor label. */
type OutsideThePayload = 'integrityHash' | 'signature' | 'chainAnchor';

/**
 * What the hash reads: every canonical key, each optional, because a key that is absent is left out
 * of the bytes. Both a feed record and a subject record (src/types/record-subject.ts) are read through
 * it, so a subject record hashes only the keys it carries and never a stand-in feed value.
 */
type CanonicalView = Partial<Omit<ForensicRecord, OutsideThePayload | 'kind'>> & {
  kind?: ForensicRecord['kind'] | SubjectKind;
  subject?: RecordSubject;
};

/**
 * Compute the canonical SHA-256 hash over a ForensicRecord's content.
 *
 * Inputs that are part of the hash (changing any one breaks the signature):
 *   • All identity / content fields (id, timestamps, text, hashes)
 *   • All detection metadata (techniques, scores, mode, source, AI provider)
 *   • Chain link fields (prevRecordHash, chainPosition) — SKELETON 3a
 *   • Verdict + skipReason — but ONLY when defined; see below
 *
 * Inputs that are NOT in the hash (would create a circular self-reference):
 *   • integrityHash itself
 *   • signature (signature is OVER the integrityHash)
 *   • chainAnchor (advisory marker only — its presence/absence on legacy vs
 *     genesis records doesn't affect the hash)
 *
 * `publicKeyFingerprint` is part of the canonical hash. The field is
 * STAMPED on the record at write time, and an attacker with IDB write
 * access could otherwise mutate ONLY the fingerprint without breaking
 * integrityHash → signature → recomputed-hash verification. With it
 * inside the canonical bytes, any mutation breaks the recomputed
 * hash. Back-compat: legacy records with
 * `publicKeyFingerprint === undefined` hash byte-identically
 * (JSON.stringify omits undefined keys).
 *
 * Field order matters for hash stability. JSON.stringify with explicit key
 * order locks the output bytes. Adding a new field: append to the bottom of
 * the object literal AND ship a schema version bump in the same commit so
 * existing records don't suddenly fail verification.
 *
 * **Backwards-compatibility trick.** The `verdict` and `skipReason`
 * fields live at the bottom of the payload object and pass through as
 * `record.verdict` (no `??` coalesce). When a legacy record has
 * `verdict === undefined`, JSON.stringify omits the key entirely — the
 * resulting payload string is BYTE-IDENTICAL to a legacy record's
 * payload, so its integrityHash is unchanged and the chain-integrity
 * walk still passes. New records (verdict !== undefined) include the
 * keys and produce a different (correct) hash. This avoids needing a
 * migration that would invalidate every existing signature.
 */
export async function computeRecordIntegrityHash(
  input: Omit<ForensicRecord, OutsideThePayload> | UnhashedSubjectRecord,
): Promise<string> {
  const record: CanonicalView = input;
  const payload = JSON.stringify({
    id: record.id,
    timestamp: record.timestamp,
    platform: record.platform,
    originalText: record.originalText,
    originalHash: record.originalHash,
    originalLength: record.originalLength,
    neutralizedText: record.neutralizedText,
    author: record.author,
    postUrl: record.postUrl,
    techniques: record.techniques,
    overallScore: record.overallScore,
    userAgeCategory: record.userAgeCategory,
    aiSource: record.aiSource,
    feedSource: record.feedSource,
    aiModel: record.aiModel ?? '',
    aiProvider: record.aiProvider ?? '',
    detectionMode: record.detectionMode ?? '',
    configSnapshot: record.configSnapshot ?? null,
    // SKELETON 3a chain link — empty string + -1 sentinel for pre-chain
    // legacy records (kept in the hash so the contract is stable across
    // legacy and chain-era records).
    prevRecordHash: record.prevRecordHash ?? '',
    chainPosition: record.chainPosition ?? -1,
    // Verdict + skipReason. NO coalesce: undefined values are omitted
    // by JSON.stringify, preserving byte-identical hashes for legacy
    // records. Tamper protection still applies: anyone who ADDS
    // verdict to a legacy record changes its payload bytes and breaks
    // the recomputed hash, just as with any other field.
    verdict: record.verdict,
    skipReason: record.skipReason,
    // kind + parentVideoId. Same back-compat trick: undefined keys
    // are omitted by JSON.stringify so legacy records hash to the
    // same bytes. Setting either field on a new record changes the
    // hash — they're part of the tamper-evident payload.
    kind: record.kind,
    parentVideoId: record.parentVideoId,
    // Environment payload (kind='environment' records only). Same
    // omit-when-undefined back-compat. The whole struct is part of
    // the hash so any aggregate / metric tampering is visible.
    environment: record.environment,
    // Reset Marker fields. Part of the hash so any tampering with the
    // priorChainHash claim or the resetReason text breaks recomputed-
    // hash verification. Same back-compat omit-undefined semantics:
    // every record kind other than 'reset-marker' has these fields
    // undefined and they're omitted from JSON.stringify.
    priorChainHash: record.priorChainHash,
    resetReason: record.resetReason,
    // publicKeyFingerprint is part of the hash. Back-compat trick:
    // legacy records with `publicKeyFingerprint === undefined` omit
    // the key from JSON.stringify and hash byte-identically. New
    // records carry the fingerprint and any mutation breaks the
    // recomputed hash. The fingerprint is computed from the install's
    // public-key JWK coordinates and is stable across all records
    // signed by the same install.
    publicKeyFingerprint: record.publicKeyFingerprint,
    // topic + sourceCategory. Same back-compat trick: undefined keys
    // are omitted by JSON.stringify.
    topic: record.topic,
    sourceCategory: record.sourceCategory,
    // Tree-relationship fields. parentRecordId + commentDepth express
    // the tree edges; roomAuthor / roomCaption / roomUrl denormalize
    // room context on every comment for self-contained records (per
    // VISION §1.1 §7.2). All optional + undefined-omitted by
    // JSON.stringify — legacy records hash byte-identically (chain
    // integrity preserved).
    parentRecordId: record.parentRecordId,
    commentDepth: record.commentDepth,
    roomAuthor: record.roomAuthor,
    roomCaption: record.roomCaption,
    roomUrl: record.roomUrl,
    // harmFloor pre-filter signal. Pre-2026-05-24 this field was stamped
    // on records by logForensicEvent/logPassEvent but was NOT in the
    // canonical payload — the ECDSA signature did NOT cover it, so an
    // attacker with IDB write access could mutate per-comment slur-match
    // evidence (identity-slur flag, top category, score, evidence
    // snippet) without breaking the recomputed-hash → signature verify.
    // Closed 2026-05-24 (audit BLOCKER-1). Back-compat trick: legacy
    // records with `harmFloor === undefined` omit the key from
    // JSON.stringify and hash byte-identically. New records produce a
    // new (correct, covered) hash; pre-2026-05-24 records remain
    // verifiable because they never carried the field.
    harmFloor: record.harmFloor,
    // failureKind + cap. Same architecture gap as harmFloor: stamped on
    // cancelled-* / skipped records by logCancelEvent but outside the
    // signature pre-2026-05-24. An attacker could repaint failure
    // attribution (e.g. `auth-refusal` → `network`) to hide a tier
    // mismatch without breaking signatures. Closed 2026-05-24 (audit
    // HIGH-1). Same omit-when-undefined back-compat semantics.
    failureKind: record.failureKind,
    cap: record.cap,
    // Per-item engagement metrics. Same omit-when-undefined back-compat:
    // legacy + metric-less records have metrics === undefined → JSON.stringify
    // omits the key → byte-identical hash. New records with metrics produce a
    // new (correct, signature-covered) hash. Tamper-evident: mutating a
    // captured like / view / share count breaks the recomputed hash. MUST stay
    // byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE
    // (enforced by tests/unit/forensics/html-verifier-drift.test.ts).
    metrics: record.metrics,
    // Per-comment deep-link (the address that lands on this exact comment,
    // not just its post). Same omit-when-undefined back-compat: legacy
    // records, post/video records, and any platform without a stable
    // per-comment URL have anchorUrl === undefined → JSON.stringify omits the
    // key → byte-identical hash. New comment records with an anchor produce a
    // new (signature-covered) hash. Tamper-evident: mutating the captured
    // comment address breaks the recomputed hash. MUST stay byte-synced with
    // html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE (enforced by
    // tests/unit/forensics/html-verifier-drift.test.ts).
    anchorUrl: record.anchorUrl,
    // Honest override provenance (which deterministic gate set the technique,
    // or undefined for AI-origin verdicts). Same omit-when-undefined back-compat:
    // AI-origin + legacy records hash byte-identically; an override record
    // carries it inside the signature so the provenance can't be repainted.
    // MUST stay byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    overrideOrigin: record.overrideOrigin,
    // Hide/collapse verdict whose DOM change did not apply (false) — omitted
    // on every record whose visual landed, so legacy and normal records hash
    // byte-identically. Inside the signature so the record cannot later be
    // repainted as "hidden". MUST stay byte-synced with html-export.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    visualApplied: record.visualApplied,
    // Video-context evidence (overlay-text transcript + scene + vision-model
    // provenance). Same omit-when-undefined back-compat: legacy / context-less
    // records hash byte-identically. Inside the signature: mutating the
    // captured transcript or severity breaks the recomputed hash. MUST stay
    // byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    videoContext: record.videoContext,
    // Source labels: WHO posted the item (accountType) + the named container it
    // lived in (sourceContainer, the FB group name). Derived from live DOM
    // signals (src/content/record/account-type.ts). Same omit-when-undefined back-compat:
    // legacy + person records (no provable type) hash byte-identically. Inside
    // the signature: repainting an ad as organic, or swapping the group name,
    // breaks the recomputed hash. MUST stay byte-synced with html-export.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE (enforced by tests/unit/forensics/html-verifier-drift.test.ts).
    accountType: record.accountType,
    sourceContainer: record.sourceContainer,
    // Impression / exposure order — local observed order captured pre-AI in the
    // content script (see IMPRESSION_LAYER_V1.md). Same omit-when-undefined
    // back-compat: legacy records + records where capture didn't fire hash
    // byte-identically. Inside the signature: a mutated sequence/timestamp
    // breaks the recomputed hash. MUST stay byte-synced with html-export.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE (enforced by tests/unit/forensics/html-verifier-drift.test.ts).
    observedSequence: record.observedSequence,
    viewportSeenAt: record.viewportSeenAt,
    surfaceSessionId: record.surfaceSessionId,
    // Image-context evidence (overlay-text transcription + scene + vision-model
    // provenance for a post's still images). Same omit-when-undefined
    // back-compat: legacy / image-less records hash byte-identically. Inside
    // the signature: mutating the captured overlay text or severity breaks
    // the recomputed hash. MUST stay byte-synced with html-export.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE (enforced by
    // tests/unit/forensics/html-verifier-drift.test.ts).
    imageContext: record.imageContext,
    // The origin of the page the item was seen on, captured once at content
    // script load. Appended at the bottom under the omit-when-undefined
    // contract: every record written before 2026-09-04 has it undefined, so
    // JSON.stringify drops the key and the payload bytes are unchanged. The
    // pin for that is tests/unit/forensics/canonical-payload-stability.test.ts, which
    // holds the hash of a fixed legacy record computed before the field
    // existed. Inside the signature: repainting which site a record came from
    // breaks the recomputed hash. MUST stay byte-synced with html-export.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    surfaceOrigin: record.surfaceOrigin,
    // What the page carried against what the screen showed ('whole', 'folded',
    // 'cut'; src/content/record/text-fold.ts). Appended under the same contract: every
    // record written before 2026-09-05 has it undefined, JSON.stringify drops
    // the key and the bytes are unchanged (the stability pin covers it). Inside
    // the signature so a fragment cannot later be repainted as the whole item.
    // MUST stay byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    textCapture: record.textCapture,
    // The media addresses the page carried, as read (register item 14,
    // 2026-09-06). Same contract: absent before that date, JSON.stringify
    // drops the key, the stability pin covers it. Inside the signature so an
    // address cannot be swapped after the fact. MUST stay byte-synced with
    // html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    mediaUrls: record.mediaUrls,
    // Why the product acted (the decision block) and the declared reader
    // profile (Stage 2 of the 2026-09-07 plan; docs/design/
    // DECISION-BLOCK-2026-09-07.md). Same contract: absent on every record
    // written before the fields existed, JSON.stringify drops the keys, the
    // stability pin covers it. Inside the signature so the row that fired, the
    // action applied and the reader cannot be repainted after the fact. MUST
    // stay byte-synced with html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    decision: record.decision,
    reader: record.reader,
    // Which build of the content script judged this item (src/core/build-id.ts).
    // Same append-only contract: absent on every record written before the
    // field existed, JSON.stringify drops the key, the stability pin covers
    // it. Inside the signature so a record cannot be reattributed to a build
    // that did not make it. MUST stay byte-synced with html-export.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    buildId: record.buildId,
    // Where the verdict was read from, when it was not read from the item's
    // own words ('room': the comments under a text-less post, PLAN-2026-09-14
    // standing decision 3). Same append-only contract: absent on every record
    // written before the field existed and on every record judged on its own
    // text, JSON.stringify drops the key, the stability pin covers it. Inside
    // the signature so a room verdict cannot be repainted as a reading of the
    // item itself. MUST stay byte-synced with html-export.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    verdictOrigin: record.verdictOrigin,
    // How the author was arrived at ('withheld': the recorder saw one and
    // refused it because it could not show the header and the body belonged to
    // the same item; src/types/author-capture.ts). Same append-only contract:
    // absent on every record written before 2026-09-17 and on every record
    // whose author is the one the page showed, JSON.stringify drops the key,
    // the stability pin covers it. Inside the signature so a row cannot later
    // be repainted as having carried an author. MUST stay byte-synced with
    // html-export.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    authorCapture: record.authorCapture,
    // The display name beside the handle, when the adapter read it
    // separately (src/types/post.ts PostContent.authorName). Same
    // omit-when-undefined back-compat: legacy records and every adapter
    // that reads only one string for author hash byte-identically. Inside
    // the signature: repainting the name breaks the recomputed hash. MUST
    // stay byte-synced with verifier-core-source.ts
    // VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE.
    authorName: record.authorName,
    stamp: record.stamp,
    provenance: record.provenance,
    // What a record is about when it is not a feed item: a document seen at an address, a consent
    // string, a note the person typed (src/types/record-subject.ts; `kind` says which). One key,
    // hashed whole, like `stamp`: its sub-fields grow inside it and the key list never grows for it
    // again. Absent on every feed record and marker, so they hash byte-identically (the stability pin
    // covers it). A build that writes it must not reach a person before the published checker knows
    // it (verifier/FORMAT.md, "A checker older than the file"). MUST stay byte-synced with
    // verifier-core-source.ts VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE. A null is dropped like an absent
    // key, here and in the checker: written as "subject":null it would change the hash of a record
    // that carries no subject, and nothing but the types forbids a null at run time.
    subject: record.subject ?? undefined,
  });
  return sha256(payload);
}

