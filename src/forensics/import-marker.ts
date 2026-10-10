// FeelingWise - the signed import marker (evidence-gap register item 15, 2026-09-06).
//
// The register asked for relegation to be an append rather than a mutable
// flag. In the tree as it stands nothing relegates an active record any more
// (the re-anchor that did was removed; markRelegated has no caller). The one
// writer of chainAnchor='pre-rekey' is the salvage import, which stamps
// records recovered from a picked file before they enter their own store,
// and nothing on the signed chain said that an import happened. This marker
// does: one signed record on the live chain per import pass, with the counts,
// the generations named, and a digest over the ids of exactly the records
// that entered, inside the hashed text. No canonical field changed, so
// existing records hash as before. A file name is not carried; it can name a
// person.
//
// What it proves and what it does not. It ties an import to a moment on the
// install's own chain and to a fixed set of records. It does not say the
// records are genuine; a fabricated file with its own fabricated key imports
// and the export labels that key as supplied with the records (item 12).

import type { ForensicRecord } from '../types/forensic';
import type { ImportMarkerInput } from '../types/import-marker';
import { sha256 } from './hasher';
import { finalizeRecord } from './record-stamp';
import { getPublicKeyFingerprint } from './signing';
import { addRecord, getChainState } from './store';
import { getSettingsForAttestation } from '../storage/settings';
import { sharedChainWriteLock } from './chain-write-lock';
import { levelOf } from '../types/mode';

const HEX64 = /^[0-9a-f]{64}$/;
const FINGERPRINT = /^[0-9a-f]{8,64}$/;

/** Shape check at the realm boundary: a dashboard message is input. */
export function isImportMarkerInput(x: unknown): x is ImportMarkerInput {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  const count = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v) && v >= 0;
  return count(m.imported) && count(m.alreadyPresent) && count(m.rejected)
    && (m.imported as number) > 0
    && Array.isArray(m.epochs) && m.epochs.every(e => typeof e === 'string' && FINGERPRINT.test(e))
    && typeof m.idsDigest === 'string' && HEX64.test(m.idsDigest);
}

/** The digest the dashboard computes and the marker carries. */
export function importIdsDigest(ids: ReadonlyArray<string>): Promise<string> {
  return sha256([...ids].sort().join('\n'));
}

/** The hashed line. */
export function importMarkerText(input: ImportMarkerInput, markerTimestamp: string, readFailed: boolean): string {
  return `[import-marker @ ${markerTimestamp}] imported=${input.imported} alreadyPresent=${input.alreadyPresent}`
    + ` rejected=${input.rejected} keys=${input.epochs.length ? [...input.epochs].sort().join(',') : 'none'}`
    + ` idsDigest=${input.idsDigest}`
    + (readFailed ? ' settings-read-failed' : '');
}

/** The reader's line, carried in resetReason like the other markers. */
export function importMarkerSummary(input: ImportMarkerInput): string {
  const keys = input.epochs.length === 1 ? '1 signing key' : `${input.epochs.length} signing keys`;
  return `import: ${input.imported} record${input.imported === 1 ? '' : 's'} recovered from a file entered the record under ${keys}; ${input.rejected} refused`;
}

/** Append one signed import marker to the LIVE chain, on the shared chain-write lock. */
export function appendImportMarker(input: ImportMarkerInput): Promise<void> {
  return sharedChainWriteLock(async () => {
    const { nextPosition, prevRecordHash } = await getChainState();
    const attestation = await getSettingsForAttestation();
    const markerTimestamp = new Date().toISOString();
    const text = importMarkerText(input, markerTimestamp, attestation.readFailed);
    const partial: Omit<ForensicRecord, 'integrityHash' | 'signature'> = {
      id: `fr-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: markerTimestamp,
      // Storage slot only, the prune marker's convention.
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
      detectionMode: 'import-marker',
      prevRecordHash,
      chainPosition: nextPosition,
      chainAnchor: 'import',
      verdict: 'pass',
      kind: 'import-marker',
      resetReason: importMarkerSummary(input),
      publicKeyFingerprint: await getPublicKeyFingerprint(),
    };
    await addRecord(await finalizeRecord(partial));
  });
}
