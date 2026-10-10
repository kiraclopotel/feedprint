// src/ui/dashboard/components/DashHeader.tsx
// Surface-ID: dash-header (1.1)
//
// CHANGES vs v1:
//   • Visual refresh — gradient wordmark glyph, mono timestamp on last-record line.
//   • PRESERVED: theme toggle cycles dark → light → system → dark (3 states).
//   • PRESERVED: integrity pill (3 states ok/warn/err) shares state with ChainBanner.
//   • PRESERVED: tier pill uppercase chip; free tier renders with muted background.
//
// FW-specific adjustments from the original design bundle:
//   • integrity may be `null` (verification in flight) — render as 'warn' / "checking".
//   • Records are stored oldest-first; the last record is `records[records.length - 1]`,
//     not `records[0]` (the original handoff bundle assumed newest-first).

import { formatCompact } from '../../shared/format-number';
import * as React from 'react';
import { Mark } from '../../shared/brand';
import { useState, useEffect } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { IntegrityResult } from '../../../forensics/chain-integrity';
import { integrityVerificationState, unverifiedRecordCount } from '../../../forensics/integrity-summary';
import { recordLinesNotes, recordLinesSplit } from '../../../forensics/record-lines';
import type { LicenseInfo } from '../../../storage/license';
import { Clock, Moon, Sun, Contrast, Check, X } from '../../shared/icons/lucide';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { formatTimeLocal, formatUtcStamp } from '../../shared/format-time';
import type { MonthSummary } from '../../../forensics/archive-summary';
import type { MonthSets, OlderMonthsProgress } from '../month-sets';
import { EntriesBreakdown } from './EntriesBreakdown';
import { PRODUCT_NAME, dashboardWords } from '../dashboard-words';

import { nextThemeInCycle, type ThemeChoice } from '../../shared/theme';

export interface DashHeaderProps {
  records: ForensicRecord[];
  /**
   * Records held in the month archives, which `records` (the ACTIVE chain)
   * does not include. The chip shows the sum. Without it the headline number
   * falls every time the cap is enforced, which reads to the user as losing
   * records at the moment the app finally started keeping them.
   */
  archivedCount?: number;
  /** The entries the page holds (active chain plus loaded months), sorted into sets when the chip opens. */
  loadedEntries?: readonly ForensicRecord[];
  /** The months not loaded: counted from their summaries, not sorted. */
  unloadedSummaries?: readonly MonthSummary[];
  /** When the archived months were counted; they are counted once per load. */
  archivedCountedAt?: Date | null;
  /** The archived months counted by the module's rules (month-sets.ts); the chip sorts them once all are. */
  monthSets?: ReadonlyMap<string, MonthSets>;
  /** While the older months are being counted by those rules: how far it has come. */
  olderMonthsProgress?: OlderMonthsProgress | null;
  integrity: IntegrityResult | null;
  license: LicenseInfo;
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  // Chain-management actions surfaced inline next to the status pill.
  // Pre-2026-05-25 these lived in the Forensics tab behind a wall of
  // explanatory paragraphs; a standing product decision, 2026-05-25:
  // lift to the always-visible header so a parent can verify / reset
  // from any tab without navigating + the explanations collapse into
  // a single help tooltip.
  // The manual "Fix record" (re-anchor) button was removed 2026-06-11.
  // Verification never mutates the record or auto-re-anchors a failure.
  onVerify?: () => void | Promise<void>;
  onReset?: () => void;
  // Optional jump to the Forensics tab. Used by the integrity pill when the
  // chain is in the 'err' state: a parent who taps the broken-chain pill is
  // sent to the deep-dive surface (ChainBanner) rather than re-running verify
  // on an already-known-broken chain. Optional so the header still mounts in
  // contexts that have no tab router (e.g. the cap-exhausted fallback shell).
  onShowForensics?: () => void;
  // True while the dashboard has painted only the newest page of the chain.
  // The RECORDS chip and last-record time show a pending glyph instead of a
  // number: `records` is empty until the full read lands, and neither 0 nor a
  // page-sized count is the chain's total.
  countsPending?: boolean;
}


export function DashHeader({
  records, integrity, license, theme, setTheme,
  onVerify, onReset, onShowForensics, countsPending, archivedCount,
  loadedEntries, unloadedSummaries, archivedCountedAt, monthSets, olderMonthsProgress,
}: DashHeaderProps) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  // Records are stored oldest-first in IDB. Newest is at the tail.
  const last = records.length > 0 ? records[records.length - 1] : null;
  const hasRecords = records.length > 0;

  // Three states: integrity in flight = 'warn'; valid = 'ok'; invalid =
  // 'err'. CSS renders 'err' in amber rather than red per a 2026-05-25
  // design decision: green to yellow on issue, red reserved for
  // catastrophic surfaces (the ChainBanner shows when the chain is
  // actually broken).
  const verification = integrity == null ? null : integrityVerificationState(integrity);
  const state: 'ok' | 'warn' | 'err' =
    verification === 'verified' ? 'ok' : verification === 'failed' ? 'err' : 'warn';
  // When the chain is healthy but empty, the pill is "armed" — protection is
  // live and watching, nothing has been recorded yet. Reuse the first-run
  // welcome title ("Nothing recorded yet") so the empty state reads honestly
  // instead of "Record is healthy" against a zero-length chain.
  const label =
    state === 'ok'
      ? (hasRecords ? t.hdrPillOk : t.feedWelcomeTitle)
      : verification === 'partial' ? t.hdrPillPartial
        : state === 'warn' ? t.hdrPillChecking :
        t.hdrPillErr;

  const [verifying, setVerifying] = useState(false);
  // After Verify completes, surface the outcome in a small toast so the
  // parent gets explicit confirmation. Pre-2026-05-25 the click was a
  // no-op visually — the integrity prop updated but nothing told the
  // parent the verify ran. Success toast plays a CSS fade-out
  // (dash-verify-toast-out keyframe, 5.3s delay → 0.7s fade), then
  // unmounts at the 6s mark. Failure toast stays until manually closed
  // (parent needs to act on it; no fade).
  const [resultShown, setResultShown] = useState(false);
  const handleVerify = async () => {
    if (!onVerify || verifying) return;
    setVerifying(true);
    setResultShown(false);
    try { await onVerify(); }
    finally {
      setVerifying(false);
      setResultShown(true);
    }
  };
  useEffect(() => {
    if (!resultShown) return;
    if (verification === 'verified') {
      const t = setTimeout(() => setResultShown(false), 6000);
      return () => clearTimeout(t);
    }
    return;
  }, [resultShown, verification]);

  // Help popover (? button). Native title-tooltip was unreliable —
  // slow show, can't be styled, can't render line breaks consistently
  // across browsers. Replace with a click-to-toggle dropdown anchored
  // under the button, click-outside to dismiss.
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (!helpOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.dash-record-help')) return;
      if (e.target.closest('.dash-record-help-popover')) return;
      setHelpOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [helpOpen]);
  const [entriesOpen, setEntriesOpen] = useState(false);
  useEffect(() => {
    if (!entriesOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.pg-records-chip') || e.target.closest('.dash-entries-breakdown')) return;
      setEntriesOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [entriesOpen]);
  const entriesTotal = records.length + (archivedCount ?? 0);

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Contrast;
  // Cycle dark → light → system → dark. Sequence locked in CHANGES.md
  // Behavioral Contract #7; the logic lives in shared/theme (D5 2026-07-14 —
  // this line previously inlined a duplicate of nextThemeInCycle).
  const next: ThemeChoice = nextThemeInCycle(theme);

  return (
    <header className="dash-header">
      <div className="dash-header-inner">
        {/* Three slots: the brand and the record's actions at the left, the record's
            status alone in the centre, the settings and counts at the right. */}
        <div className="dash-header-left">
          <div className="dash-wordmark">
            <Mark size={36} className="dash-wordmark-mark" />
            <div className="dash-wordmark-text">{PRODUCT_NAME}<small>{t.hdrWordmarkSub}</small></div>
          </div>
          {/* Record-management actions (Verify / Reset / help) sit on the LEFT,
              next to the wordmark (design decision, 2026-06-16). */}
          {onVerify && onReset && (
            <span className="dash-record-actions" role="group" aria-label={t.hdrRecordMgmtAria}>
              <button
                type="button"
                className="dash-record-btn"
                onClick={() => { void handleVerify(); }}
                disabled={!hasRecords || verifying}
                title={t.hdrVerifyTip}
              >
                {verifying ? t.hdrVerifying : t.hdrVerify}
              </button>
              <button
                type="button"
                className="dash-record-btn danger"
                onClick={onReset}
                disabled={!hasRecords}
                title={t.hdrResetTip}
              >
                {dashboardWords(lang).resetLabel}
              </button>
              <span className="dash-record-help-wrap">
                <button
                  type="button"
                  className="dash-record-help"
                  onClick={() => setHelpOpen(o => !o)}
                  aria-label={t.hdrHelpAria}
                  aria-expanded={helpOpen}
                >
                  ?
                </button>
                {helpOpen && (
                  <div className="dash-record-help-popover" role="dialog" aria-label={t.hdrHelpDialogAria}>
                    <p><strong>{t.hdrHelpVerifyTitle}</strong>{t.hdrHelpVerifyBody}</p>
                    <p><strong>{t.hdrHelpResetTitle}</strong>{t.hdrHelpResetBody}</p>
                  </div>
                )}
              </span>
            </span>
          )}
        </div>
        <div className="dash-header-centre">
          {/* The integrity pill is now actionable (was display-only):
              • chain healthy (ok) → re-run Verify, the same action as the
                Verify button, so a parent can confirm from one tap;
              • chain broken (err) → jump to the Forensics deep-dive surface
                (ChainBanner) instead of re-verifying an already-broken chain.
              It stays inert in the 'warn'/in-flight state, or when no handler
              is wired. role/tabIndex/keyboard added only when actionable so the
              non-interactive pill keeps its plain-text semantics. */}
          {(() => {
            const pillAction =
              state === 'ok' && onVerify ? () => { void handleVerify(); } :
              state === 'err' && onShowForensics ? onShowForensics :
              null;
            const pillTitle =
              state === 'ok' && onVerify ? t.hdrVerifyTip :
              state === 'err' && onShowForensics ? t.hdrPillErr :
              undefined;
            return (
          <span
            className={'dash-integrity-pill ' + state}
            {...(pillAction
              ? {
                  role: 'button' as const,
                  tabIndex: 0,
                  title: pillTitle,
                  onClick: pillAction,
                  onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pillAction(); }
                  },
                  style: { cursor: 'pointer' },
                }
              : {})}
          >
            {state === 'ok' ? (
              // Healthy → a live ECG/vital-signs trace (a sweeping heartbeat),
              // not a static dot: it reads as "the record is alive + being
              // watched". Warn/err keep the dot. Animation respects
              // prefers-reduced-motion (see dashboard-design.css).
              <svg className="dash-ecg" viewBox="0 0 40 16" width="40" height="14" aria-hidden="true">
                <polyline className="ecg-base" pathLength={100} points="0,8 8,8 11,8 13,6.5 15,8 18,8 20,3 22,13 24,8 27,8 40,8" />
                <polyline className="ecg-beam" pathLength={100} points="0,8 8,8 11,8 13,6.5 15,8 18,8 20,3 22,13 24,8 27,8 40,8" />
              </svg>
            ) : (
              <span className="dot" />
            )}
            {label}
          </span>
            );
          })()}
        </div>
        <div className="dash-header-meta">
          <button
            type="button"
            className="dash-icon-btn"
            title={t.hdrThemeTip(t.hdrThemeName[theme], t.hdrThemeName[next])}
            aria-label={t.hdrThemeAria(t.hdrThemeName[theme], t.hdrThemeName[next])}
            onClick={() => setTheme(next)}
          >
            <ThemeIcon size={15} />
          </button>
          <span className="dash-tier-stack">
            {/* Only a held key is named: a keyless install has no level to show. */}
            {license.tier !== 'free' && <span className="dash-tier-pill">{license.tier}</span>}
            <span className="dash-last-record">
              {/* Records-count chip — total sealed records, relabelled "RECORDS"
                  + count and lightly accent-tinted so the running total reads as
                  the headline number (design decision, 2026-06-16). Sits before
                  the last-record timestamp. */}
              <span className="dash-record-help-wrap">
                <button
                  type="button"
                  className="pg-trust-chip pg-records-chip"
                  title={t.hdrRecordsTitle}
                  aria-expanded={entriesOpen}
                  disabled={countsPending}
                  onClick={() => setEntriesOpen((o) => !o)}
                >
                  <span className="pg-trust-chip-label">{t.hdrRecordsLabel}</span>
                  <span className="pg-trust-chip-count">{countsPending ? '…' : formatCompact(entriesTotal, lang)}</span>
                </button>
                {entriesOpen && !countsPending && (
                  <EntriesBreakdown
                    total={entriesTotal}
                    loadedEntries={loadedEntries ?? records}
                    unloadedSummaries={unloadedSummaries ?? []}
                    archivedCountedAt={archivedCountedAt ?? null}
                    monthSets={monthSets}
                    olderMonthsProgress={olderMonthsProgress ?? null}
                  />
                )}
              </span>
              {olderMonthsProgress && (
                <span className="dash-older-months-counting" role="status" data-testid="older-months-counting">
                  {t.hdrCountingOlderMonths(olderMonthsProgress.done, olderMonthsProgress.total)}
                </span>
              )}
              {/* The header is chrome a reader checks against their own day
                  ("did it record while I was on X an hour ago?"), so it is on
                  their clock. The record's sealed instant is on the hover, and
                  the Record tab's ledger states its own clock in words. */}
              <Clock size={11} /> {t.hdrLastRecord}{' '}
              <span title={last ? t.utcStamp(formatUtcStamp(last.timestamp)) : undefined}>
                {countsPending ? '…' : last ? formatTimeLocal(last.timestamp, lang, true) : t.noneYet}
              </span>
            </span>
          </span>
        </div>
      </div>
      {resultShown && integrity && !verifying && (
        <div
          className={'dash-verify-toast ' + (verification === 'verified' ? 'ok' : verification === 'partial' ? 'warn' : 'err')}
          role="status"
          aria-live="polite"
        >
          {verification === 'verified' ? (
            <>
              <Check size={14} />
              <span>
                <strong>{t.hdrToastVerifiedLead}</strong>{t.hdrToastVerifiedBody(integrity.chainLength ?? records.length)}
              </span>
            </>
          ) : verification === 'partial' ? (
            <>
              <span className="dash-verify-toast-glyph">!</span>
              <span>
                <strong>{t.hdrToastPartialLead}</strong>
                {integrity.recordLines && recordLinesSplit(integrity.recordLines) && unverifiedRecordCount(integrity) === 0
                  ? ': ' + t.chainLinesLead + recordLinesNotes(integrity.recordLines, lang).join(' ')
                  : t.hdrToastPartialBody(unverifiedRecordCount(integrity))}
              </span>
            </>
          ) : (
            <>
              <span className="dash-verify-toast-glyph">!</span>
              <span>
                <strong>{t.hdrToastIssueLead(integrity.brokenAt ?? '?')}</strong>{t.hdrToastIssueBody}
              </span>
            </>
          )}
          <button
            type="button"
            className="dash-verify-toast-close"
            onClick={() => setResultShown(false)}
            aria-label={t.hdrDismissAria}
          >
            <X size={12} />
          </button>
        </div>
      )}
    </header>
  );
}

