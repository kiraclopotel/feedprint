// Things that need one click from the parent, put where they cannot be missed.
//
// Found 2026-09-01: a backup folder had silently lost write permission after
// a browser restart. The app knew, and said so, in small grey text at the
// bottom of the Export tab next to a button labelled "Allow again". Backups
// had stopped for days and the loss was only found while hunting for
// something else.
//
// A state that stops the record being saved is not a status line. The rule
// this component encodes: if the app knows something is broken AND a single
// click fixes it, that belongs at the top of the page with the button
// attached, not in a paragraph the user has to go looking for.
//
// Deliberately not a modal. A modal that blocks the dashboard would be worse
// than the problem for anyone who cannot act right now, and the browser needs
// a real user gesture for the folder re-grant anyway, so the button has to be
// a button the parent chooses to press.

import { useState } from 'react';
import { useDashboardT } from '../../../i18n/react';
import { localDayKey } from '../../shared/format-time';

export interface AttentionItem {
  /** Stable id, so dismissing one does not hide a different problem later. */
  id: string;
  /** A reminder, not a fault: shown where it can be acted on (Overview, Export), not over every tab. */
  reminder?: boolean;
  title: string;
  body: string;
  actionLabel: string;
  /**
   * Resolves true only when the action fixed the problem. "Done" is shown on
   * true and nowhere else: a refused folder grant or a jump to another tab
   * fixed nothing, and the banner said Done for both (wiring audit 13 Sep,
   * D2-19).
   */
  onAction: () => boolean | Promise<boolean>;
}

/** localStorage key for today's dismissals: { [itemId]: 'YYYY-MM-DD' }. */
export const ATTENTION_DISMISS_KEY = 'fw-attention-dismissed';

function today(): string {
  // NOT-DISPLAYED: a localStorage key for today's dismissals, never rendered.
  //
  // Cut at LOCAL midnight since 2026-09-19 (M253). It was cut in UTC, reasoned
  // as keeping the key a dismissal is written under equal to the key the next
  // read looks for even across a timezone change. That reason is real and it
  // costs more than it buys: at UTC+3 a dismissal made at nine in the evening
  // came back at three in the morning, and the rest of the dashboard already
  // means local midnight by "today" (StatisticsTab and the Activity tab both
  // cut there, after the two disagreed in every non-UTC zone). One product
  // should not hold two meanings of the same word.
  //
  // What the old reason was protecting against still happens and is harmless:
  // after a timezone change a key may not match, and the item reappears. An
  // item coming back is the safe direction, and in a new place it is a new day.
  // Through localDayKey rather than hand-cut here: one-clock-per-surface refused
  // the hand-rolled version and named it, which is the same rule as the number
  // formatter and the same reason. One place decides what a local day is.
  return localDayKey(new Date());
}

/**
 * Dismissals last until the reader's own midnight and survive a reload (D2-20:
 * they lasted one mount, so every reopen of the dashboard showed the item
 * again). "The reader's own" is the part that was not true until 2026-09-19.
 * They do not last longer, because a problem that stops the record being
 * saved must come back tomorrow if it is still there.
 */
export function readDismissed(now: string = today()): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ATTENTION_DISMISS_KEY) ?? '{}') as Record<string, string>;
    return new Set(Object.keys(raw).filter((id) => raw[id] === now));
  } catch {
    return new Set();
  }
}

function writeDismissed(ids: Set<string>, now: string = today()): void {
  try {
    const out: Record<string, string> = {};
    for (const id of ids) out[id] = now;
    localStorage.setItem(ATTENTION_DISMISS_KEY, JSON.stringify(out));
  } catch {
    /* storage unavailable: the dismissal lasts this mount only */
  }
}

export function AttentionBanner({ items }: { items: AttentionItem[] }) {
  const t = useDashboardT();
  const [hidden, setHidden] = useState<Set<string>>(() => readDismissed());
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());

  const visible = items.filter(i => !hidden.has(i.id));
  if (visible.length === 0) return null;

  return (
    // The heading is spoken, not shown: each item's own title is the card's title, and a second line above it
    // saying "needs your attention" made one problem read as two.
    <div className="dash-attention" role="status" aria-live="polite" aria-label={t.attnTitle}>
      {visible.map(item => (
        <div key={item.id} className="dash-attention-item">
          <div className="dash-attention-text">
            <div className="dash-attention-title">{item.title}</div>
            <div className="dash-attention-body">{item.body}</div>
          </div>
          <div className="dash-attention-actions">
            {done.has(item.id) ? (
              <span className="dash-attention-done">{t.attnDone}</span>
            ) : (
              <button
                className="btn dash-attention-cta"
                disabled={busy === item.id}
                onClick={() => {
                  setBusy(item.id);
                  void Promise.resolve(item.onAction())
                    .then((fixed) => { if (fixed) setDone(prev => new Set(prev).add(item.id)); })
                    .catch(() => { /* the item stays, so the parent can retry */ })
                    .finally(() => setBusy(null));
                }}
              >
                {item.actionLabel}
              </button>
            )}
            <button
              className="dash-attention-hide"
              onClick={() => setHidden(prev => { const next = new Set(prev).add(item.id); writeDismissed(next); return next; })}
            >
              {t.attnDismiss}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
