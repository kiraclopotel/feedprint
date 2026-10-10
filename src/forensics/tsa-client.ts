// FeelingWise - RFC 3161 Time-Stamp Authority client.
//
// WHAT AN ANCHOR IS FOR
//
// The local ECDSA signature in src/forensics/signing.ts proves WHAT was
// written. It cannot prove WHEN, because the key and the clock are both on the
// same computer as the person offering the record. A third-party time stamp
// over the chain head fixes that: the authority signs "this hash existed by
// this moment", and because the chain is hash-linked, one anchor binds every
// record up to that position. Change anything earlier and the head hash moves,
// so the authority's signature no longer matches.
//
// WHAT CHANGED ON 2026-09-04, AND WHY
//
// Three things made the anchor decorative rather than evidential:
//
//   1. It was gated to paid tiers. With no paying subscribers, no shipped
//      install had ever received one, while landing/keeping-evidence.html told
//      parents that every entry carried an independent timestamp. The gate is
//      gone: a timestamp costs nothing and it is the only mechanism here that
//      puts a time on the record the device cannot forge.
//   2. Every request went through api.feelingwise.org. The "independent third
//      party" was reachable only through the vendor's own server, and the
//      client checked nothing it returned. The client now talks to authorities
//      directly where the browser allows it, and falls back to the proxy.
//   3. The token was never checked. It is now verified before it is stored
//      (src/forensics/rfc3161.ts) and again by the recipient's browser inside
//      the export, and it must chain to a certificate this client pins. That
//      last part is what makes the transport stop mattering: a proxy, or a
//      network attacker on the two http endpoints, can return bytes but cannot
//      produce a token that chains to an authority we know. Without the pin
//      check it could: an audit of this code minted its own root under the
//      subject name of a real one and every other check passed.
//
// One authority is a single point of failure and a single point of doubt, so a
// request goes to two different operators. Two
// unrelated authorities colluding, or being compromised together, is a
// materially harder thing to allege than one.
//
// PRIVACY
//
// A direct request tells the authority one thing: an IP address asked to stamp
// a 32-byte hash at a moment. No content, no account, no identifier, and the
// hash reveals nothing about what it covers. Through the proxy the authority
// sees Cloudflare instead and FeelingWise sees the IP. Direct is preferred
// because it is what takes FeelingWise out of the middle of its own evidence.
// Both routes are described in docs/compliance/DATA-FLOW-MAP.md.

import {
  buildTimeStampReq,
  parseTimeStampResp,
  verifyTimeStampToken,
  type TsaVerification,
} from './rfc3161';
import { getLicense, type LicenseInfo } from '../storage/license';
import { licenseFingerprint } from '../storage/cap-markers';
import { licenseRefusalHolds, noteLicenseRefused } from '../storage/license-refusal';
import { getSettings } from '../storage/settings';
import { makesNoOutsideCall, levelOf } from '../types/mode';

const PROXY_TSA_URL = 'https://api.feelingwise.org/v1/tsa';

export interface TsaEndpoint {
  /** Stable id, stored on the anchor so a reader can see who was asked. */
  id: string;
  /** Shown to a person. Never parsed. */
  label: string;
  /** Where the operator is established, or "country not established" when no public source shows it. */
  jurisdiction: string;
  url: string;
}

/**
 * The authorities a request may go to directly. All three are public RFC 3161
 * endpoints that need no account, and all three were reachable and returned a
 * verifiable SHA-256 token when this list was written (2026-09-04).
 *
 * They are deliberately unrelated: a German community service and two
 * commercial certificate authorities on different continents.
 *
 * CESNET, the Czech research network (https://tsa.cesnet.cz:5817/tsa), was a
 * fourth until 2026-09-23 and is gone on purpose. Its own pages say the service
 * is meant for research and education institutions and registered users, and
 * an extension installed by the public is neither (read 2026-09-23,
 * docs/research/2026-09-23-direction/research/check-2.md, row T2). Its root
 * stays pinned in src/forensics/rfc3161.ts, because records made up to
 * Receipts 2.5.14 can carry a CESNET token that must still verify. Adding it
 * back would need CESNET's written agreement first.
 *
 * Direct requests need the matching entry in manifest.json host_permissions. If
 * the permission is absent the endpoint is skipped and a paid install uses the
 * proxy, so this list is safe to extend before a manifest change ships.
 *
 * NOT eIDAS-qualified. A qualified timestamp under Regulation 910/2014 Article
 * 41 carries a legal presumption of the accuracy of its date and the integrity
 * of the data; these do not. What they give is a signature from a party with no
 * stake in the dispute, which is the thing the record lacked entirely. A
 * qualified stamp is worth buying for a single export that is actually going to
 * court, not for every anchor: see docs/spec/subsystems/forensic-chain.md.
 */
export const TSA_ENDPOINTS: readonly TsaEndpoint[] = Object.freeze([
  // FreeTSA publishes no operator or country that can be shown (docs/compliance/DATA-FLOW-MAP.md), so the field
  // says so rather than guess one.
  { id: 'freetsa', label: 'FreeTSA (freetsa.org)', jurisdiction: 'country not established', url: 'https://freetsa.org/tsr' },
  { id: 'digicert', label: 'DigiCert', jurisdiction: 'United States', url: 'http://timestamp.digicert.com' },
  { id: 'sectigo', label: 'Sectigo', jurisdiction: 'United Kingdom', url: 'http://timestamp.sectigo.com' },
]);

/** How many independent authorities one anchoring round tries to collect. */
export const ANCHORS_PER_ROUND = 2;

export interface TsaAnchorResponse {
  ok: true;
  /** Endpoint id, or 'freetsa' for a token the proxy fetched. */
  tsaProvider: string;
  /** How the bytes arrived. Recorded because it is a chain-of-custody fact. */
  route: 'direct' | 'proxy';
  /** base64 of the full TimeStampResp envelope (PKIStatus + TST). */
  response: string;
  /** base64 of the inner TimeStampToken (CMS SignedData) alone, when known. */
  tst: string;
  /**
   * The time read out of the SIGNED token by src/forensics/rfc3161.ts. Not a
   * field any server typed: if this is set, the bytes said it.
   */
  generalizedTime: string | null;
  /** The full check list, stored on the anchor so the dashboard can show it. */
  verification: TsaVerification;
}

export type TsaAnchorResult =
  | { ok: true; anchor: TsaAnchorResponse }
  | { ok: false; reason: string };

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * True when the browser will let us fetch this endpoint. A direct request needs
 * the origin in host_permissions; without it fetch fails with an opaque network
 * error that is indistinguishable from the authority being down, which would
 * make a missing permission look like an outage forever.
 */
export function matchPatternFor(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    // A Chrome match pattern has no port component, and one built from
    // URL.origin carries the port when there is one. CESNET, on the list until
    // 2026-09-23, listened on 5817, so `https://tsa.cesnet.cz:5817/*` was not a
    // valid pattern and the permission check for it could never succeed: that
    // authority was silently skipped on every round (found 2026-09-04). A host
    // pattern matches any port, which is the behavior we want for any future
    // endpoint on a non-default port.
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

async function canReachDirectly(url: string): Promise<boolean> {
  const pattern = matchPatternFor(url);
  if (!pattern) return false;
  try {
    if (!chrome?.permissions?.contains) return false;
    return await chrome.permissions.contains({ origins: [pattern] });
  } catch {
    return false;
  }
}

/** RFC 3161 wants this content type; several authorities reject anything else. */
const TSQ_CONTENT_TYPE = 'application/timestamp-query';

/** A slow authority must not hold up a chain write path that is already async. */
const TSA_TIMEOUT_MS = 15_000;

async function requestDirect(
  endpoint: TsaEndpoint,
  hashHex: string,
): Promise<TsaAnchorResult> {
  const req = buildTimeStampReq(hashHex);
  let resp: Response;
  try {
    resp = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': TSQ_CONTENT_TYPE },
      body: req.der as BodyInit,
      // The two lines that say what the BROWSER may add, rather than what this
      // code sends. The privacy page tells a reader that the authority sees
      // their internet address and the fingerprint; without these it could also
      // see a cookie it had set on an earlier visit, and a referrer naming the
      // extension. src/forensics/donation.ts has set both since it was written;
      // this call, which runs every few hours on its own, did not (2026-09-18).
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      // An anchor is a fresh assertion about a moment. A cached response would
      // be an old one, and a cached REQUEST is a fingerprint sitting in a store
      // this code did not choose.
      cache: 'no-store',
      signal: AbortSignal.timeout(TSA_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: `${endpoint.id}_network_error` };
  }
  if (!resp.ok) return { ok: false, reason: `${endpoint.id}_http_${resp.status}` };

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await resp.arrayBuffer());
  } catch {
    return { ok: false, reason: `${endpoint.id}_unreadable_body` };
  }

  return finishAnchor(bytes, hashHex, req.nonceHex, endpoint.id, 'direct');
}

/**
 * The proxy route, for a paid install. Kept as a fallback for installs without
 * the host permission and for networks that block the authorities directly.
 * The proxy's own `generalizedTime` is ignored: the time comes from the token.
 */
async function requestViaProxy(hashHex: string, license: LicenseInfo): Promise<TsaAnchorResult> {
  const bearer = `fw-${license.tier}-${license.secret}`;
  let resp: Response;
  try {
    resp = await fetch(PROXY_TSA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bearer}` },
      body: JSON.stringify({ hash: hashHex.toLowerCase() }),
      // Same reason as the direct route above: what the browser adds on its own
      // is pinned here rather than left to whatever the profile happens to hold.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: AbortSignal.timeout(TSA_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'proxy_network_error' };
  }
  if (!resp.ok) {
    // The proxy's own licence code pauses this key for the AI reading too.
    if (resp.status === 401) {
      try {
        const body = await resp.json();
        const code = body?.error?.code ?? body?.code;
        if (typeof code === 'string') noteLicenseRefused(licenseFingerprint(license.tier, license.secret), code);
      } catch { /* no readable code: nothing is paused */ }
    }
    return { ok: false, reason: `proxy_http_${resp.status}` };
  }

  let parsed: { ok?: boolean; tst?: string; response?: string; tsaProvider?: string };
  try {
    parsed = await resp.json();
  } catch {
    return { ok: false, reason: 'proxy_invalid_json' };
  }
  const b64 = parsed.response ?? parsed.tst;
  if (parsed.ok !== true || typeof b64 !== 'string') {
    return { ok: false, reason: 'proxy_malformed_response' };
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    return { ok: false, reason: 'proxy_token_not_base64' };
  }
  // The proxy builds its own request, so it does not know our nonce and cannot
  // pass one back. Nothing is lost: the messageImprint check already ties the
  // token to this exact hash, and a replayed token would have to be a token
  // over the same never-before-seen chain-head hash.
  return finishAnchor(bytes, hashHex, null, parsed.tsaProvider ?? 'freetsa', 'proxy');
}

/**
 * Verify the bytes before they are allowed to become an anchor. A token that
 * does not stamp our hash, or that is not signed by the certificate it carries,
 * is not stored: an unverified anchor in the record is worse than no anchor,
 * because a reader would count it.
 */
async function finishAnchor(
  bytes: Uint8Array,
  hashHex: string,
  nonceHex: string | null,
  provider: string,
  route: 'direct' | 'proxy',
): Promise<TsaAnchorResult> {
  // Static import, not a dynamic one. This module is reachable from the service
  // worker, and a dynamic import pulls Vite's DOM preload helper into a realm
  // with no document (known-issues M40). scripts/check-sw-bundle.mjs gates the
  // build on it and caught exactly this on 2026-09-04.
  let tokenBytes = bytes;
  let responseBytes = bytes;
  try {
    const parsed = parseTimeStampResp(bytes);
    if (parsed.status !== 0 && parsed.status !== 1) {
      return { ok: false, reason: `${provider}_rejected_status_${parsed.status}` };
    }
    if (parsed.token) tokenBytes = parsed.token;
  } catch {
    // Not an envelope. Treat the bytes as a bare token and let verification say
    // whether that was right.
    responseBytes = bytes;
  }

  const verification = await verifyTimeStampToken(tokenBytes, hashHex, nonceHex);
  if (!verification.ok) {
    const failed = verification.checks.filter(c => !c.ok).map(c => c.name).join(',');
    return { ok: false, reason: `${provider}_unverified_${failed || verification.error || 'unknown'}` };
  }
  // The verifier reports an unrecognised issuer rather than failing on it,
  // because a reader holding a token from an authority we have not met can
  // check the fingerprint by hand. Storing one is different. We asked a
  // specific authority whose certificate we pin, so a token that does not
  // chain to it is not that authority's, and two of the three endpoints are
  // plain http where a network attacker could substitute one. Anyone can mint
  // a certificate authority and a timestamping certificate under it; an
  // audit of this code did exactly that, under the subject name
  // "DigiCert Trusted Root G4", and the token verified. It is refused here.
  if (!verification.knownRootName) {
    return { ok: false, reason: `${provider}_unrecognised_authority_${verification.rootCertSha256 ?? 'none'}` };
  }

  return {
    ok: true,
    anchor: {
      ok: true,
      tsaProvider: provider,
      route,
      response: bytesToBase64(responseBytes),
      tst: bytesToBase64(tokenBytes),
      generalizedTime: verification.genTime,
      verification,
    },
  };
}

/**
 * Ask one authority for a verified timestamp over `hashHex`.
 *
 * Kept for the single-anchor callers and for the tests that pin the failure
 * contract. `requestVerifiedTimestamps` is what the anchoring path uses.
 */
export async function fetchTimeStampToken(hashHex: string): Promise<TsaAnchorResult> {
  if (!/^[0-9a-f]{64}$/i.test(hashHex)) return { ok: false, reason: 'invalid_hash' };
  const results = await requestVerifiedTimestamps(hashHex, 1);
  if (results.anchors.length > 0) return { ok: true, anchor: results.anchors[0] };
  return { ok: false, reason: results.reasons[0] ?? 'no_authority_answered' };
}

export interface TimestampRound {
  anchors: TsaAnchorResponse[];
  /** Why each authority that was tried did not produce an anchor. */
  reasons: string[];
}

/**
 * Collect up to `want` verified timestamps from different authorities.
 *
 * Order rotates with the hash so no single authority sees every anchor from
 * every install, and so an outage at the head of the list does not stop
 * anchoring. A failure at one authority, of any kind (no permission, a network
 * error, an http error, a token that does not verify), moves the round on to
 * the next one; only `want` anchors or the end of the list stops it. With three
 * authorities and two wanted, one can be down and the round still completes.
 * Requests run in sequence rather than in parallel: a round happens
 * a few times a day, the latency does not matter, and one at a time keeps a
 * free service from seeing a burst.
 */
export async function requestVerifiedTimestamps(
  hashHex: string,
  want: number = ANCHORS_PER_ROUND,
): Promise<TimestampRound> {
  const anchors: TsaAnchorResponse[] = [];
  const reasons: string[] = [];
  if (!/^[0-9a-f]{64}$/i.test(hashHex)) return { anchors, reasons: ['invalid_hash'] };
  // Both routes end here, the direct authorities and the proxy, so this is the one place Strict
  // stops them. A settings snapshot that could not be read reads as Strict: not knowing the level is
  // no reason to send a hash out, and the next tick asks again.
  const settings = await getSettings();
  if (makesNoOutsideCall(settings)) {
    return { anchors, reasons: [levelOf(settings.mode) === 'strict' ? 'strict_makes_no_calls' : 'no_level_chosen'] };
  }

  // Rotate the starting point by the hash itself. Deterministic, so a retry of
  // the same head asks the same authority first, and spread across installs.
  const offset = parseInt(hashHex.slice(-2), 16) % TSA_ENDPOINTS.length;
  const ordered = TSA_ENDPOINTS.map((_, i) => TSA_ENDPOINTS[(i + offset) % TSA_ENDPOINTS.length]);

  for (const endpoint of ordered) {
    if (anchors.length >= want) break;
    if (!(await canReachDirectly(endpoint.url))) {
      reasons.push(`${endpoint.id}_no_host_permission`);
      continue;
    }
    const r = await requestDirect(endpoint, hashHex);
    if (r.ok) anchors.push(r.anchor);
    else reasons.push(r.reason);
  }

  // The proxy is the fallback, not the preference: it only runs when direct
  // requests could not produce enough anchors. It returns a token from one
  // fixed authority, so when a direct request to that same authority already
  // answered, the proxy's token is refused: a round exists to collect
  // independent operators, and the same operator twice is one anchor wearing
  // two labels.
  if (anchors.length < want) {
    const license = await getLicense();
    // The proxy authenticates every caller and has no free tier.
    // A free install has no key, so it does not ask: the request could only be
    // refused, after handing the proxy the fingerprint and the install's address.
    if (license.tier !== 'free' && await licenseRefusalHolds(licenseFingerprint(license.tier, license.secret))) {
      // A key the proxy refused lately is not sent again until its pause ends.
      reasons.push('proxy_license_refused');
    } else if (license.tier !== 'free') {
      const r = await requestViaProxy(hashHex, license);
      if (!r.ok) reasons.push(r.reason);
      else if (isSameAuthorityAsAny(anchors, r.anchor)) reasons.push(`proxy_duplicate_authority_${r.anchor.tsaProvider}`);
      else anchors.push(r.anchor);
    }
  }

  return { anchors, reasons };
}

/**
 * Two anchors are from the same authority when the token chains to the same
 * pinned root, or, when neither carries a root, when the endpoint id matches.
 * Exported for the unit test; the round above is the only production caller.
 */
export function isSameAuthorityAsAny(
  anchors: readonly TsaAnchorResponse[],
  candidate: TsaAnchorResponse,
): boolean {
  const root = candidate.verification?.rootCertSha256 ?? null;
  return anchors.some(a => {
    const aRoot = a.verification?.rootCertSha256 ?? null;
    if (root && aRoot) return root === aRoot;
    return a.tsaProvider === candidate.tsaProvider;
  });
}
