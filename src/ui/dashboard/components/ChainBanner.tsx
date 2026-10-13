// src/ui/dashboard/components/ChainBanner.tsx
// Surface-ID: chain-banner (1.2)
//
// CHANGES vs v1:
//   • Visual refresh — left color-rail, shield-on-soft-fill icon, mono stat tiles right.
//   • Scoped to the Forensics tab. The DashHeader integrity pill (3-state
//     ok/warn/err) carries the at-a-glance signal on every other tab; the
//     banner itself is the deep-dive surface and lives where a parent goes
//     to verify the chain (Forensics).
//   • PRESERVED: state shares with dash-header integrity pill via the same IntegrityResult.
//   • PRESERVED: shows unsignedCount when > 0 ("… · N records unsigned").
//
// FW-specific adjustments:
//   • integrity may be `null` (verification in flight) — render as the 'warn' state.

import { formatCompact, formatDecimal } from '../../shared/format-number';
import type { ResolvedUiLanguage } from '../../../i18n';
import * as React from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { IntegrityResult } from '../../../forensics/chain-integrity';
import { integrityVerificationState, unverifiedRecordCount } from '../../../forensics/integrity-summary';
import { recordLinesNotes, recordLinesSplit } from '../../../forensics/record-lines';
import { ShieldCheck, Shield, ShieldAlert } from '../../shared/icons/lucide';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatUtcStamp } from '../../shared/format-time';

export interface ChainBannerProps {
  records: ForensicRecord[];
  integrity: IntegrityResult | null;
  fingerprint: string | null;
  anchorCreatedAt: string | null;
  unsignedCount?: number;
  // Optional inline actions. The banner is the Forensics deep-dive surface, so
  // a parent who lands here (incl. via the DashHeader broken-chain pill) can
  // act without scrolling back to the header: re-run the chain verify, or jump
  // straight to evidence export. Each button renders ONLY when its handler is
  // wired — the banner stays a pure status surface when neither is supplied.
  onVerify?: () => void | Promise<void>;
  onExport?: () => void;
  /**
   * How many archived months exist, and whether they have been checked yet.
   *
   * `integrity` only ever describes the CURRENT chain. Archived months are
   * verified by a separate on-demand walk that is null until the parent
   * presses Verify, and its result was rendered in a table further down the
   * page and never reached this banner. So a parent could read "Record
   * verified" in green while an archived month, quite possibly the one a court
   * would want, was broken and unexamined.
   *
   * A green banner must therefore state its own scope. Counting the months is
   * cheap (a database listing, no records read); verifying them is not, which
   * is why this reports scope instead of forcing the expensive walk on load.
   */
  archivedMonthCount?: number;
  archivesVerified?: boolean;
  /**
   * The record store could not be READ. Distinct from an empty chain, and it
   * must never render as one: "no incidents" and "we could not open our own
   * database" look identical to a parent otherwise.
   */
  readFailed?: boolean;
  /**
   * Rows that are stored and did not decode on this install (M212). A third
   * state, and the banner has to keep it apart from the other two: `readFailed`
   * is "we could not open the store at all", an empty `records` is "there is
   * nothing here", and this is "some of it is here and this machine could not
   * read it today". Collapsing it into either of those is what let a person
   * with three good records and one damaged one see an empty feed.
   */
  unreadableCount?: number;
}

export function ChainBanner({
  records, integrity, fingerprint, anchorCreatedAt, unsignedCount,
  onVerify, onExport, archivedMonthCount = 0, archivesVerified = false,
  readFailed = false, unreadableCount = 0,
}: ChainBannerProps) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const verification = integrity == null ? null : integrityVerificationState(integrity);
  // A failed read outranks every other state. Nothing below it can be trusted,
  // because none of it was read.
  // Rows that did not decode outrank a clean verification, because a walk over
  // the rows that DID read can come back verified while part of the record was
  // never looked at, and "Record verified" over that is the overclaim this
  // product exists not to make. It does not outrank a failed verification:
  // tampering is the worse fact and keeps the stronger colour.
  const someUnreadable = !readFailed && unreadableCount > 0;
  // Nothing to check is not a verdict. chain-integrity.ts answers valid: true
  // over an empty chain because nothing failed, which is the right answer to
  // the question it was asked and the wrong word to print at a reader: the walk
  // hashed no payload, resolved no link and checked no signature. This is the
  // same fact actionsOff already knows further down, where an enabled Verify
  // button "would produce a green check over a record that may be intact"
  // (2026-09-18). It ranks under a failed read, which is a worse fact, and over
  // everything else, because none of the others can be true of an empty chain.
  const nothingRecorded = !readFailed && (integrity?.chainLength ?? records.length) === 0;
  // A fresh install has not gone wrong, so an empty chain gets the quiet state
  // and not the warning colour.
  const state: 'ok' | 'warn' | 'err' | 'idle' =
    readFailed ? 'err'
      : nothingRecorded ? 'idle'
        : verification === 'failed' ? 'err'
          : someUnreadable ? 'warn'
            : verification === 'verified' ? 'ok' : 'warn';
  const unverified = integrity == null ? (unsignedCount ?? 0) : unverifiedRecordCount(integrity);
  // Archived months exist and nobody has checked them. The current chain may
  // be perfect and the record as a whole still unproven, so the strongest
  // thing this banner may claim is "the current chain".
  const archivesUnchecked = archivedMonthCount > 0 && !archivesVerified;

  // The record's own position, never the array index: everywhere else in the
  // product a record is named by its chainPosition (the feed's `#105`, the
  // reason sentence right under this title), and on a chain whose first loaded
  // record sits at 100 the index is 100 lower. This box read "Entry #0 failed
  // verification" over "Integrity hash mismatch at position 100", two numbers
  // for one record, neither of which a reader could look up (2026-09-17).
  const brokenTitle = integrity?.brokenAtPosition != null
    ? t.chainTitleEntryFailed(integrity.brokenAtPosition)
    : t.chainTitleBroken;

  // One precedence, and the title follows the same order as the colour above,
  // because a box whose colour says one thing and whose words say another is
  // worse than either alone. Could not open the store, then a chain that failed
  // to verify, then rows that did not decode, then everything else.
  const title =
    readFailed ? t.chainTitleUnreadable :
    nothingRecorded ? t.chainTitleNothingYet :
    verification === 'failed' ? brokenTitle :
    someUnreadable ? t.chainTitleSomeUnreadable :
    state === 'ok' ? (archivesUnchecked ? t.chainTitleOkCurrentOnly : t.chainTitleOk) :
    verification === 'partial' ? t.chainTitlePartial :
    state === 'warn' ? t.chainTitleChecking :
    brokenTitle;

  const desc = (() => {
    if (readFailed) return t.chainDescUnreadable;
    if (nothingRecorded) return t.chainDescNothingYet;
    // After the failed-verification branch below, for the same reason the title
    // is: tampering is the worse fact and keeps the box.
    if (someUnreadable && verification !== 'failed') {
      return t.chainDescSomeUnreadable(unreadableCount, records.length);
    }
    if (state === 'ok') {
      const len = integrity?.chainLength ?? records.length;
      // The anchor is evidence: it stays on the record's own clock, named
      // in words rather than with a bare "UTC" suffix a reader skips.
      const anchorISO = anchorCreatedAt
        ? t.utcStamp(formatUtcStamp(anchorCreatedAt))
        : null;
      const main = t.chainDescOk(len, anchorISO);
      const tail = unsignedCount && unsignedCount > 0
        ? t.chainUnsignedTail(unsignedCount)
        : '';
      const scope = archivesUnchecked ? t.chainArchivesUnchecked(archivedMonthCount) : '';
      return main + tail + scope;
    }
    if (verification === 'partial') {
      // The checker's own notes, so the reason on this screen is the reason the exported file gives.
      const lines = integrity?.recordLines;
      if (lines && recordLinesSplit(lines)) {
        const said = t.chainLinesLead + recordLinesNotes(lines, lang).join(' ');
        return unverified > 0 ? said + ' ' + t.chainDescPartial(unverified) : said;
      }
      return t.chainDescPartial(unverified);
    }
    if (state === 'warn') {
      return t.chainDescChecking;
    }
    // Structural breaks (deleted / reordered / collided positions) cannot be
    // repaired safely — point the parent to the restore path explicitly.
    const restoreHint =
      integrity?.brokenKind === 'position-mismatch' || integrity?.brokenKind === 'chain-link-mismatch'
        ? t.chainRestoreHint
        : '';
    return (integrity?.reason ?? t.chainDescBrokenFallback) + restoreHint;
  })();

  const fpShort = (() => {
    if (!fingerprint) return '—';
    const m = fingerprint.match(/.{1,4}/g) ?? [];
    return m.length > 1 ? `${m[0]}···${m[m.length - 1]}` : fingerprint;
  })();

  // What the browser MEASURES FeelingWise's storage at (navigator.storage
  // .estimate(), the extension origin's usage: the record, its archives and
  // everything else the extension keeps). It replaced a figure computed as
  // 4 KB per record, which records are gzipped far below (wiring audit 13 Sep,
  // D2-36): a made-up number on the trust banner. No measurement: a dash.
  const recordCount = integrity?.chainLength ?? records.length;
  const onDiskDisplay = useMeasuredStorage(recordCount, lang);

  const Icon = state === 'ok' ? ShieldCheck : state === 'err' ? ShieldAlert : Shield;
  // Verify and Export act on what was read. When the store could not be read,
  // there is nothing to verify or export, and an enabled button would produce a
  // green check or an empty file over a record that may be intact (D2-35).
  const actionsOff = readFailed || records.length === 0;

  return (
    <div className={'chain-banner ' + state}>
      <div className="chain-banner-shield"><Icon size={24} /></div>
      <div>
        <div className="chain-banner-title">{title}</div>
        <div className="chain-banner-desc">{desc}</div>
      </div>
      <div className="chain-banner-stats">
        <Stat value={formatCompact(recordCount, lang)} label={t.chainStatRecords} />
        <Stat value={fpShort} label={t.chainStatAnchor} title={t.chainStatAnchorTip} />
        <Stat
          value={onDiskDisplay}
          label={t.chainStatOnDisk}
          title={t.chainStatOnDiskTip}
        />
      </div>
      {(onVerify || onExport) && (
        <div
          className="chain-banner-actions"
          style={{ display: 'flex', gap: 8, alignItems: 'center', marginLeft: 14 }}
        >
          {onVerify && (
            <button
              type="button"
              onClick={() => { void onVerify(); }}
              disabled={actionsOff}
              // Accessibility audit found 2026-09-18: a forced single line on
              // a translated button label overflows the button box in RO/PT-BR.
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 12px', minHeight: 32, borderRadius: 2,
                cursor: actionsOff ? 'default' : 'pointer',
                border: '1px solid var(--fw-border)', background: 'transparent',
                color: 'var(--fw-text-secondary)',
                opacity: actionsOff ? 0.5 : 1,
              }}
            >
              {t.hdrVerify}
            </button>
          )}
          {onExport && (
            <button
              type="button"
              onClick={onExport}
              disabled={actionsOff}
              // Accessibility audit found 2026-09-18: a forced single line on
              // a translated button label overflows the button box in RO/PT-BR.
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 12px', minHeight: 32, borderRadius: 2,
                cursor: actionsOff ? 'default' : 'pointer',
                border: '1px solid var(--fw-teal)',
                background: actionsOff ? 'transparent' : 'var(--fw-teal)',
                color: actionsOff ? 'var(--fw-text-secondary)' : 'var(--fw-bg)',
                opacity: records.length === 0 ? 0.5 : 1,
              }}
            >
              {t.tabExport}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, title }: { value: string; label: string; title?: string }) {
  return (
    <div className="chain-banner-stat" title={title}>
      <div className="chain-banner-stat-value">{value}</div>
      <div className="chain-banner-stat-label">{label}</div>
    </div>
  );
}

/** The browser's measured storage for this extension, formatted; a dash when it cannot say. Re-read when the record count changes. */
function useMeasuredStorage(recordCount: number, lang: ResolvedUiLanguage): string {
  const [bytes, setBytes] = React.useState<number | null>(null);
  React.useEffect(() => {
    let live = true;
    const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
    if (!storage || typeof storage.estimate !== 'function') return;
    storage.estimate().then(
      (e) => { if (live) setBytes(typeof e.usage === 'number' ? e.usage : null); },
      () => { if (live) setBytes(null); },
    );
    return () => { live = false; };
  }, [recordCount]);
  return formatStorage(bytes, lang);
}

/** Bytes to the banner's short form. Exported for its test. */
export function formatStorage(bytes: number | null, lang: ResolvedUiLanguage = 'en'): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '\u2014';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${formatDecimal(bytes / (1024 * 1024), lang, 1)} MB`;
  return `${formatDecimal(bytes / (1024 * 1024 * 1024), lang, 2)} GB`;
}
