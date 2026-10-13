// FeelingWise — Overview tab (the landing surface).
//
// The day, counted from the record: a briefing sentence, KPI tiles with 7-day
// sparklines, the feed-balance bar (same arithmetic as Statistics), the day
// as sessions, the served-surface split, the most-served sources, and the
// hour-by-day rhythm. Every figure is recomputed from the signed records on
// render and every row drills into the Activity feed via `onDrill`.
//
// Design source (browser-verified on the real chain, both themes):
// docs/redesign/mockups/2026-07-15/overview-home.html
// Fence honored: this tab renders OUTSIDE the virtualized feed; it never
// touches FeedCard, virtual-scroll, or fc-timeline.

import React from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { ActivityDrill } from './activity-drill';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { ArchivesPendingNote } from './ArchivesPendingNote';
import { intlLocaleFor, type ResolvedUiLanguage } from '../../../i18n';
import {
  dayKeyAsLocalDate, formatDateLocal, formatDateLongLocal, formatTimeLocal, formatWeekdayShort,
} from '../../shared/format-time';
import { PLATFORM_COLORS, PLATFORM_LABELS } from './color-maps';
import { computeOverview } from './overview-data';
import { TONE } from '../house-tones';
import { formatCount } from '../../shared/format-number';
import { wilson } from '../../../forensics/wilson';
import { isHiddenAsHarmful } from '../record-sets';
import { dashboardWords } from '../dashboard-words';
import { breakableHandle } from '../shown-text';

const capFirst = (s: string): string => s.charAt(0).toLocaleUpperCase() + s.slice(1);

const sevColor = (s: number): string => (s >= 8 ? TONE.ink : s >= 5 ? TONE.mid : TONE.light);

// The attention rows answer "when was I looking at this", so they are on the
// reader's own clock, in the reader's own language.
const hm = (t: number, lang: ResolvedUiLanguage): string => formatTimeLocal(t, lang);

export function OverviewTab({ records, onDrill, onOpenStatistics, archivesPending }: {
  records: ForensicRecord[];
  onDrill: (d: Omit<ActivityDrill, 'seq'>) => void;
  onOpenStatistics: () => void;
  /** The archived months are still being read; the counts below cover the active chain only until they land. */
  archivesPending?: boolean;
}) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const model = React.useMemo(() => computeOverview(records), [records]);

  if (!model) {
    return (
      <div className="ov-shell">
        <section className="ov-card ov-brief"><p className="ov-eyebrow">{t.tabOverview}</p>
          <div className="ov-card-title">{t.ovEmpty}</div>
        </section>
      </div>
    );
  }

  const { brief, balance, sessions, surfaces, sources, attention, heat, heatMax, kpis } = model;
  const locale = intlLocaleFor(lang);
  // nf was this file's own Intl.NumberFormat, the third implementation of one
  // rule (2026-09-18). It keeps its name so the call sites below are unchanged.
  const nf = { format: (n: number) => formatCount(n, lang) };
  const focusNice = formatDateLongLocal(model.focusDate, lang);
  const words = dashboardWords(lang);
  // A day key is a calendar date, not an instant: dayKeyAsLocalDate reads it
  // back at local noon so it cannot slip a date on any offset.
  const dayShort = (dayKey: string) => formatWeekdayShort(dayKeyAsLocalDate(dayKey), lang);
  // The tooltips used to print the raw "2026-09-18" key beside dates written
  // as "18 Sep 2026" elsewhere on the same page.
  const dayLong = (dayKey: string) => formatDateLocal(dayKeyAsLocalDate(dayKey), lang);
  const pfLabel = (p: string) => PLATFORM_LABELS[p] ?? p;
  const pfColor = (p: string) => PLATFORM_COLORS[p] ?? 'var(--fw-muted)';
  const drillIds = (ids: string[]) => onDrill({ recordIds: ids });
  // The hero carries one figure and its own 7-day trend; `videos` is the only
  // other quantity the page states nowhere else, so it rides in the context
  // clause. The rest of `kpis` is computed but no longer rendered here.
  const flaggedKpi = kpis.find((k) => k.key === 'flagged') ?? null;
  const videosChecked = kpis.find((k) => k.key === 'videos')?.value ?? 0;
  // DST-safe day span: a local calendar day is 23-25 hours on transition
  // days, so scale by the real span, never a fixed 86,400,000 ms (SOL
  // finding 2).
  const dayStartD = new Date(model.focusDate); dayStartD.setHours(0, 0, 0, 0);
  const dayEndD = new Date(model.focusDate); dayEndD.setHours(24, 0, 0, 0);
  const dayStart = dayStartD.getTime();
  const daySpan = Math.max(1, dayEndD.getTime() - dayStart);
  const dayPct = (ts: number) => ((ts - dayStart) / daySpan) * 100;
  const heatLevel = (n: number) =>
    n === 0 ? '' : ` h${Math.min(5, Math.max(1, Math.ceil((n / heatMax) * 5)))}`;

  return (
    <div className="ov-shell">
      <ArchivesPendingNote pending={archivesPending} />
      <div className="ov-grid">

        {/* ── Where it came from ──
            The head above every tab already says the day's counts in its three short lines, so this card does not say them
            again: it answers where they came from (the sites, each opening its own items), how many sessions, the
            videos, and how the flagged count moved against the days before. */}
        <section className="ov-card ov-brief span-12">
          <p className="ov-eyebrow">{words.ovFromEyebrow}</p>
          <div className="ov-brief-meta">
            {brief.platforms.map((p) => (
              /* Drill by the exact focus-day record set so the chip's count
                 and the resulting feed are the same thing (SOL finding 1). */
              <button key={p.platform} type="button" className="ov-chip" onClick={() => drillIds(p.recordIds)}>
                <span className="dot" style={{ background: pfColor(p.platform) }} aria-hidden="true" />
                <span className="ov-chip-name">{pfLabel(p.platform)}</span> <b className="ov-chip-n">{nf.format(p.count)}</b>
              </button>
            ))}
            <span className="ov-chip">{t.ovBriefSigned}</span>
          </div>
          <div className="ov-hero-context">
            {words.ovSessionsLine(brief.sessions)}
            {videosChecked > 0 ? ` ${t.ovHeroVideos(videosChecked)}` : ''}
          </div>
          {brief.flagged > 0 && flaggedKpi && (
            <div className="ov-hero-trend">
              <div className={`delta${flaggedKpi.deltaPct !== null && flaggedKpi.deltaPct > 8 ? ' up' : flaggedKpi.deltaPct !== null && flaggedKpi.deltaPct < -8 ? ' down' : ''}`}>
                {`${capFirst(words.labelFlagged)}: ${flaggedKpi.deltaPct !== null ? t.ovKpiDelta(flaggedKpi.deltaPct) : t.ovKpiNoPrior(model.priorActiveDays)}`}
              </div>
            </div>
          )}
        </section>

        {/* ── Feed balance (Statistics arithmetic on a named 7-day window) ── */}
        <section className="ov-card span-6">
          <p className="ov-eyebrow">{t.ovBalanceEyebrow}</p>
          {balance.decided === 0 ? (
            /* Same explicit no-decisions branch Statistics has (SOL finding 4). */
            <div style={{ color: 'var(--fw-muted)', fontStyle: 'italic', padding: '12px 0' }}>{t.statsBalanceEmpty}</div>
          ) : (<>
          <div className="ov-balance-headline">{t.ovBalanceHeadline(balance.passedPct)}</div>
          {/* P0 item 2 (capability audit 2026-09-06): the share carries its n and its interval. */}
          {(() => {
            const sh = wilson(balance.passed, balance.decided);
            return sh ? <div className="ov-balance-interval" style={{ fontSize: 13, color: 'var(--fw-muted)' }}>{sh.k}/{sh.n} · {t.shareInterval(sh.lowerPct, sh.upperPct)}</div> : null;
          })()}
          <div className="ov-balance-bar" role="img" aria-label={t.ovBalanceEyebrow}>
            {([
              [t.statsBalancePassed, balance.passed, TONE.record],
              [t.statsBalanceFlagged, balance.flagged, TONE.flagged],
              [t.statsBalanceBlocked, balance.blocked, 'var(--fw-noise, var(--fw-purple))'],
            ] as const).filter(([, n]) => n > 0).map(([label, n, color]) => (
              <div key={label} className="seg" title={`${label} ${nf.format(n)}`}
                style={{ width: `${(n / balance.decided) * 100}%`, background: color }} />
            ))}
          </div>
          <div className="ov-balance-legend">
            {([
              [t.statsBalancePassed, balance.passed, TONE.record],
              [t.statsBalanceFlagged, balance.flagged, TONE.flagged],
              [t.statsBalanceBlocked, balance.blocked, 'var(--fw-noise, var(--fw-purple))'],
            ] as const).filter(([, n]) => n > 0).map(([label, n, color]) => (
              <span key={label} className="ov-legend-item">
                <span className="sw" style={{ background: color }} aria-hidden="true" />
                {label} {nf.format(n)} ({Math.round((n / balance.decided) * 100)}%)
              </span>
            ))}
          </div>
          <div className="ov-bal-split">{t.ovBalanceSplit(balance.flagged, balance.flaggedVisible, balance.flaggedHidden)}</div>
          <div className="ov-bal-days">
            {balance.days.map((d) => (
              <div key={d.dayKey} className="ov-bal-day"
                title={(() => {
                  const sh = d.passShare !== null ? wilson(Math.round(d.passShare * d.decided), d.decided) : null;
                  return sh ? `${t.ovBalanceDayTip(dayLong(d.dayKey), sh.pct, d.decided)} · ${t.shareInterval(sh.lowerPct, sh.upperPct)}` : t.ovBalanceDayEmpty(dayLong(d.dayKey));
                })()}>
                <div className="bar" style={{ height: `${Math.max(4, (d.passShare ?? 0) * 100)}%`, opacity: d.decided ? 1 : 0.18 }} />
                <div className="lbl">{dayShort(d.dayKey)}</div>
              </div>
            ))}
          </div>
          <div className="ov-footnote">
            {t.ovBalanceFootnote(balance.decided)}{' '}
            <button type="button" className="ov-link" onClick={onOpenStatistics}>{t.ovBalanceToStats}</button>
          </div>
          </>)}
        </section>

        {/* ── Worth a look ── */}
        <section className="ov-card span-6">
          <p className="ov-eyebrow">{t.ovAttentionEyebrow}</p>
          <div className="ov-card-sub">{t.ovAttentionSub}</div>
          {attention.length === 0 && <div className="ov-card-sub">{t.ovAttentionEmpty}</div>}
          {attention.map(({ record: r, severity, technique }) => (
            <div key={r.id} className="ov-att-row">
              <span className="ov-att-sev" style={{ background: sevColor(severity) }} aria-hidden="true" />
              <div className="ov-att-main">
                <div className="ov-att-why">
                  {technique ? t.techniqueLabel(technique) : t.ovAttentionFlagged}, {t.ovAttentionSeverity(severity)}
                  {isHiddenAsHarmful(r) ? `, ${t.ovAttentionHidden}` : ''}
                </div>
                <div className="ov-att-meta">
                  {(r.author && r.author.toLowerCase() !== 'unknown' ? r.author : t.ovUnknownAuthor)} · {pfLabel(r.platform)} · {hm(new Date(r.timestamp).getTime(), lang)}
                </div>
              </div>
              <button type="button" className="ov-link" onClick={() => drillIds([r.id])}>{t.ovViewRecord}</button>
            </div>
          ))}
          <div className="ov-footnote">{t.ovAttentionFootnote}</div>
        </section>

        {/* ── The day as sessions ── */}
        <section className="ov-card span-12">
          <p className="ov-eyebrow">{t.ovSessionsEyebrow}</p>
          <div className="ov-card-sub">{t.ovSessionsSub(focusNice)}</div>
          <div className="ov-sess-axis">
            {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
              <React.Fragment key={h}>
                {/* The two at the ends are centred on 0% and 100%, so half of
                    each hung outside the card until 2026-09-17. They cannot be
                    picked out in CSS by position, because the tick lines beside
                    them are spans too, so they say which they are. */}
                <span
                  className={`ov-sess-hour${h === 0 ? ' at-start' : h === 24 ? ' at-end' : ''}`}
                  style={{ left: `${(h / 24) * 100}%` }}
                >{String(h).padStart(2, '0')}:00</span>
                <span className="ov-sess-tickline" style={{ left: `${(h / 24) * 100}%` }} aria-hidden="true" />
              </React.Fragment>
            ))}
            <div className="ov-sess-track" aria-hidden="true" />
            {sessions.map((s, i) => (
              <button key={i} type="button" className="ov-sess-block"
                style={{ left: `${dayPct(s.start)}%`, width: `${Math.max(0.6, dayPct(s.end) - dayPct(s.start))}%` }}
                title={t.ovSessionTip(hm(s.start, lang), hm(s.end, lang), s.count, s.flaggedTimes.length)}
                onClick={() => drillIds(s.recordIds)}>
                {/* A session of a few minutes is 7px wide, and three 7px dots do
                    not fit in it: measured 2026-09-17, they spilled 11px past
                    the block onto the track beside it. A narrow block shows the
                    first platform only, which is the colour that carries the
                    meaning; the count below already gates on width the same way. */}
                {s.platforms.slice(0, dayPct(s.end) - dayPct(s.start) > 2.2 ? 3 : 1).map(([p]) => (
                  <span key={p} className="ov-pf-dot" style={{ background: pfColor(p) }} aria-hidden="true" />
                ))}
                {dayPct(s.end) - dayPct(s.start) > 4 && <span className="cnt">{s.count}</span>}
              </button>
            ))}
            {sessions.flatMap((s, i) => s.flaggedTimes.map((ft, j) => (
              <span key={`${i}-${j}`} className="ov-sess-flag" style={{ left: `${dayPct(ft)}%` }} aria-hidden="true" />
            )))}
          </div>
          <div className="ov-footnote">{t.ovSessionsFootnote(sessions.length, brief.items)}</div>
        </section>

        {/* ── How content arrived ── */}
        <section className="ov-card span-6">
          <p className="ov-eyebrow">{t.ovSurfaceEyebrow}</p>
          <div className="ov-card-sub">{t.ovSurfaceSub}</div>
          {(() => {
            const max = Math.max(1, ...surfaces.map((s) => s.count));
            return surfaces.map((s) => (
              <button key={s.key} type="button" className="ov-srv-row" onClick={() => drillIds(s.recordIds)}>
                <span className="ov-srv-label">{t.ovSurfaceLabel(s.key)}</span>
                <span className="ov-srv-track"><span className="ov-srv-fill" style={{ width: `${(s.count / max) * 100}%` }} /></span>
                <span className="ov-srv-right">{nf.format(s.count)} · <span className="fr">{t.ovSurfaceFlagRate(Math.round((s.flagged / Math.max(1, s.count)) * 1000) / 10)}</span>{(() => {
                  const sh = wilson(s.flagged, s.count);
                  // Its own line: run on after the flag rate it wraps wherever the column ends, which leaves a separator dot at the end of one row's line and the start of another's.
                  return sh ? <span className="fr" style={{ display: 'block', opacity: 0.7 }}>{t.shareInterval(sh.lowerPct, sh.upperPct)}</span> : null;
                })()}</span>
              </button>
            ));
          })()}
          <div className="ov-footnote">{t.ovSurfaceFootnote(model.surfaceTotal)}</div>
        </section>

        {/* ── Who the feed brought to the screen ── */}
        <section className="ov-card span-6">
          <p className="ov-eyebrow">{t.ovSourcesEyebrow}</p>
          <div className="ov-card-sub">{t.ovSourcesSub(model.sourceTotal)}</div>
          {sources.map((s) => (
            <button key={`${s.platform}:${s.author}`} type="button" className="ov-src-row" onClick={() => drillIds(s.recordIds)}>
              <span className="ov-src-avatar" aria-hidden="true">{Array.from(s.author.replace(/^@+/, '')).slice(0, 2).join('').toUpperCase() || '?'}</span>
              <span className="ov-src-name">{breakableHandle(s.author)}</span>
              {/* No advertiser badge: an ad never ranks here (overview-data.ts). */}
              {s.accountType === 'group' && (
                <span className={`ov-src-type ${s.accountType}`}>{t.ovSourceType(s.accountType)}</span>
              )}
              <span className="ov-pf-dot" style={{ background: pfColor(s.platform) }} title={pfLabel(s.platform)} aria-hidden="true" />
              <span className="ov-src-nums">
                {/* The platform in words, not by its square alone (row 66, 12 Oct 2026). */}
                {pfLabel(s.platform)} · {t.ovSourceSeen(s.count)}
                {s.flagged > 0 && <> · <span className="fl">{t.ovSourceFlagged(s.flagged)}</span></>}
              </span>
            </button>
          ))}
          <div className="ov-footnote">{t.ovSourcesFootnote}</div>
        </section>

        {/* ── When the feed was on screen ── */}
        <section className="ov-card span-12">
          <p className="ov-eyebrow">{t.ovRhythmEyebrow}</p>
          <div className="ov-card-sub">{t.ovRhythmSub}</div>
          <div className="ov-heat-wrap">
            <div className="ov-heat-days">
              {heat.map((h) => <div key={h.dayKey}>{dayShort(h.dayKey)}</div>)}
            </div>
            <div className="ov-heat-grid">
              {heat.map((h) => (
                <div key={h.dayKey} className="ov-heat-row">
                  {h.hours.map((n, hi) => (
                    <span key={hi} className={`ov-heat-cell${heatLevel(n)}`}
                      title={t.ovRhythmTip(dayShort(h.dayKey), hi, n)} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="ov-heat-wrap" aria-hidden="true">
            <div />
            <div className="ov-heat-hours">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h}>{h % 6 === 0 || h === 23 ? String(h).padStart(2, '0') : ''}</div>
              ))}
            </div>
          </div>
          <div className="ov-footnote">{t.ovRhythmFootnote}</div>
        </section>

      </div>
    </div>
  );
}
