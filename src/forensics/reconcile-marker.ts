// FeelingWise - the signed reconciliation marker (evidence-gap register item
// 10, 2026-09-06). The ninth and last marker kind for this register.
//
// reconcile.ts does the join in the dashboard realm and keeps nothing. This
// puts the fact that the join happened on the chain, under the install's own
// signature: which platforms' archives were read, the window they cover, the
// tolerance the join allowed, and the counts. The reading of the archive is
// identified by a digest, so a later reader can check that the same reading
// was used without the file being kept anywhere.
//
// What it proves and what it does not. It ties a comparison to a moment on the
// chain and to one fixed reading of one set of files. It does not prove the
// archive is genuine - a parent could hand it a file they wrote - and the
// digest does not help there: it is taken over the decoded text of whichever
// files the picker handed over, in that order, so nobody starting from the
// platform's own archive computes it, and a second request to the platform
// returns a different file anyway. What the digest is good for is repetition:
// the same person can re-open the same files and reach the same value, so a
// comparison can be shown to have been run over the same input. The export
// said the opposite in four languages until 2026-09-18.
//
// It is not a completeness proof either: Meta's own list is partial and its
// retention short, so the corroborated count is a floor and the summary says
// so in those words.
//
// The details ride inside originalText, which the canonical payload hashes, so
// the signature covers them without touching the canonical field list: no
// record written before this kind existed hashes any differently
// (tests/unit/forensics/canonical-payload-stability.test.ts is the pin).
//
// The same reasoning governs the four fields added on 2026-09-18. They are
// optional in the input and appended to the hashed line only when present, in
// a fixed order after the five original counts and before the settings flag,
// so a line built from an input that lacks them is the byte string it always
// was. An already written marker is never touched, and re-hashing one from its
// stored text reaches the hash it was signed with. The reader's summary is
// extended by the same rule: the old sentence, with a clause appended only
// when the new fields are there.

import type { ForensicRecord } from '../types/forensic';
import type { ReconcileMarkerInput } from '../types/reconcile-marker';
import { sha256 } from './hasher';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { addRecord, getChainState } from './store';
import { getSettingsForAttestation } from '../storage/settings';
import { sharedChainWriteLock } from './chain-write-lock';
import { levelOf } from '../types/mode';

const HEX64 = /^[0-9a-f]{64}$/;
const PLATFORMS: ReadonlySet<string> = new Set(['twitter', 'instagram', 'tiktok', 'facebook', 'youtube']);

/** Shape check at the realm boundary: a dashboard message is input. */
export function isReconcileMarkerInput(x: unknown): x is ReconcileMarkerInput {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  const count = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  // A field added on 2026-09-18 is absent on an old dashboard and checked like
  // any other count or instant when it is there; absent is allowed, wrong is not.
  const optionalCount = (v: unknown): boolean => v === undefined || count(v);
  const optionalInstant = (v: unknown): boolean => v === undefined || (typeof v === 'string' && Number.isFinite(Date.parse(v)));
  return typeof m.archiveDigest === 'string' && HEX64.test(m.archiveDigest)
    && Array.isArray(m.platforms) && m.platforms.length > 0 && m.platforms.every(p => typeof p === 'string' && PLATFORMS.has(p))
    && typeof m.fromISO === 'string' && Number.isFinite(Date.parse(m.fromISO))
    && typeof m.toISO === 'string' && Number.isFinite(Date.parse(m.toISO))
    && typeof m.windowMinutes === 'number' && Number.isFinite(m.windowMinutes) && m.windowMinutes >= 0 && m.windowMinutes <= 24 * 60
    && count(m.corroboratedByUrl) && count(m.corroboratedByAuthorAndTime)
    && count(m.unmatchedRecords) && count(m.unmatchedArchiveItems) && count(m.recordsOutsideWindow)
    && optionalCount(m.archiveItemsOutsideCoverage) && optionalCount(m.systemMarkersExcluded)
    && optionalInstant(m.comparedFromISO) && optionalInstant(m.comparedToISO);
}

/** The hashed line. Exported so the export renderer and tests read one format. */
export function reconcileMarkerText(input: ReconcileMarkerInput, markerTimestamp: string, readFailed: boolean): string {
  return `[reconcile-marker @ ${markerTimestamp}] archive=${input.archiveDigest}`
    + ` platforms=${[...input.platforms].sort().join(',')}`
    + ` from=${input.fromISO} to=${input.toISO} windowMinutes=${input.windowMinutes}`
    + ` corroboratedByUrl=${input.corroboratedByUrl}`
    + ` corroboratedByAuthorAndTime=${input.corroboratedByAuthorAndTime}`
    + ` unmatchedRecords=${input.unmatchedRecords}`
    + ` unmatchedArchiveItems=${input.unmatchedArchiveItems}`
    + ` recordsOutsideWindow=${input.recordsOutsideWindow}`
    // Appended, never interleaved, and only when present: a line from an input
    // without these is the byte string it was before 2026-09-18, so every
    // marker already on a chain still hashes to what it was signed with. The
    // export's reader takes each field by name and ignores what it does not
    // know, so an older reader is not broken by a newer line either.
    + (input.systemMarkersExcluded === undefined ? '' : ` systemMarkersExcluded=${input.systemMarkersExcluded}`)
    + (input.archiveItemsOutsideCoverage === undefined ? '' : ` archiveItemsOutsideCoverage=${input.archiveItemsOutsideCoverage}`)
    + (input.comparedFromISO === undefined ? '' : ` comparedFrom=${input.comparedFromISO}`)
    + (input.comparedToISO === undefined ? '' : ` comparedTo=${input.comparedToISO}`)
    + (readFailed ? ' settings-read-failed' : '');
}

/**
 * The reader's line, carried in resetReason like the other markers.
 *
 * The three sentences added on 2026-09-18 say what the first three count and
 * what they do not, and each appears only when the marker carries the field it
 * reads, so a marker written before that date produces the sentence it always
 * produced.
 */
export function reconcileMarkerSummary(input: ReconcileMarkerInput): string {
  const corroborated = input.corroboratedByUrl + input.corroboratedByAuthorAndTime;
  const platforms = [...input.platforms].sort().join(', ');
  const extra: string[] = [];
  if (input.comparedFromISO && input.comparedToISO) {
    extra.push(`The counts run over ${input.comparedFromISO.slice(0, 10)} to ${input.comparedToISO.slice(0, 10)},`
      + ` the part of that period the recorder was also running.`);
  }
  if (input.systemMarkersExcluded !== undefined) {
    const n = input.systemMarkersExcluded;
    extra.push(`They are over what was seen and not over the chain's own housekeeping:`
      + ` ${n} marker${n === 1 ? '' : 's'} of that kind ${n === 1 ? 'was' : 'were'} left out, because none of them names anything the platform could confirm.`);
  }
  if (input.archiveItemsOutsideCoverage !== undefined) {
    const n = input.archiveItemsOutsideCoverage;
    extra.push(`A further ${n} thing${n === 1 ? '' : 's'} the export lists ${n === 1 ? 'falls' : 'fall'} outside the period this recorder covers at all,`
      + ` and ${n === 1 ? 'is' : 'are'} counted here rather than as something it failed to record.`);
  }
  return `reconciled against the platform's own export (${platforms}, ${input.fromISO.slice(0, 10)} to ${input.toISO.slice(0, 10)}):`
    + ` ${corroborated} record${corroborated === 1 ? '' : 's'} supported by it, ${input.unmatchedRecords} not mentioned in it,`
    + ` ${input.unmatchedArchiveItems} thing${input.unmatchedArchiveItems === 1 ? '' : 's'} it lists that the recorder has no record of.`
    + ` The supported count is a floor: these exports are partial by the platform's own account.`
    + (extra.length > 0 ? ` ${extra.join(' ')}` : '');
}

/** Append one signed reconciliation marker to the LIVE chain, on the shared chain-write lock. */
export function appendReconcileMarker(input: ReconcileMarkerInput): Promise<void> {
  return sharedChainWriteLock(async () => {
    const { nextPosition, prevRecordHash } = await getChainState();
    const attestation = await getSettingsForAttestation();
    const markerTimestamp = new Date().toISOString();
    const text = reconcileMarkerText(input, markerTimestamp, attestation.readFailed);
    const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
      id: `fr-reconcile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: markerTimestamp,
      // Storage slot only; the platforms are named in the hashed text (the
      // prune, gap and heartbeat markers' convention).
      platform: 'twitter',
      originalText: text,
      originalHash: await sha256(text),
      originalLength: text.length,
      neutralizedText: '',
      author: '',
      postUrl: '',
      techniques: [],
      overallScore: 0,
      userAgeCategory: levelOf(attestation.mode),
      aiSource: 'none',
      feedSource: 'unknown',
      detectionMode: 'reconcile-marker',
      prevRecordHash,
      chainPosition: nextPosition,
      chainAnchor: 'reconcile',
      verdict: 'pass',
      kind: 'reconcile-marker',
      resetReason: reconcileMarkerSummary(input),
      publicKeyFingerprint: await getPublicKeyFingerprint(),
    };
    await addRecord(await finalizeRecord(partial));
  });
}
