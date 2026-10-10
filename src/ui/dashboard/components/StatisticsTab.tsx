// src/ui/dashboard/components/StatisticsTab.tsx
// Surface-ID: statistics-tab (NEW — Inventory Part 7 #6)
//
// The tab between Activity and Forensics. Surfaces:
//   • what this record holds: the feed balance, flagged items over time, the amplification
//     signal, feed patterns, and the platform and technique breakdowns.
//   • KPI snapshots (records today / flagged / blocked / active platforms / techniques /
//     unsigned) — re-anchored from the previous inline ActivityTab KPI row so a
//     parent reading "what did FW see" lands here, not on the feed.
//
// It carried a "Quality: reviewer agreement" card and a per-technique agreement breakdown until
// 2026-09-16 (PLAN-2026-09-16 item 6.1). Both read a calibration result that is always the
// insufficient-data state: calibration is off-device by design (docs/LONG-PLAN.md), so no verdict
// is ever counted on this machine and the card could only ever say "Calibrating...". A panel that
// promises a number it can never show is worse than no panel.

import * as React from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { ForensicStats } from '../../../forensics/store';
import { PLATFORM_LABELS } from './color-maps';
import { TONE } from '../house-tones';
import { dashboardWords } from '../dashboard-words';
import { canonicalizeTechniqueForStats } from '../../../forensics/store';
import { computeExposureTimeline, computeAmplificationTrend } from '../../../forensics/analytics';
import { computeExposureSkew, computeRuns, computePeriodicity, dominantTechnique } from '../../../forensics/sequence';
import { wilson } from '../../../forensics/wilson';
import { StatsCard } from './PatternSection';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { dayKeyAsLocalDate, formatDayMonthLocal, localDayKey } from '../../shared/format-time';
import { formatCount } from '../../shared/format-number';
import { ArchivesPendingNote } from './ArchivesPendingNote';
import { honestPct } from './overview-data';
import { countRecordSets, daySpanOf, inRecordSet, isFlaggedItem, isSecondReading, type RecordSetName } from '../record-sets';
import {
  KitRow, KitStack, KitLegend, KitCols, KitAxis, KitTile, KitChip, stackedColumn,
} from './chart-kit';

export interface StatisticsTabProps {
  records: ForensicRecord[];
  stats: ForensicStats;
  now: Date;
  /** Cross-tab drill-down: jump to the Activity feed pre-filtered.
   *  `technique` carries CANONICAL names. */
  onDrill?: (d: { platform?: 'all' | ForensicRecord['platform']; technique?: string | null; recordIds?: string[] | null }) => void;
  /** The archived months are still being read; every figure covers the active chain only until they land. */
  archivesPending?: boolean;
  /** The whole record's entry count (every archived month plus the active chain, Dashboard.tsx wholeRecordCount). `records` holds the walk window only (item 7, second slice), so the all-time figure cannot be its length. */
  allTimeCount?: number;
  /** The install has the AI reading (ai-wording.ts); off, the coverage footnote says nothing about the AI. */
  readingOffered?: boolean;
}

export function StatisticsTab({ records, stats, now, onDrill, archivesPending, allTimeCount, readingOffered = true }: StatisticsTabProps) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  // Local-midnight day boundary — must match the Activity tab's inline "today"
  // computation (Dashboard.tsx), or the two tabs show different "today"
  // numbers (they did, in any non-UTC zone).
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const recordsToday = records.filter((r) => Date.parse(r.timestamp) >= startOfToday).length;
  // Every count on this tab comes from one sorting (record-sets.ts), so the
  // flagged tile, the bar and the Activity badge cannot use different rules.
  // The bar divides by checked items: passed, flagged and blocked. Room
  // summaries, markers and items that reached no verdict are outside it.
  const sets = React.useMemo(() => countRecordSets(records), [records]);
  const flagged = sets.flagged;
  const seenALotLabel = (() => { const w = t.techniqueLabel('repeat-exposure'); return w.charAt(0).toLocaleUpperCase(lang) + w.slice(1); })();
  const blocked = sets.blocked;
  const balancePassed = sets.passed;
  const balanceFlagged = sets.flagged;
  const balanceBlocked = sets.blocked;
  const decided = sets.checked;
  // The daily trend counts items, the same set the flagged tile divides by.
  const isBalanceContent = (r: ForensicRecord) => inRecordSet('items', r);
  const passedPct = honestPct(balancePassed, decided);
  // P0 item 2 (capability audit 2026-09-06): every printed share carries its
  // denominator and a 95% Wilson interval, from one helper.
  const passedShare = wilson(balancePassed, decided);
  // Active platforms over the ACTUAL trailing-24h window (F3a). The previous
  // records.slice(-100) scan under-counted heavy days (>100 records/24h): any
  // platform whose activity fell before the last 100 records silently dropped
  // out of the KPI. Anchored on the `now` prop — the same clock the "today"
  // figures above use — not Date.now(), so the tile agrees with its siblings
  // and stays deterministic under test.
  const platforms24h = React.useMemo(() => {
    const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
    const set = new Set<string>();
    for (const r of records) {
      const ms = Date.parse(r.timestamp);
      if (Number.isFinite(ms) && ms > cutoff) set.add(r.platform);
    }
    return set.size;
  }, [records, now]);

  // Interpretation engine views (read-only over the signed chain).
  const exposure = React.useMemo(() => computeExposureTimeline(records, { bucket: 'week' }), [records]);
  const recentWeeks = exposure.buckets.slice(-8);
  const maxSeverity = Math.max(1, ...recentWeeks.map((b) => b.severitySum));
  const amplification = React.useMemo(() => computeAmplificationTrend(records), [records]);
  const ampTotals = amplification.buckets.reduce(
    (a, b) => ({
      high: a.high + b.amplificationLabels.high,
      normal: a.normal + b.amplificationLabels.normal,
      low: a.low + b.amplificationLabels.low,
    }),
    { high: 0, normal: 0, low: 0 },
  );
  const ampMax = Math.max(1, ampTotals.high, ampTotals.normal, ampTotals.low);
  const topPushed = amplification.repeatedPosts.filter((p) => p.maxViewsPerLike != null).slice(0, 5);

  // Served-sequence structure (read-only; observed shape, not a decoded algorithm).
  // The skew counts flag verdicts over what it is given; without the second readings
  // that is exactly the flagged items the bars' drills open (dominantIds below).
  const skew = React.useMemo(() => computeExposureSkew(records.filter((r) => !isSecondReading(r))), [records]);
  // The records each "most served" bar counts: exposure records whose DOMINANT
  // technique is that one, the rule computeExposureSkew counts by. The drill
  // opens exactly these ids; a technique drill matched any record carrying
  // the technique at all, so the feed was larger than the k/n printed on the
  // bar (wiring audit 13 Sep, D1-22).
  const dominantIds = React.useMemo(() => {
    const m = new Map<string, string[]>();
    for (const r of records) {
      if (!isFlaggedItem(r)) continue;
      const tech = dominantTechnique(r);
      if (tech === null) continue;
      const list = m.get(tech);
      if (list) list.push(r.id); else m.set(tech, [r.id]);
    }
    return m;
  }, [records]);
  const runs = React.useMemo(() => computeRuns(records), [records]);
  const periodicity = React.useMemo(() => computePeriodicity(records), [records]);
  const topTechniqueShares = Object.entries(skew.byTechnique.shares).sort((a, b) => b[1] - a[1]).slice(0, 3);
  // The axis shares are count / (records with a dominant technique); print that
  // denominator and the interval, not the bare percentage.
  const techniqueN = Object.values(skew.byTechnique.counts).reduce((a, c) => a + c, 0);
  const longestRun = runs.find((r) => r.length >= 3);
  const rhythmNote = periodicity.insufficient
    ? t.statsRhythmNotEnough(periodicity.daysObserved)
    : periodicity.peakLags.includes(7)
      ? t.statsRhythmWeekly
      : periodicity.peakLags.includes(1)
        ? t.statsRhythmDaily
        : periodicity.peakLags.length > 0
          ? t.statsRhythmNDay(periodicity.peakLags[0])
          : t.statsRhythmNone;

  // Depth additions (queue item 5): per-day 14-day trend + severity bands.
  const daily = React.useMemo(() => {
    const days: { key: string; total: number; flagged: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      days.push({ key: localDayKey(d), total: 0, flagged: 0 });
    }
    const byKey = new Map(days.map((d) => [d.key, d]));
    for (const r of records) {
      // Q40 (W48): the bar is labeled "items witnessed"; room summaries and
      // chain markers are not witnessed items and were inflating day.total
      // while day.flagged stayed verdict-filtered.
      if (!isBalanceContent(r)) continue;
      const ms = Date.parse(r.timestamp);
      if (!Number.isFinite(ms)) continue;
      const day = byKey.get(localDayKey(ms));
      if (!day) continue;
      day.total++;
      if (isFlaggedItem(r)) day.flagged++;
    }
    return days;
  }, [records, now]);
  const dailyMax = Math.max(1, ...daily.map((d) => d.total));

  const severityBands = React.useMemo(() => {
    const bands = { lo: 0, mi: 0, hi: 0 };
    for (const r of records) {
      if (!isFlaggedItem(r)) continue;
      // isFlaggedRecord has already dropped the paid placements, so the
      // severity 6 the ad marker stamps can never fill a band here.
      const s = typeof r.overallScore === 'number' ? r.overallScore : 0;
      if (s >= 8) bands.hi++;
      else if (s >= 5) bands.mi++;
      else bands.lo++;
    }
    return bands;
  }, [records]);
  const sevMax = Math.max(1, severityBands.lo, severityBands.mi, severityBands.hi);

  // Per-platform technique split (queue item 5): top flagged patterns per
  // platform, technique names folded into their canonical display buckets.
  const platTech = React.useMemo(() => {
    const byPlatform = new Map<string, Map<string, number>>();
    for (const r of records) {
      if (!isFlaggedItem(r) || !Array.isArray(r.techniques)) continue;
      let m = byPlatform.get(r.platform);
      if (!m) byPlatform.set(r.platform, (m = new Map()));
      for (const tech of r.techniques) {
        if (!tech?.name) continue;
        const canon = canonicalizeTechniqueForStats(tech.name);
        m.set(canon, (m.get(canon) ?? 0) + 1);
      }
    }
    return Array.from(byPlatform.entries())
      .map(([platform, m]) => ({
        platform,
        total: Array.from(m.values()).reduce((a, b) => a + b, 0),
        top: Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3),
      }))
      .filter((p) => p.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [records]);

  // Provenance (lens contract): every count names its set and the days that set
  // spans in the entries this tab holds, never the wall clock.
  const spanOf = (set: RecordSetName) => daySpanOf(records, (r) => inRecordSet(set, r));
  const dayLabel = (key: string) => formatDayMonthLocal(dayKeyAsLocalDate(key), lang);
  const prov = (set: RecordSetName, n: number) => {
    const span = spanOf(set);
    return span.firstDay
      ? <div className="fb-prov">{t.fbProv(set, n, dayLabel(span.firstDay), dayLabel(span.lastDay))}</div>
      : null;
  };
  const itemsSpan = spanOf('items');
  const blockedSpan = spanOf('blocked');

  return (
    <div className="stats-grid">
      <ArchivesPendingNote pending={archivesPending} />
      {/* Feed balance — the benign majority, so the harm counts read in context */}
      <div className="stats-card full">
        <h3>{t.statsBalanceTitle}</h3>
        <div className="stats-sub">{t.statsBalanceSub}</div>
        <FeedBalanceBar
          passed={balancePassed} flagged={balanceFlagged} blocked={balanceBlocked}
          decided={decided} passedPct={passedPct}
          interval={passedShare ? t.shareInterval(passedShare.lowerPct, passedShare.upperPct) : ''}
        />
        {prov('checked', decided)}
      </div>

      {/* Limits box — judge lens: limits stated before conclusions. Every
          claim below reads against these four sentences. */}
      <div className="stats-card full">
        <h3>{t.statsLimitsTitle}</h3>
        <div className="fwc-callout" style={{ marginTop: 6 }}>
          <div>{t.statsLimit1}</div>
          <div>{t.statsLimit2}</div>
          <div>{t.statsLimit3}</div>
          <div>{readingOffered ? t.statsLimit4 : dashboardWords(lang).statsLimitNoAi}</div>
        </div>
      </div>

      {/* Exposure over time — interpretation engine */}
      <StatsCard
        full
        title={t.statsManipTitle}
        sub={t.statsManipSub}
        empty={recentWeeks.length === 0 ? t.noDataYet : undefined}
      >
        {recentWeeks.length === 0 ? (
          <></>
        ) : (
          <>
            {/* Column chart (mockup: 84px plot, 80px usable). Height encodes the
                severity-weighted sum; the tooltip carries the item count. */}
            <KitCols
              height={84}
              cols={recentWeeks.map((b) => ({
                tip: `${formatDayMonthLocal(dayKeyAsLocalDate(b.bucket), lang)} · ${b.count}`,
                parts: [{ h: Math.round((b.severitySum / maxSeverity) * 80), color: TONE.ink }],
              }))}
            />
            {/* The bucket key is the Monday that starts the week. It was
                printed as a raw "09-15" cut out of the key, which is a date
                shape in no language sitting beside formatDayMonthLocal dates
                on the same tab (2026-09-18). */}
            <KitAxis perCol labels={recentWeeks.map((b) => formatDayMonthLocal(dayKeyAsLocalDate(b.bucket), lang))} />
            {/* Q42 (W49): records with unreadable timestamps used to vanish
                from this chart with no surface anywhere; the count existed
                on ExposureTimeline since day one and was never rendered. */}
            {exposure.undatedCount > 0 && (
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                {t.statsUndatedNote(exposure.undatedCount)}
              </div>
            )}
          </>
        )}
      </StatsCard>

      {/* Algorithmic amplification — interpretation engine */}
      <div className="stats-card full">
        <h3>{t.statsPushTitle}</h3>
        <div className="stats-sub">
          {t.statsPushSub}
        </div>
        {/* The repeat-push list is the card's strongest line — "this item came
            back N times, at M times its organic reach" — and it was nested
            inside the else-branch of a gate on the LABEL totals. Those totals
            were always zero (analytics.ts read the label off records that never
            carry one), so the list was hidden even when its own data was
            complete. Each half now gates on its own data. */}
        {ampTotals.high + ampTotals.normal + ampTotals.low === 0 && topPushed.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{t.statsNoAmpData}</div>
        ) : (
          <>
            {ampTotals.high + ampTotals.normal + ampTotals.low > 0 &&
              ([[t.statsAmpHigh, ampTotals.high, TONE.ink], [t.statsAmpNormal, ampTotals.normal, TONE.mid], [t.statsAmpLow, ampTotals.low, TONE.light]] as const).map(([label, n, color]) => (
              <KitRow key={label} label={label} color={color} width={(n / ampMax) * 100} count={n} />
            ))}
            {topPushed.length > 0 && (
              <div className="stats-sub" style={{ marginTop: 10 }}>
                {t.statsTopPushed}
                {topPushed.map((p) => (
                  <div key={p.postUrl} style={{ fontSize: 12, color: 'var(--fw-muted)', marginTop: 2 }}>
                    {/^https?:\/\//.test(p.postUrl) && !/^https?:\/\/[^/]+\/?(?:home|foryou)?\/?$/i.test(p.postUrl) ? (
                      <a
                        href={p.postUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: 'var(--fw-text-secondary)', textDecoration: 'underline dotted' }}
                        title={p.postUrl}
                      >
                        {t.statsViewsPerLike(formatCount(p.maxViewsPerLike as number, lang), p.sightings)}
                      </a>
                    ) : (
                      t.statsViewsPerLike(formatCount(p.maxViewsPerLike as number, lang), p.sightings)
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Feed patterns — served-sequence structure engine */}
      <StatsCard
        full
        title={t.statsFeedPatternsTitle}
        sub={t.statsFeedPatternsSub}
        empty={skew.total === 0 ? t.noDataYet : undefined}
      >
        {skew.total === 0 ? (
          <></>
        ) : (
          <>
            <div style={{ color: 'var(--fw-muted)', fontSize: 12, margin: '4px 0' }}>{t.statsMostServed}</div>
            {topTechniqueShares.map(([name, share]) => (
              <KitRow
                key={name}
                label={t.techniqueLabel(name)}
                color={TONE.ink}
                width={(share / Math.max(0.01, topTechniqueShares[0][1])) * 100}
                count={(() => {
                  const sh = wilson(skew.byTechnique.counts[name] ?? Math.round(share * techniqueN), techniqueN);
                  return sh
                    ? <>{sh.k}/{sh.n} · {sh.pct}% <span className="fwc-pct">· {t.shareInterval(sh.lowerPct, sh.upperPct)}</span></>
                    : `${Math.round(share * 100)}%`;
                })()}
                onClick={onDrill ? () => onDrill({ platform: 'all', recordIds: dominantIds.get(name) ?? [] }) : undefined}
                title={onDrill ? t.statsDrillHint : undefined}
              />
            ))}
            <div className="fwc-chips">
              <KitChip
                k={t.statsLongestStreak}
                v={longestRun
                  ? t.statsStreakValue(longestRun.length, longestRun.kind === 'high-severity' ? t.statsHighSeverity : t.techniqueLabel(longestRun.kind))
                  : t.statsNone}
              />
              <KitChip k={t.statsRhythm} v={rhythmNote} />
            </div>
          </>
        )}
      </StatsCard>

      {/* Per-day trend — depth addition (queue item 5) */}
      <StatsCard
        full
        title={t.statsDailyTitle}
        sub={t.statsDailySub}
        empty={daily.every((d) => d.total === 0) ? t.noDataYet : undefined}
      >
        {daily.every((d) => d.total === 0) ? (
          <></>
        ) : (
          <>
            {/* Column chart (mockup: 96px plot, 92px usable): flagged share
                stacked in amber over the neutral witnessed base. */}
            <KitCols
              height={96}
              cols={daily.map((d) => ({
                tip: `${formatDayMonthLocal(dayKeyAsLocalDate(d.key), lang)} · ${t.statsDailyFlaggedOf(d.flagged, d.total)}`,
                parts: stackedColumn(d.total, d.flagged, dailyMax, 92, TONE.ink),
              }))}
            />
            {/* The axis used to print the raw key's "MM-DD" tail, which is
                month-first in every language. */}
            <KitAxis perCol labels={daily.map((d, i) => (i % 3 === 0 ? formatDayMonthLocal(dayKeyAsLocalDate(d.key), lang) : ''))} />
            <KitLegend
              style={{ marginTop: 10 }}
              items={[
                { color: 'var(--fwc-neutral)', label: t.statsDailyItemsLegend },
                { color: TONE.ink, label: t.kpiFlagged },
              ]}
            />
          </>
        )}
      </StatsCard>

      {/* Severity distribution — depth addition (queue item 5) */}
      <StatsCard
        full
        title={t.statsSevDistTitle}
        sub={t.statsSevDistSub}
        empty={severityBands.lo + severityBands.mi + severityBands.hi === 0 ? t.noDataYet : undefined}
      >
        {severityBands.lo + severityBands.mi + severityBands.hi === 0 ? (
          <></>
        ) : (() => {
          // Statistician lens: every band carries its share of the flagged
          // denominator, not just a raw count against a bar.
          const sevTotal = severityBands.lo + severityBands.mi + severityBands.hi;
          // Marker ramp (locked tokens): the same colors as the dots in the
          // feed, so severity reads identically on both surfaces.
          return (
            <>
              {([[t.statsSevLo, severityBands.lo, 'var(--fw-marker-low)'], [t.statsSevMi, severityBands.mi, 'var(--fw-marker-mid)'], [t.statsSevHi, severityBands.hi, 'var(--fw-marker-high)']] as const).map(([label, n, color]) => (
                <KitRow
                  key={label}
                  label={label}
                  color={color}
                  width={(n / sevMax) * 100}
                  count={(() => {
                    const sh = wilson(n, sevTotal);
                    return sh
                      ? <>{n} <span className="fwc-pct">· {sh.pct}% · {t.shareInterval(sh.lowerPct, sh.upperPct)}</span></>
                      : <>{n}</>;
                  })()}
                />
              ))}
              {prov('flagged', sevTotal)}
            </>
          );
        })()}
      </StatsCard>

      {/* Per-platform technique split — depth addition (queue item 5) */}
      {platTech.length > 0 && (
        <div className="stats-card full">
          <h3>{t.statsPlatTechTitle}</h3>
          <div className="stats-sub">{t.statsPlatTechSub}</div>
          {platTech.map((p) => (
            <div key={p.platform} style={{ marginTop: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'currentColor' }}>
                {PLATFORM_LABELS[p.platform] ?? p.platform}
                <span style={{ fontFamily: 'var(--fw-font-mono)', fontWeight: 400, fontSize: 12, color: 'var(--fw-muted)', marginLeft: 6 }}>
                  {p.total}
                </span>
              </div>
              {p.top.map(([name, n]) => (
                <KitRow
                  key={name}
                  label={t.techniqueLabel(name)}
                  color={TONE.ink}
                  width={(n / p.top[0][1]) * 100}
                  count={n}
                  onClick={onDrill ? () => onDrill({ platform: p.platform as ForensicRecord['platform'], technique: name }) : undefined}
                  title={onDrill ? t.statsDrillHint : undefined}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Snapshot tiles */}
      {/* DASH-2: the sub-caption must be the TRUE all-time record total —
          `stats.total` (store.ts) is deliberately scoped to flagged-only
          records, not a general record count, so reusing it here mixed two
          counting rules under one "records ... all-time" label and diverged
          from DashHeader's own Records chip (`records.length`). Use the same
          true total the header shows, matching the sibling tile below. */}
      {/* The all-time figure is the whole record's count (every archived month
          plus the active chain, Dashboard.tsx wholeRecordCount), the same one
          the header's Records chip shows (wiring audit 13 Sep, D1-3, C3).
          `records` is the walk window since item 7's second slice. */}
      <SnapshotTile value={recordsToday} label={t.kpiRecordsToday} sub={t.statsAllTime(formatCount((allTimeCount ?? records.length), lang))} spark={daily.map((d) => d.total)} />
      {/* Q40 (W48): the "of N records seen" denominator is content only —
          markers and room summaries are not things the child saw. */}
      <SnapshotTile value={flagged} label={t.kpiFlagged} color={TONE.ink} sub={itemsSpan.firstDay ? t.statsOfRecordsSeen(sets.items, dayLabel(itemsSpan.firstDay), dayLabel(itemsSpan.lastDay)) : undefined} spark={daily.map((d) => d.flagged)} sparkHot />
      {/* Seen a lot, beside flagged and never inside it (the Head, 10 Oct 2026): a post or source that came back often,
          marked with no reading of its content. The technique's own words, as on the Feed log. */}
      <SnapshotTile value={sets.seenALot} label={seenALotLabel} color={TONE.noise} />
      <SnapshotTile value={blocked} label={t.kpiBlocked} color={TONE.noise} sub={blockedSpan.firstDay ? t.statsBlockedSub(dayLabel(blockedSpan.firstDay), dayLabel(blockedSpan.lastDay)) : undefined} />

      {/* Platform breakdown */}
      <StatsCard
        full
        title={t.statsByPlatformTitle}
        sub={readingOffered
          ? t.statsByPlatformSub(Object.values(stats.byPlatform).reduce((a, b) => a + b, 0))
          : dashboardWords(lang).statsByPlatformSubNoAi(Object.values(stats.byPlatform).reduce((a, b) => a + b, 0))}
        empty={Object.keys(stats.byPlatform).length === 0 ? t.noDataYet : undefined}
      >
        {Object.keys(stats.byPlatform).length === 0 ? (
          <></>
        ) : (
          Object.entries(stats.byPlatform).sort((a, b) => b[1] - a[1]).map(([p, n]) => {
            const max = Math.max(...Object.values(stats.byPlatform));
            return (
              <KitRow
                key={p}
                dot
                label={PLATFORM_LABELS[p] ?? p}
                color={TONE.mid}
                width={(n / max) * 100}
                count={n}
                onClick={onDrill ? () => onDrill({ platform: p as ForensicRecord['platform'], technique: null }) : undefined}
                title={onDrill ? t.statsDrillHint : undefined}
              />
            );
          })
        )}
      </StatsCard>

      <SnapshotTile value={platforms24h} label={t.kpiActivePlatforms} color="var(--fw-teal)" />
      <SnapshotTile value={Object.keys(stats.byTechnique).length} label={t.statsTechniquesObserved} sub={t.statsTechniquesSub} />
      <SnapshotTile value={stats.unsignedRecordsCount} label={t.statsUnsigned} color={TONE.mid} sub={t.statsUnsignedSub} />
    </div>
  );
}

function FeedBalanceBar({
  passed, flagged, blocked, decided, passedPct, interval,
}: {
  passed: number; flagged: number; blocked: number; decided: number; passedPct: number; interval: string;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  if (decided === 0) {
    return <div style={{ color: 'var(--fw-muted)', fontStyle: 'italic', padding: '12px 0' }}>{t.statsBalanceEmpty}</div>;
  }
  // Kit law: the benign majority renders neutral so the status hues never
  // crowd; identity is carried by the legend labels + segment tooltips.
  const legend: Array<{ label: string; n: number; color: string }> = [
    { label: t.statsBalancePassed, n: passed, color: TONE.record },
    { label: t.statsBalanceFlagged, n: flagged, color: TONE.ink },
    { label: t.statsBalanceBlocked, n: blocked, color: TONE.noise },
  ];
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{t.statsBalanceLine(passedPct, passed, decided)}</div>
      {interval && <div className="fwc-pct" style={{ fontSize: 12, marginTop: 2 }}>{interval}</div>}
      <KitStack segs={legend.map((s) => ({ n: s.n, color: s.color, title: `${s.label} ${s.n}` }))} />
      <KitLegend items={legend.map((s) => ({ color: s.color, strong: formatCount(s.n, lang), label: s.label }))} />
    </div>
  );
}

function SnapshotTile({
  value, label, color, sub, spark, sparkHot,
}: {
  value: number; label: string; color?: string; sub?: string;
  spark?: number[]; sparkHot?: boolean;
}) {
  return (
    <div className="stats-card third">
      <KitTile value={value} label={label} sub={sub} color={color} spark={spark} sparkHot={sparkHot} />
    </div>
  );
}
