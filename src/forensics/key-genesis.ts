// FeelingWise - proving the signing key existed before there was a dispute.
//
// THE QUESTION THIS ANSWERS
//
// The chain anchors answer "was this backdated": an authority with no stake in
// the matter signed the chain head at a known moment, so nothing before that
// point can have been written after it. They do not answer the question that
// comes next, which the 2026-09-04 evidence audit put like this:
//
//   "I generated this file on my laptop over lunch. Please open it and click
//    your Verify button. It says VERIFIED. Now tell the court what your green
//    banner distinguishes."
//
// A file signed by a key it also carries is internally consistent by
// construction. Anyone can make a fresh keypair, author records, chain them,
// sign them, and get real time stamps over the fabricated chain heads.
//
// What a fabricator cannot do is go back and have an authority sign their new
// key months ago. So the install asks two authorities to time stamp the
// SHA-256 of its own public key, once, as soon as the key exists. From then on
// the export can say: this key existed by this date, according to someone with
// no interest in the outcome. A record signed by a key that predates the
// dispute, in a chain anchored continuously from then on, is a different kind
// of object from a file made over lunch. It is exactly the claim the product
// makes on landing/keeping-evidence.html and could not previously support:
// "it was made automatically, before there was a dispute."
//
// WHAT IT STILL DOES NOT PROVE
//
// The key's owner has held it the whole time. Someone who set out to fabricate
// months in advance, and kept anchoring, could still do it. This raises the
// cost of a forgery from an afternoon to a sustained deception begun before
// the events, which is the honest description and the one the export uses.
//
// HOW A RECIPIENT CHECKS IT
//
// The export carries the public key. A recipient recomputes SHA-256 over the
// key's coordinates the same way `publicKeyDigestHex` does, and checks the
// token against that digest with the verifier already inlined in the file. No
// network, no account, no trust in FeelingWise.

import { getPublicKeyJWK, publicKeyDigestHex } from './signing';
import { requestVerifiedTimestamps, type TsaAnchorResponse } from './tsa-client';

const STORAGE_KEY = 'fw_signing_key_genesis';

interface KeyGenesisAnchor {
  /** Endpoint id of the authority that signed. */
  tsaProvider: string;
  /** Whether the request went straight to the authority or through the proxy. */
  route: 'direct' | 'proxy';
  /** base64 of the full TimeStampResp. */
  responseB64: string;
  /** base64 of the inner TimeStampToken. */
  tstB64: string;
  /** The time read out of the signed token, never a field a server typed. */
  generalizedTime: string | null;
  /** Local clock at the moment of the request. Diagnostic only. */
  requestedAt: string;
}

export interface KeyGenesisRecord {
  /**
   * The exact digest the authorities signed: SHA-256 over `x|y` of the public
   * key's JWK coordinates. A recipient recomputes it from the key in the
   * export, so this field is a convenience, not the evidence.
   */
  publicKeyDigest: string;
  /** First 16 characters of the digest, matching the fingerprint on records. */
  fingerprint: string;
  anchors: KeyGenesisAnchor[];
}

/** Read the stored genesis record. Returns null when the key has never been stamped. */
export async function getKeyGenesis(): Promise<KeyGenesisRecord | null> {
  try {
    const raw = await chrome.storage.local.get(STORAGE_KEY);
    const value = raw[STORAGE_KEY] as KeyGenesisRecord | undefined;
    if (!value || typeof value.publicKeyDigest !== 'string' || !Array.isArray(value.anchors)) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function toAnchor(a: TsaAnchorResponse, at: string): KeyGenesisAnchor {
  return {
    tsaProvider: a.tsaProvider,
    route: a.route,
    responseB64: a.response,
    tstB64: a.tst,
    generalizedTime: a.generalizedTime,
    requestedAt: at,
  };
}

export type KeyGenesisOutcome =
  | { status: 'already-stamped'; anchors: number }
  | { status: 'stamped'; anchors: number; providers: string[] }
  | { status: 'skipped'; reason: string };

let roundInFlight: Promise<KeyGenesisOutcome> | null = null;

/**
 * Stamp the install's public key with independent authorities, once.
 *
 * Idempotent and failure-tolerant, and deliberately re-runnable: the worker
 * starts it the moment a key is made (signing.ts onSigningKeyBorn), without
 * waiting for it, because key creation happens on the first record write and
 * must never depend on the network; the periodic anchor alarm runs it again.
 * An install that was offline on its first day gets stamped on the next alarm
 * that finds a network, and the stored time is the authority's, so a late
 * stamp is honest about being late rather than pretending otherwise.
 *
 * One round at a time: the birth call and an alarm can meet, and two rounds
 * would ask the authorities twice for one key.
 *
 * A key that is REPLACED (a restore from backup under a different identity)
 * has a different digest, so the stored record no longer matches and a fresh
 * stamp is taken for the new key. The old one is not kept: it belonged to a
 * chain the install no longer signs under, and keeping it would invite a
 * reader to attach its date to the current key.
 */
export function ensureKeyGenesisAnchor(): Promise<KeyGenesisOutcome> {
  roundInFlight ??= stampKeyGenesisOnce().finally(() => { roundInFlight = null; });
  return roundInFlight;
}

async function stampKeyGenesisOnce(): Promise<KeyGenesisOutcome> {
  // Do NOT create a key here. getPublicKeyJWK goes through ensureSigningKey,
  // which generates and persists a keypair when storage is empty, so calling it
  // on an alarm would mint an identity on an install that has never recorded
  // anything and then spend two network requests dating it. A key exists when
  // the first record is written; until then there is nothing to stamp.
  try {
    const stored = await chrome.storage.local.get('fw_signing_public_jwk');
    if (!stored.fw_signing_public_jwk) {
      return { status: 'skipped', reason: 'no_signing_key' };
    }
  } catch {
    return { status: 'skipped', reason: 'storage_unreadable' };
  }
  let jwk: JsonWebKey;
  try {
    jwk = await getPublicKeyJWK();
  } catch {
    return { status: 'skipped', reason: 'no_signing_key' };
  }
  const digest = await publicKeyDigestHex(jwk);

  const existing = await getKeyGenesis();
  if (existing && existing.publicKeyDigest === digest && existing.anchors.length > 0) {
    return { status: 'already-stamped', anchors: existing.anchors.length };
  }

  const round = await requestVerifiedTimestamps(digest);
  if (round.anchors.length === 0) {
    return { status: 'skipped', reason: round.reasons[0] ?? 'no_authority_answered' };
  }

  const at = new Date().toISOString();
  const record: KeyGenesisRecord = {
    publicKeyDigest: digest,
    fingerprint: digest.slice(0, 16),
    anchors: round.anchors.map(a => toAnchor(a, at)),
  };
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: record });
  } catch {
    return { status: 'skipped', reason: 'storage_write_failed' };
  }
  return {
    status: 'stamped',
    anchors: record.anchors.length,
    providers: record.anchors.map(a => a.tsaProvider),
  };
}

/**
 * Put back a genesis record that came out of a backup.
 *
 * A restore under the original identity brings the key back; without this the
 * stamps that dated it stay behind, `ensureKeyGenesisAnchor` finds no record
 * for the restored digest and takes a fresh stamp with today's date, and the
 * only evidence that the key predates the dispute is replaced by evidence that
 * it does not.
 *
 * Refuses a record that is not about the key now in use: the digest must match,
 * or the date would be attached to a key it never covered.
 */
export async function restoreKeyGenesis(record: KeyGenesisRecord | undefined): Promise<boolean> {
  if (!record || typeof record.publicKeyDigest !== 'string' || !Array.isArray(record.anchors)) {
    return false;
  }
  let digest: string;
  try {
    digest = await publicKeyDigestHex(await getPublicKeyJWK());
  } catch {
    return false;
  }
  if (digest !== record.publicKeyDigest) return false;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: record });
    return true;
  } catch {
    return false;
  }
}

/**
 * The earliest time any authority signed the key, or null when it has never
 * been stamped. This is the sentence the export leads with, so it takes the
 * earliest rather than the latest: the claim is "no later than", and the
 * earliest signature is the strongest true version of it.
 */
export function earliestGenesisTime(record: KeyGenesisRecord | null): string | null {
  if (!record) return null;
  const times = record.anchors
    .map(a => a.generalizedTime)
    .filter((t): t is string => typeof t === 'string' && t.length > 0)
    .sort();
  return times[0] ?? null;
}
