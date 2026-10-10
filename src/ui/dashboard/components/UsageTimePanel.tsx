import { useMemo, useState } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import { usageBand } from '../../../forensics/usage-band';
import type { MonthSummary } from '../../../forensics/archive-summary';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import type { ResolvedUiLanguage } from '../../../i18n';
import { formatDayOfMonth, formatHourAxis, formatMonthShort, formatWeekdayShort } from '../../shared/format-time';
import { dashboardWords } from '../dashboard-words';

// ─── Usage time panel (Forensics tab) ───
// Extracted from Dashboard.tsx (Proposal B step 3). buildUsageBuckets is the
// pure histogram builder, locked by tests/unit/ui/dashboard/components/usage-buckets.test.ts.
//
// Wiring audit 13 Sep 2026 (D2-12, D2-13): the "year" frame was twelve
// 30-day buckets labelled with month names under "last 12 months" (a 360-day
// window that did not start on any month), and every record that was neither
// blocked nor flagged, including skipped and cancelled scans and the chain's
// own markers, was filed into the "pass" band. Now: the year frame is twelve
// calendar months ending with the current one; markers and room summaries
// are not counted (they are not things the person saw); a scan that reached
// no verdict is its own band, "not judged".
export type UsageFrame = 'day' | 'week' | 'month' | 'year';

export interface UsageBucket {
  label: string;
  startMs: number;
  endMs: number;
  /** Records counted in this bucket: flagged + blocked + pass + unjudged. */
  count: number;
  flagged: number;
  blocked: number;
  pass: number;
  /** Skipped and cancelled scans: seen, never judged either way. */
  unjudged: number;
  /**
   * Signed gap markers that fall in this bucket: the chain's own statement that
   * the recorder stopped, and why (src/types/gap-marker.ts types ten reasons,
   * among them recorder-down, context-invalidated and chain-lost).
   *
   * They are counted here and nowhere in `count`, because a gap is not
   * something the person was shown. The reason they are counted at all: an
   * empty bar used to mean one thing on the page, "this browser was not on a
   * covered platform", and it can mean at least eight, of which that is the
   * only reassuring one. An hour holding the chain's own proof that the
   * recorder was down drew identically to an hour somebody spent asleep
   * (2026-09-18). A record that cannot tell "nothing happened" from "the
   * recorder was dead" is the record a recipient must not rely on.
   */
  gaps: number;
}

// usageBand lives in forensics/usage-band.ts since item 7's second slice; the
// month summary counts the same bands per hour. Re-exported for the tests.
export { usageBand };

/**
 * The histogram over the records in the page plus, for the months whose
 * records are not in the page (item 7, second slice: the walk window loads
 * the last 90 days), their summaries' per-hour bands. A month is counted
 * from its records or from its summary, never both; the caller passes only
 * the summaries of months it did not load (Dashboard.tsx unloadedSummaries).
 */
export function buildUsageBuckets(
  records: ForensicRecord[],
  frame: UsageFrame,
  nowMs: number,
  /**
   * The reader's interface language. The axis labels used to come from
   * `toLocaleDateString([])`, which is the BROWSER's locale: a Spanish
   * interface printed English month names on a US-English browser (cold read
   * of the dashboard, 2026-09-18). Required rather than defaulted so a new
   * call site cannot fall back to the browser by omission.
   */
  lang: ResolvedUiLanguage,
  archivedSummaries: readonly MonthSummary[] = [],
): UsageBucket[] {
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;
  const buckets: UsageBucket[] = [];
  const push = (label: string, startMs: number, endMs: number): void => {
    buckets.push({ label, startMs, endMs, count: 0, flagged: 0, blocked: 0, pass: 0, unjudged: 0, gaps: 0 });
  };
  if (frame === 'year') {
    // Twelve calendar months, the current one last and cut at `nowMs`, in
    // the reader's local time. Labels name the month the bucket IS.
    const now = new Date(nowMs);
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      push(formatMonthShort(start, lang), start.getTime(), Math.min(end.getTime(), nowMs));
    }
  } else {
    const cfg = frame === 'day'
      ? { count: 24, sizeMs: HOUR, label: (d: Date) => formatHourAxis(d) }
      : frame === 'week'
        ? { count: 7, sizeMs: DAY, label: (d: Date) => formatWeekdayShort(d, lang) }
        : { count: 30, sizeMs: DAY, label: (d: Date) => formatDayOfMonth(d) };
    const startMs = nowMs - cfg.count * cfg.sizeMs;
    for (let i = 0; i < cfg.count; i++) {
      const bStart = startMs + i * cfg.sizeMs;
      push(cfg.label(new Date(bStart)), bStart, bStart + cfg.sizeMs);
    }
  }
  const windowStart = buckets[0].startMs;
  for (const r of records) {
    const band = usageBand(r);
    // A gap marker bands to null like every system marker, and unlike the
    // others it is evidence about the window it sits in. Placed before the
    // band guard so it is counted rather than discarded.
    const isGap = r.kind === 'gap-marker';
    if (band === null && !isGap) continue;
    const ts = Date.parse(r.timestamp);
    if (!Number.isFinite(ts) || ts < windowStart || ts >= nowMs) continue;
    // Buckets are contiguous and ascending; the last one whose start is at
    // or before the timestamp is the one it falls in.
    let idx = buckets.length - 1;
    while (idx > 0 && buckets[idx].startMs > ts) idx--;
    const b = buckets[idx];
    if (isGap) { b.gaps++; continue; }
    if (band === null) continue;
    b.count++;
    b[band]++;
  }
  // The summarised months: each UTC hour bucket carries the bands of the
  // records that hour held. An hour is placed by its start, so a bucket edge
  // inside an hour (the day frame's local hours in a half-hour zone) can put
  // that hour's records one bucket early; the year, month and week frames sit
  // on day boundaries and are exact for whole-hour zones.
  for (const s of archivedSummaries) {
    const usage = s.usageByHour;
    if (!usage) continue;
    for (const hourKey in usage) {
      const ts = Date.parse(`${hourKey}:00:00.000Z`);
      if (!Number.isFinite(ts) || ts < windowStart || ts >= nowMs) continue;
      let idx = buckets.length - 1;
      while (idx > 0 && buckets[idx].startMs > ts) idx--;
      const b = buckets[idx];
      const u = usage[hourKey];
      b.count += u.n;
      b.flagged += u.flagged;
      b.blocked += u.blocked;
      b.pass += u.pass;
      b.unjudged += u.unjudged;
      // Gaps travel with the month now (summary version 3, 2026-09-19). Before
      // that an outage became an idle hour the moment its month was archived,
      // which is the same wrongness this panel fixed for the live window a day
      // earlier and then kept only there. `?? 0` covers a summary written
      // before the field existed; the version check recomputes those anyway,
      // and this is the belt to that brace.
      b.gaps += u.gaps ?? 0;
    }
  }
  return buckets;
}

export function UsageTimePanel({ records, archivedSummaries = [], readingOffered = true }: {
  records: ForensicRecord[];
  /** A free install rewrites nothing, so its flagged count and legend say marked only (ai-wording.ts). */
  readingOffered?: boolean;
  /** Summaries of the archived months whose records are not in `records` (Dashboard.tsx unloadedSummaries). */
  archivedSummaries?: readonly MonthSummary[];
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const words = dashboardWords(lang);
  const [frame, setFrame] = useState<UsageFrame>('day');
  const buckets = useMemo(() => buildUsageBuckets(records, frame, Date.now(), lang, archivedSummaries), [records, frame, lang, archivedSummaries]);
  const max = Math.max(1, ...buckets.map(b => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const totalFlagged = buckets.reduce((s, b) => s + b.flagged, 0);
  const totalBlocked = buckets.reduce((s, b) => s + b.blocked, 0);
  const totalPass = buckets.reduce((s, b) => s + b.pass, 0);
  const totalUnjudged = buckets.reduce((s, b) => s + b.unjudged, 0);
  const activeBuckets = buckets.filter(b => b.count > 0).length;
  const peakBucket = buckets.reduce<UsageBucket | null>(
    (acc, b) => (acc == null || b.count > acc.count ? b : acc), null,
  );

  return (
    <div className="stats-card full" style={{ marginTop: 18 }}>
      <h3>
        {t.usageTitle}
        <span style={{ float: 'right', fontSize: 12, color: 'var(--fw-muted)', fontWeight: 400 }}>
          {t.usageHeaderCount(total, frame)}
        </span>
      </h3>
      <div className="stats-sub">
        {t.usageSub(frame)}
      </div>

      <div className="usage-frames">
        {(['day', 'week', 'month', 'year'] as const).map(f => (
          <button
            type="button"
            key={f}
            className={'chip' + (frame === f ? ' active' : '')}
            onClick={() => setFrame(f)}
          >
            {t.usageFrameChip(f)}
          </button>
        ))}
      </div>

      <div className="usage-summary">
        <div className="usage-summary-item">
          <div className="v">{activeBuckets}/{buckets.length}</div>
          <div className="l">{t.usageActiveLabel(frame)}</div>
        </div>
        <div className="usage-summary-item">
          <div className="v" style={{ color: 'var(--fw-amber)' }}>{totalFlagged}</div>
          <div className="l">{readingOffered ? t.usageRewritesLabel : words.usageFlaggedNoAi}</div>
        </div>
        <div className="usage-summary-item">
          <div className="v" style={{ color: 'var(--fw-purple)' }}>{totalBlocked}</div>
          <div className="l">{t.usageBlocksLabel}</div>
        </div>
        <div className="usage-summary-item">
          <div className="v" style={{ color: 'var(--fw-teal)' }}>{totalPass}</div>
          <div className="l">{t.usagePassLabel}</div>
        </div>
        {totalUnjudged > 0 && (
          <div className="usage-summary-item">
            <div className="v" style={{ color: 'var(--fw-muted)' }}>{totalUnjudged}</div>
            <div className="l">{t.usageUnjudgedLabel}</div>
          </div>
        )}
        <div className="usage-summary-item">
          <div className="v">{peakBucket && peakBucket.count > 0 ? peakBucket.label : t.noneYet}</div>
          <div className="l">{t.usagePeakLabel(frame, peakBucket?.count ?? 0)}</div>
        </div>
      </div>

      <div className="usage-chart" aria-label={t.usageChartAria(frame)}>
        {buckets.map((b, i) => {
          const heightPct = b.count === 0 ? 2 : Math.max(10, Math.round((b.count / max) * 100));
          const isActive = b.count > 0;
          const passPct = isActive ? Math.round((b.pass / b.count) * 100) : 0;
          const flaggedPct = isActive ? Math.round((b.flagged / b.count) * 100) : 0;
          const unjudgedPct = isActive ? Math.round((b.unjudged / b.count) * 100) : 0;
          const blockedPct = isActive ? Math.max(0, 100 - passPct - flaggedPct - unjudgedPct) : 0;
          // An empty bar with a gap marker in it is not an idle hour, and it
          // must not be labelled as one. It keeps the empty bar's shape,
          // because nothing was recorded, and says the other thing the chain
          // knows about that window.
          const tooltip = isActive
            ? t.usageBarTooltip(b.label, b.count, b.flagged, b.blocked, b.pass, b.unjudged)
            : b.gaps > 0
              ? t.usageBarGapTooltip(b.label, b.gaps)
              : t.usageBarIdleTooltip(b.label);
          return (
            <div
              key={i}
              className={'usage-bar' + (isActive ? '' : ' idle') + (!isActive && b.gaps > 0 ? ' gap' : '')}
              style={{ height: heightPct + '%' }}
              title={tooltip}
            >
              {!isActive && b.gaps > 0 && (
                <span className="usage-bar-gap-mark" aria-label={t.usageBarGapTooltip(b.label, b.gaps)} />
              )}
              {isActive && (
                <>
                  {blockedPct > 0 && <span className="seg blocked" style={{ height: blockedPct + '%' }} />}
                  {flaggedPct > 0 && <span className="seg flagged" style={{ height: flaggedPct + '%' }} />}
                  {passPct > 0 && <span className="seg pass" style={{ height: passPct + '%' }} />}
                  {unjudgedPct > 0 && <span className="seg unjudged" style={{ height: unjudgedPct + '%', background: 'var(--fw-muted)', opacity: 0.45 }} />}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="usage-legend">
        <span><span className="sw" style={{ background: 'var(--fw-teal)' }} /> {t.legendPass}</span>
        <span><span className="sw" style={{ background: 'var(--fw-amber)' }} /> {readingOffered ? t.legendRewrite : words.legendMarkNoAi}</span>
        <span><span className="sw" style={{ background: 'var(--fw-purple)' }} /> {t.legendBlock}</span>
        {totalUnjudged > 0 && <span><span className="sw" style={{ background: 'var(--fw-muted)', opacity: 0.45 }} /> {t.legendUnjudged}</span>}
        <span><span className="sw" style={{ background: 'var(--fw-surface-2)' }} /> {t.legendIdle}</span>
        {buckets.some((b) => b.count === 0 && b.gaps > 0) && (
          <span><span className="sw usage-legend-gap" /> {t.legendGap}</span>
        )}
      </div>
    </div>
  );
}
