// FeelingWise — public keys of earlier generations, kept so an export can
// verify their signatures.
//
// A record names its signing key by fingerprint and carries no key. Until
// 2026-09-03 an export embedded only the install's current key, so every
// record recovered from an earlier generation ("recover from an older
// export") verified by hash alone: the owner's consolidated file read
// "112,836 record signature(s) could not be verified" although 20 of its 58
// keys sat in the very files he had imported. Every HTML export and every
// epoch file scripts/salvage-extract.ts writes carries the public key of its
// generation; the picker remembers those keys here, and the exporter embeds
// every remembered key whose records are in the file, so the recipient's
// verifier checks each record under the key that signed it. A key that was
// never exported before its install was replaced cannot be recovered; those
// records stay hash-only and the export says so.
//
// The fingerprint is always derived from the key, never read from the file:
// a file that names one fingerprint and carries another key is not believed.

import type { ForensicRecord } from '../types/forensic';
import type { EmbeddedPublicKey } from './html-export';
import { fingerprintPublicJwk } from './signing';

const STORAGE_KEY = 'fwKnownPublicKeys';

function isP256PublicJwk(v: unknown): v is JsonWebKey & { x: string; y: string } {
  if (!v || typeof v !== 'object') return false;
  const j = v as Record<string, unknown>;
  return j.kty === 'EC' && j.crv === 'P-256' && typeof j.x === 'string' && typeof j.y === 'string'
    && j.x.length > 0 && j.y.length > 0;
}

async function readAll(): Promise<Record<string, JsonWebKey>> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const v = stored[STORAGE_KEY];
  return v && typeof v === 'object' ? (v as Record<string, JsonWebKey>) : {};
}

/** The remembered public key with this fingerprint, if any. */
export async function knownPublicKey(fingerprint: string): Promise<JsonWebKey | undefined> {
  const all = await readAll();
  return all[fingerprint];
}

/**
 * Remember every P-256 public key among `candidates` (anything else is
 * ignored). Returns how many of them are held afterwards, new or already
 * known, so the picker can say "signing key kept" for a file that carried one.
 */
export async function rememberPublicKeys(candidates: ReadonlyArray<unknown>): Promise<number> {
  const valid = candidates.filter(isP256PublicJwk);
  if (valid.length === 0) return 0;
  const all = await readAll();
  let added = 0;
  const held = new Set<string>();
  for (const jwk of valid) {
    const fp = await fingerprintPublicJwk(jwk);
    held.add(fp);
    if (all[fp]) continue;
    // Only the public coordinates: a file could carry more, none of it needed.
    all[fp] = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    added++;
  }
  if (added > 0 && typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY]: all });
  }
  return held.size;
}

/**
 * The keys an export should carry: the install's own first, then every
 * remembered key that signed a record in `records`, by fingerprint.
 */
export async function publicKeysForExport(
  records: ReadonlyArray<ForensicRecord>,
  ownJwk: JsonWebKey,
  ownFingerprint: string,
): Promise<EmbeddedPublicKey[]> {
  const out: EmbeddedPublicKey[] = [];
  if (ownFingerprint && isP256PublicJwk(ownJwk)) out.push({ fingerprint: ownFingerprint, jwk: ownJwk });
  const wanted = new Set<string>();
  for (const r of records) if (r.publicKeyFingerprint && r.publicKeyFingerprint !== ownFingerprint) wanted.add(r.publicKeyFingerprint);
  if (wanted.size === 0) return out;
  const known = await readAll();
  for (const fp of [...wanted].sort()) {
    const jwk = known[fp];
    if (jwk) out.push({ fingerprint: fp, jwk });
  }
  return out;
}

/**
 * Every key a picked file can carry: an HTML export's payload or an epoch
 * file (`publicKeyJwk`, plus `publicKeys` since 2026-09-03), or a keys list
 * (`[{ fingerprint, jwk }]`, the shape scripts/salvage-keys.ts writes).
 * Returns candidates; `rememberPublicKeys` does the checking.
 */
export function publicKeysInFileJson(parsed: unknown): unknown[] {
  if (!parsed || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed)) {
    return parsed.filter(e => e && typeof e === 'object' && 'jwk' in e).map(e => (e as { jwk: unknown }).jwk);
  }
  const o = parsed as Record<string, unknown>;
  const out: unknown[] = [];
  if (o.publicKeyJwk) out.push(o.publicKeyJwk);
  for (const list of [o.publicKeys, o.keys]) {
    if (Array.isArray(list)) for (const e of list) if (e && typeof e === 'object' && 'jwk' in e) out.push((e as { jwk: unknown }).jwk);
  }
  return out;
}
