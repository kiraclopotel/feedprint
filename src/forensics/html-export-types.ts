import type { ExportLocale } from '../types/export-strings';
// The shapes the export is built from and against: the locale it speaks, the key it carries, the
// metadata the builder is handed, and every string the page prints.
//
// Cut out of src/forensics/html-export.ts on 2026-09-16 (PLAN-2026-09-16 item 10.1), so the string
// table, the inline scripts and the stylesheet can each live in their own file without any of them
// importing the builder. html-export.ts re-exports these names, so every existing import works.
//
// The locale and the string table's own shape live in src/types/export-strings.ts, so the words in
// src/i18n can be typed without importing anything from forensics (item 8.11's layer table).

import type { ChainAnchor } from '../types/chain-anchor';
import type { MethodologyBlock } from './methodology';
import type { HealEvent } from './auto-heal';
import type { ExportProfile } from './profile';

export interface EmbeddedPublicKey {
  fingerprint: string;
  jwk: JsonWebKey;
}

export interface ExportMetadata {
  /** FeelingWise build version (e.g., 'V1.0.0-build-abc123'). */
  fwVersion: string;
  /** Public key JWK so the recipient verifier can verify ECDSA P-256 signatures. */
  publicKeyJwk: JsonWebKey;
  /** Public-key fingerprint (first 16 hex of SHA-256(JWK.x|JWK.y)) for human eyeball. */
  publicKeyFingerprint: string;
  /**
   * Every signing key this file carries: the install's own first, then the
   * remembered keys of earlier generations whose records are in the file
   * (forensics/known-keys.ts, since 2026-09-03). The verifier checks each
   * record under the key its fingerprint names; a record whose key is not
   * here verifies by hash only, and the summary says so. Optional: a caller
   * that omits it produces the single-key file as before.
   */
  publicKeys?: EmbeddedPublicKey[];
  /**
   * Why each key this install has held came to exist (signing.ts origin
   * ledger). Keys from before the ledger existed, and keys recovered from
   * other installs, have no entry and print as "not recorded".
   */
  keyOrigins?: Array<{ fingerprint: string; origin: 'generated-storage-empty' | 'restored-from-backup'; at: string; previousFingerprint?: string }>;
  /**
   * The install's heal log (auto-heal.ts), newest first: every repair that
   * wrote over stored records, with its counts. Printed in "This file" so a
   * repair is a maintenance record the file discloses (register item 18).
   */
  healLog?: HealEvent[];
  /** Locale of the verifier UI. Single-language per VISION §7.2 V1 scope. */
  locale: ExportLocale;
  /**
   * Who made the file, in their own chosen name, and which machine (the facts
   * Chrome exposes; forensics/profile.ts). Rendered as page-one rows that the
   * provenance digest signs. Not in the envelope canonical, so the public
   * checker's byte-synced copy of envelopeCanonical stays valid.
   */
  profile?: ExportProfile;
  /**
   * Optional: Operating-point precision disclosure per VISION §7.1 (e.g., the
   * "20-50% on hostile-stratified" published figure). Surfaced in the page-1
   * summary so the recipient sees the precision claim alongside the record list.
   * Optional because V1.5 may revise the published number.
   */
  precisionDisclosure?: string;
  /**
   * A few plain sentences printed at the very TOP of the document, above the
   * reading section, for the one thing a reader must know before the first
   * card rather than after it.
   *
   * Added 2026-09-18. A researcher read landing/demo.html cold and stopped
   * trusting it at the sixth card, because the only sentence saying the posts
   * were invented sat in a page-one metadata row under the label "FeelingWise
   * precision disclosure", which is both far below the feed and not a label
   * that prepares anyone for it. The builder had no way to put a sentence
   * above the feed, so this field exists rather than a second demo-only
   * section.
   *
   * Rendered with data-fw-prov="topNotice", so the provenance digest covers
   * it. An unsigned paragraph at the top of an evidence file is exactly the
   * drift extractProvenanceRows exists to close: a sentence a reader reads and
   * no checker reads.
   *
   * Omitted by every real export, which renders the document unchanged: no
   * paragraph, no provenance row, no shift in any digest.
   */
  topNotice?: string;
  /**
   * What this export left behind.
   *
   * CSV and JSON have always stated "Records included: N of M. Excluded: …"
   * (exporter.ts `caveatText`). The HTML report — the file most likely to be
   * handed to a school, a lawyer or another parent — printed a bare count, so
   * a severity-gated subset and the whole retained chain produced an
   * identical-looking line and the reader had no way to tell which they were
   * holding.
   *
   * Omitted by the complete-chain export, which renders the "nothing held
   * back" line instead. Numbers, not prose, because the page is bilingual and
   * the recipient script serializes the string table.
   */
  /**
   * In a report: how many records it leaves out that the install holds a checked
   * time stamp over, each record once. Those stamps are not in the file.
   */
  stampedRecordsLeftOut?: number;
  selection?: {
    included: number;
    totalSource: number;
    excludedUnreviewed: number;
    excludedLowConfidence: number;
    excludedNonDetection: number;
  };
  /**
   * Archived rows the install holds that did not decode, so they are not in this file. Stated so
   * the holes they leave are not read as a filtered extract or a removal; absent when there were none.
   */
  unreadableArchivedRows?: number;
  /**
   * RFC 3161 chain anchors covering ranges of chainPosition. Each anchor
   * is a third-party-signed timestamp from an independent TSA (FreeTSA in
   * V1) binding the chain head's integrityHash at that position to a known
   * time. Rendered in the export so the recipient sees the independent-
   * time claim alongside per-record signatures. V1 renders the claim;
   * V1.5 will add offline cryptographic verification of the TST bytes
   * (currently embedded verbatim in the export's JSON payload for the
   * recipient to verify with external tooling like OpenSSL or pkijs).
   */
  anchors?: ChainAnchor[];
  /**
   * Time stamps taken over the SHA-256 of this install's public key, once,
   * when the key was first seen (src/forensics/key-genesis.ts). They answer a
   * question the chain anchors cannot: whether the key that signed all of this
   * existed before the dispute did. A recipient recomputes the digest from
   * `publicKeyJwk` and checks the token against it, offline.
   */
  /**
   * ISO time the signing key was first persisted on this install, from
   * signing.getSigningKeyCreatedAt(). The device's own clock, and labelled as
   * such: the authority-signed date lives in `keyGenesis`.
   */
  signingKeyCreatedAt?: string | null;
  keyGenesis?: {
    publicKeyDigest: string;
    fingerprint: string;
    anchors: Array<{
      tsaProvider: string;
      route: 'direct' | 'proxy';
      responseB64: string;
      tstB64: string;
      generalizedTime: string | null;
      requestedAt: string;
    }>;
  };
  /**
   * "Under what criteria was this identified" (2026-07-02) — verbatim
   * model instructions + pins + thresholds, rendered near the top of the
   * export as a collapsible section. Optional so callers without it (tests,
   * older paths) produce the pre-existing document unchanged.
   */
  methodology?: MethodologyBlock;
}

/**
 * Every string the export verifier / feed view can render. Typing I18N as
 * Record<ExportLocale, ExportI18nStrings> (not Record<string,string>) makes
 * TypeScript reject a locale table that is missing a key — a dropped RO key
 * would otherwise render literal 'undefined' in a court-facing document. The
 * key-parity unit test (tests/unit/forensics/html-export-i18n-parity.test.ts) guards the
 * runtime table against the same drift.
 */

export type { ExportLocale, ExportI18nStrings } from '../types/export-strings';
