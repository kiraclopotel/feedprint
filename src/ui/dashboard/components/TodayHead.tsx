// The dashboard's first screen, said in three short lines (direction A, 9 Oct 2026; crew/dashboard/OUT.md): what the feed
// showed on the latest day with records, how much of it was hidden and how much was flagged for review, and the week
// beside it. It leads the Overview; over the timeline it pushed the list below the fold.
//
// It counts nothing of its own. The day, the items and the seven-day series are the Overview's model (computeOverview:
// the focus day is "the latest day that has content records"); hidden is the one blocked test every count uses
// (isBlockedItem: a checked item a rule hid), on the same content and the same day keys. So the head, the Overview and
// the timeline's "Hidden" filter cannot disagree.

import React, { useMemo } from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { ResolvedUiLanguage } from '../../../types/ui-language';
import { computeOverview } from './overview-data';
import { isBalanceContent, isBlockedItem, itemOutcomeOf } from '../record-sets';
import { dayKeyAsLocalDate, formatDateLongLocal, formatWeekdayShort, localDayKey } from '../../shared/format-time';
import { PRODUCT_NAME, dashboardWords } from '../dashboard-words';
import { formatCount } from '../../shared/format-number';

export interface TodayModel {
  when: 'today' | 'yesterday' | 'date';
  focusDate: Date;
  items: number;
  sites: number;
  flagged: number;
  hidden: number;
  /** Items seen but given no verdict (skipped, cancelled): said so the day's total and the Overview's "decided" share agree. */
  notChecked: number;
  /** Seven days, oldest first, ending at the focus day. null = nothing recorded that day (not a zero). */
  week: Array<{ dayKey: string; items: number | null; hidden: number }>;
}

export function computeToday(records: ForensicRecord[], now: Date = new Date()): TodayModel | null {
  const model = computeOverview(records);
  if (!model) return null;
  const items = model.kpis.find((k) => k.key === 'items');
  const flagged = model.kpis.find((k) => k.key === 'flagged');
  if (!items || !flagged) return null;
  const trail = model.balance.days.map((d) => d.dayKey);
  const hiddenByDay = new Map<string, number>();
  let notChecked = 0;
  for (const r of records) {
    if (!r.timestamp || !isBalanceContent(r)) continue;
    const k = localDayKey(r.timestamp);
    if (isBlockedItem(r)) hiddenByDay.set(k, (hiddenByDay.get(k) ?? 0) + 1);
    if (k === model.focusDayKey && itemOutcomeOf(r) === 'notChecked') notChecked++;
  }
  const todayKey = localDayKey(now);
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const when = model.focusDayKey === todayKey ? 'today' : model.focusDayKey === localDayKey(y) ? 'yesterday' : 'date';
  return {
    when,
    focusDate: model.focusDate,
    items: model.brief.items,
    sites: model.brief.platforms.length,
    flagged: flagged.value,
    hidden: hiddenByDay.get(model.focusDayKey) ?? 0,
    notChecked,
    week: trail.map((dayKey, i) => ({
      dayKey,
      items: model.daysOnRecord[i] ? items.series[i] : null,
      hidden: hiddenByDay.get(dayKey) ?? 0,
    })),
  };
}

const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function TodayHead({ records, lang }: { records: ForensicRecord[]; lang: ResolvedUiLanguage }): React.ReactElement | null {
  const today = useMemo(() => computeToday(records), [records]);
  if (!today) return null;
  const w = dashboardWords(lang);
  const dateText = formatDateLongLocal(today.focusDate, lang);
  const clauses = [
    today.hidden > 0 ? w.hiddenClause(today.hidden) : '',
    today.flagged > 0 ? w.flaggedClause(today.flagged) : '',
    today.notChecked > 0 ? w.notCheckedClause(today.notChecked) : '',
  ]
    .filter(Boolean).join(', ');
  const max = Math.max(1, ...today.week.map((d) => d.items ?? 0));
  return (
    <section className="today-head" aria-labelledby="today-head-line" data-testid="today-head">
      <div className="today-head-inner">
        <div className="today-head-words">
          <p className="today-head-date">{cap(dateText)}</p>
          <h1 className="today-head-line" id="today-head-line">
            {w.dayOpener(today.when, dateText)} {w.showed(today.items, today.sites)}
          </h1>
          <p className="today-head-rest">
            {w.keptAll(PRODUCT_NAME)}
            {clauses && <> {cap(clauses)}.</>}
          </p>
        </div>
        <div className="today-head-side">
          <div
            className="today-head-week"
            role="img"
            title={w.weekCaption}
            aria-label={`${w.weekCaption} ${today.week.map((d) => `${formatWeekdayShort(dayKeyAsLocalDate(d.dayKey), lang)}: ${w.weekDayValue(d.items, d.hidden)}`).join('; ')}.`}
          >
            {today.week.map((d, i) => {
              const day = formatWeekdayShort(dayKeyAsLocalDate(d.dayKey), lang);
              const h = d.items === null ? 0 : Math.round((d.items / max) * 100);
              const top = d.items ? Math.round((d.hidden / d.items) * 100) : 0;
              return (
                <div key={d.dayKey} className={'today-head-day' + (i === today.week.length - 1 ? ' focus' : '') + (d.items === null ? ' empty' : '')}>
                  <i style={{ height: `${h}%` }}><b style={{ height: `${top}%` }} /></i>
                  <span>{day}</span>
                </div>
              );
            })}
          </div>
          <dl className="today-head-figures">
            <div><dt>{w.labelRecorded}</dt><dd className="record">{formatCount(today.items, lang)}</dd></div>
            <div><dt>{w.labelFlagged}</dt><dd>{formatCount(today.flagged, lang)}</dd></div>
            <div><dt>{w.labelHidden}</dt><dd className="noise">{formatCount(today.hidden, lang)}</dd></div>
          </dl>
        </div>
      </div>
    </section>
  );
}
