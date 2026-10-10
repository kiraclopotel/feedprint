// The header's entry count, opened: what the entries are. Each line is counted
// on its own (month-sets.ts entriesBreakdown) and whatever the total holds that
// no line reached is named as unread, so the lines always add up to the chip.

import * as React from 'react';
import type { ForensicRecord } from '../../../types/forensic';
import type { MonthSummary } from '../../../forensics/archive-summary';
import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import { dayKeyAsLocalDate, formatDayMonthLocal, formatTimeLocal } from '../../shared/format-time';
import { formatCount } from '../../shared/format-number';
import type { RecordSetCounts } from '../record-sets';
import { entriesBreakdown, type MonthSets, type OlderMonthsProgress } from '../month-sets';

export interface EntriesBreakdownProps {
  total: number;
  loadedEntries: readonly ForensicRecord[];
  unloadedSummaries: readonly MonthSummary[];
  archivedCountedAt: Date | null;
  monthSets?: ReadonlyMap<string, MonthSets>;
  olderMonthsProgress?: OlderMonthsProgress | null;
}

function SetList({ s, testId }: { s: RecordSetCounts; testId: string }) {
  const t = useDashboardT();
  return (
    <ul data-testid={testId}>
      <li>
        {t.setCount('items', s.items)}
        <ul>
          <li>{t.setCount('checked', s.checked)}: {t.setCount('passed', s.passed)}, {t.setCount('flagged', s.flagged)}, {t.setCount('blocked', s.blocked)}</li>
          <li>{t.setCount('notChecked', s.notChecked)}</li>
        </ul>
      </li>
      <li>{t.setCount('roomSummaries', s.roomSummaries)}</li>
      <li>{t.setCount('markers', s.markers)}</li>
    </ul>
  );
}

export function EntriesBreakdown({ total, loadedEntries, unloadedSummaries, archivedCountedAt, monthSets, olderMonthsProgress }: EntriesBreakdownProps) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const b = React.useMemo(
    () => entriesBreakdown(total, loadedEntries, unloadedSummaries, monthSets),
    [total, loadedEntries, unloadedSummaries, monthSets],
  );
  const day = (key: string) => formatDayMonthLocal(dayKeyAsLocalDate(key), lang);
  const s = b.loaded;
  const asOf = archivedCountedAt ? formatTimeLocal(archivedCountedAt.toISOString(), lang) : '…';
  return (
    <div className="dash-record-help-popover dash-entries-breakdown" role="dialog" aria-label={t.hdrBreakdownTitle(formatCount(total, lang))}>
      <p><strong>{t.hdrBreakdownTitle(formatCount(total, lang))}</strong></p>
      {s.entries > 0 && (
        <>
          <p>{s.firstDay ? t.hdrBreakdownLoaded(day(s.firstDay), day(s.lastDay)) : null}</p>
          <SetList s={s} testId="entries-breakdown-loaded" />
        </>
      )}
      {b.olderCounted > 0 && b.olderSorted && (
        <>
          <p>{t.hdrBreakdownOlderSorted(b.olderCounted, asOf)}</p>
          <SetList s={b.olderSorted} testId="entries-breakdown-older" />
          {b.olderUnreadable > 0 && <p>{t.hdrBreakdownUnread(b.olderUnreadable)}</p>}
        </>
      )}
      {b.olderCounted > 0 && !b.olderSorted && (
        <p>
          {t.hdrBreakdownOlder(b.olderCounted, asOf)}
          {olderMonthsProgress ? <>{' '}{t.hdrCountingOlderMonths(olderMonthsProgress.done, olderMonthsProgress.total)}</> : null}
        </p>
      )}
      {b.unaccounted !== 0 && <p>{t.hdrBreakdownUnread(b.unaccounted)}</p>}
    </div>
  );
}
