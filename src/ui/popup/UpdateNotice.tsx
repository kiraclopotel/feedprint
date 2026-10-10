// The one line after an update, shared by the recorder's popup and Off's (PLAN-2026-09-17 item
// 8a). "Updated to 2.5.10: what changed" links to the Updates page on the site; a small × dismisses
// it. Either act acknowledges the version, and the line is not shown again until the next update.
// The decision of whether to show it is in src/storage/update-notice.ts.
//
// The read runs at the popup's root, on every open, whatever screen the popup lands on. It has
// to: a fresh recorder install opens on the setup wizard, and if the read waited for the main
// screen it would run for the first time after setup had written its settings, take the profile
// for one that ran an earlier build, and show the line for the version the user just installed.

import { usePopupT, useUiLanguage } from '../../i18n/react';
import { type UpdateNoticeState, acknowledgeUpdate, readUpdateNotice, updatesPageUrl } from '../../storage/update-notice';
import { useCallback, useEffect, useState } from 'react';

/**
 * Reads the state once per popup document. Returns the state (null until read) and the act that
 * acknowledges the running version. Call it at the root; render the line where it belongs.
 */
export function useUpdateNotice(): [UpdateNoticeState | null, () => void] {
  const [state, setState] = useState<UpdateNoticeState | null>(null);
  useEffect(() => {
    let cancelled = false;
    readUpdateNotice().then((s) => { if (!cancelled) setState(s); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const done = useCallback(() => {
    setState((s) => {
      if (s?.version) void acknowledgeUpdate(s.version);
      return s ? { show: false, version: s.version } : s;
    });
  }, []);
  return [state, done];
}

/** The line itself, given the version; a test renders this directly. */
export function UpdateNoticeLine({ version, onDone, switchesMoved = false }: {
  version: string;
  onDone: () => void;
  /** Receipts, for an install that had a switch on that moved to Off: says where it went, with the same ×. */
  switchesMoved?: boolean;
}) {
  const t = usePopupT();
  const lang = useUiLanguage();
  const link = (
    <a
      href={updatesPageUrl(lang, version)}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onDone}
    >
      {t.updateNoticeLine(version)}
    </a>
  );
  return (
    <div className="pop-update" role="status">
      {/* With the note the two run as one text, so neither is squeezed into a narrow column beside the other. */}
      {switchesMoved
        ? <span className="pop-update-text">{link}<span className="pop-update-moved"> {t.pageSwitchesMovedNote}</span></span>
        : link}
      <button type="button" className="chip-x" aria-label={t.updateNoticeDismiss} onClick={onDone}>×</button>
    </div>
  );
}
