// FeelingWise - a line of text that announces itself.
//
// The accessibility audit dated 2026-09-18 found ten places across the popup where the result of
// the user's own action (a saved key, a wrong PIN, a licence error, a paused schedule) was written
// to the screen and to nobody else: plain <div>s with no ARIA role, so a screen reader user who was
// not looking at the exact pixel that changed never learned what happened. This component is the
// one place that wraps `role="status"` (a polite announcement - confirmations, informational
// results) and `role="alert"` (an assertive one - errors, failures) so every call site gets the
// same two roles instead of nine slightly different ad hoc divs.
//
// It renders the same element it always would have (a <div> by default, or a <span> via `as`, so a
// call site that sits inside a <button> or needs an existing CSS class keeps its exact layout) with
// one attribute added. It does not manage timing: several of the ten call sites cleared their text
// on a 600ms or 1200ms timer, too fast for a screen reader to reach before the node disappeared or
// went empty, and that timing was widened at the call site, not here.
import type { CSSProperties, ReactNode } from 'react';

export function StatusLine({
  children, tone = 'status', as = 'div', className, style, id, ...rest
}: {
  children: ReactNode;
  /** 'status' (polite) for a confirmation or informational result, 'alert' (assertive) for an error. */
  tone?: 'status' | 'alert';
  /** The element to render. Defaults to 'div'; pass 'span' to sit inline (e.g. inside a <button>). */
  as?: 'div' | 'span';
  className?: string;
  style?: CSSProperties;
  id?: string;
  /**
   * `data-` hooks the call site already had, carried through (2026-09-19).
   *
   * A div being replaced by this component may be the one a test or a browser
   * probe finds by its data attribute, and silently dropping that turns an
   * accessibility fix into a broken check somewhere else. It happened on the
   * first swap: ExportTab's receipt line carries data-fw-export-receipt and a
   * test looks for it. Only `data-` is accepted, so this cannot quietly become
   * a way to set role or aria from outside the one place that owns them.
   */
  [dataAttr: `data-${string}`]: unknown;
}) {
  const Tag = as;
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rest)) if (k.startsWith('data-')) data[k] = v;
  return (
    <Tag role={tone} className={className} style={style} id={id} {...data}>
      {children}
    </Tag>
  );
}
