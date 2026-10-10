// One quiet line on the timeline spine for a run of housekeeping records (see
// marker-runs.ts for why they fold). It reuses the spine's quiet-gap row, the
// same dashed segment the list draws through a calm period, so a run reads as
// time passing rather than as something that was served.

import { useDashboardT, useUiLanguage } from '../../../i18n/react';
import type { ForensicRecord } from '../../../types/forensic';
import { formatDateTimeLocal, formatTimeLocal, localDayKey } from '../../shared/format-time';
import { formatCount } from '../../shared/format-number';
import { countMarkerKinds, markerRunSpan } from './marker-runs';

export function MarkerRunLine({ rowKey, run }: { rowKey: string; run: readonly ForensicRecord[] }) {
  const t = useDashboardT();
  const lang = useUiLanguage();
  const kinds = countMarkerKinds(run)
    .map(({ kind, count }) => `${formatCount(count, lang)} ${t.feedMarkerKindWord(kind, count)}`);
  const span = markerRunSpan(run);
  const from = formatDateTimeLocal(span.from, lang);
  const to = span.to === span.from ? null
    : localDayKey(span.to) === localDayKey(span.from) ? formatTimeLocal(span.to, lang)
      : formatDateTimeLocal(span.to, lang);
  return (
    <div className="fc-marker-run" data-fw-key={rowKey} data-fw-marker-count={run.length} title={t.feedMarkerRunTip}>
      <div className="fc-tl-row gap">
        <div className="fc-tl-gutter" />
        <div className="fc-tl-gaplabel">{kinds.join(' · ')} · {t.feedMarkerRunSpan(from, to)}</div>
      </div>
    </div>
  );
}
