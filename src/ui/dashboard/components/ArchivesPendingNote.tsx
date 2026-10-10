// One line, shown by every counting tab while the archived months are still
// being read (Dashboard.tsx `archivesPending`). Until 13 Sep 2026 those tabs
// counted the active chain alone and said nothing, so the month rotation
// zeroed them and every eviction at the cap lowered them (wiring audit C1, C2,
// C3, D1-3, D1-10). Now they count the whole record, and this is the honest
// state for the seconds before the archives land: the numbers on screen are
// the active chain's, and they will grow, not shrink.

import { useDashboardT } from '../../../i18n/react';

export function ArchivesPendingNote({ pending }: { pending?: boolean }) {
  const t = useDashboardT();
  if (!pending) return null;
  return (
    <div className="stats-card full" role="status" data-fw-archives-pending="1" style={{ color: 'var(--fw-muted)', fontSize: 12 }}>
      {t.archivesPendingNote}
    </div>
  );
}
