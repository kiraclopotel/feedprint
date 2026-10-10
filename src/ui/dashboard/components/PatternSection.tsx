// One shape for a section of the Feed behaviour tab.
//
// Nine sections in PatternsTab.tsx each carried their own copy of the same two
// inline style objects and the same three-part shape: a title, a muted line of
// explanation, and then either content or a sentence saying there is none. Two
// of those copies had already drifted a pixel apart, which is what a repeated
// style always does eventually.
//
// `empty` is the sentence to show when there is nothing, and it changes the
// shape rather than the content. On a record with nothing flagged yet, which is
// every install in its first days, most of this tab is in that state, and each
// section still cost a full card with a heading and a paragraph: the tab ran to
// 3,239px at a 900px window (measured 2026-09-17), most of it explaining things
// that had not happened.
//
// What does not fold away is the finding itself. "No identical item has been
// recorded in separate sittings yet" is a statement about the record, not the
// absence of one, and this product says what it did not find as plainly as what
// it did. The sentence sits on the summary line, read without opening anything;
// what folds is the paragraph that explains what the section would have shown.

import React from 'react';

export function PatternSection({ title, sub, empty, children }: {
  title: string;
  sub?: React.ReactNode;
  /** The one-line finding when the section has nothing to show. */
  empty?: string;
  children: React.ReactNode;
}) {
  if (empty) {
    return (
      <details className="pat-section pat-section-empty">
        <summary>
          <span className="pat-section-title">{title}</span>
          <span className="pat-section-note">{empty}</span>
        </summary>
        {sub !== undefined && <p className="pat-section-sub">{sub}</p>}
        {children}
      </details>
    );
  }
  return (
    <section className="pat-section">
      <h3 className="pat-section-title">{title}</h3>
      {sub !== undefined && <p className="pat-section-sub">{sub}</p>}
      {children}
    </section>
  );
}

/**
 * The same shape for the Statistics tab, whose cards are a card in a
 * twelve-column grid rather than a section in a column. Five of them were a
 * whole card around the words "No data yet." on a record with nothing flagged
 * (2026-09-17), which is most of that tab on an install's first days.
 */
export function StatsCard({ title, sub, empty, full, children }: {
  title: string;
  sub?: React.ReactNode;
  /** The one-line finding when there is nothing to show. */
  empty?: string;
  /** Twelve columns rather than six. */
  full?: boolean;
  children: React.ReactNode;
}) {
  const base = `stats-card${full ? ' full' : ''}`;
  if (empty) {
    return (
      <details className={`${base} pat-section-empty`}>
        <summary>
          <span className="pat-section-title">{title}</span>
          <span className="pat-section-note">{empty}</span>
        </summary>
        {sub !== undefined && <div className="stats-sub">{sub}</div>}
        {children}
      </details>
    );
  }
  return (
    <div className={base}>
      <h3>{title}</h3>
      {sub !== undefined && <div className="stats-sub">{sub}</div>}
      {children}
    </div>
  );
}
