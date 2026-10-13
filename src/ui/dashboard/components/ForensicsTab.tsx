// ─── Forensics tab ───
// Moved out of Dashboard.tsx (Proposal B step 6). Its ledger moved to the Feed log tab on 10 Oct 2026 (FeedLogTab.tsx,
// feed-log.ts); this tab keeps the chain banner, the anchor data, the usage panel and the exclusions.

import { dashboardWords } from '../dashboard-words';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { MonthSummary } from '../../../forensics/archive-summary';
import type { IntegrityResult, CrossMonthIntegrityResult } from '../../../forensics/chain-integrity';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatDateLocal, formatUtcStamp } from '../../shared/format-time';
import { ChainBanner } from './ChainBanner';
import { PLATFORM_LABELS } from './color-maps';
import { scrollBehavior } from '../../shared/motion';
import { UsageTimePanel } from './UsageTimePanel';
import { ArchivesPendingNote } from './ArchivesPendingNote';
import { readExclusions, removeExclusion, type AuthorExclusion } from '../../../forensics/author-exclusions';

export function ForensicsTab({
  records, allRecords, wholeCount, unloadedSummaries, archivesPending, integrity, crossMonth, anchorCreatedAt, fingerprint, unsignedCount,
  archivedMonthCount, recordReadFailed, unreadableCount, onVerify, onExport, onOpenFeedLog, readingOffered = true,
  onOpenAccount, focusExclusions = 0,
}: {
  /** The active chain: what the ledger lists and the per-chain exports carry. */
  records: ForensicRecord[];
  /** The whole record, archived months plus the active chain (Dashboard.tsx allRecords). Every count on this tab that describes "the record" reads this; defaults to the active chain. */
  allRecords?: ForensicRecord[];
  /** The whole record's entry count (every archived month plus the active chain). Since item 7's second slice `allRecords` holds the walk window only, so the count printed as "the record" comes from here. */
  wholeCount?: number;
  /** Summaries of the archived months outside the walk window (Dashboard.tsx unloadedSummaries), for the usage panel's long frames. */
  unloadedSummaries?: readonly MonthSummary[];
  /** The archived months are still being read. */
  archivesPending?: boolean;
  integrity: IntegrityResult | null;
  crossMonth?: CrossMonthIntegrityResult | null;
  /** Archived months that exist, counted cheaply (a DB listing, no reads). */
  archivedMonthCount: number;
  recordReadFailed?: boolean;
  /** Stored rows that did not decode on this install (M212). Passed straight to the banner. */
  unreadableCount?: number;
  anchorCreatedAt: string | null;
  fingerprint: string | null;
  unsignedCount?: number;
  onVerify?: () => void | Promise<void>;
  onExport?: () => void;
  /** Opens the Feed log, where the items of the feed now are. */
  onOpenFeedLog?: () => void;
  /** Opens the Feed log on one account of the not-recorded list. */
  onOpenAccount?: (e: AuthorExclusion) => void;
  /** Changes when the Feed log asks for the not-recorded list: the tab scrolls to it. */
  focusExclusions?: number;
  /** Passed to the usage panel, whose wording follows whether the AI reading is on offer. */
  readingOffered?: boolean;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const whole = allRecords ?? records;
  // A broken archived month is a broken record. Feeding the worst of the two
  // into the banner is what stops a green shield sitting above a table that
  // says an archive failed; the parent reads the shield.
  const bannerIntegrity = crossMonth ?? integrity;
  // Register item 20 part 2: the accounts the recorder skips.
  const [exclusions, setExclusions] = useState<AuthorExclusion[]>([]);
  useEffect(() => { void readExclusions().then(setExclusions).catch(() => {}); }, []);
  const exclusionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusExclusions) exclusionsRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() }); }, [focusExclusions]);

  const dataValues: { node: ReactNode; mono?: boolean }[] = [
    { node: fingerprint ?? t.noneYet, mono: true },
    { node: anchorCreatedAt ? t.utcStamp(formatUtcStamp(anchorCreatedAt)) : t.noneYet },
    // The whole record, and the same verdict the banner above reads (the
    // cross-month one after Verify), so the two never print different totals
    // (wiring audit 13 Sep, D2-2).
    { node: <>{wholeCount ?? whole.length} <span style={{ color: 'var(--fw-muted)' }}>{t.anchorEntriesDetail(bannerIntegrity?.chainLength ?? t.noneYet, bannerIntegrity?.preChainCount ?? 0)}</span></> },
    { node: 'ECDSA P-256 · SHA-256', mono: true },
    { node: <><span style={{ color: 'var(--fw-green)' }}>● </span>{t.anchorVerifierValue}</> },
  ];

  return (
    <>
      {/* Chain banner — surface-id: chain-banner (1.2). Scoped to the Forensics
          tab (no longer mounted at the dashboard shell). The DashHeader
          integrity pill carries the at-a-glance signal on every other tab. */}
      <ChainBanner
        records={whole}
        integrity={bannerIntegrity}
        fingerprint={fingerprint}
        anchorCreatedAt={anchorCreatedAt}
        unsignedCount={unsignedCount}
        archivedMonthCount={archivedMonthCount}
        archivesVerified={crossMonth != null}
        readFailed={recordReadFailed}
        unreadableCount={unreadableCount}
        onVerify={onVerify}
        onExport={onExport}
      />

      {/* Judge-lens limits box (READER_LENSES: limits stated before
          conclusions; what the tool did NOT see). Mirrors the Statistics
          tab's box; chart-kit callout. Turn 13, Record-tab lens look. */}
      <div className="stats-card full" style={{ marginTop: 16 }}>
        <h3>{t.recordLimitsTitle}</h3>
        <div className="fwc-callout" style={{ marginTop: 6 }}>
          <div>{t.recordLimit1}</div>
          <div>{t.recordLimit2}</div>
          <div>{readingOffered ? t.recordLimit3 : dashboardWords(lang).recordLimitNoAi}</div>
          <div>{t.recordLimit4}</div>
        </div>
      </div>

      {/* D3 — per-month breakdown after an explicit Verify when archived
          months exist. `linkToPreviousOk` says whether this month's opening
          Rotation Marker chains from the previous month's terminal hash, which
          is what this column has always rendered. The field was called
          `linkToNextOk` until 2026-09-19 and this comment existed to correct
          for it; the name says what it holds now. */}
      {crossMonth && crossMonth.perMonth.length > 1 && (
        <div className="stats-card full" style={{ marginTop: 16 }}>
          <h3>{t.archiveMonthsTitle}</h3>
          <div className="stats-sub">{t.archiveMonthsSub}</div>
          <div className="anchor-grid">
            <div>
              {crossMonth.perMonth.map((m, i) => (
                <div className="anchor-row" key={m.monthKey}>
                  <span className="anchor-num">{i + 1}</span>
                  <div className="anchor-data">
                    <div className="anchor-label">
                      {m.monthKey === 'current' ? t.archiveMonthCurrent : m.monthKey}
                    </div>
                    <div className="anchor-value">
                      <span style={{ color: m.result.valid ? 'var(--fw-green)' : 'var(--fw-red)' }}>● </span>
                      {m.result.valid ? t.archiveMonthOk : t.archiveMonthFailed}
                    </div>
                  </div>
                  <div
                    className="anchor-explainer"
                    style={m.linkToPreviousOk === false ? { color: 'var(--fw-red)' } : undefined}
                  >
                    {m.linkToPreviousOk === undefined ? '' : m.linkToPreviousOk ? t.archiveLinkOk : t.archiveLinkBroken}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="stats-card full" style={{ marginTop: 16 }}>
        <h3>{t.yourRecord}</h3>
        <div className="stats-sub">
          {t.yourRecordSub}
        </div>

        <div className="anchor-grid">
          <div>
            {t.anchorExplainers.map((row, i) => (
              <div className="anchor-row" key={row.label}>
                <span className="anchor-num">{i + 1}</span>
                <div className="anchor-data">
                  <div className="anchor-label">{row.label}</div>
                  <div className="anchor-value">{dataValues[i].node}</div>
                </div>
                <div className="anchor-explainer">{row.why}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Verify / Fix record / Reset buttons lifted to DashHeader 2026-05-25
            so they're reachable from any tab. The long explainer paragraphs
            that used to live here were collapsed into the help-tooltip
            (?) next to those header buttons. The "note on uninstall +
            reinstall" caveat below replaces all four prior paragraphs as
            the single durable piece of context worth preserving on this
            surface — it warns about the one operation FW can't intercept
            (Chrome wiping extension storage on uninstall). */}
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--fw-text-secondary)', lineHeight: 1.6, maxWidth: '70ch' }}>
          <p style={{ margin: 0 }}>
            <strong>{t.noteUninstallLead}</strong> {t.noteUninstall1}<strong>{t.backupNowTitle}</strong>{t.noteUninstall2}<strong>{t.tabExport}</strong>{t.noteUninstall3}<strong>{t.restoreTitle}</strong>{t.noteUninstall4}
          </p>
        </div>
      </div>

      <ArchivesPendingNote pending={archivesPending} />
      <UsageTimePanel records={whole} archivedSummaries={unloadedSummaries} readingOffered={readingOffered} />

      {/* Evidence ledger — rebuilt to the redesign's 8-column chronology
          (Serial · Time · Gap · Platform · Kind · Record · Sev · Verdict) with
          derived session / platform-switch / idle dividers and a windowed
          footer. PRESERVED from the prior table: per-row verify status, the
          integrity hash, click-to-expand, the three sort modes, and the
          anchor-data panel above. Gap + Kind columns and the dividers are
          additive (derived, no schema change). */}
      <div ref={exclusionsRef} id="accounts-not-recorded" className="entries-table-wrap fx-exclusions" style={{ marginTop: 16, scrollMarginTop: 16 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '0 0 6px', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.2 }}>{t.exclusionsTitle}</h3>
          <span style={{ fontSize: 12, color: 'var(--fw-muted)' }}>{t.exclusionsSub}</span>
        </div>
        {exclusions.length === 0
          ? <div style={{ fontSize: 12, color: 'var(--fw-muted)' }}>{t.exclusionsNone}</div>
          : exclusions.map(e => (
            <div key={e.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', fontSize: 12, padding: '3px 0' }}>
              <span style={{ fontFamily: 'var(--fw-font-mono)' }}>{e.author}</span>
              <span style={{ color: 'var(--fw-muted)' }}>{PLATFORM_LABELS[e.platform] ?? e.platform} · {formatDateLocal(e.addedAt, lang)}{e.reason ? ` · ${e.reason}` : ''}</span>
              <button type="button" className="fx-withhold" onClick={() => { void removeExclusion(e.key).then(setExclusions); }}>{t.exclusionRemove}</button>
              {onOpenAccount && <button type="button" className="fx-withhold" onClick={() => onOpenAccount(e)}>{t.tabFeedLog}</button>}
            </div>
          ))}
      </div>
      {/* The items of the feed, with what Feedprint did to each, moved to the Feed log tab (10 Oct 2026). */}
      <div className="entries-table-wrap fl-pointer" style={{ marginTop: 16 }}>
        <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>{t.feedLogPointer}</p>
        {onOpenFeedLog && (
          <button type="button" className="chip" style={{ marginTop: 8 }} onClick={onOpenFeedLog}>{t.tabFeedLog}</button>
        )}
      </div>
    </>
  );
}
