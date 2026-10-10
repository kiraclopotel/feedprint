// ─── The restore's confirmation, held above the tab that reports it ───
//
// A restore that works replaces the whole record and then asks the dashboard
// to re-read it. That refresh unmounts the export tab (Dashboard.tsx renders it
// under `!archiveLoading`), so a sentence written into the export tab's own
// state is wiped a moment later: on 14 Sep 2026 the walk restored 6 records
// hash for hash and the screen's last words were still the question it had
// asked before ("Restoring replaces the 8 entries currently in the record"),
// board line c2.
//
// The fix is where the sentence lives, not what it says. This hook holds it in
// the dashboard shell, which does not unmount, and hands it back down to the
// export tab on every render. It is a module of its own so the timing can be
// tested without mounting the whole dashboard.

import { useEffect, useRef, useState } from 'react';

/**
 * How long the confirmation stays up when the parent does not dismiss it.
 * Long enough to read the sentence twice, short enough that it is not still
 * sitting there over the next thing they do.
 */
export const RESTORE_NOTICE_MS = 10_000;

interface RestoreNotice {
  /** Records the backup put back into the record. */
  restored: number;
  /** Records that were in the record before, and are not any more. */
  replaced: number;
}

interface HeldNotice extends RestoreNotice {
  /** Bumped per show, so a second restore restarts the timer rather than
   *  inheriting what is left of the first one's. */
  seq: number;
}

export interface RestoreNoticeHold {
  notice: HeldNotice | null;
  show: (n: RestoreNotice) => void;
  dismiss: () => void;
}

export function useRestoreNotice(): RestoreNoticeHold {
  const [notice, setNotice] = useState<HeldNotice | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), RESTORE_NOTICE_MS);
    return () => clearTimeout(id);
  }, [notice?.seq]);
  return {
    notice,
    show: (n: RestoreNotice) => setNotice({ ...n, seq: (seq.current += 1) }),
    dismiss: () => setNotice(null),
  };
}
