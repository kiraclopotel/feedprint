// The signature on a repair file (11 Oct 2026).
//
// A repair file is fetched from our own relay, but the relay is not what is trusted: the signature is. The file is
// signed offline with an Ed25519 key we hold; the public half is in the package (public-keys.ts), so a copy of the
// package can check a file with no network and no account. A file whose signature does not verify is ignored, however it
// arrived. WebCrypto's Ed25519 is in Chrome from version 113.

import { parseRepairPayload, type RepairEnvelope, type RepairFile } from './format';

export interface RepairPublicKey {
  /** The name a file's keyId refers to, for example "r1". */
  readonly id: string;
  /** The raw 32-byte public key, base64. */
  readonly publicKeyB64: string;
}

function fromBase64(b64: string): Uint8Array | null {
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/**
 * The repair file inside a signed wrapper, or null when the key is not known, the signature does not verify, or the
 * payload is not a valid repair file (or has expired). Never throws.
 */
export async function verifyRepairEnvelope(
  envelope: RepairEnvelope,
  keys: readonly RepairPublicKey[],
  now: number = Date.now(),
): Promise<RepairFile | null> {
  try {
    const key = keys.find((k) => k.id === envelope.keyId);
    const subtle = globalThis.crypto?.subtle;
    if (!key || !subtle) return null;
    const publicKey = fromBase64(key.publicKeyB64);
    const signature = fromBase64(envelope.signature);
    if (!publicKey || publicKey.length !== 32 || !signature || signature.length !== 64) return null;
    const cryptoKey = await subtle.importKey('raw', publicKey as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    const ok = await subtle.verify({ name: 'Ed25519' }, cryptoKey, signature as BufferSource, new TextEncoder().encode(envelope.payload) as BufferSource);
    return ok ? parseRepairPayload(envelope.payload, now) : null;
  } catch {
    return null;
  }
}
