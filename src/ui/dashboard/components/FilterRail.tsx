// Activity filter rail — surface-id: activity-filter-rail (redesign 2026-08-01).
//
// Left rail replacing the stacked filter rows (platform tabs, verdict chips,
// account chips, active-drill chips). Grouped, collapsible axes with a live
// count per option; search at the top; a "?" guidance popover at the head
// (amber, slow ping, never modal, never open by default). Owner-chosen mockup:
// docs/redesign/mockups/2026-08-01/activity-filter-B-filter-rail.html.
//
// Controlled + presentational: the owner (ActivityTab) builds the group specs
// (labels, counts, active flags, pick handlers) so all filter state and count
// math stays in one place; this component only renders and holds the local
// open/collapsed + hint-popover UI state.

import { useEffect, useState } from 'react';
import { useDashboardT } from '../../../i18n/react';

interface RailOptionSpec {
  key: string;
  label: string;
  /** Click-through count for this option. Null while the archive is still
   *  loading — a count over a partial chain is a total the page has not
   *  loaded, so the chip shows a pending glyph instead of a number. */
  count: number | null;
  active: boolean;
  title?: string;
  onPick: () => void;
}

export interface RailGroupSpec {
  id: string;
  label: string;
  /** Expanded on first render (user toggles are kept afterwards). */
  defaultOpen?: boolean;
  options: RailOptionSpec[];
}

export function FilterRail({ search, onSearchChange, groups }: {
  search: string;
  onSearchChange: (next: string) => void;
  groups: RailGroupSpec[];
}) {
  const t = useDashboardT();
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const g of groups) init[g.id] = g.defaultOpen ?? false;
    return init;
  });
  const [hintOpen, setHintOpen] = useState(false);

  // A group id that appears after first render (a surface group that only
  // exists once records carry a feedSource, say) starts from its own
  // defaultOpen instead of rendering collapsed forever; ids the user already
  // toggled keep their state (wiring audit 13 Sep 2026, finding 26).
  // The separator is a literal NUL byte written as its escape. As a raw byte in the file it made
  // ripgrep treat this whole file as binary and skip it without a word, so every source sweep
  // read clean here while never having looked (PLAN-2026-09-16 item 6.6).
  const groupIds = groups.map((g) => g.id).join('\u0000');
  useEffect(() => {
    setOpen((prev) => {
      let next: Record<string, boolean> | null = null;
      for (const g of groups) {
        if (g.id in prev) continue;
        if (!next) next = { ...prev };
        next[g.id] = g.defaultOpen ?? false;
      }
      return next ?? prev;
    });
    // groups is rebuilt every render; only the id list matters here.
  }, [groupIds]);

  // The hint popover closes on any outside click (mockup contract: opt-in,
  // non-modal, never open by default).
  useEffect(() => {
    if (!hintOpen) return;
    const close = () => setHintOpen(false);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [hintOpen]);

  return (
    <aside className="filter-rail">
      <div className="frail-head">
        <span>{t.railHead}</span>
        <div className={'frail-hint' + (hintOpen ? ' open' : '')}>
          <button
            type="button"
            aria-label={t.railHintButton}
            aria-expanded={hintOpen}
            onClick={(e) => { e.stopPropagation(); setHintOpen((v) => !v); }}
          >
            ?
          </button>
          {hintOpen && (
            <div className="frail-pop" onClick={(e) => e.stopPropagation()}>
              <h4>{t.railHintWhatTitle}</h4>
              <p>{t.railHintWhatBody}</p>
              <h4>{t.railHintDoTitle}</h4>
              <p>{t.railHintDoBody}</p>
            </div>
          )}
        </div>
      </div>
      <div className="frail-search">
        <input
          type="search"
          aria-label={t.searchPlaceholder}
          placeholder={t.searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
      {/* The groups scroll, the head does not.
          Reported by the owner from his own install on 2026-09-17, with 3,278
          records: opening a group with many options makes this rail taller than
          the window, and a sticky element taller than the window pins at the top
          with its bottom permanently off screen. The lower groups, "Mode at
          capture" and "Model that read it", could not be reached at all.
          The head stays outside this box on purpose: the "?" popover is anchored
          there, and a scroll container clips on both axes, which is the reason
          the whole rail was left unscrollable in the first place. */}
      <div className="frail-groups">
      {groups.map((g) => (
        <details
          key={g.id}
          className="frail-grp"
          open={!!open[g.id]}
          onToggle={(e) => {
            const isOpen = (e.currentTarget as HTMLDetailsElement).open;
            setOpen((prev) => (prev[g.id] === isOpen ? prev : { ...prev, [g.id]: isOpen }));
          }}
        >
          <summary>{g.label}</summary>
          {g.options.map((o) => (
            <button
              type="button"
              key={o.key}
              className={'frail-opt' + (o.active ? ' on' : '')}
              onClick={o.onPick}
              title={o.title}
              aria-pressed={o.active}
            >
              <span className="frail-opt-label">{o.label}</span>
              <span className="frail-count">{o.count ?? '…'}</span>
            </button>
          ))}
        </details>
      ))}
      </div>
    </aside>
  );
}
