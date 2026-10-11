// FeelingWise — Standalone HTML forensic export.
//
// Per VISION §7.2: standalone HTML export that opens in any modern
// browser without installation, with a one-click Web Crypto verifier
// embedded inline so a recipient can check signatures under the embedded public
// key plus chain consistency locally without installing OpenSSL / Python / tooling.
//
// V1 minimum trims the print stylesheet, real-time progress bar, and
// color-hierarchy audit pass to stay within the V1 ship-blocker
// scope. RFC 3161, FRE 902 affidavit, operator-credential, and
// multi-jurisdiction support are later work.
//
// Page-1 copy is DESCRIPTIVE not INTERPRETIVE per  framing-bias
// requirement — records what FW measured (counts, time window, precision
// disclosure), explicitly NOT what FW concludes. The "what FW does NOT
// measure" disclaimer is load-bearing: pre-empts the framing-bias the
// recipient might otherwise carry into their own decision.
//
// Inline verifier algorithm:
//   1. Read records + public key JWK from embedded <script type="application/json">.
//   2. For each record: recompute SHA-256 over canonical payload (mirrors
//      `src/forensics/canonical-payload.ts:computeRecordIntegrityHash`).
//   3. Verify the recomputed hash matches `record.integrityHash`.
//   4. Verify the ECDSA P-256 signature over `record.integrityHash` using
//      the public key. Web Crypto SubtleCrypto.verify.
//   5. Walk chain links: each record's `prevRecordHash` must equal the previous
//      record's `integrityHash` (chain genesis is the first record's
//      `chainAnchor === 'genesis-v1'`).
//   6. Render per-record + chain summary results.

import type { ForensicRecord, InstallType } from '../types/forensic';
import type { ChainAnchor } from './chain-anchor-store';
import type { MethodologyBlock } from './methodology';
import { isSystemMarkerRecord } from './system-records';
import { sha256 } from './hasher';
import { signHash } from './signing';
import type { HealEvent } from './auto-heal';
import { wilson, type Share } from './wilson';
import { computeFlagSplit, isDecidedContentRecord, isFlaggedRecord } from './flag-provenance';
import { computeAttendance } from './attendance';
import { EXPORT_NUMBERS_INLINE_SOURCE } from './export-numbers-inline';
import { computeDisclosure } from './discloses';
import { machineLine, type ExportProfile } from './profile';
import { QR_LIB_NOTICE, QR_LIB_SOURCE } from './qrcode-vendor';
import { RFC3161_VERIFIER_SOURCE } from './rfc3161-inline.generated';
// One source of truth for technique display labels. Before 2026-08-04 the
// product carried THREE divergent vocabularies for the same enum: the dashboard
// map, its Romanian twin, and a third hardcoded inline in FEED_SCRIPT below that
// said "anger bait" where the dashboard said "anger trigger". A reader comparing
// their dashboard against the file they exported got two different words for one
// record. The labels are display-only and never enter the canonical payload, so
// they can be served from the envelope; the enum in the signed record is
function isoDateRange(records: ForensicRecord[]): { earliest: string; latest: string } {
  if (records.length === 0) return { earliest: '—', latest: '—' };
  const ts = records.map(r => r.timestamp).sort();
  return { earliest: ts[0].slice(0, 10), latest: ts[ts.length - 1].slice(0, 10) };
}

// The verifier's core functions live in verifier-core-source.ts (no imports,
// so the standalone checker can be built from them outside a browser); they
// are re-exported here because every consumer in the tree names this module.
export { VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE, VERIFIER_CORE_FNS_SOURCE } from './verifier-core-source';

// The file was one 6,664-line module until 2026-09-16 (PLAN-2026-09-16 item 10.1). Its pieces now
// sit beside it and are imported back here, so every existing import of this module still works and
// the page it builds is byte-identical:
//   html-export-types.ts    the shapes (locale, metadata, every string the page prints)
//   ../i18n/export-strings  the string table, four languages
//   html-export-scripts.ts  the scripts the exported page carries inside itself
//   html-export-styles.ts   the stylesheet
export type {
  ExportLocale,
  EmbeddedPublicKey,
  ExportMetadata,
  ExportI18nStrings,
} from './html-export-types';
import type { ExportMetadata, ExportI18nStrings } from './html-export-types';
import { I18N, TECHNIQUE_OVERLAY } from '../i18n/export-strings';
import { PRETTY_TECHNIQUE } from '../i18n/technique-labels';
import type { ExportEvidenceStrings } from '../types/export-strings';
import { EVIDENCE_STRINGS } from './export-evidence-strings';
export { I18N };

/** The shared export table with the rows on where the record came from laid over it. */
type PageOneStrings = ExportI18nStrings & ExportEvidenceStrings;
import {
  ANCHOR_CHECK_SCRIPT,
  FILE_DIGEST_SCRIPT,
  KEY_GENESIS_SCRIPT,
  COMPLETENESS_SCRIPT,
  FIXED_VERDICT_KEYS,
  verifierScript,
  FEED_SCRIPT,
  READING_SCRIPT,
  EXPOSURE_SCRIPT,
  WILSON_INLINE_SOURCE,
  BEHAVIOR_SCRIPT,
  CERT_SCRIPT,
} from './html-export-scripts';
export {
  FIXED_VERDICT_KEYS,
  verifierScript,
  FEED_SCRIPT,
  READING_SCRIPT,
  EXPOSURE_SCRIPT,
  WILSON_INLINE_SOURCE,
  BEHAVIOR_SCRIPT,
};
import { STYLES } from './html-export-styles';
import { isBeforeLevels } from '../types/mode';
import { escapeHtml } from './html-escape';


/**
 * Checks every embedded time-stamp token in the recipient's own browser.
 *
 * The work happens in RFC3161_VERIFIER_SOURCE, which is compiled from
 * src/forensics/rfc3161.ts so the file a stranger opens runs the same checks
 * the extension ran when it accepted the anchor. Nothing here reaches the
 * network: the certificates travel inside the token.
 *
 * Ordering note: this script runs after the payload script that defines
 * window.__FW_EXPORT__ and after the one that defines __FW_RFC3161__. If
 * either is missing the section keeps the no-JavaScript sentence it was
 * rendered with, which is the honest fallback.
 */
function renderFileSection(
  metadata: ExportMetadata,
  recordCount: number,
  i18n: ExportI18nStrings,
): string {
  const rows: string[] = [];
  const made = metadata.methodology?.generatedAt;
  if (made) rows.push(`<dt>${escapeHtml(i18n.fileMadeAt)}:</dt><dd><code>${escapeHtml(made)}</code></dd>`);
  const build = metadata.methodology?.extensionVersion ?? metadata.fwVersion;
  if (build) rows.push(`<dt>${escapeHtml(i18n.fileBuild)}:</dt><dd>${escapeHtml(build)}</dd>`);
  rows.push(`<dt>${escapeHtml(i18n.fileRecords)}:</dt><dd>${recordCount}</dd>`);
  if (metadata.publicKeyFingerprint) {
    rows.push(`<dt>${escapeHtml(i18n.fileKey)}:</dt><dd><code>${escapeHtml(metadata.publicKeyFingerprint)}</code></dd>`);
  }
  if (metadata.signingKeyCreatedAt) {
    rows.push(`<dt data-fw-prov="keyCreated.label">${escapeHtml(i18n.fileKeyCreated)}:</dt><dd data-fw-prov="keyCreated"><code>${escapeHtml(metadata.signingKeyCreatedAt)}</code></dd>`);
  }
  rows.push(`<dt>${escapeHtml(i18n.fileDigest)}:</dt><dd><code data-file-digest="1">...</code></dd>`);
  const repairs = (metadata.healLog ?? []).map(e => repairLine(e, i18n)).filter((l): l is string => l !== null);
  if (repairs.length > 0) {
    rows.push(`<dt class="fw-full">${escapeHtml(i18n.fileRepairs)}:</dt><dd class="fw-full" data-repairs="${repairs.length}">${repairs.map(l => `<p>${escapeHtml(l)}</p>`).join('')}</dd>`);
  }
  return `<div class="fw-anchors">
    <h2>${escapeHtml(i18n.fileHeader)}</h2>
    <p class="fw-anchors-intro">${escapeHtml(i18n.fileIntro)}</p>
    <dl>${rows.join('')}</dl>
    <p class="fw-anchors-intro">${escapeHtml(i18n.fileDigestNote)}</p>
    <p class="fw-anchors-intro">${escapeHtml(i18n.fileOriginNote)}</p>
  </div>`;
}

/**
 * One reconciliation, read back out of a marker's own hashed line (register
 * item 10). The section is rendered from the markers the file carries rather
 * than from metadata threaded in, so any export holding the marker - the whole
 * record or a filtered report - prints the same sentences from the same signed
 * bytes.
 */
export interface ReconciliationLine {
  at: string;
  platforms: string;
  fromISO: string;
  toISO: string;
  windowMinutes: string;
  corroborated: number;
  unmatchedRecords: number;
  unmatchedArchiveItems: number;
  archiveDigest: string;
}

export function reconciliationOf(marker: Pick<ForensicRecord, 'kind' | 'originalText' | 'timestamp'>): ReconciliationLine | null {
  if (marker.kind !== 'reconcile-marker') return null;
  const text = marker.originalText ?? '';
  const field = (name: string): string | undefined => new RegExp(String.raw`\b${name}=(\S+)`).exec(text)?.[1];
  const digest = field('archive');
  const from = field('from');
  const to = field('to');
  if (!digest || !from || !to) return null;
  const num = (name: string): number => {
    const v = field(name);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    at: marker.timestamp,
    platforms: (field('platforms') ?? '').split(',').filter(Boolean).join(', '),
    fromISO: from,
    toISO: to,
    windowMinutes: field('windowMinutes') ?? '?',
    corroborated: num('corroboratedByUrl') + num('corroboratedByAuthorAndTime'),
    unmatchedRecords: num('unmatchedRecords'),
    unmatchedArchiveItems: num('unmatchedArchiveItems'),
    archiveDigest: digest,
  };
}

/**
 * Page-one section: what the platform's own export supported, for each comparison the record carries.
 * The dashboard no longer offers to make one, so a file without any prints nothing here rather than
 * a sentence pointing at a step nobody can take; a record that carries one keeps it.
 */
function renderReconciliationSection(records: ForensicRecord[], i18n: ExportI18nStrings): string {
  const lines = records
    .map(r => reconciliationOf(r))
    .filter((l): l is ReconciliationLine => l !== null)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (lines.length === 0) return '';
  const body = lines.map(l => {
        const sentence = i18n.reconcileLine
          .replace('{at}', l.at.slice(0, 10))
          .replace('{platforms}', l.platforms)
          .replace('{from}', l.fromISO.slice(0, 10))
          .replace('{to}', l.toISO.slice(0, 10))
          .replace('{c}', String(l.corroborated))
          .replace('{u}', String(l.unmatchedRecords))
          .replace('{a}', String(l.unmatchedArchiveItems))
          .replace('{w}', l.windowMinutes);
        const archive = i18n.reconcileArchive.replace('{d}', l.archiveDigest);
        return `<p>${escapeHtml(sentence)}</p><p class="fw-anchors-intro">${escapeHtml(archive)}</p>`;
      }).join('');
  return `<div class="fw-anchors" data-reconciliations="${lines.length}">
    <h2>${escapeHtml(i18n.reconcileHeader)}</h2>
    <p class="fw-anchors-intro">${escapeHtml(i18n.reconcileIntro)}</p>
    ${body}
    <p class="fw-anchors-intro">${escapeHtml(i18n.reconcileFloor)}</p>
  </div>`;
}

/** One heal-log event as a sentence, or null for an event that says nothing. */
export function repairLine(e: HealEvent, i18n: ExportI18nStrings): string | null {
  if (!e.healed && e.error) return i18n.fileRepairFailed.replace('{at}', e.at).replace('{e}', e.error);
  if (e.kind === 'position-repair') {
    return i18n.fileRepairPositionSolve.replace('{at}', e.at).replace('{r}', String(e.repairedCount ?? 0)).replace('{u}', String(e.unrepairedCount ?? 0));
  }
  if (e.kind === 'reanchor') return i18n.fileRepairReanchor.replace('{at}', e.at).replace('{r}', String(e.reAnchoredCount ?? 0));
  return null;
}

function renderKeyGenesisSection(
  keyGenesis: ExportMetadata['keyGenesis'],
  i18n: ExportI18nStrings,
): string {
  const intro = escapeHtml(i18n.keyGenesisIntro);
  if (!keyGenesis || keyGenesis.anchors.length === 0) {
    return `<div class="fw-anchors">
      <h2>${escapeHtml(i18n.keyGenesisHeader)}</h2>
      <p class="fw-anchors-intro">${intro}</p>
      <p><em>${escapeHtml(i18n.keyGenesisNone)}</em></p>
    </div>`;
  }
  const items = keyGenesis.anchors.map((a, idx) => `<div class="fw-anchor" data-keygen-index="${idx}"><dl>
      <dt>${escapeHtml(i18n.anchorTsa)}:</dt><dd>${escapeHtml(a.tsaProvider)}</dd>
      <dt>${escapeHtml(i18n.anchorRequestedAt)}:</dt><dd><code>${escapeHtml(a.requestedAt)}</code></dd>
    </dl>
    <div class="fw-anchor-check" data-keygen-check="${idx}">
      <div class="section-label">${escapeHtml(i18n.anchorCheckHeader)}</div>
      <p class="fw-anchor-check-line">${escapeHtml(i18n.anchorCheckNoJs)}</p>
    </div>
    <div class="section-label" style="font-size:.85rem;color:#555;margin-top:.4rem">${escapeHtml(i18n.anchorTstBytes)}:</div>
    <div class="fw-anchor-tst">${escapeHtml(a.tstB64 || a.responseB64)}</div>
    </div>`).join('');
  return `<div class="fw-anchors">
    <h2>${escapeHtml(i18n.keyGenesisHeader)}</h2>
    <p class="fw-anchors-intro">${intro}</p>
    <p class="fw-keygen-headline" data-keygen-headline="1"></p>
    <dl><dt>${escapeHtml(i18n.keyGenesisDigest)}:</dt><dd><code>${escapeHtml(keyGenesis.publicKeyDigest)}</code></dd></dl>
    ${items}
    <p class="fw-anchors-intro">${escapeHtml(i18n.keyGenesisLimit)}</p>
  </div>`;
}

function renderAnchorsSection(
  anchors: ChainAnchor[] | undefined,
  i18n: ExportI18nStrings,
  keyStamped = false,
): string {
  // Sort by anchoredChainPosition ascending so recipient reads the timeline
  // bottom-up (earliest anchor first).
  const sorted = (anchors ?? []).slice().sort(
    (a, b) => a.anchoredChainPosition - b.anchoredChainPosition,
  );
  const intro = escapeHtml(i18n.anchorsIntro);
  if (sorted.length === 0) {
    return `<div class="fw-anchors">
      <h2>${escapeHtml(i18n.anchorsHeader)}</h2>
      <p class="fw-anchors-intro">${intro}</p>
      <p><em>${escapeHtml(keyStamped ? i18n.anchorsNoneKeyStamped : i18n.anchorsNone)}</em></p>
    </div>`;
  }
  // Compute "covers chain positions" range per anchor. For anchor i: covers
  // the range (prior anchor's position + 1, this anchor's position]. The
  // first anchor implicitly covers from chainPosition 0.
  let priorPosition = -1;
  const items = sorted.map((a, idx) => {
    const startInclusive = priorPosition + 1;
    // A round asks two authorities about the SAME chain head, so the second
    // anchor at a position would compute a start past its own end and render
    // a backwards range like "6-5". Two stamps over one position each cover
    // that position; only the first of them extends the range behind it.
    const range = startInclusive >= a.anchoredChainPosition
      ? `${a.anchoredChainPosition}`
      : `${startInclusive}–${a.anchoredChainPosition}`;
    priorPosition = Math.max(priorPosition, a.anchoredChainPosition);
    // The stored time is shown as what it is: a value the file carries. The
    // authoritative time is the one the inline verifier reads out of the
    // signed bytes, and it replaces this slot once the check has run. Before
    // 2026-09-04 the stored value was the only time the export ever showed,
    // and nothing had checked it against the token.
    return `<div class="fw-anchor" data-anchor-index="${idx}"><dl>
      <dt>${escapeHtml(i18n.anchorTsa)}:</dt><dd>${escapeHtml(a.tsaProvider)}</dd>
      <dt>${escapeHtml(i18n.anchorCovers)}:</dt><dd>${escapeHtml(range)}</dd>
      <dt>${escapeHtml(i18n.anchorAt)}:</dt><dd>${escapeHtml(a.generalizedTime ?? '—')}</dd>
      <dt>${escapeHtml(i18n.anchorHash)}:</dt><dd><code>${escapeHtml(a.anchoredIntegrityHash)}</code></dd>
      <dt>${escapeHtml(i18n.anchorRequestedAt)}:</dt><dd><code>${escapeHtml(a.requestedAt)}</code></dd>
    </dl>
    <div class="fw-anchor-check" data-anchor-check="${idx}">
      <div class="section-label">${escapeHtml(i18n.anchorCheckHeader)}</div>
      <p class="fw-anchor-check-line">${escapeHtml(i18n.anchorCheckNoJs)}</p>
    </div>
    <div class="section-label" style="font-size:.85rem;color:#555;margin-top:.4rem">${escapeHtml(i18n.anchorTstBytes)}:</div>
    <div class="fw-anchor-tst">${escapeHtml(a.tstB64)}</div>
    </div>`;
  }).join('');
  return `<div class="fw-anchors">
    <h2>${escapeHtml(i18n.anchorsHeader)}</h2>
    <p class="fw-anchors-intro">${intro}</p>
    ${items}
  </div>`;
}

/** Collapsible "how items were identified" section — verbatim model
 *  instructions, pins, thresholds. Empty string when no block was supplied
 *  (older callers/tests produce the pre-existing document unchanged). */
/**
 * The post-path flag gate is a table, not a number. Rendering it inline in the
 * methodology block is the point: an earlier build printed a single "flag gate
 * >= 6", which is wrong for most techniques and made every legitimately
 * flagged severity-4/5 post record look like a contract violation to anyone
 * auditing the export.
 */
function postFloorRange(m: MethodologyBlock): string {
  const cells = Object.values(m.thresholds.postSeverityFloorByTechniqueAndMode)
    .flatMap(v => [v.child, v.teen]);
  if (!cells.length) return `>= ${m.thresholds.defaultPostSeverityFloor}`;
  return `${Math.min(...cells)} to ${Math.max(...cells)}`;
}

function postFloorTable(m: MethodologyBlock): string {
  const rows = Object.keys(m.thresholds.postSeverityFloorByTechniqueAndMode)
    .sort()
    .map(name => {
      const cell = m.thresholds.postSeverityFloorByTechniqueAndMode[name];
      return `<tr><td>${escapeHtml(name)}</td><td>${cell.child}</td><td>${cell.teen}</td></tr>`;
    })
    .join('\n');
  if (!rows) return '';
  return `<table class="fw-mth-floors">
<caption>Post-path severity floor per technique, for Strict and Moderate only. A technique below its floor is dropped, not flagged. Relaxed posts do not pass through this table: see the Relaxed reader lines above.</caption>
<thead><tr><th>Technique</th><th>Strict</th><th>Moderate</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

/**
 * The adult reader answers one family, never a technique. The record carries a
 * technique. Without this map a reader auditing an adult record sees a
 * technique name in a vocabulary the printed adult prompt never mentions.
 */
function adultFamilyTable(m: MethodologyBlock): string {
  const rows = Object.keys(m.thresholds.adultReaderFamilyToTechnique)
    .sort()
    .map(
      family =>
        `<tr><td>${escapeHtml(family)}</td><td>${escapeHtml(m.thresholds.adultReaderFamilyToTechnique[family])}</td></tr>`,
    )
    .join('\n');
  if (!rows) return '';
  return `<table class="fw-mth-floors">
<caption>Relaxed reader: the family it answered, and the technique name that family writes on the record.</caption>
<thead><tr><th>Family answered</th><th>Technique on the record</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function renderMethodologySection(
  m: MethodologyBlock | undefined,
  i18n: ExportI18nStrings,
): string {
  if (!m) return '';
  const promptEntries: Array<[string, string]> = [
    ['Comment judge: Strict', m.prompts.commentJudgeChildMode],
    ['Comment judge: Moderate (Relaxed uses this framing)', m.prompts.commentJudgeTeenMode],
    ['Comment-section room sensor', m.prompts.roomSensor],
    ['Post judge: Strict', m.prompts.postJudgeChildMode],
    ['Post judge: Moderate (not used for Relaxed posts)', m.prompts.postJudgeTeenMode],
    // The adult reader. It has its own model, its own text and its own two
    // severity cuts, and until 2026-09-18 this list printed none of them, so an
    // adult export answered "under what criteria was this identified" with the
    // framing of a judge that had not read its records. It is the only thing
    // that reads an adult post, and the same reader answers the read-this
    // button; the label said "armed by hand" until the cuts went in and showed
    // that the automatic adult path runs it too.
    ['Relaxed reader: every Relaxed post, and the read-this button', m.prompts.adultReader],
    ['Rewriter', m.prompts.rewriter],
  ];
  const prompts = promptEntries
    .map(
      ([name, text]) =>
        `<details class="fw-mth-prompt"><summary>${escapeHtml(name)}</summary><pre>${escapeHtml(text)}</pre></details>`,
    )
    .join('\n');
  return `
<details class="fw-methodology">
<summary>${escapeHtml(i18n.methodologyHeader)}</summary>
<p>${escapeHtml(i18n.methodologyIntro)}</p>
<p class="fw-meta">${escapeHtml(m.note)}</p>
<strong>${escapeHtml(i18n.methodologyModelsLabel)}</strong>
<dl>
<dt>Text judge:</dt><dd>${escapeHtml(m.models.textJudge)}</dd>
<dt>Relaxed reader:</dt><dd>${escapeHtml(m.models.adultReader)}</dd>
<dt>Room sensor:</dt><dd>${escapeHtml(m.models.roomSensor)}</dd>
</dl>
<p class="fw-meta">${escapeHtml(m.models.modelProvenanceNote)}</p>
<strong>${escapeHtml(i18n.methodologyThresholdsLabel)}</strong>
<dl>
<dt>Comment flag gate (severity):</dt><dd>&ge; ${m.thresholds.severityFlagGate}</dd>
<dt>Post flag gate, Strict and Moderate (severity):</dt><dd>per technique &times; level, ${postFloorRange(m)} (table below)</dd>
<dt>Relaxed reader, acts at (severity):</dt><dd>&ge; ${m.thresholds.adultReaderFireSeverity}, and only when it called the item charged</dd>
<dt>Relaxed reader, hides instead of rewriting at (severity):</dt><dd>&ge; ${m.thresholds.adultReaderHideSeverity}</dd>
<dt>Relaxed reader, confidence written:</dt><dd>${m.thresholds.adultReaderFixedConfidence} on every record it acts on, a fixed value and not a measure of certainty</dd>
<dt>Profanity-filter path (fixed severity):</dt><dd>${m.thresholds.profanityFilterSeverity}</dd>
<dt>Deterministic harm floor (score 0-100):</dt><dd>&ge; ${m.thresholds.harmFloorTrigger}</dd>
</dl>
<p class="fw-meta">${escapeHtml(m.thresholds.adultReaderNote)}</p>
${adultFamilyTable(m)}
${postFloorTable(m)}
<p class="fw-meta">${escapeHtml(m.thresholds.thresholdsNote)}</p>
<p class="fw-meta">${escapeHtml(m.thresholds.flagAccountingNote)}</p>
<p class="fw-meta" data-fw-mth="ads">${escapeHtml(i18n.methodologyAdsNote)}</p>
<strong>${escapeHtml(i18n.methodologyTopicsLabel)}</strong>
<p>${escapeHtml(m.topicLabelVocabulary.join(', '))}</p>
<strong>${escapeHtml(i18n.methodologyPromptsLabel)}</strong>
${prompts}
<p class="fw-meta">${escapeHtml(m.prompts.promptsNote)}</p>
</details>`;
}

/**
 * The "what was left out" rows of the page-1 summary.
 *
 * Always renders something. A reader must never have to infer completeness
 * from the absence of a line — that inference is exactly what the bare count
 * invited, and it is the difference between a filtered extract and a whole
 * chain reading identically.
 */
/**
 * What this file can and cannot account for, derived from the records it
 * carries and nothing else.
 *
 * The export used to answer the completeness question with a constant: when
 * no filter was applied it printed "Nothing. This is the complete retained
 * chain." That sentence was in a 21 MB file holding 11816 of 38834 chain
 * positions, next to four of its own prune markers recording the deletions,
 * because the complete-chain and everything exports pass no `selection` and
 * the no-selection branch asserted completeness rather than declining to.
 *
 * A forensic file may not claim more than it can show. These are the three
 * ways the chain in a file can fail to be the whole story, all of them
 * visible in the records themselves:
 *
 *   • it starts above position 0 — earlier records were removed from the
 *     install before the export ran;
 *   • it has holes inside its own range;
 *   • it starts at a reset marker — position 0 of a chain that REPLACED an
 *     earlier one. Technically complete, and the most misleading of the
 *     three, because the count and the range both look clean.
 *
 * Positions restart legitimately at each month rotation, so the range is
 * walked as runs and a run beginning at 0 costs nothing. Only a run that
 * begins above 0 implies records that are not here.
 */
export interface ChainCoverage {
  firstPosition?: number;
  lastPosition?: number;
  /** Records implied by runs that begin above position 0. */
  missingBefore: number;
  /** Positions absent from inside a run's own range. */
  gapsInside: number;
  /** ISO timestamp of a reset marker at the start of the chain, if any. */
  resetAt?: string;
  /** Prune markers carried in this file, which name where records went. */
  pruneMarkers: number;
  /**
   * Gap markers carried in this file (src/forensics/gap-marker.ts): the recorder's own
   * signed statements that it was not running between two times, or that a counted number
   * of items did not reach the record, or that entries the install once held are gone.
   * A file can have every position present and still hold these, so the all-clear about
   * positions is never the whole answer to "is anything missing" (2026-09-20).
   */
  signedGaps: number;
  /**
   * Timestamps of reset markers that open a run AFTER the first one. `resetAt` reads only
   * the file's first opener, so a reset in the middle of an everything export was on no
   * row of page one. The records before such a marker are in this file because a reset
   * archives the outgoing chain before it clears it (store.ts, resetForensicChain).
   */
  resetsInside: string[];
}

export function computeChainCoverage(records: ForensicRecord[]): ChainCoverage {
  const chained = records.filter(
    r => typeof r.chainPosition === 'number' && r.chainPosition >= 0 && r.chainAnchor !== 'pre-rekey',
  );
  const pruneMarkers = records.filter(r => r.kind === 'prune-marker').length;
  const signedGaps = records.filter(r => r.kind === 'gap-marker').length;
  if (chained.length === 0) {
    return { missingBefore: 0, gapsInside: 0, pruneMarkers, signedGaps, resetsInside: [] };
  }

  // Split into runs at every position reset (a month rotation restarts at 0).
  const runs: number[][] = [];
  const resetsInside: string[] = [];
  let current: number[] = [];
  let previous = -Infinity;
  for (const r of chained) {
    const pos = r.chainPosition as number;
    if (pos <= previous) {
      if (current.length > 0) runs.push(current);
      current = [];
      if (r.kind === 'reset-marker') resetsInside.push(r.timestamp);
    }
    current.push(pos);
    previous = pos;
  }
  if (current.length > 0) runs.push(current);

  let missingBefore = 0;
  let gapsInside = 0;
  for (const run of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    if (first > 0) missingBefore += first;
    const span = last - first + 1;
    const present = new Set(run).size;
    if (span > present) gapsInside += span - present;
  }

  const firstPosition = runs[0][0];
  const opener = chained.find(r => r.chainPosition === firstPosition);
  const resetAt = firstPosition === 0 && opener?.kind === 'reset-marker' ? opener.timestamp : undefined;

  return {
    firstPosition,
    lastPosition: runs[runs.length - 1][runs[runs.length - 1].length - 1],
    missingBefore,
    gapsInside,
    resetAt,
    pruneMarkers,
    signedGaps,
    resetsInside,
  };
}

/** One run's time-stamp coverage: how many of its records a stamp in the file stands behind. */
export interface RunStampCoverage {
  first: number;
  last: number;
  records: number;
  /** Records at or before the furthest position a stamp in this file names inside this run. */
  stamped: number;
  /** The newest generalizedTime among those stamps, as the file carries it; null when none. */
  newest: string | null;
}

/**
 * Per run, how many records fall under a time stamp. Mirrors stampCoverage in
 * VERIFIER_CORE_FNS_SOURCE, run for run, and tests/unit/forensics/page-one-stamp-coverage.test.ts
 * holds the two equal. A stamp names one record hash; every record before it in the same run is
 * fixed by it through the links. A stamp counts only at the position it states, on a record the
 * file holds, and a later run's stamp is not carried back.
 */
export function computeStampCoverage(records: ForensicRecord[], anchors: ChainAnchor[] | undefined): RunStampCoverage[] {
  const runs: Array<{ first: number; last: number; positions: number[]; stampedTo: number; newest: string | null }> = [];
  const where = new Map<string, { run: number; position: number }>();
  let current: (typeof runs)[number] | undefined;
  let previous = -Infinity;
  for (const r of records) {
    if (typeof r.chainPosition !== 'number' || r.chainPosition < 0 || r.chainAnchor === 'pre-rekey') continue;
    const pos = r.chainPosition;
    if (!current || pos <= previous) {
      current = { first: pos, last: pos, positions: [], stampedTo: -1, newest: null };
      runs.push(current);
    }
    current.positions.push(pos);
    current.last = pos;
    previous = pos;
    if (typeof r.integrityHash === 'string' && !where.has(r.integrityHash)) where.set(r.integrityHash, { run: runs.length - 1, position: pos });
  }
  for (const a of anchors ?? []) {
    const at = typeof a.anchoredIntegrityHash === 'string' ? where.get(a.anchoredIntegrityHash) : undefined;
    if (!at || a.anchoredChainPosition !== at.position) continue;
    const hit = runs[at.run];
    if (at.position > hit.stampedTo) hit.stampedTo = at.position;
    const t = typeof a.generalizedTime === 'string' && a.generalizedTime ? a.generalizedTime : null;
    if (t && (hit.newest === null || t > hit.newest)) hit.newest = t;
  }
  return runs.map(run => ({
    first: run.first,
    last: run.last,
    records: run.positions.length,
    stamped: run.positions.filter(p => p <= run.stampedTo).length,
    newest: run.newest,
  }));
}

/**
 * The stamps page one may count: those the install verified when the token arrived, under an
 * authority it pins. A token that failed, verified only under an unknown root, or arrived before
 * the install checked tokens at all dates nothing, so it adds nothing to the count.
 */
export function installCheckedAnchors(anchors: ChainAnchor[] | undefined): ChainAnchor[] {
  return (anchors ?? []).filter(a => a.verification?.ok === true && !!a.verification.knownRootName);
}

/**
 * A report leaves out the stamps over the records it leaves out. This row says
 * how many such records the install holds a stamp over, and that this file
 * neither carries nor checks those stamps, so the count is not read as evidence.
 * No row when there are none: a signed "none" is a claim no checker can test.
 */
function stampedLeftOutRow(n: number | undefined, i18n: ExportI18nStrings): string {
  if (!n || n <= 0) return '';
  return `<dt data-fw-prov="stampsElsewhere.label">${escapeHtml(i18n.summaryStampsElsewhere)}:</dt><dd data-fw-prov="stampsElsewhere">${escapeHtml(fill(i18n.summaryStampsElsewhereValue, '{n}', String(n)))}</dd>`;
}

/** One sentence per run, under the signature like every coverage row. */
function stampCoverageRow(runs: RunStampCoverage[], i18n: ExportI18nStrings): string {
  if (runs.length === 0) return '';
  const lines = runs.map(run => {
    const template = run.newest ? i18n.summaryStampRunNewest : i18n.summaryStampRun;
    return escapeHtml(fill(fill(fill(fill(fill(template, '{a}', String(run.first)), '{b}', String(run.last)), '{n}', String(run.stamped)), '{m}', String(run.records)), '{t}', run.newest ?? ''));
  });
  return `<dt data-fw-prov="stampCoverage.label">${escapeHtml(i18n.summaryStampCoverage)}:</dt><dd data-fw-prov="stampCoverage">${lines.join('<br>\n')}<br>\n<span class="fw-stamp-note">${escapeHtml(i18n.summaryStampNote)}</span></dd>`;
}

/**
 * One signing key's share of the file, so a multi-generation export can
 * describe itself honestly (owner's 2026-09-02 export: "Recorded by
 * FeelingWise V2.3.0, chain positions 0 to 0" on a file holding ten keys and
 * three months of records judged by several models). Runs are walked in
 * timestamp order within the key, never across keys: prior chains all start
 * at position 0, so a position-only walk over the whole file reads them as
 * one broken chain. A record does not carry the app version that wrote it,
 * so no version is claimed per key; the models it names are listed.
 */
export interface EpochSummary {
  /** '' for records written before the fingerprint stamp existed. */
  fingerprint: string;
  /** The install's own key, the one the file is signed under. */
  ownKey: boolean;
  /** A key the file carries, own or recovered with its records; its signatures are checkable. */
  keyInFile: boolean;
  records: number;
  runs: { first: number; last: number; count: number }[];
  missingBefore: number;
  gapsInside: number;
  earliest: string;
  latest: string;
  models: string[];
  /** userAgeCategory counts, most records first. Every record carries one. */
  modes: Array<{ mode: string; records: number }>;
  /** Distinct configSnapshot conditions (threshold, dailyCap) with record counts, most first. */
  conditions: Array<{ threshold: number; dailyCap: number; records: number }>;
  /** Records in this epoch with no configSnapshot (older records, environment and manual-flag records). */
  noSnapshot: number;
}

export function computeEpochSummaries(
  records: ForensicRecord[],
  exportFingerprint: string,
  keysInFile: ReadonlySet<string> = new Set(),
): EpochSummary[] {
  const byKey = new Map<string, ForensicRecord[]>();
  for (const r of records) {
    const fp = r.publicKeyFingerprint ?? '';
    const list = byKey.get(fp);
    if (list) list.push(r); else byKey.set(fp, [r]);
  }
  const out: EpochSummary[] = [];
  for (const [fingerprint, list] of byKey) {
    const sorted = [...list].sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    const runs: EpochSummary['runs'] = [];
    let previous = -Infinity;
    let seen = new Set<number>();
    for (const r of sorted) {
      const pos = r.chainPosition;
      if (typeof pos !== 'number' || pos < 0) continue;
      if (pos <= previous && runs.length > 0) {
        runs[runs.length - 1].count = seen.size;
        seen = new Set<number>();
      }
      if (pos <= previous || runs.length === 0) runs.push({ first: pos, last: pos, count: 0 });
      const run = runs[runs.length - 1];
      if (pos > run.last) run.last = pos;
      seen.add(pos);
      previous = pos;
    }
    if (runs.length > 0) runs[runs.length - 1].count = seen.size;
    let missingBefore = 0;
    let gapsInside = 0;
    for (const run of runs) {
      if (run.first > 0) missingBefore += run.first;
      const span = run.last - run.first + 1;
      if (span > run.count) gapsInside += span - run.count;
    }
    const models = new Set<string>();
    const modeCounts = new Map<string, number>();
    const condCounts = new Map<string, { threshold: number; dailyCap: number; records: number }>();
    let noSnapshot = 0;
    for (const r of sorted) {
      if (r.aiModel) models.add(r.aiModel);
      const mode = r.userAgeCategory ?? '';
      modeCounts.set(mode, (modeCounts.get(mode) ?? 0) + 1);
      const cs = r.configSnapshot;
      if (cs && typeof cs.threshold === 'number' && typeof cs.dailyCap === 'number') {
        const k = `${cs.threshold}|${cs.dailyCap}`;
        const c = condCounts.get(k);
        if (c) c.records++; else condCounts.set(k, { threshold: cs.threshold, dailyCap: cs.dailyCap, records: 1 });
      // A marker never carries settings: it is the chain writing about itself. Counting it
      // here printed "35 of them do not carry the settings ... so this file cannot say what
      // those were" over a file whose 64 content records all carried them (2026-09-20).
      } else if (!isSystemMarkerRecord(r)) noSnapshot++;
    }
    const ownKey = fingerprint !== '' && fingerprint === exportFingerprint;
    out.push({
      fingerprint,
      ownKey,
      keyInFile: ownKey || (fingerprint !== '' && keysInFile.has(fingerprint)),
      records: list.length,
      runs,
      missingBefore,
      gapsInside,
      earliest: sorted[0]?.timestamp ?? '',
      latest: sorted[sorted.length - 1]?.timestamp ?? '',
      models: [...models].sort(),
      modes: [...modeCounts].map(([mode, records]) => ({ mode, records })).sort((a, b) => b.records - a.records),
      conditions: [...condCounts.values()].sort((a, b) => b.records - a.records),
      noSnapshot,
    });
  }
  // The export's own key first, then the keys it carries, then by first record.
  const rank = (e: EpochSummary): number => (e.ownKey ? 0 : e.keyInFile ? 1 : 2);
  out.sort((a, b) => (rank(a) !== rank(b) ? rank(a) - rank(b) : a.earliest < b.earliest ? -1 : 1));
  return out;
}

function positionsText(e: EpochSummary, i18n: ExportI18nStrings): string {
  if (e.runs.length === 0) return i18n.epochNoPositions;
  const first = Math.min(...e.runs.map(r => r.first));
  const last = Math.max(...e.runs.map(r => r.last));
  const parts = [`${first} to ${last}`];
  if (e.runs.length > 1) parts.push(`${e.runs.length} ${i18n.epochRunsWord}`);
  if (e.missingBefore > 0) parts.push(`${e.missingBefore} ${i18n.epochMissingWord}`);
  if (e.gapsInside > 0) parts.push(`${e.gapsInside} ${i18n.epochGapsWord}`);
  return parts.join(', ');
}

/** A signed mode value as a reader should see it: the level's word, or an old id marked as the setting before the levels. */
export function modeLabel(mode: string, i18n: ExportI18nStrings): string {
  return isBeforeLevels(mode) ? `${modeWord(mode, i18n)} ${i18n.epochModeBeforeLevels}` : modeWord(mode, i18n);
}

function modeWord(mode: string, i18n: ExportI18nStrings): string {
  switch (mode) {
    case 'strict': return i18n.epochModeStrict;
    case 'moderate': return i18n.epochModeModerate;
    case 'relaxed': return i18n.epochModeRelaxed;
    case 'adult': return i18n.epochModeAdult;
    case 'teen': return i18n.epochModeTeen;
    case 'child': return i18n.epochModeChild;
    default: return mode || '?';
  }
}

/**
 * "1200 recorded with the app set for an adult reader, 3 ... for a child reader"
 *
 * A sentence, since 2026-09-18, because it was two words in a table cell and one
 * of them was a number. A researcher reading the file cold met "teen 1500" under
 * the label "Conditions the records were made under", read it three times, and
 * asked whether it meant 1500 teenagers or a setting called teen whose value was
 * 1500. The count also appears two rows above as the record count, which made
 * the guess worse rather than better.
 */
export function modesText(e: EpochSummary, i18n: ExportI18nStrings): string {
  return e.modes
    .map(m => i18n.epochModeFmt
      .replace('{n}', String(m.records))
      .replace('{mode}', modeWord(m.mode, i18n))
      + (isBeforeLevels(m.mode) ? ` ${i18n.epochModeBeforeLevels}` : ''))
    .join(', ');
}

/** "1200 at threshold 0.6, daily cap 50; 3 without a configuration snapshot" */
export function conditionsText(e: EpochSummary, i18n: ExportI18nStrings): string {
  // Two scales share the field: the post path stores a confidence cut in
  // [0, 1], the comment path a severity floor on the 1 to 10 scale
  // (MANIPULATION_SEVERITY_THRESHOLD). Printed as one number they read as a
  // tenfold difference that does not exist.
  const parts = e.conditions.map(c =>
    (c.threshold >= 1 ? i18n.epochConditionFmtSeverity : i18n.epochConditionFmt)
      .replace('{n}', String(c.records)).replace('{t}', String(c.threshold)).replace('{c}', String(c.dailyCap)));
  if (e.noSnapshot > 0) parts.push(i18n.epochNoSnapshot.replace('{n}', String(e.noSnapshot)));
  return parts.join('; ');
}

/** Why a key exists, from the origin ledger; "not recorded" when the ledger has no entry. */
export function keyOriginText(
  fingerprint: string,
  keyOrigins: ExportMetadata['keyOrigins'],
  i18n: ExportI18nStrings,
): string {
  const entry = keyOrigins?.find(o => o.fingerprint === fingerprint);
  if (!entry) return i18n.epochWhyUnknown;
  const why = entry.origin === 'restored-from-backup' ? i18n.epochWhyRestored : i18n.epochWhyGenerated;
  return `${why} (${entry.at.slice(0, 10)})`;
}

/** Single-key files: why the key exists, as one page-one row. */
function keyOriginRow(epochs: EpochSummary[], keyOrigins: ExportMetadata['keyOrigins'], i18n: ExportI18nStrings): string {
  if (epochs.length !== 1) return '';
  return `<dt data-fw-prov="keyOrigin.label">${escapeHtml(i18n.summaryKeyOrigin)}:</dt><dd data-fw-prov="keyOrigin">${escapeHtml(keyOriginText(epochs[0].fingerprint, keyOrigins, i18n))}</dd>`;
}

/** Single-key files: the conditions as one page-one row (multi-key files carry them per epoch). */
function conditionsRow(epochs: EpochSummary[], i18n: ExportI18nStrings): string {
  if (epochs.length !== 1) return '';
  const e = epochs[0];
  return `<dt data-fw-prov="conditions.label">${escapeHtml(i18n.summaryConditions)}:</dt><dd data-fw-prov="conditions">${escapeHtml(modesText(e, i18n))}<br><span class="fw-conditions-note">${escapeHtml(conditionsText(e, i18n))}</span></dd>`;
}

/** The per-key table for a file that carries more than one signing key. */
function epochRows(epochs: EpochSummary[], i18n: ExportI18nStrings, keyOrigins: ExportMetadata['keyOrigins']): string {
  if (epochs.length < 2) return '';
  const rows = epochs.map(e => {
    const key = e.fingerprint ? `<code>${escapeHtml(e.fingerprint)}</code>` : escapeHtml(i18n.epochUnfingerprinted);
    const status = e.ownKey ? i18n.epochActiveKey : e.keyInFile ? i18n.epochCarriedKey : i18n.epochPriorKey;
    const period = `${escapeHtml(e.earliest.slice(0, 10))} to ${escapeHtml(e.latest.slice(0, 10))}`;
    const models = e.models.length ? escapeHtml(e.models.join(', ')) : escapeHtml(i18n.epochNoModel);
    return `<tr><td>${key}<br><span class="fw-coverage-note">${escapeHtml(status)}</span></td><td>${e.records}</td><td>${escapeHtml(positionsText(e, i18n))}</td><td>${period}</td><td>${models}</td><td>${escapeHtml(modesText(e, i18n))}</td><td>${escapeHtml(conditionsText(e, i18n))}</td><td>${escapeHtml(keyOriginText(e.fingerprint, keyOrigins, i18n))}</td></tr>`;
  });
  const carried = epochs.filter(e => e.keyInFile).length;
  return `<dt data-fw-prov="keysInFile.label">${escapeHtml(i18n.summaryKeysInFile)}:</dt><dd data-fw-prov="keysInFile">${epochs.length}, ${escapeHtml(i18n.summaryKeysCarried.replace('{n}', String(carried)))}<br><span class="fw-coverage-note">${escapeHtml(i18n.summaryEpochsNote)}</span></dd>
<dt class="fw-full" data-fw-prov="epochs.label">${escapeHtml(i18n.summaryEpochsLabel)}:</dt><dd data-fw-prov="epochs" class="fw-full"><table class="fw-epochs"><thead><tr><th>${escapeHtml(i18n.epochColKey)}</th><th>${escapeHtml(i18n.epochColRecords)}</th><th>${escapeHtml(i18n.epochColPositions)}</th><th>${escapeHtml(i18n.epochColPeriod)}</th><th>${escapeHtml(i18n.epochColModels)}</th><th>${escapeHtml(i18n.epochColModes)}</th><th>${escapeHtml(i18n.epochColConditions)}</th><th>${escapeHtml(i18n.epochColWhy)}</th></tr></thead><tbody>${rows.join('')}</tbody></table></dd>`;
}

/**
 * Chain-coverage rows for the page-one summary. Always renders something.
 *
 * Every row here is a completeness claim, so every row here carries
 * data-fw-prov. Measured on 2026-09-18 against verifier/vectors/01-verified.html:
 * the sentence "None. This file begins at the start of the chain and has no gaps
 * in it." could be rewritten in a text editor to "None. Nothing was ever removed
 * and this is the whole history." and the file still read VERIFIED, manifest ok,
 * exit 0. The numbers behind it are in the records and under recordsDigest; the
 * sentence a reader reads was under nothing.
 *
 * The `missingBefore` name is reused by the two branches that print that row,
 * the count and the all-clear. They can never BOTH render, which is the part
 * that matters: two rows sharing a name would make the sorted pair list
 * order-dependent between the builder and the checker. It said "exactly one of
 * them ever renders" until 2026-09-19, and that is not true. The all-clear also
 * requires no gaps inside and no reset, so a file with nothing missing before
 * it and a hole in the middle prints neither row. That is a missing sentence,
 * not a collision, and it is why the weaker claim is the honest one.
 */
function coverageRows(coverage: ChainCoverage, i18n: ExportI18nStrings, includeRange = true, isSelection = false, unreadable = 0): string {
  const rows: string[] = [];
  if (includeRange && coverage.firstPosition !== undefined && coverage.lastPosition !== undefined) {
    rows.push(
      `<dt data-fw-prov="chainRange.label">${escapeHtml(i18n.summaryChainRange)}:</dt><dd data-fw-prov="chainRange">${coverage.firstPosition} to ${coverage.lastPosition}</dd>`,
    );
  }

  // A report is a selection: the gate keeps the flagged records and leaves the rest of the
  // chain out on purpose (exporter.ts applyExportGate). Its absent positions are therefore
  // mostly the filter's doing, and the rows below would call them "removed from this
  // install before the export was made, so no export can contain them", which was false
  // of a 10-of-71 report whose whole export held every one of them (read 2026-09-20).
  // From the report alone a position the filter left out cannot be told from one that was
  // gone already, so one row says exactly that and points at the file that can tell.
  if (isSelection) {
    const absent = coverage.missingBefore + coverage.gapsInside;
    if (absent > 0) {
      rows.push(
        `<dt data-fw-prov="selectionCoverage.label">${escapeHtml(i18n.summarySelectionCoverage)}:</dt><dd data-fw-prov="selectionCoverage">${escapeHtml(fill(i18n.summarySelectionCoverageValue, '{n}', String(absent)))}</dd>`,
      );
    }
    return rows.join('\n');
  }

  const notes: string[] = [];
  if (coverage.missingBefore > 0) notes.push(String(coverage.missingBefore));
  if (coverage.missingBefore > 0) {
    // An archived row the install could not read leaves this same hole when it opened a run, as a
    // month's rotation marker and the install's first record do. The plain note would then state a
    // removal that may not have happened.
    const note = unreadable > 0 ? i18n.summaryMissingBeforeNoteUnreadable : i18n.summaryMissingBeforeNote;
    rows.push(
      `<dt data-fw-prov="missingBefore.label">${escapeHtml(i18n.summaryMissingBefore)}:</dt><dd data-fw-prov="missingBefore">${coverage.missingBefore}<br><span class="fw-coverage-note">${escapeHtml(note)}</span></dd>`,
    );
  }
  if (coverage.gapsInside > 0) {
    rows.push(`<dt data-fw-prov="gapsInside.label">${escapeHtml(i18n.summaryGapsInside)}:</dt><dd data-fw-prov="gapsInside">${coverage.gapsInside}</dd>`);
  }
  if (coverage.resetAt) {
    rows.push(
      `<dt data-fw-prov="chainReset.label">${escapeHtml(i18n.summaryResetLabel)}:</dt><dd data-fw-prov="chainReset">${escapeHtml(i18n.summaryResetNote)} ${escapeHtml(coverage.resetAt)}</dd>`,
    );
  }
  if (coverage.resetsInside.length > 0) {
    rows.push(
      `<dt data-fw-prov="resetsInside.label">${escapeHtml(i18n.summaryResetsInside)}:</dt><dd data-fw-prov="resetsInside">${escapeHtml(fill(i18n.summaryResetsInsideValue, '{at}', coverage.resetsInside.join(', ')))}</dd>`,
    );
  }
  if (notes.length === 0 && coverage.gapsInside === 0 && !coverage.resetAt && coverage.resetsInside.length === 0) {
    rows.push(
      `<dt data-fw-prov="missingBefore.label">${escapeHtml(i18n.summaryMissingBefore)}:</dt><dd data-fw-prov="missingBefore">${escapeHtml(i18n.summaryCoverageComplete)}</dd>`,
    );
  }
  // The recorder's own signed gaps. Printed beside the all-clear when both are true: every
  // position can be present in a file whose markers say the recorder was off for days.
  // Until 2026-09-20 the all-clear read "has no gaps in it" and nothing on page one looked
  // at these records, so a file holding ten of them, one saying entries were gone, said
  // "no gaps" under the same signature.
  if (coverage.signedGaps > 0) {
    rows.push(
      `<dt data-fw-prov="signedGaps.label">${escapeHtml(i18n.summarySignedGaps)}:</dt><dd data-fw-prov="signedGaps">${escapeHtml(fill(i18n.summarySignedGapsValue, '{n}', String(coverage.signedGaps)))}</dd>`,
    );
  }
  return rows.join('\n');
}

/**
 * Page-one flagged share, same counting rule as the Statistics tab's balance
 * bar: environment and system-marker records are out of both sides; a record
 * without a verdict is flagged (verdict-less records predate the field and were
 * only ever written when flagged); blocked counts as decided. Printed with its
 * k, its n and a 95% Wilson interval (capability audit 2026-09-06, P0 item 2).
 */
export function computeFlaggedShare(records: ForensicRecord[]): Share | null {
  // One definition of a content record for both page-one rows. Until 2026-09-17 this share
  // counted image records and left masked ones out, while the judge row above it
  // (flag-provenance.ts) did the opposite, so the two rows printed two different totals under
  // one label: the public demo read "99 of 1,325" and "129 of 1,500" content records on the
  // same page. A paid placement stays in the denominator and never on the flagged side
  // (standing decision 1, 2026-09-14): it is reported on its own row instead.
  let flagged = 0;
  let decided = 0;
  for (const r of records) {
    if (!isDecidedContentRecord(r)) continue;
    decided++;
    if (isFlaggedRecord(r)) flagged++;
  }
  return wilson(flagged, decided);
}

/**
 * A share as a percentage with one decimal when it is small enough for the
 * decimal to matter. 2.7% and 3% are different claims about a product, and the
 * integer rounding the total row uses hides that difference exactly where the
 * judged share lives.
 */
/**
 * Put a value into a template slot without letting the VALUE be read as a
 * replacement pattern.
 *
 * String.prototype.replace parses `$$`, `$&`, `` $` `` and `$'` in its second
 * argument, and several slots on this page take text a stranger chose: a
 * Facebook group is named by whoever created it, and that name reaches page one
 * verbatim out of the signed record. A group called `Sale $& Swap` printed as
 * `Sale {sample} Swap` — an unresolved template token shipped to a lawyer. One
 * called ``Cumparaturi $` Exempleni`` spliced the surrounding sentence into the
 * middle of its own quoted name. `Deals $' Group` lost the marker silently, and
 * `Cash $$ Deals` lost a character.
 *
 * In every case the name page one shows is not the sourceContainer in the
 * record beneath it: a recipient who compares the two sees what reads as
 * tampering, and one who looks the group up on the platform does not find it.
 *
 * The function form of the replacement is never parsed, so the value lands as
 * itself. Use it for every slot whose value is not a number this file computed.
 */
function fill(template: string, token: string, value: string): string {
  return template.replace(token, () => value);
}

function pctText(k: number, n: number): string {
  return pctOf(n === 0 ? 0 : k / n);
}

/**
 * A proportion in [0,1] as a percentage string, one decimal below 10%.
 *
 * Every share on page one goes through this, so the same k over the same n
 * cannot print two different numbers. It could: the total flagged row printed
 * wilson()'s integer *Pct fields while the judged row printed one decimal, so a
 * file whose flags were all judged rendered "142 of 5233 (2.7%, interval
 * 2.3-3.2%)" directly above "142 of 5233 (3%, interval 2-3%)" — the same
 * numerator and denominator twice, in two numbers, with the total row's
 * interval not even containing the judged row's upper bound.
 *
 * Bounds take the proportion itself. Rounding a Wilson bound back to whole
 * records first (Math.round(lower * n) / n) re-quantised it to the nearest
 * 1/n and printed something that was no longer the bound.
 */
function pctOf(p: number): string {
  const v = p * 100;
  return v < 10 ? v.toFixed(1) : String(Math.round(v));
}

/**
 * The name a reader is given for a rule family, keyed by what the split writes:
 * an `overrideOrigin` (the comment path) or a detection-mode family (the post
 * path). Two keys can be one rule reached two ways, which is why the counts are
 * added under the label rather than printed as two rows of the same name.
 *
 * The row used to print the keys themselves, so the one line on page one that
 * says which rules fired read "profanity-mask 17" in the file the letters ask a
 * researcher to open. A key this version has no name for is printed as it is:
 * inventing a name for an unknown rule would be worse than showing its key.
 */
const RULE_KIND_LABELS: Readonly<Record<string, keyof ExportI18nStrings>> = {
  'identity-slur': 'feedGateIdentitySlur',
  slur: 'feedGateIdentitySlur',
  'profanity-tier': 'feedGateProfanityTier',
  profanity: 'feedGateProfanityTier',
  'profanity-mask': 'feedGateProfanityTier',
  'coded-harm': 'feedGateCodedHarm',
  'ad-hominem': 'feedGateAdHominem',
  'harm-floor': 'feedGateHarmFloor',
  'rage-format': 'feedGateRageFormat',
  blocklist: 'ruleWordFilter',
};

function ruleKindList(
  ruleKinds: ReadonlyArray<{ kind: string; records: number }>,
  i18n: ExportI18nStrings,
): string {
  const byLabel = new Map<string, number>();
  for (const { kind, records } of ruleKinds) {
    const key = RULE_KIND_LABELS[kind];
    const label = key ? String(i18n[key]) : kind;
    byLabel.set(label, (byLabel.get(label) ?? 0) + records);
  }
  return [...byLabel.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .map(([label, n]) => i18n.ruleKindFmt.replace('{n}', String(n)).replace('{label}', label))
    .join(', ');
}

/**
 * The two rows that say what decided the flags in this file: the ones a judge
 * read and named, and the ones a rule matched (forensics/flag-provenance.ts).
 *
 * Printed ABOVE the total, because the total is the figure a reader
 * misunderstands on their own: in the 2026-09-08 export 400 of 594 flags were
 * the platform's own "Sponsored" marker, and a single 11% carried an ad
 * blocker and a judge under one word.
 */
function flagProvenanceRows(records: ForensicRecord[], i18n: ExportI18nStrings): string {
  const split = computeFlagSplit(records);
  if (!split) return '';
  const judged = wilson(split.judged, split.decided);
  const judgedValue = judged
    ? i18n.summaryFlaggedJudgedValue
        .replace('{k}', String(judged.k)).replace('{n}', String(judged.n))
        .replace('{pct}', pctOf(judged.p))
        .replace('{lo}', pctOf(judged.lower))
        .replace('{hi}', pctOf(judged.upper))
    : i18n.summaryFlaggedShareNone;
  const kinds = ruleKindList(split.ruleKinds, i18n);
  const ruleValue = split.rule === 0
    // "Every flag in this file was made by a judge" is false when a person
    // typed one in, so that sentence is only used when the judged row really
    // does account for all of them.
    ? (split.manual === 0 ? i18n.summaryFlaggedRuleNone : i18n.summaryFlaggedRuleNoneShort)
    : i18n.summaryFlaggedRuleValue
        .replace('{k}', String(split.rule)).replace('{n}', String(split.decided))
        .replace('{pct}', pctText(split.rule, split.decided))
        .replace('{kinds}', () => kinds);
  // A flag a person typed in is neither judged nor matched. Its own row when
  // there is one, and no row at all when there is none — a permanent "Added by
  // hand: 0" would be a line nobody reads.
  const manualRow = split.manual === 0 ? '' :
    `
<dt data-fw-prov="flaggedManual.label">${escapeHtml(i18n.summaryFlaggedManual)}:</dt><dd data-fw-prov="flaggedManual">${escapeHtml(
      i18n.summaryFlaggedManualValue
        .replace('{k}', String(split.manual)).replace('{n}', String(split.decided))
        .replace('{pct}', pctText(split.manual, split.decided)),
    )}</dd>`;
  // Advertising, on its own row and in no other number on this page (standing
  // decision 1, 2026-09-14). Printed only when the file holds some, the same
  // rule the hand-typed row follows: a permanent "Paid placement: 0" is a line
  // nobody reads.
  const paidRow = split.paidPlacement === 0 ? '' :
    `
<dt data-fw-prov="paidPlacement.label">${escapeHtml(i18n.summaryPaidPlacement)}:</dt><dd data-fw-prov="paidPlacement">${escapeHtml(
      i18n.summaryPaidPlacementValue
        .replace('{k}', String(split.paidPlacement)).replace('{n}', String(split.decided))
        .replace('{pct}', pctText(split.paidPlacement, split.decided)),
    )}</dd>`;
  return (
    `<dt data-fw-prov="flaggedJudged.label">${escapeHtml(i18n.summaryFlaggedJudged)}:</dt><dd data-fw-prov="flaggedJudged">${escapeHtml(judgedValue)}</dd>
` +
    `<dt data-fw-prov="flaggedRule.label">${escapeHtml(i18n.summaryFlaggedRule)}:</dt><dd data-fw-prov="flaggedRule">${escapeHtml(ruleValue)}</dd>` +
    manualRow +
    paidRow
  );
}

/**
 * The row that says how much of this file was served to nobody
 * (forensics/attendance.ts). Derived from the timestamps in the file, not from
 * a stored field: a recipient recomputes it from what they are holding.
 *
 * Printed because the alternative is worse. Without it the 2026-09-08 export
 * described a person awake for 34.7 hours, and every exposure figure in the
 * product silently included 704 items rendered into an open Instagram tab
 * between 01:43 and 06:13 while the household slept.
 */
function unattendedRow(records: ForensicRecord[], i18n: ExportI18nStrings): string {
  const att = computeAttendance(records);
  if (att.considered === 0) return '';
  if (att.unattended === 0) {
    // "Every stretch arrives the way a person scrolling produces" is a claim,
    // and it needs a stretch that was actually long enough to look at. A file
    // of short bursts gets the honest line instead of the reassuring one.
    const line = att.judgedRecords > 0 ? i18n.summaryUnattendedNone : i18n.summaryUnattendedUnjudged;
    return `<dt data-fw-prov="unattended.label">${escapeHtml(i18n.summaryUnattended)}:</dt><dd data-fw-prov="unattended">${escapeHtml(line)}</dd>`;
  }
  // Name the stretches themselves, biggest first, so the reader can go and
  // look at that part of the feed rather than take the number on faith.
  const runs = att.unattendedRuns.slice(0, 4).map(r =>
    i18n.summaryUnattendedRun
      .replace('{k}', String(r.records))
      .replace('{start}', r.startISO.slice(0, 16).replace('T', ' '))
      .replace('{end}', r.endISO.slice(11, 16))
      .replace('{s}', String(r.medianGapS)),
  ).join('; ');
  const more = att.unattendedRuns.length > 4 ? ` (+${att.unattendedRuns.length - 4})` : '';
  const value = i18n.summaryUnattendedValue
    .replace('{k}', String(att.unattended))
    .replace('{n}', String(att.considered))
    .replace('{pct}', pctText(att.unattended, att.considered))
    .replace('{runs}', () => runs + more);
  return `<dt data-fw-prov="unattended.label">${escapeHtml(i18n.summaryUnattended)}:</dt><dd data-fw-prov="unattended">${escapeHtml(value)}</dd>`;
}

/**
 * What this file tells a reader about the person who made it
 * (forensics/discloses.ts), in that file's own numbers.
 *
 * Page one already says what the export does not prove. It said nothing about
 * what it does reveal, and the export exists to be handed to someone. The
 * 2026-09-08 file carries no name, no address and no account, and identifies
 * its owner from what was served TO them: named groups for one suburb, a
 * parenting group, a PC-parts market, and advertisers who buy Romanian retail.
 *
 * The numbers are the point. A warning that could be printed on any file
 * teaches nothing; "{n} named groups, {m} advertisers, {k} links back to your
 * own view" is a thing the sender can weigh before they send it.
 */
/**
 * Who made the file and on what machine (forensics/profile.ts). The name is
 * the one the user chose and the row says so; the machine row is the facts
 * Chrome exposes and nothing an extension cannot read. Both carry
 * data-fw-prov so the provenance digest signs the rendered sentence. Silent
 * when no profile was supplied (an older caller, or a test).
 */
function profileRows(profile: ExportProfile | undefined, i18n: ExportI18nStrings): string {
  if (!profile) return '';
  const rows: string[] = [];
  if (profile.name) {
    rows.push(`<dt data-fw-prov="madeBy.label">${escapeHtml(i18n.summaryMadeBy)}:</dt><dd data-fw-prov="madeBy"><strong>${escapeHtml(profile.name)}</strong> (${escapeHtml(i18n.summaryMadeByNote)})</dd>`);
  }
  const machine = machineLine(profile);
  rows.push(`<dt data-fw-prov="machine.label">${escapeHtml(i18n.summaryMachine)}:</dt><dd data-fw-prov="machine">${escapeHtml(machine || i18n.summaryMachineUnknown)}</dd>`);
  return rows.join('\n');
}

function disclosureBlock(records: ForensicRecord[], i18n: ExportI18nStrings, profileName: string | null = null): string {
  const d = computeDisclosure(records);
  if (!d) return '';
  // Name a few of the groups. A group name is the sharpest single item in the
  // file — it can carry a suburb, a school or a household — so the reader sees
  // the kind of thing being counted, not only the count.
  const sample = d.sampleContainers.length > 0
    ? ` (${d.sampleContainers.map(c => `"${c}"`).join(', ')}${d.namedContainers > d.sampleContainers.length ? ', …' : ''})`
    : '';
  // Only what this file actually holds. A list padded with "0 advertisers, 0
  // named groups" reads as a form letter, and a reader who learns to skim the
  // zeroes skims the line that matters.
  const parts: string[] = [];
  const add = (n: number, tmpl: string, extra?: (t: string) => string): void => {
    if (n <= 0) return;
    const filled = tmpl.replace('{n}', String(n));
    parts.push(extra ? extra(filled) : filled);
  };
  add(d.authors, i18n.tellsAuthors);
  add(d.chosenAccounts, i18n.tellsChosen);
  add(d.advertisers, i18n.tellsAdvertisers);
  add(d.namedContainers, i18n.tellsContainers, t => fill(t, '{sample}', sample));
  add(d.links, i18n.tellsLinks);
  add(d.mediaAddresses, i18n.tellsMedia);
  add(d.spanHours, i18n.tellsSpan, t => t.replace('{h}', String(d.activeHoursUtc)));
  if (parts.length === 0) return '';
  const intro = profileName
    ? fill(fill(i18n.whatThisFileTellsIntroNamed, '{name}', profileName), '{list}', parts.join(', '))
    : fill(i18n.whatThisFileTellsIntro, '{list}', parts.join(', '));
  const body = intro + i18n.whatThisFileTellsOutro;
  return `<div class="fw-disclaimer">
<strong>${escapeHtml(i18n.whatThisFileTells)}</strong>
<p data-fw-prov="discloses">${escapeHtml(body)}</p>
</div>`;
}

/**
 * Which builds wrote this file. Named whenever any record names its build, so page one always
 * answers "which code wrote this"; silent only when no record names one. With one build, the row
 * says whether every record carries it or only some: the markers the extension writes about itself
 * name no build, nor do records written before records carried one.
 *
 * It states the fact and stops there. An earlier draft blamed a tab left open
 * across an extension reload, which the product's own code makes impossible: a
 * reload nukes chrome.runtime in the orphaned content script synchronously
 * (content/context-guard.ts), so that tab cannot send a message and therefore
 * cannot write a record at all. Two ids in one file are ordinary chronology —
 * rows judged before an update and rows judged after it — and a signed export
 * must not hand a reader a cause its own mechanism cannot produce, least of
 * all inside the provenance digest, on the one question the file exists to
 * answer.
 */
function buildIdCounts(records: ForensicRecord[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    if (typeof r.buildId === 'string' && r.buildId) counts.set(r.buildId, (counts.get(r.buildId) ?? 0) + 1);
  }
  return counts;
}

function buildsRow(records: ForensicRecord[], i18n: PageOneStrings): string {
  const counts = buildIdCounts(records);
  if (counts.size === 0) return '';
  if (counts.size === 1) {
    const [[id, n]] = [...counts.entries()];
    const value = n === records.length
      ? fill(i18n.summaryBuildOneValue, '{id}', id)
      : fill(fill(fill(fill(i18n.summaryBuildOneOfSomeValue, '{id}', id), '{n}', String(n)), '{total}', String(records.length)), '{rest}', String(records.length - n));
    return `<dt data-fw-prov="builds.label">${escapeHtml(i18n.summaryBuildOne)}:</dt><dd data-fw-prov="builds">${escapeHtml(value)}</dd>`;
  }
  const list = [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .map(([id, n]) => fill(i18n.summaryBuildsItem, '{id}', id).replace('{n}', String(n)))
    .join(', ');
  return `<dt data-fw-prov="builds.label">${escapeHtml(i18n.summaryBuilds)}:</dt><dd data-fw-prov="builds">${escapeHtml(fill(i18n.summaryBuildsValue, '{list}', list))}</dd>`;
}

const INSTALL_WORDS: Record<InstallType, keyof ExportEvidenceStrings> = {
  normal: 'installNormal',
  development: 'installDevelopment',
  sideload: 'installSideload',
  admin: 'installAdmin',
  other: 'installOther',
};

/**
 * How the extension that wrote the records was installed, counted from each record's own stamp.
 * Left out when no record states it, so a file from before records carried it prints nothing it
 * cannot back. Inside the signed page rows, like the build row above it.
 */
function installRow(records: ForensicRecord[], i18n: PageOneStrings): string {
  const counts = new Map<InstallType, number>();
  let unstated = 0;
  for (const r of records) {
    const t = r.stamp?.installType;
    if (t && t in INSTALL_WORDS) counts.set(t, (counts.get(t) ?? 0) + 1);
    else unstated++;
  }
  if (counts.size === 0) return '';
  const items = [...counts.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
    .map(([t, n]) => fill(fill(i18n.summaryInstallItem, '{what}', i18n[INSTALL_WORDS[t]]), '{n}', String(n)));
  if (unstated > 0) items.push(fill(i18n.summaryInstallUnstated, '{n}', String(unstated)));
  const value = `${items.join('; ')}. ${i18n.summaryInstallLimit}`;
  return `<dt data-fw-prov="install.label">${escapeHtml(i18n.summaryInstall)}:</dt><dd data-fw-prov="install">${escapeHtml(value)}</dd>`;
}

/**
 * What "content records" means, said on the page that uses the words. Until 2026-09-20 page one
 * printed "Records included: 1500" and then every share as "of 1325 content records", and never
 * said what a content record is or where the other 175 went. A recount of the public demo's page
 * one against its own records found every number right and this one question unanswerable from
 * the page. The definition is isDecidedContentRecord's, in the words of its docblock. The row is
 * left out when every record is a content record, because then there is no gap to explain.
 */
function contentRecordsRow(records: ForensicRecord[], i18n: ExportI18nStrings): string {
  const n = records.filter(isDecidedContentRecord).length;
  if (n === records.length) return '';
  const value = i18n.summaryContentRecordsValue.replace('{n}', String(n)).replace('{total}', String(records.length));
  return `<dt data-fw-prov="contentRecords.label">${escapeHtml(i18n.summaryContentRecords)}:</dt><dd data-fw-prov="contentRecords">${escapeHtml(value)}</dd>`;
}

function flaggedShareRow(records: ForensicRecord[], i18n: ExportI18nStrings): string {
  const sh = computeFlaggedShare(records);
  const value = sh
    ? i18n.summaryFlaggedShareValue
        .replace('{k}', String(sh.k)).replace('{n}', String(sh.n))
        .replace('{pct}', pctOf(sh.p)).replace('{lo}', pctOf(sh.lower)).replace('{hi}', pctOf(sh.upper))
    : i18n.summaryFlaggedShareNone;
  return `<dt data-fw-prov="flaggedShare.label">${escapeHtml(i18n.summaryFlaggedShare)}:</dt><dd data-fw-prov="flaggedShare">${escapeHtml(value)}</dd>`;
}

function selectionRows(
  selection: ExportMetadata['selection'],
  i18n: ExportI18nStrings,
): string {
  if (!selection) {
    return `<dt data-fw-prov="heldBack.label">${escapeHtml(i18n.summaryHeldBack)}:</dt><dd data-fw-prov="heldBack">${escapeHtml(i18n.summaryHeldBackNone)}</dd>`;
  }
  const held = selection.totalSource - selection.included;
  const drawn = `<dt data-fw-prov="drawnFrom.label">${escapeHtml(i18n.summaryDrawnFrom)}:</dt><dd data-fw-prov="drawnFrom">${selection.totalSource}</dd>`;
  if (held <= 0) {
    return `${drawn}\n<dt data-fw-prov="heldBack.label">${escapeHtml(i18n.summaryHeldBack)}:</dt><dd data-fw-prov="heldBack">${escapeHtml(i18n.summaryHeldBackNone)}</dd>`;
  }
  const parts: string[] = [];
  if (selection.excludedUnreviewed > 0) {
    parts.push(`${selection.excludedUnreviewed} ${escapeHtml(i18n.summaryHeldBackUnreviewed)}`);
  }
  if (selection.excludedLowConfidence > 0) {
    parts.push(`${selection.excludedLowConfidence} ${escapeHtml(i18n.summaryHeldBackLowSeverity)}`);
  }
  if (selection.excludedNonDetection > 0) {
    parts.push(`${selection.excludedNonDetection} ${escapeHtml(i18n.summaryHeldBackNonDetection)}`);
  }
  // The total is stated even when the reasons do not add up to it, so a
  // future gate that forgets to report its own bucket cannot shrink the
  // number a reader sees.
  const detail = parts.length > 0 ? `${held}: ${parts.join('; ')}` : String(held);
  return `${drawn}\n<dt data-fw-prov="heldBack.label">${escapeHtml(i18n.summaryHeldBack)}:</dt><dd data-fw-prov="heldBack">${detail}</dd>`;
}

/**
 * The count leads the row because the checkers read it there: the row is under the provenance
 * digest and the envelope's count is not. Nothing at all when there are none.
 */
function unreadableRow(count: number | undefined, i18n: ExportI18nStrings): string {
  if (!count || count <= 0) return '';
  return `\n<dt data-fw-prov="unreadableRows.label">${escapeHtml(i18n.summaryUnreadableRows)}:</dt><dd data-fw-prov="unreadableRows">${escapeHtml(fill(i18n.summaryUnreadableRowsValue, '{n}', String(count)))}</dd>`;
}

export interface ExportManifest {
  /** 1: records, anchors, keys and wording. 2: the envelope's provenance too. */
  version: 2;
  recordCount: number;
  recordsDigest: string;
  anchorsDigest: string;
  publicKeysDigest: string;
  techLabelsDigest: string;
  i18nDigest: string;
  publicKeyFingerprint: string;
  generatedAt: string;
  /**
   * SHA-256 over envelopeCanonical: the selection, the key genesis and
   * origins, the key's creation stamp, the operating point, the build and the
   * locale - the facts a reader is asked to believe that are not records.
   */
  envelopeDigest: string;
  /**
   * SHA-256 over the summary rows a reader actually reads (the ones marked
   * data-fw-prov). The envelope digest covers the values; this covers the
   * sentences rendered from them, which are HTML a text editor can rewrite
   * without touching the payload underneath.
   */
  provenanceDigest: string;
  /** SHA-256 over the fixed-order canonical array of the fields above. */
  digest: string;
  /** ECDSA P-256 over `digest`, base64url, under the install's key. */
  signature: string;
}

/**
 * The opening tag of the payload element, WRITTEN one way and READ another.
 *
 * What is written is the canonical form below, byte for byte, and that never
 * changes. What is read is any <script> whose attributes include
 * id="fw-export-data", in any order, with any whitespace between them, because
 * that is what a browser's getElementById sees and what a second recorder is
 * entitled to emit.
 *
 * The matter was settled one level down and not here. FORMAT.md section 5 tells
 * an implementer, in a paragraph of its own, that the provenance attribute MAY
 * sit anywhere in its tag and that anchoring it to the front is how one shipped
 * implementation came to read fourteen rows where the page read sixteen. The
 * same lesson had not reached the ONE element the whole format hangs on: until
 * 2026-09-18 a file writing `id` before `type` was answered with "not a
 * FeelingWise export", which is the worst sentence this checker can say about a
 * sound file. Found by an engineer writing an independent checker from the
 * specification alone, which is the reading this format exists to survive.
 */
const PAYLOAD_OPEN = '<script type="application/json" id="fw-export-data">';
/** Any script element carrying the payload id, however its attributes are ordered. */
const PAYLOAD_RE = /<script\b[^>]*\bid="fw-export-data"[^>]*>/;

/** The canonical string the manifest digest is taken over. Byte-synced with checkManifest in VERIFIER_CORE_FNS_SOURCE. */
export function manifestCanonical(m: Omit<ExportManifest, 'digest' | 'signature'>): string {
  return JSON.stringify([m.version, m.recordCount, m.recordsDigest, m.anchorsDigest, m.publicKeysDigest, m.techLabelsDigest, m.i18nDigest, m.publicKeyFingerprint, m.generatedAt, m.envelopeDigest, m.provenanceDigest]);
}

/**
 * The canonical string the envelope digest is taken over: everything outside
 * the records that a reader is asked to believe. Version 1 of the manifest
 * covered the records, the anchors, the keys and the wording; it did not cover
 * which key was the install's own and which was supplied with the records
 * (item 12's whole subject), whether the file is a filtered extract or a set
 * with records missing, when the signing key was made, or the operating point
 * the reading was measured at. Each of those could be edited with the manifest
 * still verifying. Byte-synced with envelopeCanonical in
 * VERIFIER_CORE_FNS_SOURCE.
 *
 * It describes envelopeCanonical, which is a few hundred lines below. Until
 * 2026-09-19 it sat here with a second docblock immediately under it, so every
 * tool and every reader attached it to the function that follows THAT one, and
 * envelopeCanonical itself carried nothing.
 */
/**
 * The rows a reader reads, as the browser will read them. The values behind
 * them are already in the envelope digest; this is the rendered sentence,
 * because a signed value under an edited sentence still lies to a reader. Text
 * is taken the way textContent takes it - tags dropped, entities decoded,
 * whitespace collapsed - so the signer and the page compute the same string.
 * Byte-synced with readProvenanceRows in VERIFIER_CORE_FNS_SOURCE.
 *
 * WHICH ROWS CARRY THE ATTRIBUTE. Anything the page states about this file or
 * about the records in it, and nothing that is decoration. A tampering set of
 * twenty three single-place edits, run on 2026-09-18 against
 * verifier/vectors/01-verified.html, found seven of roughly eighteen rendered
 * rows attributed and the rest under no digest at all, so four edits survived a
 * VERIFIED reading: the signing key fingerprint a recipient compares by eye, the
 * sentence saying which earlier records are absent, the paragraph naming what
 * the check does not establish, and the envelope's own profile block. The rule
 * the builder follows: every row that states something about this file or the
 * records in it carries the attribute, and only the title and the subtitle do
 * not, because they are not claims. That is the rule; the set itself is
 * whatever the builder marks, which on a current file is over thirty names,
 * and a list written here would drift from it. A reader who wants the set
 * should read the marked names out of a file, the way the checker does.
 *
 * This paragraph used to enumerate about ten of them and to say that the
 * general "what FeelingWise does not measure" note was NOT attributed. It is,
 * and the comment beside the markup a few hundred lines below says so
 * outright. A list is the checklist the next person uses to decide whether a
 * new row needs marking, so one that names a signed row as unsigned is worse
 * than no list (2026-09-19).
 *
 * LABELS, SINCE 2026-09-18. The <dt> beside each signed value is its own row,
 * named `<value>.label`, so the two sort together and neither can be presented
 * as the other. Until that day a label was under no digest: the signed digits of
 * the signing key fingerprint could be shown under the words "Archive
 * fingerprint" and the file still read VERIFIED, which was the last of twenty
 * four single-place edits the tampering corpus did not refuse. Covering it is a
 * change to the format's coverage rule (FORMAT.md section 5) and to all three
 * implementations of that rule, which is why it waited for a pass that could do
 * all three at once; the agreement between them is now itself a test, in
 * tests/unit/forensics/provenance-rule-agrees.test.ts.
 *
 * OLD FILES ARE UNAFFECTED, WHICH IS WHY THE FIX IS HERE AND NOT IN THE
 * CHECKER. The digest is taken over the attributed rows a file actually
 * carries, so a file exported before this change carries its own seven and the
 * same checker recomputes the same seven. Measured twice, at both widenings:
 * all ten vectors under verifier/vectors/, built before the change, still read
 * as EXPECTED.json says. Widening the CHECKER to read unattributed <dd>
 * elements instead would have broken every file already in somebody's hands.
 */
export function extractProvenanceRows(html: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  // dt, dd AND p: the summary rows are <dd> in the definition list, the labels
  // that introduce them are <dt>, and the disclosure block and the limits
  // paragraph are <p>. Matching <dd> alone left those paragraphs signed
  // nowhere, and matching dd and p left every label signed nowhere, which is the
  // exact gap this digest exists
  // to close. Kept as an explicit set rather than a wildcard tag so the builder
  // and readProvenanceRows in VERIFIER_CORE_FNS_SOURCE cover the same set by
  // construction.
  //
  // The attribute is matched wherever it sits in the tag, not only immediately
  // after the tag name. querySelectorAll does not care about attribute order, so
  // the earlier anchored form was the looser of the two: the first row written
  // as `<dd class="fw-full" data-fw-prov="...">` would have been read by the
  // page and missed by the signer, and the file would have been born reading
  // BROKEN. Two rows now carry another attribute before or after this one.
  const re = /<(dt|dd|p)\b[^>]*?\sdata-fw-prov="([a-zA-Z.]+)"[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push([m[2], provenanceText(m[3])]);
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return out;
}

function provenanceText(inner: string): string {
  return inner
    .replace(/<[^>]*>/g, '')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function envelopeCanonical(data: Record<string, unknown>): string {
  return JSON.stringify([
    data.selection ?? null,
    data.keyGenesis ?? null,
    data.keyOrigins ?? null,
    data.signingKeyCreatedAt ?? null,
    data.precisionDisclosure ?? null,
    data.fwVersion ?? null,
    data.locale ?? null,
    data.publicKeyJwk ?? null,
  ]);
}

/**
 * Sign the export's envelope (register item 6, 2026-09-06). Reads the payload
 * back out of the built document, digests its records, anchors, keys, labels
 * and wording, signs the manifest digest with the install key and writes the
 * manifest into the envelope. The verifier checks it first and prints no
 * verdict wording when it fails. A document that cannot be signed (no key in
 * this realm) is returned unchanged; the verifier then reads it as partial.
 */
export async function attachSignedManifest(
  html: string,
  sign: (hash: string) => Promise<string> = signHash,
): Promise<string> {
  // Matched by attribute rather than by the literal opening tag, the same way
  // every checker matches it since 2026-09-18. This builder writes the
  // canonical form three lines of its own and would never meet another order,
  // but the two readers have to agree by construction or the format has a
  // second drift of exactly the kind PAYLOAD_RE's docblock describes.
  const open = PAYLOAD_RE.exec(html);
  if (!open) return html;
  const from = open.index + open[0].length;
  const end = html.indexOf('</script>', from);
  if (end < 0) return html;
  const escaped = html.slice(from, end);
  let data: Record<string, unknown>;
  try {
    // Parsed as it stands. `<` is an ordinary JSON escape and JSON.parse
    // reads it back as `<` without help, which is exactly what every checker
    // does with this same string (verifier/verify-export.browser.js parseExport).
    //
    // Until 2026-09-18 this line un-escaped the payload textually first,
    // `escaped.replace(/\\u003c/g, '<')`, and that was reachable sabotage. A
    // record whose own text contains the six characters < is written into
    // the payload by JSON.stringify as \\u003c, the backslash doubled; the
    // replace matched from the second backslash on and produced `\<`, which is
    // not a legal JSON escape, so the parse threw, this function returned the
    // document unchanged, and the export went out with no manifest at all: no
    // error, no log, nothing on any screen. The recipient's checker then read
    // the file the way it reads a file whose envelope is covered by nothing.
    // A stranger who wanted someone's future evidence to read as unsigned only
    // had to write < once in a thread that person was recording.
    data = JSON.parse(escaped) as Record<string, unknown>;
  } catch {
    return html;
  }
  if (data.manifest) return html;
  const records = Array.isArray(data.records) ? data.records : [];
  const fields: Omit<ExportManifest, 'digest' | 'signature'> = {
    version: 2,
    recordCount: records.length,
    recordsDigest: await sha256(JSON.stringify(records)),
    anchorsDigest: await sha256(JSON.stringify(data.anchors ?? [])),
    publicKeysDigest: await sha256(JSON.stringify(data.publicKeys ?? [])),
    techLabelsDigest: await sha256(JSON.stringify(data.techLabels ?? {})),
    i18nDigest: await sha256(JSON.stringify(data.i18n ?? {})),
    publicKeyFingerprint: typeof data.publicKeyFingerprint === 'string' ? data.publicKeyFingerprint : '',
    generatedAt: new Date().toISOString(),
    envelopeDigest: await sha256(envelopeCanonical(data)),
    provenanceDigest: await sha256(JSON.stringify(extractProvenanceRows(html))),
  };
  const digest = await sha256(manifestCanonical(fields));
  let signature: string;
  try {
    signature = await sign(digest);
  } catch {
    return html;
  }
  const manifest: ExportManifest = { ...fields, digest, signature };
  const close = escaped.lastIndexOf('}');
  if (close < 0) return html;
  const injected = escaped.slice(0, close) + ',"manifest":' + JSON.stringify(manifest).replace(/</g, '\\u003c') + escaped.slice(close);
  return html.slice(0, from) + injected + html.slice(end);
}

export function buildForensicHtmlExport(
  records: ForensicRecord[],
  metadata: ExportMetadata,
): string {
  const { locale, fwVersion, publicKeyJwk, publicKeyFingerprint, precisionDisclosure, anchors } = metadata;
  const i18n: PageOneStrings = { ...I18N[locale], ...EVIDENCE_STRINGS[locale] };
  const range = isoDateRange(records);
  // A file with more than one signing key describes each key on its own
  // (see computeEpochSummaries); a single-key file keeps the short header.
  const publicKeys = metadata.publicKeys ?? [];
  const epochs = computeEpochSummaries(records, publicKeyFingerprint, new Set(publicKeys.map(k => k.fingerprint)));
  const multiKey = epochs.length > 1;
  // A single signing key can still span many app updates — the same install,
  // never reinstalled, carries one key across every version it has ever run.
  // "Recorded with {fwVersion}" would then name only the version that HAPPENED
  // to export, over records `buildsRow` (below) shows were written by other
  // builds entirely. Read from the same per-record buildId, not a new field.
  // One build that is not the exporting one counts too: the label carries the exporting build's id
  // (extension-label.ts), and "Recorded with" over records another build judged would be false.
  const recordBuilds = [...buildIdCounts(records).keys()];
  const multiBuild = recordBuilds.length > 1
    || (recordBuilds.length === 1 && !fwVersion.includes(` build ${recordBuilds[0]}`));
  // Anchors are embedded in the JSON payload too — V1.5 verifier work can
  // do offline cryptographic validation of each TimeStampToken against the
  // TSA's certificate (currently the recipient verifies externally with
  // OpenSSL or pkijs). Embedding the TST bytes verbatim keeps the export
  // self-sufficient.
  const exportPayload = JSON.stringify({
    records,
    publicKeyJwk,
    publicKeyFingerprint,
    // Every key the file carries (own first); the verifier checks each
    // record under the key its fingerprint names.
    publicKeys,
    i18n,
    anchors: anchors ?? [],
    // The verifier needs to know whether records are missing because the file
    // is a filtered extract or because someone removed them. Without this it
    // has to report every filtered export as if records had gone missing.
    selection: metadata.selection ?? null,
    keyGenesis: metadata.keyGenesis ?? null,
    // Provenance the reader relies on, in the payload so the manifest can
    // cover it (register item 6, second pass). The summary rows above are
    // rendered from these same values; a file whose rows disagree with them
    // is a file whose rows were edited.
    keyOrigins: metadata.keyOrigins ?? null,
    signingKeyCreatedAt: metadata.signingKeyCreatedAt ?? null,
    precisionDisclosure: precisionDisclosure ?? null,
    fwVersion,
    locale,
    // Who made the file and on what machine (profile.ts). Envelope-only and
    // outside envelopeCanonical, which was fixed in a released format before
    // this key existed and cannot take a twelfth element now without refusing
    // every file signed under the old order.
    //
    // It is not left unguarded for that. The rendered "made by" and "machine"
    // rows are under the provenance digest, and checkManifest in
    // VERIFIER_CORE_FNS_SOURCE refuses a file whose profile block disagrees with
    // them: the signed copy decides and the unsigned copy has to match it.
    // Found on 2026-09-18 by a tampering set, which invented a maker here in a
    // file whose page names none and got VERIFIED, manifest ok, exit 0.
    // FORMAT.md section 1 now names the key and says what holds it down.
    profile: metadata.profile ?? null,
    // Outside envelopeCanonical for the same reason as profile, and held down the same way: the
    // checkers take this count only when the signed unreadableRows row states it. Written only
    // when there are such rows, so every other file stays exactly as it was.
    ...(metadata.unreadableArchivedRows && metadata.unreadableArchivedRows > 0
      ? { unreadableArchivedRows: metadata.unreadableArchivedRows }
      : {}),
    // Display labels for the technique enums, resolved for this export's
    // locale. Envelope-only: adding a key here cannot shift a record's
    // integrityHash, which is computed over the record alone
    // (canonical-payload.ts). RO falls back to EN per key, matching
    // dashboard-strings.ts `techniqueLabel`, so a missing translation shows
    // the English word rather than a raw kebab id.
    techLabels: { ...PRETTY_TECHNIQUE, ...(TECHNIQUE_OVERLAY[locale] ?? {}) },
  });
  const precisionLine = precisionDisclosure
    ? escapeHtml(precisionDisclosure)
    : escapeHtml(i18n.summaryPrecisionMissing);

  return `<!DOCTYPE html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(i18n.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="fw-brandrow"><span class="fw-brand-dot"></span><span class="fw-brand-word">FeelingWise</span></div>
<h1>${escapeHtml(i18n.title)}</h1>
<p class="fw-meta">${escapeHtml(i18n.subtitle)}</p>
${metadata.topNotice ? `<p class="fw-disclaimer" data-fw-prov="topNotice">${escapeHtml(metadata.topNotice)}</p>\n` : ''}
<!-- The reading mode comes first (futurestate.md section 3b, item 2): the
     platform marks, the numbers over the whole file, the filters, then the
     list. The verifier stays right under the numbers so its status is in view
     when the cards get stamped. The file's own rows, the methodology and the
     interpretation follow, the last two behind closed details. -->
<section id="fw-reading" class="fw-reading">
<h2>${escapeHtml(i18n.rdHeader)}</h2>
<p id="fw-reading-sentence" class="fw-reading-sentence"></p>
<p class="fw-meta">${escapeHtml(i18n.rdIntro)}</p>
<div id="fw-reading-marks" class="fw-marks" role="group"></div>
<div id="fw-reading-filters" class="fw-filters"></div>
<label class="fw-blur-toggle"><input type="checkbox" id="fw-blur-authors"> ${escapeHtml(i18n.rdBlur)}</label>
<div id="fw-reading-numbers"></div>
</section>
<div class="fw-verify-block">
<div id="fw-completeness"></div>
<button id="fw-verify-btn">${escapeHtml(i18n.verifyBtn)}</button>
<div id="fw-status"></div>
<p data-fw-prov="whatThisDoes" class="fw-meta fw-what-this-does">${escapeHtml(i18n.whatThisDoes)}</p>
</div>

<div id="fw-feed" class="fw-feed"></div>

<h2>${escapeHtml(i18n.pageOneHeader)}</h2>
<div class="fw-summary"><dl>
<dt data-fw-prov="recordCount.label">${escapeHtml(i18n.summaryRecordCount)}:</dt><dd data-fw-prov="recordCount">${records.length}</dd>
${contentRecordsRow(records, i18n)}
${flagProvenanceRows(records, i18n)}
${flaggedShareRow(records, i18n)}
${unattendedRow(records, i18n)}
${buildsRow(records, i18n)}
${installRow(records, i18n)}
${selectionRows(metadata.selection, i18n)}
${coverageRows(computeChainCoverage(records), i18n, !multiKey, !!metadata.selection && metadata.selection.totalSource > metadata.selection.included, metadata.unreadableArchivedRows ?? 0)}${unreadableRow(metadata.unreadableArchivedRows, i18n)}
${stampCoverageRow(computeStampCoverage(records, installCheckedAnchors(anchors)), i18n)}
${stampedLeftOutRow(metadata.stampedRecordsLeftOut, i18n)}
<dt data-fw-prov="timeWindow.label">${escapeHtml(i18n.summaryTimeWindow)}:</dt><dd data-fw-prov="timeWindow">${escapeHtml(range.earliest)} – ${escapeHtml(range.latest)} ${escapeHtml(i18n.summaryTimeWindowUtc)}</dd>
<dt data-fw-prov="fingerprint.label">${escapeHtml(i18n.summaryFingerprint)}:</dt><dd data-fw-prov="fingerprint"><code>${escapeHtml(publicKeyFingerprint)}</code></dd>
${epochRows(epochs, i18n, metadata.keyOrigins)}
${conditionsRow(epochs, i18n)}
${keyOriginRow(epochs, metadata.keyOrigins, i18n)}
<dt data-fw-prov="capturedBy.label">${escapeHtml(multiKey || multiBuild ? i18n.summaryExportedBy : i18n.capturedBy)}:</dt><dd data-fw-prov="capturedBy">${escapeHtml(fwVersion)}</dd>
${profileRows(metadata.profile, i18n)}
<dt data-fw-prov="precision.label">${escapeHtml(i18n.summaryPrecisionLabel)}:</dt><dd data-fw-prov="precision">${precisionLine}</dd>
</dl></div>

<div class="fw-disclaimer">
<!-- The heading is a <strong> and the reading rule covers dt, dd and p, so it
     carries no mark: a mark on a fourth tag would be written by the builder and
     read by neither checker, which is the shape of every drift this digest has
     had. The paragraph under it holds the claims and is signed. A reader who
     rewrites only the heading is left with a heading that disagrees with the
     signed sentence directly beneath it. -->
<strong>${escapeHtml(i18n.whatFWDoesNotMeasure)}</strong>
<p data-fw-prov="notMeasure">${escapeHtml(i18n.notMeasureBullets)}</p>
</div>
${disclosureBlock(records, i18n, metadata.profile?.name ?? null)}
${renderMethodologySection(metadata.methodology, i18n)}

${renderFileSection(metadata, records.length, i18n)}
${renderReconciliationSection(records, i18n)}
${renderKeyGenesisSection(metadata.keyGenesis, i18n)}
${renderAnchorsSection(anchors, i18n, (metadata.keyGenesis?.anchors.length ?? 0) > 0)}

<div id="fw-exposure" class="fw-exposure"></div>

<!-- Interpretation is off by default: the behavior reading and its caution
     box render inside a closed details. The script still runs on load, so
     opening the summary shows the finished section. -->
<details class="fw-interpretation">
<summary>${escapeHtml(i18n.rdInterpSummary)}</summary>
<div id="fw-behavior" class="fw-behavior"></div>
</details>

<!-- Per-record verification detail renders here, BELOW the readable views:
     the at-a-glance VERIFIED/BROKEN banner (#fw-status) sits up top with the
     button; the long per-record card list is reference detail, kept last so it
     never buries the exposure summary + feed. -->
<div id="fw-results"></div>

<script type="application/json" id="fw-export-data">${
    // Escape EVERY `<` as the JSON unicode escape `<`. Inside a JSON
    // string literal `<` decodes back to `<`, so the payload round-trips
    // byte-identically; and because a literal `<` can never appear, none of
    // the HTML script-data terminators (`</script>`, `<!--`, `<script>` —
    // HTML5 §13.2.5.4.6) can form inside this block. This is valid JSON for
    // ALL input (the previous per-substring escapes inserted `<\!--` / `<\script`,
    // which are INVALID JSON escape sequences — a record containing the bare
    // text `<script` or `<!--` made JSON.parse throw and bricked the entire
    // export).
    exportPayload.replace(/</g, '\\u003c')
  }</script>
<script>window.__FW_EXPORT__=JSON.parse(document.getElementById('fw-export-data').textContent);</script>
<script>${QR_LIB_NOTICE}${QR_LIB_SOURCE}</script>
<script>${EXPORT_NUMBERS_INLINE_SOURCE}</script>
<script>${EXPOSURE_SCRIPT}</script>
<script>${BEHAVIOR_SCRIPT}</script>
<script>${FEED_SCRIPT}</script>
<script>${READING_SCRIPT}</script>
<script>${RFC3161_VERIFIER_SOURCE}</script>
<script>${ANCHOR_CHECK_SCRIPT}</script>
<script>${KEY_GENESIS_SCRIPT}</script>
<script>${FILE_DIGEST_SCRIPT}</script>
<script>${COMPLETENESS_SCRIPT}</script>
<script>${CERT_SCRIPT}</script>
<script>${verifierScript(i18n)}</script>
</body>
</html>`;
}
