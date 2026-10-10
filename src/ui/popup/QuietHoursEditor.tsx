// FeelingWise: the quiet-hours control, shared by the Off and Receipts popups.
//
// The engine has existed since 2026-08-05 (core/quiet-hours.ts
// and media-timeout.ts: a schedule on the `media-timeout` toggle's value
// blocks the page during its windows), but no screen could write a schedule,
// while the site and the store text promised quiet hours (found 2026-09-15).
// This is that screen: one window, from a time to a time, on the days picked,
// for all five sites. It writes the feature's GLOBAL value; a per-platform
// value (none is written by any screen) would still win for its platform, as
// getFeatureValue has always done. The popups sit behind the parent PIN, so
// this is PIN-gated like every other switch.

import { useState } from 'react';
import { usePopupT } from '../../i18n/react';
import { getFeatureValue, updateFeature, type FWSettings } from '../../storage/settings';
import {
  isWithinQuietHours,
  readQuietHoursSchedule,
  type QuietHoursWindow,
} from '../../core/quiet-hours';
import { FeatRow, Toggle } from './controls';

/** A school night: 22:00 to 07:00, every day. */
export const DEFAULT_QUIET_WINDOW: QuietHoursWindow = {
  days: [0, 1, 2, 3, 4, 5, 6],
  startMin: 22 * 60,
  endMin: 7 * 60,
};

/** Days in the order a week reads in Europe and Latin America: Monday first. */
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Minutes since midnight to the `HH:MM` an `<input type="time">` takes. 1440 reads 00:00. */
export function minutesToTime(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** `HH:MM` to minutes since midnight, or null when the field is empty or malformed. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Why an edit was refused, when it was. Named rather than boolean so the screen
 * can say which of the two it is; a parent unticking their last day and a
 * parent setting an end equal to the start need different sentences.
 */
export type QuietHoursRefusal = 'no-days' | 'same-time';

/** True for the refusals, false for a window. */
export function isRefusal(r: QuietHoursWindow | QuietHoursRefusal): r is QuietHoursRefusal {
  return typeof r === 'string';
}

/**
 * The window an edit produces, or the reason it was refused when the edit would
 * make a window the engine drops (same start and end, no day). A refused edit
 * is not written, so the stored schedule is never one the engine would silently
 * ignore, and since 2026-09-19 the screen says so instead of doing nothing.
 */
export function editWindow(
  current: QuietHoursWindow,
  edit: { startMin?: number; endMin?: number; toggleDay?: number },
): QuietHoursWindow | QuietHoursRefusal {
  const startMin = edit.startMin ?? current.startMin;
  // An end of 00:00 means "to midnight", which the engine spells 1440.
  const rawEnd = edit.endMin ?? current.endMin;
  const endMin = rawEnd === 0 ? 1440 : rawEnd;
  let days = current.days;
  if (edit.toggleDay !== undefined) {
    days = days.includes(edit.toggleDay)
      ? days.filter(d => d !== edit.toggleDay)
      : [...days, edit.toggleDay].sort((a, b) => a - b);
  }
  // Two refusals, told apart since 2026-09-19. Both used to return the same
  // null, and the caller dropped it: no write, no message, the chip snapping
  // back to where it was. A parent unticking their last day, or setting an end
  // equal to the start, pressed a control that did nothing and was told
  // nothing, twice over if they tried again.
  //
  // Both refusals are right. Zero days is a schedule that never runs, and an
  // end equal to the start is a window of no length, which the engine cannot
  // tell from "all day" because it spells midnight as 1440. What was missing
  // is the sentence.
  if (days.length === 0) return 'no-days';
  if (startMin === endMin % 1440) return 'same-time';
  return { days, startMin, endMin };
}

export function QuietHoursEditor({ settings, onChanged }: {
  settings: FWSettings;
  onChanged: () => Promise<void> | void;
}) {
  const t = usePopupT();
  const schedule = readQuietHoursSchedule(getFeatureValue(settings, 'media-timeout'));
  const win = schedule[0] ?? null;
  const on = win !== null;
  const blockingNow = on && isWithinQuietHours(schedule, new Date());
  /** The last refused edit, so the screen can say why nothing moved. */
  const [refused, setRefused] = useState<QuietHoursRefusal | null>(null);

  const write = async (next: QuietHoursWindow | null) => {
    await updateFeature('media-timeout', cur => {
      const { value: _old, ...rest } = cur;
      return next ? { ...rest, value: { schedule: [next] } } : rest;
    });
    await onChanged();
  };

  const edit = (e: Parameters<typeof editWindow>[1]) => {
    if (!win) return;
    const next = editWindow(win, e);
    if (isRefusal(next)) {
      setRefused(next);
      return;
    }
    setRefused(null);
    void write(next);
  };

  return (
    <div className="quiet-hours">
      <FeatRow
        name={t.quietEditTitle}
        desc={t.quietEditDesc}
        note={blockingNow ? t.quietEditNow : undefined}
        noteColor="var(--fw-red)"
        control={(
          <Toggle
            on={on}
            onClick={() => { void write(on ? null : DEFAULT_QUIET_WINDOW); }}
            label={t.quietEditTitle}
          />
        )}
      />
      {win && (
        <div className="qh-body">
          <div className="qh-times">
            <label>
              <span>{t.quietEditFrom}</span>
              <input
                type="time"
                value={minutesToTime(win.startMin)}
                onChange={e => { const m = timeToMinutes(e.currentTarget.value); if (m !== null) edit({ startMin: m }); }}
              />
            </label>
            <label>
              <span>{t.quietEditTo}</span>
              <input
                type="time"
                value={minutesToTime(win.endMin)}
                onChange={e => { const m = timeToMinutes(e.currentTarget.value); if (m !== null) edit({ endMin: m }); }}
              />
            </label>
          </div>
          <div className="qh-days" role="group" aria-label={t.quietEditDays}>
            {DAY_ORDER.map(d => {
              const picked = win.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className={`qh-day${picked ? ' on' : ''}`}
                  aria-pressed={picked}
                  onClick={() => edit({ toggleDay: d })}
                >
                  {t.quietEditDayNames[d]}
                </button>
              );
            })}
          </div>
          {/* An overnight window runs from the day it STARTS on into the next,
              which core/quiet-hours.ts states because getting it backwards
              moves a whole school-night block by a day. It was stated there
              and nowhere a parent could see it, so the default 22:00 to 07:00
              with the weekend unticked left Sunday night open, which is the
              night they most meant to close, and closed Friday night, which
              they did not ask for (2026-09-19). */}
          {win.startMin > win.endMin && (
            <div className="fr-desc">{t.quietEditOvernightNote}</div>
          )}
          {refused && (
            <div className="fr-desc" role="status" style={{ color: 'var(--fw-red)' }}>
              {refused === 'no-days' ? t.quietNeedsADay : t.quietNeedsALength}
            </div>
          )}
          <div className="fr-desc">{t.quietEditHint}</div>
        </div>
      )}
    </div>
  );
}
