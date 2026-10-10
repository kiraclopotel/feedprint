// ChainAnchor: the shape, with no behavior attached.
//
// It was declared in src/forensics/chain-anchor-store.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

export interface ChainAnchor {
  /** Stable id (used as the IDB primary key). */
  id: string;
  /** chainPosition of the record whose integrityHash was anchored. */
  anchoredChainPosition: number;
  /**
   * The exact integrityHash that was sent to the TSA. Stored so a
   * recipient can re-verify the TSA signature against this specific
   * hash without trusting our calculation.
   */
  anchoredIntegrityHash: string;
  /** 'freetsa' for V1. Reserved for failover providers. */
  tsaProvider: string;
  /** base64 of the full TimeStampResp envelope (PKIStatus + TST). */
  responseB64: string;
  /**
   * base64 of just the inner TimeStampToken (CMS SignedData). This is
   * what a recipient feeds to OpenSSL / pkijs to verify the TSA
   * signature against the embedded TSA certificate.
   */
  tstB64: string;
  /**
   * ISO-8601 time the TSA claims it stamped at (extracted from the TST's
   * TSTInfo.genTime by the worker). NULL if the GeneralizedTime couldn't
   * be parsed by the worker's best-effort scanner — the TST bytes remain
   * authoritative either way.
   */
  generalizedTime: string | null;
  /**
   * Local-clock time the request was made. Diagnostic only — NOT the
   * load-bearing evidence (that's generalizedTime + the TSA signature).
   */
  requestedAt: string;
  /**
   * How the bytes reached this computer. A chain-of-custody fact: 'direct'
   * means the browser asked the authority itself and FeelingWise never held
   * the token; 'proxy' means it came through api.feelingwise.org. Absent on
   * anchors written before 2026-09-04, when every anchor went through the
   * proxy.
   */
  route?: 'direct' | 'proxy';
  /**
   * The result of checking the token against `anchoredIntegrityHash` at the
   * moment it arrived (src/forensics/rfc3161.ts). Since 2026-09-04 an anchor
   * is only stored when this passed, so its presence means the check ran and
   * held. Absent on anchors written before that date, which were stored
   * unchecked and are re-checked on read.
   */
  verification?: {
    ok: boolean;
    /** Subject of the certificate that signed, for display. */
    signerSubject: string | null;
    /** SHA-256 of the certificate the chain ended at. */
    rootCertSha256: string | null;
    /** Name from KNOWN_TSA_ROOTS when the root is one we pin. */
    knownRootName: string | null;
    checks: { name: string; ok: boolean; detail: string }[];
  };
}
