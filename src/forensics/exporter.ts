// FeelingWise - Forensic data exporter
// JSON, CSV, and PDF (via browser print) export with complete metadata.
//
// The PDF path deliberately uses browser print instead of bundling jsPDF:
//   - No 250KB+ library added to the extension bundle.
//   - Chrome's "Save as PDF" produces a self-contained PDF that embeds the
//     full HTML evidence report — identical content to what the dashboard
//     already computes.
//   - Works offline; no network dependency.
// Trade-off: the user must confirm the "Save as PDF" destination in Chrome's
// print dialog. For review-packet use, this is desirable: the user performs
// the archival step themselves and can choose any later signing/notarization.

import { ForensicRecord } from '../types/forensic';
import { feedActionKeyFor } from './feed-action';
import { isPaidPlacement } from './paid-placement';
import { isCountedFlagVerdict } from './flag-verdict';
import {
  getPublicKeyJWK,
  getPublicKeyFingerprint,
  getSigningKeyCreatedAt,
  getSigningKeyOrigins,
} from './signing';
import { buildForensicHtmlExport, I18N, installCheckedAnchors, modeLabel, type ExportLocale } from './html-export';
import { intlLocaleFor } from '../i18n';
import { buildMethodologyBlock, currentExtensionVersion } from './methodology';
import { extensionLabel } from './extension-label';
import { getKeyGenesis } from './key-genesis';
import { readHealLog } from './auto-heal';
import { readExclusions } from './author-exclusions';
import type { ExportMetadata } from './html-export-types';
import { attachSignedManifest } from './html-export';
import { applyRedactions } from './redaction';
import { buildExportProfile, profileNameSlug } from './profile';
import { sha256 } from './hasher';
import { getAnchors } from './chain-anchor-store';
import { escapeHtml } from './html-escape';
import type { ChainAnchor } from '../types/chain-anchor';
import { loadArchivesOldestFirst } from './archive-reader';
import { readSalvagedRecords } from './salvage-store';
import { publicKeysForExport } from './known-keys';
import { levelOfRecorded } from '../types/mode';
import { isHiddenAd, standInKey } from './stand-in';

// HTML exports are FREE for every tier (DECISIONS.md 2026-06-21: the full
// provable black box, including the verifiable HTML export, is the free
// core; paid = the real-time AI defense). A Layer-2 paywall assert lived
// here until 2026-07-15 (register M43) — after the decision removed the
// dashboard button gate, the surviving assert made a free-tier parent's
// ENABLED export button fail at runtime with a paywall error. Deleted;
// tests/unit/forensics/html-export-paywall.test.ts locks the free behavior.

// Export gate. The PDF/JSON/CSV only contains records that pass review:
//   • severity ≥ threshold     (overallScore ≥ minOverallScore)
// Everything else is held back AND counted in the caveat summary so opposing
// counsel knows the export wasn't cherry-picked from a bigger pool.
export interface ExportFilterOptions {
  /** 0..10 severity floor on overallScore. 0 = no floor. */
  minOverallScore: number;
}

export interface ExportFilterResult {
  included: ForensicRecord[];
  excludedUnreviewed: number;
  excludedLowConfidence: number;
  /**
   * Count of records dropped because they're not
   * detection records (verdict='pass' / 'blocked' / kind='environment').
   * Pre-fix these landed in `excludedUnreviewed` because their verdict
   * was 'pass' and the parent never marked them confirmed — but the
   * caveat then said "N not yet reviewed by the report author" which
   * misrepresents the exclusion (these aren't review-pending detections,
   * they're operational metadata that doesn't belong in an evidence
   * export at all). Surfaced as its own bucket so the caveat is honest.
   */
  excludedNonDetection: number;
  totalSource: number;
}

export function applyExportGate(
  records: ForensicRecord[],
  opts: ExportFilterOptions,
): ExportFilterResult {
  // The parent-review filter arm was removed (S11): no on-device parent-review
  // source exists, so its only caller always passed requireHumanConfirmed:false.
  // Kept as a constant 0 to preserve the export-JSON `excluded.unreviewed` key
  // (a documented back-compat field), byte-identical to prior output.
  const excludedUnreviewed = 0;
  let excludedLowConfidence = 0;
  let excludedNonDetection = 0;
  const included: ForensicRecord[] = [];

  for (const r of records) {
    // Drop non-detection records first so they don't land in the wrong
    // exclusion bucket. Detection records: verdict 'flagged' / 'flagged-hidden'
    // / undefined (legacy records, treated as flagged for back-compat).
    // 'flagged-hidden' covers slur-tier comments FW removed from the kid's
    // view (forensic-completeness mandate, 2026-05-08 — hidden slurs
    // must still surface in parent exports as evidence the kid was exposed).
    // Everything else (pass / blocked / educational-reframe + kind=environment)
    // is operational metadata, not evidence, and shouldn't be in the export.
    // Advertising is not a detection either (rebuild plan 2026-09-14, standing
    // decision 1): a child or teen sponsored-ad record is written
    // flagged-hidden at severity 6 from the platform's ad marker, and an
    // evidence extract full of phone-case discounts is the fastest way to lose
    // a reader. It leaves as a non-detection record, counted on the selection
    // rows like every other exclusion.
    const isDetection =
      // "Seen a lot" is not a detection: nothing read it (the Head, 10 Oct 2026).
      isCountedFlagVerdict(r)
      && r.kind !== 'environment'
      && !isPaidPlacement(r);
    if (!isDetection) {
      excludedNonDetection++;
      continue;
    }

    if (opts.minOverallScore > 0 && r.overallScore < opts.minOverallScore) {
      excludedLowConfidence++;
      continue;
    }
    included.push(r);
  }

  return {
    included,
    excludedUnreviewed,
    excludedLowConfidence,
    excludedNonDetection,
    totalSource: records.length,
  };
}

/**
 * A record a rule acted on and no AI read: a word or account the person listed, a fixed rule, or the rule
 * engine named as its source. The file's first sentence says who judged, so it asks the records.
 */
function actedOnByRule(r: ForensicRecord): boolean {
  const mode = r.detectionMode ?? '';
  return r.aiSource === 'rules' || r.aiSource === 'none' || mode.startsWith('blocklist:') || mode.startsWith('topic:') || mode.startsWith('block:');
}

const NOT_A_FINDING = 'It is not a legal opinion, a complete capture record, or a determination of intent by the post author.';

/**
 * The sentence that opens the CSV, the JSON and the report. It used to say an AI flagged every item, and a file
 * whose only record a person's own blocked word had hidden said so too (11 Oct 2026, the night walk): a file
 * handed to a school or a lawyer must not credit an AI with a judgment nobody made.
 */
function leadSentence(included: ForensicRecord[]): string {
  const byRule = included.filter(actedOnByRule).length;
  const byAi = included.length - byRule;
  if (byRule === 0) {
    return `AI Safety Interpretation. This report identifies retained items that FeelingWise flagged as showing manipulative framing patterns. ${NOT_A_FINDING}`;
  }
  const rules = 'a word or account set on this device, or a fixed rule';
  if (byAi === 0) {
    return `This report lists retained items that FeelingWise acted on because of a rule: ${rules}. No AI reading is among them, so none of these items is an AI judgment of manipulative framing. ${NOT_A_FINDING}`;
  }
  return `This report lists retained items that FeelingWise acted on. ${byAi} ${byAi === 1 ? 'was' : 'were'} flagged by an AI reading as showing manipulative framing patterns; ${byRule} ${byRule === 1 ? 'was' : 'were'} acted on because of a rule (${rules}) and carry no AI judgment. ${NOT_A_FINDING}`;
}

/** P0.3 — single-paragraph plain-English caveat embedded in every export. */
function caveatText(filter: ExportFilterResult): string {
  const lines: string[] = [];
  lines.push(leadSentence(filter.included));
  if (filter.totalSource > filter.included.length) {
    const parts: string[] = [];
    if (filter.excludedUnreviewed) parts.push(`${filter.excludedUnreviewed} not yet reviewed by the report author`);
    if (filter.excludedLowConfidence) parts.push(`${filter.excludedLowConfidence} below the severity threshold`);
    if (filter.excludedNonDetection) {
      parts.push(
        // Until 2026-09-20 this named "verifier samples, comment-section room verdicts,
        // AI-content blocks ... operational metadata, not retained observations". On a real
        // report the bucket was 47 passes, 2 ads, 1 starred record and 11 markers: passes ARE
        // retained observations, and the gate above holds them back because they were not
        // flagged. Same words as the HTML export's held-back row (summaryHeldBackNonDetection).
        `${filter.excludedNonDetection} records the product did not flag (items it passed, items a fixed rule blocked, ads, starred swearing, comment-section summaries and the markers of the chain itself), which are in the whole-record export and were left out of this report on purpose`,
      );
    }
    lines.push(
      `Records included: ${filter.included.length} of ${filter.totalSource}. Excluded: ${parts.join(', ')}.`,
    );
  } else {
    lines.push(`Records included: ${filter.included.length} of ${filter.totalSource}. None excluded.`);
  }
  return lines.join(' ');
}

/**
 * What the exporter can state about the copy that just left the device
 * (evidence-gap register item 17): the file name, its byte length and the
 * SHA-256 of the exact bytes handed to the browser. The digest is computed
 * over the same UTF-8 encoding the Blob carries, so a recipient who hashes
 * the saved file gets this value, and the document's own in-page digest
 * (renderFileSection) agrees with it.
 */
export interface ExportReceipt {
  filename: string;
  bytes: number;
  sha256: string;
}

/** The chosen name as a filename part, dash-terminated, or nothing. */
function namePart(name: string | null): string {
  const slug = profileNameSlug(name);
  return slug ? `${slug}-` : '';
}

async function deliverHtml(html: string, filename: string): Promise<ExportReceipt> {
  const bytes = new TextEncoder().encode(html);
  const digest = await sha256(html);
  triggerDownload(new Blob([bytes], { type: 'text/html' }), filename);
  return { filename, bytes: bytes.byteLength, sha256: digest };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * The stamps a report may carry: those over a record it holds. The stamp alarm
 * names the newest record, which is nearly always a passed, skipped or
 * heartbeat record the report's gate leaves out, and a stamp over a record the
 * file does not hold vouches for nothing in it; the checker reads it as a
 * record missing or past the tail and the report reads PARTIALLY VERIFIED. The
 * match is the checker's own (anchorFindings): the same hash at the same
 * position, records from before a key change aside.
 */
export function anchorsOverHeldRecords(anchors: readonly ChainAnchor[], records: readonly ForensicRecord[]): ChainAnchor[] {
  const held = new Set<string>();
  for (const r of records) {
    if (typeof r.chainPosition === 'number' && r.chainAnchor !== 'pre-rekey') held.add(`${r.chainPosition}:${r.integrityHash}`);
  }
  return anchors.filter((a) => held.has(`${a.anchoredChainPosition}:${a.anchoredIntegrityHash}`));
}

/**
 * How many records a report leaves out that a checked stamp names, each record
 * once however many authorities stamped it (the checker counts the same way). A
 * stamp counts only over a record this chain holds and the report does not: a
 * stamp over a held record that the report could not carry (from before a key
 * change) is not over a left-out record, and a stamp over an archived month's
 * record is not counted here.
 */
export function stampedRecordsLeftOut(
  anchors: readonly ChainAnchor[],
  records: readonly ForensicRecord[],
  held: readonly ForensicRecord[],
): number {
  const byStamp = new Map<string, ForensicRecord>();
  for (const r of records) {
    if (typeof r.chainPosition === 'number') byStamp.set(`${r.chainPosition}:${r.integrityHash}`, r);
  }
  const heldIds = new Set(held.map((r) => r.id));
  const leftOut = new Set<string>();
  for (const a of installCheckedAnchors([...anchors])) {
    const key = `${a.anchoredChainPosition}:${a.anchoredIntegrityHash}`;
    const r = byStamp.get(key);
    if (r && !heldIds.has(r.id)) leftOut.add(key);
  }
  return leftOut.size;
}

/**
 * Standalone HTML forensic
 * verifier export per VISION §7.2. Builds a self-contained HTML file with
 * embedded Web Crypto verifier + records inline + descriptive page-1
 * summary. Recipient opens the
 * file in any modern browser; clicks "Verify all records"; results render
 * client-side without server contact.
 *
 * locale: 'en' | 'ro' single-language template per V1 §7.2 scope.
 * precisionDisclosure: optional operating-point string per VISION §7.1.
 */
export async function exportHtml(
  records: ForensicRecord[],
  filter?: ExportFilterResult,
  locale: ExportLocale = 'en',
  precisionDisclosure?: string,
): Promise<ExportReceipt> {
  const html = await buildHtmlExportDocument(records, filter, locale, precisionDisclosure);
  const profile = await buildExportProfile();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  // Named for what it is: a report, a selection the file states under its
  // signature. The whole record is the other file (2026-09-06, after the
  // owner read his own "verification report" as partially verified on the
  // check page and could not tell why).
  return deliverHtml(html, `feedprint-report-${namePart(profile.name)}${timestamp}.html`);
}

/**
 * The standalone HTML export as a string, before any download. The Export
 * tab's file button and the donation card (donation.ts) build the same
 * document, so what a recipient organisation receives is byte-for-byte the
 * file the user could have saved and checked themselves.
 */
/**
 * The accounts the person set aside on this computer, for the file's "Accounts not recorded" section (his word, 12 Oct
 * 2026). The names come from the setting and not from the chain, which carries only the count of records withheld, so the
 * section says both. `named: false` prints the number alone, for a file that leaves the person's hands.
 */
async function excludedAccountsForExport(named: boolean): Promise<ExportMetadata['excludedAccounts']> {
  const list = await readExclusions();
  if (list.length === 0) return undefined;
  const accounts = list
    .map(e => ({ platform: e.platform, author: e.author, addedAt: e.addedAt }))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.author.localeCompare(b.author));
  return { accounts, named };
}

export async function buildHtmlExportDocument(
  records: ForensicRecord[],
  filter?: ExportFilterResult,
  locale: ExportLocale = 'en',
  precisionDisclosure?: string,
  options: { nameExcludedAccounts?: boolean } = {},
): Promise<string> {
  const targetRecords = filter ? filter.included : records;
  const publicKeyJwk = await getPublicKeyJWK();
  const publicKeyFingerprint = await getPublicKeyFingerprint();
  const publicKeys = await publicKeysForExport(targetRecords, publicKeyJwk ?? {}, publicKeyFingerprint ?? '');
  // Read once: two reads could straddle a new stamp.
  const allAnchors = await getAnchors();
  const anchors = filter ? anchorsOverHeldRecords(allAnchors, targetRecords) : allAnchors;
  const fwVersion = extensionLabel(chrome?.runtime?.getManifest?.());
  const keyGenesis = await getKeyGenesis();
  const keyOrigins = await getSigningKeyOrigins();
  const signingKeyCreatedAt = await getSigningKeyCreatedAt();
  const profile = await buildExportProfile();
  // Withheld records leave blanked, with their markers (redaction.ts).
  return attachSignedManifest(buildForensicHtmlExport(applyRedactions(targetRecords, records), {
    fwVersion,
    publicKeyJwk: publicKeyJwk ?? {},
    publicKeyFingerprint: publicKeyFingerprint ?? '',
    publicKeys,
    locale,
    profile,
    precisionDisclosure,
    anchors,
    keyGenesis: keyGenesis ?? undefined,
    keyOrigins,
    healLog: await readHealLog(),
    signingKeyCreatedAt,
    methodology: buildMethodologyBlock(currentExtensionVersion()),
    excludedAccounts: await excludedAccountsForExport(options.nameExcludedAccounts !== false),
    // The same exclusion facts CSV and JSON have always carried in their
    // caveat paragraph. Without them this file states a count and lets the
    // reader assume it is everything.
    ...(filter
      ? {
          stampedRecordsLeftOut: stampedRecordsLeftOut(allAnchors, records, targetRecords),
          selection: {
            included: filter.included.length,
            totalSource: filter.totalSource,
            excludedUnreviewed: filter.excludedUnreviewed,
            excludedLowConfidence: filter.excludedLowConfidence,
            excludedNonDetection: filter.excludedNonDetection,
          },
        }
      : {}),
  }));
}

/**
 * Complete retained-chain export. Bypasses `applyExportGate` so the
 * full chronological forensic chain is included: pass records (posts scanned
 * and not flagged), environment records (comment-section room verdicts),
 * AI-content blocks (videos blocked by parent rule), AND flagged manipulation
 * records — everything in IDB, sorted by chainPosition.
 *
 * Use case: parent wants the chronological history of what FW scanned, for
 * transparency / audit / "show me everything" UX. Differs from the flagged-
 * only export (which targets adversarial-evidence use cases) — the flagged
 * subset is a curated extract; the complete retained chain is the full audit
 * trail currently kept by this install/export.
 *
 * Each record still carries its ECDSA P-256 signature; the recipient HTML
 * verifier (Web Crypto) checks every signature independently and reports any
 * unavailable signing key as unverified regardless of
 * verdict shape.
 */
/**
 * Sort-key builder for the complete-chain exports:
 *   1. ACTIVE chain records (chainPosition >= 0, not relegated) in ascending
 *      chainPosition order;
 *   2. relegated pre-rekey records as a SEPARATE trailing section, grouped
 *      by GENERATION (signing-key fingerprint — one keypair per rekey era),
 *      generations in first-seen-timestamp order, each in its original
 *      chainPosition order. Relegated records keep their original positions
 *      (canonical-hashed content — never stripped), and an install that
 *      rekeyed more than once holds multiple relegated generations whose
 *      position ranges overlap (each prior chain started at 0): a plain
 *      position sort would interleave them (A@0, B@0, A@1, B@1 …) and the
 *      verifier's contiguity link-walk would compare unrelated records from
 *      different generations and report a FALSE chain-link-mismatch.
 *      Grouping keeps each generation's prev-hash adjacency intact, so the
 *      walk verifies real links inside a generation and skips every
 *      cross-generation boundary (positions are never prev+1 across the
 *      stride gap unless they truly continued the same chain — in which
 *      case the link is genuine and verifies);
 *   3. pre-chain (legacy v1, chainPosition === -1 or undefined) records and
 *      position-less relegated records last. Pre-2026-05-24 the `?? 0`
 *      coercion mixed legacy records before chainPosition 0, misleading the
 *      recipient. Audit A4-HIGH-4.
 * Exported for the export/dashboard verdict-parity regression test.
 */
const PRE_REKEY_SECTION_OFFSET = 2 ** 42;
/** Wider than any single chain can grow (year-scale ≈ 10^5 records). */
const PRE_REKEY_GENERATION_STRIDE = 2 ** 21;
export function buildCompleteChainSortKey(
  records: ForensicRecord[],
): (r: ForensicRecord) => number {
  // Generation ordinal per signing-key fingerprint, in first-seen timestamp
  // order so older relegated eras read first. Unfingerprinted records share
  // one bucket (early installs predating the fingerprint stamp).
  const ordinals = new Map<string, number>();
  const relegated = records
    .filter(r => r.chainAnchor === 'pre-rekey')
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  for (const r of relegated) {
    const fp = r.publicKeyFingerprint ?? '';
    if (!ordinals.has(fp)) ordinals.set(fp, ordinals.size);
  }
  return (r: ForensicRecord): number => {
    const pos = typeof r.chainPosition === 'number' && r.chainPosition >= 0
      ? r.chainPosition
      : undefined;
    if (r.chainAnchor === 'pre-rekey') {
      if (pos === undefined) return Number.POSITIVE_INFINITY;
      const gen = ordinals.get(r.publicKeyFingerprint ?? '') ?? 0;
      return PRE_REKEY_SECTION_OFFSET + gen * PRE_REKEY_GENERATION_STRIDE + pos;
    }
    return pos !== undefined ? pos : Number.POSITIVE_INFINITY;
  };
}

// The per-chain HTML export (exportCompleteChainHtml) stood here until 2026-09-16. It wrote the
// active chain alone, under the name receipts-current-chain-*; no button in the product called it
// after the whole-record export took over (found 2026-08-10: the per-chain file produced "10k
// fragments"), and only its tests kept it compiling. Deleted with PLAN-2026-09-16 item 6.2; the
// free-export lock it carried now sits on the two entry points the dashboard actually calls.

/**
 * Q35: ONE file covering everything this install still holds: every
 * archived month (oldest first, in stored chain order) followed by the
 * active chain. The active chain caps at 10,000 records and month rotation
 * moves history into per-month archive databases, so the per-chain export
 * alone produced "10k fragments" (found 2026-08-10). The embedded verifier
 * is gap-tolerant: it enforces links only on contiguous chainPositions, so
 * month boundaries (terminal position N followed by the next month's
 * position 0) are skipped while every within-month link and every
 * per-record signature still verifies.
 */
/** The steps of the whole-record export, in order, for a progress line (wiring audit 13 Sep, D2-28). */
export type EverythingExportStage = 'reading-archives' | 'reading-keys' | 'building' | 'saving';

/** Let the page paint the progress line before the next step, which may hold the thread. */
const yieldToPaint = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function exportEverythingHtml(
  activeRecords: ForensicRecord[],
  locale: ExportLocale = 'en',
  precisionDisclosure?: string,
  onStage?: (stage: EverythingExportStage, records: number) => void,
): Promise<{ archivedMonths: number; totalRecords: number; receipt: ExportReceipt }> {
  const stage = async (s: EverythingExportStage, n: number): Promise<void> => {
    if (!onStage) return;
    onStage(s, n);
    await yieldToPaint();
  };
  await stage('reading-archives', activeRecords.length);
  const archives = await loadArchivesOldestFirst();
  const archived = archives.flatMap(a => a.records);
  // Prior-generation records recovered from earlier exports after the app had
  // already destroyed them. They carry chainAnchor 'pre-rekey', so the sort
  // key below places them in a trailing section grouped by signing key rather
  // than interleaving their chainPositions with the live chain's — which
  // would make recovered evidence read as a broken chain. Sorted together
  // with the active records so one call sees every generation present.
  const salvaged = await readSalvagedRecords();
  const sortKey = buildCompleteChainSortKey([...activeRecords, ...salvaged]);
  const sortedActive = [...activeRecords, ...salvaged].sort((a, b) => sortKey(a) - sortKey(b));
  // De-duplicate by record id. Archive-on-evict writes a record to its month
  // archive BEFORE deleting it from the active chain (the ordering is
  // deliberate: an interruption between the two must leave a duplicate, never
  // a hole). A record caught mid-move is therefore in both lists, and shipping
  // it twice would make the recipient's contiguity walk read a repeated
  // chainPosition as a broken chain. The archived copy wins: it is the one
  // that is already immutable.
  const seen = new Set<string>();
  const all = [...archived, ...sortedActive].filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });
  // Archived rows that did not decode leave holes in this file, and it says how many under its
  // signature so the holes are not read as a filtered extract or a removal. A row whose record came
  // in from the live chain left no hole.
  const unreadableArchivedRows = archives
    .flatMap(a => a.unreadable ?? [])
    .filter(u => !(typeof u.id === 'string' && seen.has(u.id)))
    .length;
  await stage('reading-keys', all.length);
  const publicKeyJwk = await getPublicKeyJWK();
  const publicKeyFingerprint = await getPublicKeyFingerprint();
  const publicKeys = await publicKeysForExport(all, publicKeyJwk ?? {}, publicKeyFingerprint ?? '');
  // Every month's independent timestamps, not only the live one's. Rotation
  // clears the active sidecar, so before 2026-09-04 an "everything" export
  // carried records going back months and anchors going back to the first of
  // the month. De-duplicated by anchor id because a rotation that wrote the
  // archive and failed the cutover leaves the same anchor in both places.
  const archivedAnchors = archives.flatMap(a => a.anchors ?? []);
  const seenAnchor = new Set<string>();
  const anchors = [...archivedAnchors, ...(await getAnchors())].filter(a => {
    // A month whose archive predates the anchors store, or whose read failed,
    // contributes nothing rather than a hole in the list.
    if (!a || typeof a.id !== 'string') return false;
    if (seenAnchor.has(a.id)) return false;
    seenAnchor.add(a.id);
    return true;
  });
  const fwVersion = extensionLabel(typeof chrome !== 'undefined' ? chrome.runtime?.getManifest?.() : undefined);
  const keyGenesis = await getKeyGenesis();
  const keyOrigins = await getSigningKeyOrigins();
  const signingKeyCreatedAt = await getSigningKeyCreatedAt();
  const profile = await buildExportProfile();
  await stage('building', all.length);
  const html = await attachSignedManifest(buildForensicHtmlExport(applyRedactions(all), {
    fwVersion,
    publicKeyJwk: publicKeyJwk ?? {},
    publicKeyFingerprint: publicKeyFingerprint ?? '',
    publicKeys,
    locale,
    profile,
    precisionDisclosure,
    anchors,
    keyGenesis: keyGenesis ?? undefined,
    keyOrigins,
    healLog: await readHealLog(),
    signingKeyCreatedAt,
    methodology: buildMethodologyBlock(currentExtensionVersion()),
    excludedAccounts: await excludedAccountsForExport(true),
    unreadableArchivedRows,
  }));
  await stage('saving', all.length);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const receipt = await deliverHtml(html, `feedprint-whole-record-${namePart(profile.name)}${timestamp}.html`);
  return { archivedMonths: archives.length, totalRecords: all.length, receipt };
}

/**
 * What a download button can say afterwards: the file's name and size. The
 * HTML exports return a full ExportReceipt with a digest; JSON and CSV are
 * built synchronously and hand back this lighter shape so the Export tab can
 * print a receipt for every button (wiring audit 13 Sep, D2-5).
 */
export interface DownloadNote {
  filename: string;
  bytes: number;
}

export function exportJSON(records: ForensicRecord[], filter?: ExportFilterResult): DownloadNote {
  // P0.3 — when called with a filter result, wrap the records in a header
  // that carries the caveat + exclusion counts. Legacy callers (no filter)
  // get a bare array for back-compat.
  const payload = filter
    ? {
        caveat: caveatText(filter),
        included_count: filter.included.length,
        total_source: filter.totalSource,
        excluded: {
          unreviewed: filter.excludedUnreviewed,
          below_severity_threshold: filter.excludedLowConfidence,
          // Back-compat alias for older consumers of the wrapped JSON export.
          low_confidence: filter.excludedLowConfidence,
          non_detection: filter.excludedNonDetection,
        },
        // "Under what criteria was this identified" — verbatim model
        // instructions + pins + thresholds (design decision, 2026-07-02).
        methodology: buildMethodologyBlock(currentExtensionVersion()),
        // Withheld records leave blanked, WITH their markers (redaction.ts: "a blanked record
        // with no marker fails"). The gate drops every marker as a non-detection, and until
        // 2026-09-20 only the HTML export put them back, so this file held a record naming a
        // marker that was not in it. included_count stays the count of content; the markers
        // are counted beside it so the two numbers and the array length add up.
        redaction_markers: applyRedactions(filter.included, records).length - filter.included.length,
        records: applyRedactions(filter.included, records),
      }
    : records;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `feedprint-records-${timestamp}.json`;
  triggerDownload(blob, filename);
  return { filename, bytes: blob.size };
}

// Spreadsheet formula leaders. A cell starting with any of these is executed
// as a formula by Excel, Sheets and LibreOffice on open.
const CSV_FORMULA_LEADERS = /^[=+\-@\t\r]/;
// A plain number is never a formula, and prefixing it would corrupt a numeric
// column — `-3` must stay `-3`, while `-2+3+cmd|'/c calc'!A0` must not.
const CSV_PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * CSV cell escaping for a file that is handed to outsiders.
 *
 * Quoting alone is not enough. Author names, post text and URLs are written by
 * whoever posted the content, and a value starting with `=`, `+`, `-`, `@`, tab
 * or CR runs as a live formula when the evidence file is opened — the export
 * exists to be believed, so it must not be able to act. A single quote in front
 * neutralizes it; every spreadsheet strips that character on display.
 */
function escapeCSV(raw: string | undefined): string {
  const value = raw ?? '';
  const guarded = CSV_FORMULA_LEADERS.test(value) && !CSV_PLAIN_NUMBER.test(value)
    ? `'${value}`
    : value;
  // \r must quote too: a bare carriage return inside an unquoted field splits
  // the row for a strict CSV reader.
  if (guarded.includes(',') || guarded.includes('"') || guarded.includes('\n') || guarded.includes('\r')) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

function modeAtCapture(record: ForensicRecord): ForensicRecord['userAgeCategory'] {
  const snapshotMode = record.configSnapshot?.mode;
  return levelOfRecorded(snapshotMode) ? (snapshotMode as ForensicRecord['userAgeCategory']) : record.userAgeCategory;
}

function shownAsText(r: ForensicRecord): string {
  const key = standInKey(r);
  return key ? I18N.en[key] : '';
}

/** What a withheld field prints as in the CSV. A redaction marker in the HTML or JSON export attests it. */
const CSV_WITHHELD = '[withheld]';
function withheldOr(r: ForensicRecord, value: string | undefined): string {
  return value === undefined && r.redacted ? CSV_WITHHELD : (value ?? '');
}

/** "provider / model: outcome" for a record the paid reading's Claude reader was asked about; '' otherwise. */
export function paidReadingCell(r: ForensicRecord): string {
  const c = r.decision?.claude;
  return c ? `${c.provider} / ${c.model}: ${c.outcome}` : '';
}

export function exportCSV(records: ForensicRecord[], filter?: ExportFilterResult): DownloadNote {
  // P0.3: the caveat rides in the file as a `# ` row. It sits LAST since 11 Oct 2026: first, a spreadsheet took it as
  // row 1 and the column names as row 2. The column names are row 1 now, and the sentence is the final row, so it
  // is still in the file a recipient opens. The JSON and the HTML report keep it at the top.
  const caveatRow = filter ? `\n# ${caveatText(filter)}` : '';
  const targetRecords = filter ? filter.included : records;
  // A hidden and a marked item differ in no other column (their
  // neutralized_text and visual_applied are both empty), so `action` names the
  // applied outcome the dashboard chip shows (feed-action.ts). It is read from
  // fields already on the record, never a new signed field.
  const header = 'timestamp,platform,author,post_url,techniques,severity,original_length,original_text,text_shown_as,neutralized_text,ai_model,ai_provider,detection_mode,mode_at_capture,config_mode,config_threshold,config_daily_cap,config_video_understanding,config_image_understanding,config_enabled_features,config_settings_read_failed,visual_applied,text_capture,author_capture,action,paid_reading';
  const rows = targetRecords.map(r => {
    const techniques = r.techniques.map(t => t.name).join(';');
    return [
      escapeCSV(r.timestamp),
      escapeCSV(r.platform),
      escapeCSV(withheldOr(r, r.author)),
      escapeCSV(withheldOr(r, r.postUrl)),
      escapeCSV(techniques),
      escapeCSV(String(r.overallScore)),
      escapeCSV(String(r.originalLength)),
      escapeCSV(withheldOr(r, r.originalText)),
      // original_text stays as stored, because the record's hash covers those bytes and a checker re-hashes them. A
      // caption-less hidden item is stored under a marker nobody saw, so this column says what it was (stand-in.ts).
      escapeCSV(shownAsText(r)),
      escapeCSV(withheldOr(r, r.neutralizedText)),
      escapeCSV(r.aiModel ?? ''),
      escapeCSV(r.aiProvider ?? ''),
      escapeCSV(r.detectionMode ?? ''),
      escapeCSV(modeAtCapture(r)),
      escapeCSV(r.configSnapshot?.mode ?? ''),
      escapeCSV(r.configSnapshot ? String(r.configSnapshot.threshold) : ''),
      escapeCSV(r.configSnapshot ? String(r.configSnapshot.dailyCap) : ''),
      // Empty means the record predates the field or was written before the
      // start gate resolved. It never means "off" — see ConfigSnapshot.
      escapeCSV(r.configSnapshot?.videoUnderstanding ?? ''),
      escapeCSV(r.configSnapshot?.imageUnderstanding ?? ''),
      // Both fields are hashed into the record precisely because the mode
      // tag alone cannot prove which protections were live; an export that
      // drops them defeats that defense. enabledFeatures is the sorted
      // feature-id list; settings_read_failed=true marks a record written
      // while settings were unreadable and FW protected at maximum (do NOT
      // read its mode as an attested child install).
      escapeCSV((r.configSnapshot?.enabledFeatures ?? []).join(';')),
      escapeCSV(r.configSnapshot?.settingsReadFailed === true ? 'true' : ''),
      // 'false' only on a hide/collapse whose DOM change did not apply (the
      // child may have seen the post; in Child the cover stayed on). Empty
      // means the visual landed or the record predates the field.
      escapeCSV(r.visualApplied === false ? 'false' : ''),
      // 'whole', 'folded' or 'cut' (what the page carried against what the
      // screen showed). Empty means the record predates the field or the item
      // did not pass through the detector; it never means whole.
      escapeCSV(r.textCapture ?? ''),
      // 'withheld' when the recorder saw an author and refused it because it
      // could not show the header and the body belonged to the same item.
      // Empty means the author is the one the page showed, or the record
      // predates the field.
      escapeCSV(r.authorCapture ?? ''),
      escapeCSV(feedActionKeyFor(r) ?? ''),
      // The paid reading's Claude reader, when it was asked: "provider / model: outcome". Empty means
      // it was not asked (a free key, the switch off, or a record from before it existed); it never
      // means the pair alone acted when Claude agreed, because then the cell is filled.
      escapeCSV(paidReadingCell(r)),
    ].join(',');
  });

  const csv = [header, ...rows].join('\n') + caveatRow;
  const blob = new Blob([csv], { type: 'text/csv' });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `feedprint-records-${timestamp}.csv`;
  triggerDownload(blob, filename);
  return { filename, bytes: blob.size };
}

// ─── PDF (via browser print) ───

type PDFLocale = ExportLocale;

const PDF_STRINGS: Record<PDFLocale, Record<string, string>> = {
  en: {
    title: 'FeelingWise Verification Report',
    generated: 'Generated',
    summary: 'Summary',
    totalRecords: 'Total records',
    dateRange: 'Date range',
    platforms: 'Platforms',
    records: 'Records',
    platform: 'Platform',
    author: 'Author',
    timestamp: 'Timestamp',
    originalPost: 'Original post',
    authorWithheld: 'not established',
    adAuthorNotShown: 'Sponsored post, advertiser not shown',
    recordWithheld: 'Withheld at the request of the person who made this report. The record keeps its place, its hash and its signature; a signed marker in the HTML and JSON exports attests the withholding.',
    authorWithheldWhy: 'The page showed a name beside this item and the recorder refused it: it could not show that the header and the words belonged to the same item, because the feed reuses one slot for a new item while it is being read. No name is recorded rather than the wrong one.',
    textCaptureCut: 'The page carried the first {n} characters; the rest was behind a control the recorder does not press.',
    textCaptureFolded: 'The page carried the whole text; the screen showed the first lines behind a control.',
    textCapturePlatform: 'The page showed no text for this item, or only part of it. This caption is what the platform\'s own data sent for it.',
    neutralizedPost: 'Neutralized version',
    techniques: 'Pattern techniques',
    severity: 'Severity',
    confidence: 'confidence',
    originalHash: 'Original content hash (SHA-256)',
    integrityHash: 'Record integrity hash',
    aiProvider: 'AI provider',
    aiModel: 'AI model',
    paidReading: 'Paid reading',
    detectionMode: 'Detection mode',
    activeMode: 'Mode at capture',
    postUrl: 'Source URL',
    configSnapshot: 'Configuration at detection',
    enabledFeaturesLabel: 'Protections on at capture',
    settingsReadFailedNote: 'Settings were unreadable when this record was written; the app protected at maximum strength. The mode shown is the fail-safe default, not an attested setting.',
    visualNotAppliedNote: 'The hide could not be applied on the page. At Silent the checking cover stayed on; at the other levels the post may have been visible.',
    videoUnderstandingLabel: 'Media Safety Signals',
    imageUnderstandingLabel: 'Image Safety Signals',
    mediaState_on: 'on',
    mediaState_off: 'off',
    mediaState_unlicensed: 'off (no paid licence)',
    'mediaState_platform-excluded': 'off (not available on this platform)',
    'mediaState_surface-excluded': 'off (private messages)',
    chainOfCustody: 'Record Integrity Summary',
    chainText: 'Records in this report were recorded automatically by the FeelingWise browser extension at the time of detection. Each record was cryptographically hashed using SHA-256 when written. The integrity hashes shown above allow a recipient to independently check whether an included record changed after it was written. This document is a review packet and integrity-checkable record export; it is not a legal opinion.',
    page: 'Page',
    of: 'of',
    printInstruction: 'To save as PDF: your browser\'s print dialog should open automatically. In the destination dropdown, select "Save as PDF" and click Save.',
    noRecords: 'No records to export. Browse a supported public platform first; neutralized posts are recorded automatically.',
    attestationTitle: 'Exporter Review Note',
    attestationBody: 'I, the undersigned, state that this report is the export I reviewed from the FeelingWise records included between the dates shown in the Summary section above. Any redaction, omission, or later change should be checked against the verification result.',
    signatureName: 'Signature',
    signaturePrintName: 'Print name',
    signatureDate: 'Date',
    signatureLocation: 'Location',
    generatedByFooter: 'Report generated by the FeelingWise browser extension',
    cryptoVerification: 'Cryptographic Verification',
    cryptoVerificationBody: 'Every record above carries an ECDSA P-256 signature over its integrity hash, produced by the signing key generated locally on this FeelingWise install. A recipient can check whether any record changed after it was written by using the public key below together with the Web Crypto API (see verification snippet). If ANY record field is altered, the integrity hash changes and the signature no longer verifies — the change is visible.',
    publicKeyLabel: 'Public key (JWK)',
    fingerprintLabel: 'Public key fingerprint (first 16 hex of SHA-256 over x|y)',
    keyCreatedLabel: 'Key generated at',
    recordSignatureLabel: 'Signature',
    verifyInstructionsTitle: 'How to verify',
    verifyInstructions: 'Import the Public Key above into any ECDSA P-256 / SHA-256 verifier (e.g., OpenSSL, Python cryptography, JavaScript Web Crypto). Feed each record\'s integrity hash string (UTF-8) and the base64url-decoded signature into the verify call. A passing verification result means that record was signed by this install and has not changed since. A failing verification result means the record changed or the export is damaged.',
    verificationNotAvailable: 'Signing key unavailable — records in this export pre-date the signing rollout or the key was not initialized on this device.',
  },
  ro: {
    title: 'Raport de verificare FeelingWise',
    generated: 'Generat',
    summary: 'Sumar',
    totalRecords: 'Total înregistrări',
    dateRange: 'Interval de date',
    platforms: 'Platforme',
    records: 'Înregistrări',
    platform: 'Platformă',
    author: 'Autor',
    timestamp: 'Data și ora',
    originalPost: 'Postare originală',
    authorWithheld: 'nestabilit',
    adAuthorNotShown: 'Postare sponsorizată, advertiserul nu este afișat',
    recordWithheld: 'Reținut la cererea celui care a făcut acest raport. Înregistrarea își păstrează locul, hash-ul și semnătura; un marcaj semnat din exporturile HTML și JSON atestă reținerea.',
    authorWithheldWhy: 'Pagina a arătat un nume lângă acest element, iar înregistratorul l-a refuzat: nu a putut arăta că antetul și cuvintele aparțin aceluiași element, fiindcă fluxul refolosește același loc pentru un element nou în timp ce este citit. Nu se înregistrează niciun nume, în loc de unul greșit.',
    textCaptureCut: 'Pagina a purtat primele {n} caractere; restul era în spatele unui buton pe care înregistratorul nu îl apasă.',
    textCaptureFolded: 'Pagina a purtat tot textul; ecranul a arătat primele rânduri, restul în spatele unui buton.',
    textCapturePlatform: 'Pagina nu a arătat niciun text pentru acest element, sau doar o parte din el. Această descriere este ce au trimis datele platformei pentru el.',
    neutralizedPost: 'Versiune neutralizată',
    techniques: 'Tipare detectate',
    severity: 'Severitate',
    confidence: 'încredere',
    originalHash: 'Hash conținut original (SHA-256)',
    integrityHash: 'Hash de integritate al registrului',
    aiProvider: 'Furnizor AI',
    aiModel: 'Model AI',
    paidReading: 'Analiza plătită',
    detectionMode: 'Mod detecție',
    activeMode: 'Mod la capturare',
    postUrl: 'URL sursă',
    configSnapshot: 'Configurație la detectare',
    enabledFeaturesLabel: 'Protecții active la capturare',
    settingsReadFailedNote: 'Setările nu au putut fi citite când a fost scrisă această înregistrare; aplicația a protejat la nivel maxim. Modul afișat este valoarea implicită de siguranță, nu o setare atestată.',
    visualNotAppliedNote: 'Ascunderea nu a putut fi aplicată pe pagină. La nivelul Silențios, acoperirea de verificare a rămas activă; la celelalte niveluri postarea poate să fi fost vizibilă.',
    videoUnderstandingLabel: 'Media Safety Signals',
    imageUnderstandingLabel: 'Image Safety Signals',
    mediaState_on: 'pornit',
    mediaState_off: 'oprit',
    mediaState_unlicensed: 'oprit (fără licență plătită)',
    'mediaState_platform-excluded': 'oprit (indisponibil pe această platformă)',
    'mediaState_surface-excluded': 'oprit (mesaje private)',
    chainOfCustody: 'Rezumat de integritate al registrului',
    chainText: 'Înregistrările din acest raport au fost înregistrate automat de extensia FeelingWise la momentul detectării. Fiecare înregistrare a fost hash-uită criptografic folosind SHA-256 la scriere. Hash-urile de integritate afișate mai sus permit destinatarului să verifice dacă o înregistrare inclusă s-a schimbat după scriere. Acest document este un pachet de revizuire și un export verificabil; nu este o opinie juridică.',
    page: 'Pagina',
    of: 'din',
    printInstruction: 'Pentru a salva ca PDF: dialogul de imprimare al browserului ar trebui să se deschidă automat. În lista de destinații, selectează "Salvează ca PDF" și apasă Salvează.',
    noRecords: 'Nu există înregistrări de exportat. Navighează mai întâi pe o platformă publică acceptată; postările neutralizate sunt înregistrate automat.',
    attestationTitle: 'Notă de revizuire a exportatorului',
    attestationBody: 'Eu, subsemnatul, declar că acesta este exportul pe care l-am revizuit din înregistrările FeelingWise incluse între datele afișate în secțiunea Sumar de mai sus. Orice redactare, omisiune sau modificare ulterioară trebuie verificată prin rezultatul de verificare.',
    signatureName: 'Semnătură',
    signaturePrintName: 'Nume în clar',
    signatureDate: 'Data',
    signatureLocation: 'Locația',
    generatedByFooter: 'Raport generat de extensia FeelingWise',
    cryptoVerification: 'Verificare criptografică',
    cryptoVerificationBody: 'Fiecare înregistrare de mai sus poartă o semnătură ECDSA P-256 peste hash-ul său de integritate, produsă de cheia de semnare generată local pe această instalare FeelingWise. Un destinatar poate verifica dacă o înregistrare s-a schimbat după scriere folosind cheia publică de mai jos împreună cu API-ul Web Crypto (vezi instrucțiunile). Dacă ORICE câmp al înregistrării este modificat, hash-ul de integritate se schimbă și semnătura nu mai verifică — schimbarea este vizibilă.',
    publicKeyLabel: 'Cheie publică (JWK)',
    fingerprintLabel: 'Amprentă cheie publică (primele 16 hex SHA-256 peste x|y)',
    keyCreatedLabel: 'Cheia a fost generată la',
    recordSignatureLabel: 'Semnătură',
    verifyInstructionsTitle: 'Cum se verifică',
    verifyInstructions: 'Importă cheia publică de mai sus în orice verificator ECDSA P-256 / SHA-256 (de ex. OpenSSL, Python cryptography, JavaScript Web Crypto). Furnizează hash-ul de integritate al fiecărei înregistrări (UTF-8) și semnătura decodată din base64url în apelul de verificare. Un rezultat pozitiv înseamnă că acea înregistrare a fost semnată de această instalare și nu s-a schimbat de atunci. Un rezultat negativ înseamnă că înregistrarea s-a schimbat sau exportul este deteriorat.',
    verificationNotAvailable: 'Cheia de semnare nu este disponibilă — înregistrările din acest export sunt anterioare integrării semnăturii sau cheia nu a fost inițializată pe acest dispozitiv.',
  },
  es: {
    title: 'Informe de verificación de FeelingWise',
    generated: 'Generado',
    summary: 'Resumen',
    totalRecords: 'Registros en total',
    dateRange: 'Rango de fechas',
    platforms: 'Plataformas',
    records: 'Registros',
    platform: 'Plataforma',
    author: 'Autor',
    timestamp: 'Marca de tiempo',
    originalPost: 'Publicación original',
    authorWithheld: 'no establecido',
    adAuthorNotShown: 'Publicación patrocinada, anunciante no indicado',
    recordWithheld: 'Retenido a petición de quien hizo este informe. El registro conserva su lugar, su hash y su firma; una marca firmada en las exportaciones HTML y JSON atestigua la retención.',
    authorWithheldWhy: 'La página mostró un nombre junto a este elemento y el registrador lo rechazó: no pudo demostrar que el encabezado y las palabras pertenecían al mismo elemento, porque el feed reutiliza un mismo hueco para un elemento nuevo mientras se lee. No se registra ningún nombre en lugar de uno equivocado.',
    textCaptureCut: 'La página llevaba los primeros {n} caracteres; el resto estaba detrás de un control que el registrador no pulsa.',
    textCaptureFolded: 'La página llevaba el texto completo; la pantalla mostró las primeras líneas detrás de un control.',
    textCapturePlatform: 'La página no mostró texto para este elemento, o solo parte de él. Esta descripción es lo que enviaron los datos de la propia plataforma.',
    neutralizedPost: 'Versión neutralizada',
    techniques: 'Técnicas del patrón',
    severity: 'Gravedad',
    confidence: 'confianza',
    originalHash: 'Hash del contenido original (SHA-256)',
    integrityHash: 'Hash de integridad del registro',
    aiProvider: 'Proveedor de IA',
    aiModel: 'Modelo de IA',
    paidReading: 'Lectura de pago',
    detectionMode: 'Modo de detección',
    activeMode: 'Modo al capturar',
    postUrl: 'URL de origen',
    configSnapshot: 'Configuración en el momento de la detección',
    enabledFeaturesLabel: 'Protecciones activas al capturar',
    settingsReadFailedNote: 'Los ajustes no se pudieron leer cuando se escribió este registro; la aplicación protegió al máximo. El modo que se muestra es el valor seguro por defecto, no un ajuste atestiguado.',
    visualNotAppliedNote: 'La ocultación no se pudo aplicar en la página. En Silencioso la tapa de comprobación se mantuvo; en los otros niveles la publicación puede haber estado visible.',
    videoUnderstandingLabel: 'Señales de seguridad en medios',
    imageUnderstandingLabel: 'Señales de seguridad en imágenes',
    mediaState_on: 'activo',
    mediaState_off: 'apagado',
    mediaState_unlicensed: 'apagado (sin licencia de pago)',
    'mediaState_platform-excluded': 'apagado (no disponible en esta plataforma)',
    'mediaState_surface-excluded': 'apagado (mensajes privados)',
    chainOfCustody: 'Resumen de integridad del registro',
    chainText: 'Los registros de este informe los registró automáticamente la extensión de navegador FeelingWise en el momento de la detección. Cada registro se sometió a un hash criptográfico SHA-256 al escribirse. Los hashes de integridad mostrados arriba permiten a quien recibe el archivo comprobar por su cuenta si un registro incluido cambió después de escribirse. Este documento es un paquete de revisión y una exportación de registros comprobable; no es una opinión jurídica.',
    page: 'Página',
    of: 'de',
    printInstruction: 'Para guardar como PDF: el diálogo de impresión de tu navegador debería abrirse solo. En la lista de destinos, elige "Guardar como PDF" y pulsa Guardar.',
    noRecords: 'No hay registros que exportar. Navega primero por una plataforma pública compatible; las publicaciones neutralizadas se registran automáticamente.',
    attestationTitle: 'Nota de revisión de quien exporta',
    attestationBody: 'Yo, quien firma abajo, declaro que este informe es la exportación que revisé de los registros de FeelingWise incluidos entre las fechas mostradas en el apartado Resumen de arriba. Cualquier tachadura, omisión o cambio posterior debe contrastarse con el resultado de la verificación.',
    signatureName: 'Firma',
    signaturePrintName: 'Nombre en letra de imprenta',
    signatureDate: 'Fecha',
    signatureLocation: 'Lugar',
    generatedByFooter: 'Informe generado por la extensión de navegador FeelingWise',
    cryptoVerification: 'Verificación criptográfica',
    cryptoVerificationBody: 'Cada registro de arriba lleva una firma ECDSA P-256 sobre su hash de integridad, producida por la clave de firma generada localmente en esta instalación de FeelingWise. Quien recibe el archivo puede comprobar si algún registro cambió después de escribirse usando la clave pública de abajo junto con la Web Crypto API (mira el fragmento de verificación). Si se altera CUALQUIER campo del registro, el hash de integridad cambia y la firma deja de verificarse: el cambio queda a la vista.',
    publicKeyLabel: 'Clave pública (JWK)',
    fingerprintLabel: 'Huella de la clave pública (primeros 16 hex del SHA-256 sobre x|y)',
    keyCreatedLabel: 'Clave generada el',
    recordSignatureLabel: 'Firma',
    verifyInstructionsTitle: 'Cómo verificar',
    verifyInstructions: 'Importa la clave pública de arriba en cualquier verificador ECDSA P-256 / SHA-256 (por ejemplo OpenSSL, Python cryptography o JavaScript Web Crypto). Pasa la cadena del hash de integridad de cada registro (UTF-8) y la firma decodificada de base64url a la llamada de verificación. Un resultado positivo significa que ese registro lo firmó esta instalación y no ha cambiado desde entonces. Un resultado negativo significa que el registro cambió o que la exportación está dañada.',
    verificationNotAvailable: 'Clave de firma no disponible: los registros de esta exportación son anteriores a la llegada de la firma, o la clave no se inicializó en este dispositivo.',
  },
  'pt-BR': {
    title: 'Relatório de verificação do FeelingWise',
    generated: 'Gerado',
    summary: 'Resumo',
    totalRecords: 'Registros no total',
    dateRange: 'Intervalo de datas',
    platforms: 'Plataformas',
    records: 'Registros',
    platform: 'Plataforma',
    author: 'Autor',
    timestamp: 'Marca de tempo',
    originalPost: 'Publicação original',
    authorWithheld: 'não estabelecido',
    adAuthorNotShown: 'Post patrocinado, anunciante não indicado',
    recordWithheld: 'Retido a pedido de quem fez este relatório. O registro mantém o seu lugar, o seu hash e a sua assinatura; uma marca assinada nas exportações HTML e JSON atesta a retenção.',
    authorWithheldWhy: 'A página mostrou um nome ao lado deste item e o gravador o recusou: não conseguiu mostrar que o cabeçalho e as palavras pertenciam ao mesmo item, porque o feed reaproveita um mesmo espaço para um item novo enquanto ele está sendo lido. Nenhum nome é registrado, em vez de um errado.',
    textCaptureCut: 'A página trazia os primeiros {n} caracteres; o resto ficava atrás de um controle que o gravador não pressiona.',
    textCaptureFolded: 'A página trazia o texto inteiro; a tela mostrou as primeiras linhas atrás de um controle.',
    textCapturePlatform: 'A página não mostrou texto para este item, ou apenas parte dele. Esta legenda é o que os dados da própria plataforma enviaram para ele.',
    neutralizedPost: 'Versão neutralizada',
    techniques: 'Técnicas do padrão',
    severity: 'Gravidade',
    confidence: 'confiança',
    originalHash: 'Hash do conteúdo original (SHA-256)',
    integrityHash: 'Hash de integridade do registro',
    aiProvider: 'Provedor de IA',
    aiModel: 'Modelo de IA',
    paidReading: 'Leitura paga',
    detectionMode: 'Modo de detecção',
    activeMode: 'Modo na hora da captura',
    postUrl: 'URL de origem',
    configSnapshot: 'Configuração no momento da detecção',
    enabledFeaturesLabel: 'Proteções ligadas na hora da captura',
    settingsReadFailedNote: 'As configurações não puderam ser lidas quando este registro foi escrito; o aplicativo protegeu no máximo. O modo mostrado é o padrão seguro, não uma configuração atestada.',
    visualNotAppliedNote: 'A ocultação não pôde ser aplicada na página. No Silencioso a tampa de conferência continuou; nos outros níveis a publicação pode ter ficado visível.',
    videoUnderstandingLabel: 'Sinais de segurança em mídia',
    imageUnderstandingLabel: 'Sinais de segurança em imagens',
    mediaState_on: 'ligado',
    mediaState_off: 'desligado',
    mediaState_unlicensed: 'desligado (sem licença paga)',
    'mediaState_platform-excluded': 'desligado (indisponível nesta plataforma)',
    'mediaState_surface-excluded': 'desligado (mensagens privadas)',
    chainOfCustody: 'Resumo de integridade do registro',
    chainText: 'Os registros deste relatório foram registrados automaticamente pela extensão de navegador FeelingWise no momento da detecção. Cada registro passou por um hash criptográfico SHA-256 ao ser escrito. Os hashes de integridade mostrados acima permitem que quem recebe confira por conta própria se um registro incluído mudou depois de ser escrito. Este documento é um pacote de revisão e uma exportação de registros conferível; não é um parecer jurídico.',
    page: 'Página',
    of: 'de',
    printInstruction: 'Para salvar como PDF: a caixa de impressão do seu navegador deve abrir sozinha. Na lista de destinos, escolha "Salvar como PDF" e clique em Salvar.',
    noRecords: 'Não há registros para exportar. Navegue primeiro numa plataforma pública compatível; as publicações neutralizadas são registradas automaticamente.',
    attestationTitle: 'Nota de revisão de quem exporta',
    attestationBody: 'Eu, abaixo assinado, declaro que este relatório é a exportação que revisei dos registros do FeelingWise incluídos entre as datas mostradas na seção Resumo acima. Qualquer supressão, omissão ou mudança posterior deve ser conferida contra o resultado da verificação.',
    signatureName: 'Assinatura',
    signaturePrintName: 'Nome legível',
    signatureDate: 'Data',
    signatureLocation: 'Local',
    generatedByFooter: 'Relatório gerado pela extensão de navegador FeelingWise',
    cryptoVerification: 'Verificação criptográfica',
    cryptoVerificationBody: 'Cada registro acima carrega uma assinatura ECDSA P-256 sobre o hash de integridade dele, produzida pela chave de assinatura gerada localmente nesta instalação do FeelingWise. Quem recebe pode conferir se algum registro mudou depois de escrito usando a chave pública abaixo junto com a Web Crypto API (veja o trecho de verificação). Se QUALQUER campo do registro for alterado, o hash de integridade muda e a assinatura deixa de ser verificada: a mudança fica visível.',
    publicKeyLabel: 'Chave pública (JWK)',
    fingerprintLabel: 'Impressão digital da chave pública (primeiros 16 hex do SHA-256 sobre x|y)',
    keyCreatedLabel: 'Chave gerada em',
    recordSignatureLabel: 'Assinatura',
    verifyInstructionsTitle: 'Como verificar',
    verifyInstructions: 'Importe a chave pública acima em qualquer verificador ECDSA P-256 / SHA-256 (por exemplo OpenSSL, Python cryptography ou JavaScript Web Crypto). Passe a string do hash de integridade de cada registro (UTF-8) e a assinatura decodificada de base64url para a chamada de verificação. Um resultado positivo quer dizer que aquele registro foi assinado por esta instalação e não mudou desde então. Um resultado negativo quer dizer que o registro mudou ou que a exportação está danificada.',
    verificationNotAvailable: 'Chave de assinatura indisponível: os registros desta exportação são anteriores à chegada da assinatura, ou a chave não foi inicializada neste aparelho.',
  },
};

function pt(locale: PDFLocale, key: string): string {
  return PDF_STRINGS[locale]?.[key] ?? PDF_STRINGS.en[key] ?? key;
}

interface VerificationBlock {
  jwk: JsonWebKey | null;
  fingerprint: string | null;
  createdAt: string | null;
}

async function buildVerificationBlock(): Promise<VerificationBlock> {
  try {
    const [jwk, fingerprint, createdAt] = await Promise.all([
      getPublicKeyJWK(),
      getPublicKeyFingerprint(),
      getSigningKeyCreatedAt(),
    ]);
    return { jwk, fingerprint, createdAt };
  } catch {
    return { jwk: null, fingerprint: null, createdAt: null };
  }
}

// The author line's text: withheld first, then the extractors' own 'unknown'
// sentinel flagged instead of printed as a plausible handle, then "Name
// @handle" when the adapter read both and they differ. Mirrors the export's
// own client-side authorDisplay (html-export-scripts.ts FEED_SCRIPT) and
// VERIFIER_SCRIPT_TEMPLATE's recordDetail (cold read finding 5), so a record
// reads the same way in the feed, the record detail and this report.
function authorDisplayText(r: ForensicRecord, s: (k: string) => string): string {
  if (r.authorCapture === 'withheld') return s('authorWithheld');
  const handle = r.author && r.author !== 'unknown' ? r.author : '(unknown)';
  // An ad's account is its advertiser, so an ad the page did not name says that, as the dashboard card does.
  if (handle === '(unknown)' && !r.authorName && isPaidPlacement(r)) return s('adAuthorNotShown');
  // Cold read finding 6: no real handle to pair the name with -- the name
  // stands alone rather than reading "Name @(unknown)".
  if (r.authorName && r.authorName !== handle) return handle === '(unknown)' ? r.authorName : `${r.authorName} @${handle.replace(/^@+/, '')}`;
  return handle;
}

// Exported for tests: the report's rendered content is a product surface a
// recipient reads, so it is asserted directly rather than through exportPDF's
// window/blob plumbing.
export async function buildEvidenceReportHTML(records: ForensicRecord[], locale: PDFLocale, filter?: ExportFilterResult): Promise<string> {
  const s = (k: string) => pt(locale, k);
  const now = new Date();
  const generatedIso = now.toISOString();
  const generatedLocal = now.toLocaleString(intlLocaleFor(locale));
  const verification = await buildVerificationBlock();

  // P0.3 — caveat banner injected after the title block. Belt-and-braces:
  // any reader who skims the report sees the AI-assisted disclaimer and the
  // included/excluded counts before reading individual records.
  const caveatHtml = filter
    ? `<div class="caveat" style="margin: 16px 0; padding: 14px 18px; border-left: 4px solid #c62828; background: #fff3e0; font-size: 13px; line-height: 1.5;">
         <strong>Important:</strong> ${escapeHtml(caveatText(filter))}
       </div>`
    : '';

  // Summary
  const sorted = [...records].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const firstTs = sorted[0]?.timestamp ? new Date(sorted[0].timestamp).toLocaleString(intlLocaleFor(locale)) : '—';
  const lastTs = sorted[sorted.length - 1]?.timestamp ? new Date(sorted[sorted.length - 1].timestamp).toLocaleString(intlLocaleFor(locale)) : '—';
  const platforms = Array.from(new Set(records.map(r => r.platform))).sort();

  const recordsHtml = sorted.map((r, i) => {
    const ts = new Date(r.timestamp).toLocaleString(intlLocaleFor(locale));
    const techniquesHtml = r.techniques.map(t => `
      <li><strong>${escapeHtml(t.name)}</strong> — ${s('severity')} ${t.severity.toFixed(1)}/10, ${(t.confidence * 100).toFixed(0)}% ${s('confidence')}</li>
    `).join('');
    // Media understanding is stated only when the record actually carries it.
    // A record written before the start gate resolved, or before the field
    // existed, says nothing here rather than implying "off".
    const mediaBits = r.configSnapshot
      ? [
          r.configSnapshot.videoUnderstanding
            ? `${s('videoUnderstandingLabel')}=${s(`mediaState_${r.configSnapshot.videoUnderstanding}`)}`
            : '',
          r.configSnapshot.imageUnderstanding
            ? `${s('imageUnderstandingLabel')}=${s(`mediaState_${r.configSnapshot.imageUnderstanding}`)}`
            : '',
        ].filter(Boolean)
      : [];
    // enabledFeatures and settingsReadFailed are hashed into the record
    // precisely because the mode tag alone cannot prove which protections
    // were live; an export that drops them defeats that defense (Q21).
    const enabledFeaturesHtml = r.configSnapshot?.enabledFeatures?.length
      ? `<div class="meta-row"><span class="meta-label">${s('enabledFeaturesLabel')}:</span> ${escapeHtml(r.configSnapshot.enabledFeatures.join(', '))}</div>`
      : '';
    const readFailedHtml = r.configSnapshot?.settingsReadFailed === true
      ? `<div class="meta-row" style="color:#c62828"><strong>${escapeHtml(s('settingsReadFailedNote'))}</strong></div>`
      : '';
    const visualNotAppliedHtml = r.visualApplied === false
      ? `<div class="meta-row" style="color:#c62828"><strong>${escapeHtml(s('visualNotAppliedNote'))}</strong></div>`
      : '';
    const configHtml = r.configSnapshot
      ? `<div class="meta-row"><span class="meta-label">${s('configSnapshot')}:</span> mode=${escapeHtml(r.configSnapshot.mode)}, threshold=${r.configSnapshot.threshold}, dailyCap=${r.configSnapshot.dailyCap}${mediaBits.length ? ', ' + escapeHtml(mediaBits.join(', ')) : ''}</div>${enabledFeaturesHtml}${readFailedHtml}`
      : '';
    // A rewrite is printed when the record holds one. A record with none (a hide, a mark, a video
    // skipped) prints no box: an empty "Neutralized version" reads as a rewrite that came out empty.
    // What the reader was shown is said in the reader's words from the same table the export uses,
    // and only when the record carries a decision block that says it.
    const applied = r.decision?.applied;
    const shownAsWords = I18N[locale];
    // A hidden item stored with no caption reads as what it was, never as its stored marker (stand-in.ts). A hidden ad's
    // label already says so, so it gets no body and no "shown as" row repeating it, as on the dashboard card.
    const standIn = standInKey(r);
    const rewriteHtml = r.neutralizedText
      ? `<div class="section-label">${s('neutralizedPost')}</div>
        <div class="post-text neutralized">${escapeHtml(r.neutralizedText)}</div>`
      : applied && !(isHiddenAd(r) && applied === 'hide')
        ? `<div class="meta-row"><span class="meta-label">${escapeHtml(shownAsWords.feedDecisionShownAs.charAt(0).toUpperCase() + shownAsWords.feedDecisionShownAs.slice(1))}:</span> ${escapeHtml(shownAsWords[`act_${applied}`])}</div>`
        : '';
    return `
      <div class="record">
        <div class="record-header">
          <span class="record-index">#${i + 1}</span>
          <span class="record-platform">${escapeHtml(r.platform)}</span>
          <span class="record-severity" style="background:${r.overallScore >= 7 ? '#c62828' : r.overallScore >= 4 ? '#ef6c00' : '#2e7d32'}">
            ${s('severity')}: ${r.overallScore.toFixed(1)}
          </span>
        </div>
        <div class="meta-row"><span class="meta-label">${s('timestamp')}:</span> ${escapeHtml(ts)}</div>
        <div class="meta-row"><span class="meta-label">${s('activeMode')}:</span> ${escapeHtml(modeLabel(modeAtCapture(r), I18N[locale]))}</div>
        <div class="meta-row"><span class="meta-label">${s('author')}:</span> ${escapeHtml(authorDisplayText(r, s))}</div>
        ${r.authorCapture === 'withheld' ? `<div class="text-capture">${escapeHtml(s('authorWithheldWhy'))}</div>` : ''}
        ${r.postUrl ? `<div class="meta-row"><span class="meta-label">${s('postUrl')}:</span> ${escapeHtml(r.postUrl)}</div>` : ''}

        <div class="section-label">${escapeHtml(isHiddenAd(r) ? I18N[locale].feedAdHidden : s('originalPost'))}</div>
        ${standIn === 'feedAdHidden' ? '' : `<div class="post-text original">${escapeHtml(r.redacted && r.originalText === undefined ? s('recordWithheld') : standIn ? I18N[locale][standIn] : r.originalText)}</div>`}
        ${r.textCapture === 'cut' ? `<div class="text-capture">${escapeHtml(s('textCaptureCut').replace('{n}', String(r.originalLength)))}</div>` : ''}
        ${r.textCapture === 'folded' ? `<div class="text-capture">${escapeHtml(s('textCaptureFolded'))}</div>` : ''}
        ${r.textCapture === 'platform' ? `<div class="text-capture">${escapeHtml(s('textCapturePlatform'))}</div>` : ''}

        ${rewriteHtml}

        <div class="section-label">${s('techniques')}</div>
        <ul class="techniques">${techniquesHtml}</ul>

        ${r.aiProvider ? `<div class="meta-row"><span class="meta-label">${s('aiProvider')}:</span> ${escapeHtml(r.aiProvider)}${r.aiModel ? ` / ${escapeHtml(r.aiModel)}` : ''}</div>` : ''}
        ${r.decision?.claude ? `<div class="meta-row paid-reading"><span class="meta-label">${s('paidReading')}:</span> ${escapeHtml(paidReadingCell(r))}</div>` : ''}
        ${r.detectionMode ? `<div class="meta-row"><span class="meta-label">${s('detectionMode')}:</span> ${escapeHtml(r.detectionMode)}</div>` : ''}
        ${configHtml}${visualNotAppliedHtml}

        <div class="hash-row"><span class="meta-label">${s('originalHash')}:</span> <code>${escapeHtml(r.originalHash)}</code></div>
        <div class="hash-row"><span class="meta-label">${s('integrityHash')}:</span> <code>${escapeHtml(r.integrityHash)}</code></div>
        ${r.signature
          ? `<div class="hash-row"><span class="meta-label">${s('recordSignatureLabel')}:</span> <code>${escapeHtml(r.signature)}</code></div>`
          : ''}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<title>${s('title')} — ${escapeHtml(generatedLocal)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #111; line-height: 1.5; font-size: 11pt; margin: 0; }
  .print-hint { background: #fffde7; border: 1px solid #fbc02d; padding: 10px 14px; font-family: system-ui, sans-serif; font-size: 10pt; margin-bottom: 20px; border-radius: 4px; }
  @media print { .print-hint { display: none; } }
  h1 { font-size: 20pt; margin: 0 0 4px; }
  h2 { font-size: 13pt; margin: 24px 0 10px; border-bottom: 1px solid #999; padding-bottom: 4px; }
  .meta { color: #555; font-size: 10pt; margin-bottom: 20px; }
  .summary { background: #f5f5f5; border-left: 3px solid #444; padding: 12px 14px; margin: 12px 0 24px; font-size: 10.5pt; }
  .summary div { margin: 3px 0; }
  .record { page-break-inside: avoid; border: 1px solid #ccc; border-radius: 4px; padding: 14px; margin-bottom: 18px; background: #fff; }
  .record-header { display: flex; gap: 10px; align-items: center; margin-bottom: 10px; }
  .record-index { font-weight: 700; color: #555; font-size: 10pt; }
  .record-platform { text-transform: capitalize; font-weight: 600; font-size: 10pt; background: #eee; padding: 2px 8px; border-radius: 3px; }
  .record-severity { color: #fff; padding: 2px 8px; border-radius: 3px; font-size: 10pt; font-weight: 600; }
  .meta-row { font-size: 10pt; margin: 3px 0; color: #333; }
  .meta-label { color: #666; font-weight: 600; }
  .section-label { font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.8px; color: #777; margin: 10px 0 4px; font-weight: 600; }
  .post-text { padding: 8px 10px; border-radius: 3px; font-size: 10.5pt; white-space: pre-wrap; word-break: break-word; }
  .post-text.original { background: #ffebee; border-left: 3px solid #c62828; }
  .post-text.neutralized { background: #e8f5e9; border-left: 3px solid #2e7d32; }
  .techniques { margin: 6px 0; padding-left: 22px; font-size: 10pt; }
  .techniques li { margin: 2px 0; }
  .hash-row { font-size: 8.5pt; color: #555; margin: 3px 0; font-family: "Courier New", monospace; word-break: break-all; }
  .hash-row code { font-family: "Courier New", monospace; background: #f0f0f0; padding: 1px 4px; border-radius: 2px; }
  .chain-statement { margin-top: 30px; padding: 16px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; font-size: 10pt; page-break-inside: avoid; }
  .chain-statement h2 { margin-top: 0; border: none; }
  .attestation { margin-top: 24px; padding: 16px; border: 1px solid #ccc; border-radius: 4px; font-size: 10pt; page-break-inside: avoid; page-break-before: auto; background: #fff; }
  .attestation h2 { margin-top: 0; border: none; }
  .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; margin-top: 28px; }
  .sig-block { display: flex; flex-direction: column; }
  .sig-line { border-bottom: 1px solid #222; height: 32px; }
  .sig-caption { font-size: 9pt; color: #555; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
  .footer { margin-top: 24px; font-size: 8.5pt; color: #888; text-align: center; border-top: 1px solid #eee; padding-top: 10px; }
  .empty-state { padding: 40px; text-align: center; color: #666; font-size: 11pt; border: 1px dashed #bbb; border-radius: 6px; margin: 30px 0; }
</style>
</head>
<body>
  <div class="print-hint">
    ${s('printInstruction')}
  </div>

  <h1>${s('title')}</h1>
  <div class="meta">${s('generated')}: ${escapeHtml(generatedLocal)} <br><small>ISO-8601: ${escapeHtml(generatedIso)}</small></div>
  ${caveatHtml}

  <div class="summary">
    <div><strong>${s('totalRecords')}:</strong> ${records.length}</div>
    <div><strong>${s('dateRange')}:</strong> ${escapeHtml(firstTs)} — ${escapeHtml(lastTs)}</div>
    <div><strong>${s('platforms')}:</strong> ${platforms.map(escapeHtml).join(', ') || '—'}</div>
  </div>

  <h2>${s('records')}</h2>
  ${recordsHtml || `<div class="empty-state">${s('noRecords')}</div>`}

  <div class="chain-statement">
    <h2>${s('chainOfCustody')}</h2>
    <p>${s('chainText')}</p>
  </div>

  <div class="chain-statement">
    <h2>${s('cryptoVerification')}</h2>
    <p>${s('cryptoVerificationBody')}</p>
    ${verification.jwk
      ? `
        <div class="hash-row" style="margin-top:12px"><span class="meta-label">${s('keyCreatedLabel')}:</span> <code>${escapeHtml(verification.createdAt ?? '—')}</code></div>
        <div class="hash-row"><span class="meta-label">${s('fingerprintLabel')}:</span> <code>${escapeHtml(verification.fingerprint ?? '—')}</code></div>
        <div class="section-label" style="margin-top:10px">${s('publicKeyLabel')}</div>
        <pre style="background:#f5f5f5;border:1px solid #ccc;padding:8px;font-family:'Courier New',monospace;font-size:9pt;white-space:pre-wrap;word-break:break-all;border-radius:3px">${escapeHtml(JSON.stringify(verification.jwk, null, 2))}</pre>
        <div class="section-label" style="margin-top:10px">${s('verifyInstructionsTitle')}</div>
        <p style="font-size:9.5pt">${s('verifyInstructions')}</p>
      `
      : `<p style="color:#a00;font-size:10pt">${s('verificationNotAvailable')}</p>`}
  </div>

  <div class="attestation">
    <h2>${s('attestationTitle')}</h2>
    <p>${s('attestationBody')}</p>
    <div class="signature-grid">
      <div class="sig-block">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-caption">${s('signatureName')}</div>
      </div>
      <div class="sig-block">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-caption">${s('signaturePrintName')}</div>
      </div>
      <div class="sig-block">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-caption">${s('signatureDate')}</div>
      </div>
      <div class="sig-block">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-caption">${s('signatureLocation')}</div>
      </div>
    </div>
  </div>

  <div class="footer">${s('generatedByFooter')} — ${escapeHtml(generatedIso)}</div>

  <script>
    // Auto-trigger print dialog so the user can pick "Save as PDF" immediately.
    window.addEventListener('load', function() {
      setTimeout(function() { window.print(); }, 300);
    });
  </script>
</body>
</html>`;
}

/**
 * Either a print tab opened, or the pop-up was blocked and the same report
 * went to Downloads instead. The caller says which: a silent fallback left
 * the parent looking for a tab that never opened (wiring audit 13 Sep, D2-5).
 */
export type PdfExportOutcome =
  | { opened: true; records: number }
  | { opened: false; records: number; fallback: DownloadNote };

export async function exportPDF(records: ForensicRecord[], locale: ExportLocale = 'en', filter?: ExportFilterResult): Promise<PdfExportOutcome> {
  const targetRecords = filter ? filter.included : records;
  const html = await buildEvidenceReportHTML(targetRecords, locale, filter);
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  // Keep the blob alive long enough for the new tab to load it, then release.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  const count = targetRecords.length;
  if (w) return { opened: true, records: count };
  // If pop-up was blocked, fall back to a download so the user can still get the report.
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `feelingwise-verification-${count}records-${timestamp}.html`;
  triggerDownload(blob, filename);
  return { opened: false, records: count, fallback: { filename, bytes: blob.size } };
}
