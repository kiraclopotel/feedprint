// FeelingWise - the whole record read as an exported file's checker reads it.
//
// A restore puts back an older state, and the entries written after the backup stay in the
// month archive. The dashboard's own walk checks the live chain and each month apart, so each
// part is sound and the screen read healthy, while the whole-record export of the same record
// read partly verified (measured on the product walk: backup, two more entries, restore, reset,
// export). The two lines only show when the archive and the live chain are read as one list.
//
// So the checker's own walk runs here, from the generated copy of its core, over the list a
// whole-record export carries, and the words shown are the checker's own notes. A second
// implementation of the rule would drift from the checker; this cannot.

import type { ForensicRecord } from '../types/forensic';
import type { ResolvedUiLanguage } from '../types/ui-language';
import type { RecordLines, RecordVerifyStatus } from './chain-integrity';
import { I18N } from '../i18n/export-strings';
import { verifyChain, chainNotes } from './verifier-core.generated';
import { knownPublicKey } from './known-keys';
import { getPublicKeyFingerprint, getPublicKeyJWK, verifyHashUnderJwk } from './signing';

export type { RecordLines };

/**
 * The archived months oldest first, then the live chain, one copy per id with the archived copy
 * winning: the order and the rule exportEverythingHtml uses, because the checker's reading of a
 * fork depends on which line comes last.
 */
export function wholeRecordInExportOrder(
  current: readonly ForensicRecord[],
  archives: ReadonlyArray<{ records: readonly ForensicRecord[] }>,
): ForensicRecord[] {
  const seen = new Set<string>();
  const out: ForensicRecord[] = [];
  for (const r of [...archives.flatMap(a => a.records), ...current]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

// The checker reads a marker as opening a new run only when its signature verified. A record
// this walk did not verify, or has no verdict for, is passed as unverified, never as verified.
function checkerVerdict(status: RecordVerifyStatus | undefined): { ok: boolean; unverified?: boolean } {
  if (status === 'broken') return { ok: false };
  if (status === 'verified') return { ok: true };
  return { ok: true, unverified: true };
}

function isRunMarker(r: ForensicRecord): boolean {
  return (r.kind === 'month-rotation-marker' || r.kind === 'reset-marker') && r.chainPosition === 0;
}

/** Checks a record's signature under the key named by its fingerprint, when that key is one an export would carry. */
export type SignatureUnderCarriedKey = (r: ForensicRecord) => Promise<boolean>;

// An export carries this install's key and every earlier key it knows (known-keys.ts
// publicKeysForExport), and its checker verifies a record under whichever of them signed it. The
// dashboard's walk checks only the current key, so a marker signed under an earlier key reads
// 'prior-key' here and verified in the file. Only a run marker's verdict moves what the walk
// counts, so only those are checked again, under the same keys the file would carry.
const underCarriedKey: SignatureUnderCarriedKey = async (r) => {
  const fp = r.publicKeyFingerprint;
  if (!fp || typeof r.signature !== 'string' || r.signature === '') return false;
  const jwk = (await knownPublicKey(fp)) ?? (fp === (await getPublicKeyFingerprint()) ? await getPublicKeyJWK() : undefined);
  return jwk ? verifyHashUnderJwk(jwk, r.integrityHash, r.signature) : false;
};

export async function readRecordLines(
  current: readonly ForensicRecord[],
  archives: ReadonlyArray<{ records: readonly ForensicRecord[] }>,
  perRecord: ReadonlyMap<string, RecordVerifyStatus> | undefined,
  signatureUnderCarriedKey: SignatureUnderCarriedKey = underCarriedKey,
): Promise<RecordLines> {
  const records = wholeRecordInExportOrder(current, archives);
  const verdicts = await Promise.all(records.map(async (r) => {
    const verdict = checkerVerdict(perRecord?.get(r.id));
    if (!verdict.unverified || !isRunMarker(r)) return verdict;
    return (await signatureUnderCarriedKey(r).catch(() => false)) ? { ok: true } : verdict;
  }));
  const chain = await verifyChain(records, verdicts);
  return { setAside: chain.setAside, setAsideLines: chain.setAsideLines, branches: chain.branches };
}

/** True when the whole record holds a line it did not keep, which the checker reads as partly verified. */
export function recordLinesSplit(lines: RecordLines | undefined): boolean {
  return !!lines && (lines.setAside > 0 || lines.branches > 0);
}

/** The checker's own notes for these counts, in the language the export would be written in. */
export function recordLinesNotes(lines: RecordLines, lang: ResolvedUiLanguage): string[] {
  return chainNotes(
    { setAside: lines.setAside, setAsideLines: lines.setAsideLines, branches: lines.branches },
    I18N[lang],
    null,
    0,
  );
}
