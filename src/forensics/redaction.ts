// FeelingWise - redaction: withholding one record's content without a hole
// (evidence-gap register item 20, part 1, 2026-09-06, on the owner's yes).
//
// The record is immutable and signed, and the chain links records by hash, so
// an erasure request from the recorded third party could only be honoured by
// destroying the whole chain. This does it as an append: a signed
// redaction-marker names the record's id and integrityHash and the fields
// withheld. The stored record is not touched; every export and every
// dashboard view blanks those fields on its copy and carries the marker, so
// the record's place in the chain, its hash and its signature stay
// verifiable while its content does not leave the device. The export's
// verifier accepts a blanked record only when a signed marker in the same
// file names its id and hash; a blanked record with no marker fails.
//
// What this is and is not. It withholds content from what leaves; the bytes
// stay in the store on the parent's device, inside the household exemption,
// and in the parent's own backups. It is not deletion. The parent's reason is
// carried in the hashed text, capped, and is the parent's choice of words.

import type { ForensicRecord } from '../types/forensic';
import type { RedactionMarkerInput } from '../types/redaction-marker';
import { sha256 } from './hasher';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { addRecord, getChainState } from './store';
import { getSettingsForAttestation } from '../storage/settings';
import { sharedChainWriteLock } from './chain-write-lock';
import { levelOf } from '../types/mode';

/** The fields a redaction withholds. Fixed for now: what names or quotes the person. */
export const REDACTED_FIELDS: ReadonlyArray<string> = [
  'originalText', 'neutralizedText', 'author', 'authorName', 'postUrl', 'anchorUrl',
  'roomAuthor', 'roomCaption', 'roomUrl', 'mediaUrls', 'imageContext', 'videoContext',
  // THE TWO THAT QUOTE THE WITHHELD TEXT BACK.
  //
  // Redaction promised to remove "what names or quotes the person" and removed
  // eleven top-level fields, while two others on the same record went on
  // quoting it verbatim. In the 2026-09-08 export, harmFloor.topEvidence held
  // "1 profanity tokens (fucking)" and "1 ideology stems (nazi)", and
  // techniques[].why held "nigga" and "dumbass; fuck" — the exact words a
  // person redacting a post is most likely to be removing. The export renders
  // a technique's reason on the card, so a redacted record could show the slur
  // it was redacted to hide.
  //
  // 'harmFloor' is a whole field and goes. 'techniqueWhy' is a rule, not a
  // field name: it drops `why` from every technique and keeps name, severity
  // and confidence, because a recipient still needs to see WHAT was found —
  // taking the whole techniques array would destroy the finding along with the
  // quote.
  'harmFloor', 'techniqueWhy',
];

/** The redaction token that is a rule over nested values rather than a key. */
const TECHNIQUE_WHY = 'techniqueWhy';

const REDACTION_REASON_MAX = 200;
const HEX64 = /^[0-9a-f]{64}$/;

/** Shape check at the realm boundary: a dashboard message is input. */
export function isRedactionMarkerInput(x: unknown): x is RedactionMarkerInput {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return typeof m.recordId === 'string' && m.recordId.length > 0 && m.recordId.length <= 200
    && typeof m.recordHash === 'string' && HEX64.test(m.recordHash)
    && Array.isArray(m.fields) && m.fields.length > 0 && m.fields.every(f => typeof f === 'string' && REDACTED_FIELDS.includes(f))
    && typeof m.reason === 'string' && m.reason.length <= REDACTION_REASON_MAX;
}

/** The hashed line. Byte-synced with the parser in VERIFIER_CORE_FNS_SOURCE (redactionOf). */
export function redactionMarkerText(input: RedactionMarkerInput, markerTimestamp: string, readFailed: boolean): string {
  const reason = input.reason.replace(/[\r\n]+/g, ' ').trim();
  return `[redaction-marker @ ${markerTimestamp}] record=${input.recordId} recordHash=${input.recordHash}`
    + ` fields=${[...input.fields].sort().join(',')}`
    + (reason ? ` reason=${reason}` : '')
    + (readFailed ? ' settings-read-failed' : '');
}

/** The reader's line, carried in resetReason like the other markers. */
export function redactionMarkerSummary(input: RedactionMarkerInput): string {
  return `withheld at the parent's request: record ${input.recordId}, ${input.fields.length} field${input.fields.length === 1 ? '' : 's'}`;
}

/** Append one signed redaction marker to the LIVE chain, on the shared chain-write lock. */
export function appendRedactionMarker(input: RedactionMarkerInput): Promise<void> {
  return sharedChainWriteLock(async () => {
    const { nextPosition, prevRecordHash } = await getChainState();
    const attestation = await getSettingsForAttestation();
    const markerTimestamp = new Date().toISOString();
    const text = redactionMarkerText(input, markerTimestamp, attestation.readFailed);
    const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
      id: `fr-redaction-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: markerTimestamp,
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
      detectionMode: 'redaction-marker',
      prevRecordHash,
      chainPosition: nextPosition,
      chainAnchor: 'redaction',
      verdict: 'pass',
      kind: 'redaction-marker',
      resetReason: redactionMarkerSummary(input),
      publicKeyFingerprint: await getPublicKeyFingerprint(),
    };
    await addRecord(await finalizeRecord(partial));
  });
}

export interface Redaction { markerId: string; at: string; recordId: string; recordHash: string; fields: string[] }

/** Read a marker's hashed line back. Null for anything that is not a redaction marker. */
export function redactionOf(marker: Pick<ForensicRecord, 'id' | 'kind' | 'originalText' | 'timestamp'>): Redaction | null {
  if (marker.kind !== 'redaction-marker') return null;
  const m = /\brecord=(\S+) recordHash=([0-9a-f]{64}) fields=(\S+)/.exec(marker.originalText ?? '');
  if (!m) return null;
  return { markerId: marker.id, at: marker.timestamp, recordId: m[1], recordHash: m[2], fields: m[3].split(',') };
}

/** Every redaction the chain carries, newest marker per record id. */
export function collectRedactions(records: ReadonlyArray<ForensicRecord>): Map<string, Redaction> {
  const out = new Map<string, Redaction>();
  for (const r of records) {
    const red = redactionOf(r);
    if (red) out.set(red.recordId, red);
  }
  return out;
}

/**
 * The copy that leaves. Every record named by a marker whose recordHash
 * matches has the withheld fields removed and carries `redacted`; the markers
 * that apply are appended when the list did not already hold them, so a
 * filtered export still carries the attestation. Records not named pass
 * through untouched (same object).
 */
export function applyRedactions(
  records: ReadonlyArray<ForensicRecord>,
  markerSource: ReadonlyArray<ForensicRecord> = records,
): ForensicRecord[] {
  const redactions = collectRedactions(markerSource);
  if (redactions.size === 0) return [...records];
  const present = new Set(records.map(r => r.id));
  const out: ForensicRecord[] = [];
  const used = new Set<string>();
  for (const r of records) {
    const red = redactions.get(r.id);
    if (!red || red.recordHash !== r.integrityHash) { out.push(r); continue; }
    const copy: Record<string, unknown> = { ...r };
    for (const f of red.fields) {
      if (f === TECHNIQUE_WHY) {
        // Keep the finding, drop the quote.
        const techniques = Array.isArray(copy.techniques) ? copy.techniques : [];
        copy.techniques = techniques.map((t) => {
          if (!t || typeof t !== 'object') return t;
          const { why: _why, ...rest } = t as Record<string, unknown>;
          return rest;
        });
        continue;
      }
      delete copy[f];
    }
    copy.redacted = { markerId: red.markerId, at: red.at, fields: [...red.fields] };
    out.push(copy as unknown as ForensicRecord);
    used.add(red.markerId);
  }
  for (const markerId of used) {
    if (present.has(markerId)) continue;
    const marker = markerSource.find(r => r.id === markerId);
    if (marker) out.push(marker);
  }
  return out;
}
