// ─── Tab bar button ───
import type { KeyboardEvent, ReactNode } from 'react';

export type TabId = 'feedlog' | 'overview' | 'activity' | 'exposure' | 'patterns' | 'statistics' | 'forensics' | 'operational' | 'export';

// Left-to-right order the strip actually renders in (Dashboard.tsx's JSX
// order under role="tablist", NOT this file's TabId union order, which lists
// 'overview' before 'activity' while the strip renders Activity first). The
// WAI-ARIA tabs pattern moves focus to the visually next/previous tab, so the
// roving-tabindex handler below has to walk the rendered order or Left/Right
// would silently jump to the wrong neighbor.
const TAB_ORDER: TabId[] = [
  'feedlog', 'activity', 'overview', 'statistics', 'patterns', 'exposure', 'forensics', 'operational', 'export',
];

export function TabBtn({ id, tab, onClick, children, hasIssues }: {
  id: TabId;
  tab: TabId;
  onClick: (t: TabId) => void;
  children: ReactNode;
  hasIssues?: boolean;
}) {
  // Accessibility audit found 2026-09-18: role="tab" + aria-selected were
  // already correct, but every tab sat in the Tab-key stop order (instead of
  // one stop for the whole strip, with the arrow keys moving inside it), and
  // there was no aria-controls linking a tab to the panel it exposes. The
  // roving tabindex below follows the WAI-ARIA tabs pattern: only the
  // selected tab is a Tab-key stop (tabIndex 0), the rest are -1, and
  // Left/Right/Home/End move both the selection and the DOM focus among the
  // sibling [role="tab"] buttons (looked up by the id this component gives
  // each button, since siblings are independent TabBtn instances with no
  // shared ref). aria-controls points at `dash-panel-${id}`, which
  // Dashboard.tsx must render on the matching panel — see that file's report
  // for the exact lines, since TabBtn does not own Dashboard.tsx.
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const key = e.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
    e.preventDefault();
    const idx = TAB_ORDER.indexOf(id);
    const nextIdx =
      key === 'ArrowRight' ? (idx + 1) % TAB_ORDER.length
      : key === 'ArrowLeft' ? (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length
      : key === 'Home' ? 0
      : TAB_ORDER.length - 1;
    const nextId = TAB_ORDER[nextIdx];
    onClick(nextId);
    document.getElementById(`dash-tab-${nextId}`)?.focus();
  };

  return (
    <button
      type="button"
      role="tab"
      id={`dash-tab-${id}`}
      aria-selected={tab === id}
      aria-controls={`dash-panel-${id}`}
      tabIndex={tab === id ? 0 : -1}
      className={'dash-tab' + (tab === id ? ' active' : '') + (hasIssues ? ' has-issues' : '')}
      onClick={() => onClick(id)}
      onKeyDown={handleKeyDown}
    >
      {children}
    </button>
  );
}
