// src/ui/dashboard/components/chart-kit.tsx
// Surface-ID: chart-kit — presentational primitives for the Statistics /
// Exposure re-skin. Transplanted from the browser-verified mockup
// docs/redesign/mockups/2026-07-17/chart-kit.html; geometry constants are the
// mockup's exact values. Rendering only — no aggregation, no counting rules.
//
// Kit law (palette validated 2026-07-17, dataviz validator): color is never
// the only channel — every mark carries a text label or a tooltip; adjacent
// fills are separated by a 2px surface gap; pass/benign quantities render in
// --fwc-neutral so the locked status hues never sit adjacent.

import * as React from 'react';

type CSSVars = React.CSSProperties & Record<string, string | number>;

export function KitHero({
  num, unit, delta,
}: {
  num: React.ReactNode; unit?: React.ReactNode; delta?: React.ReactNode;
}) {
  return (
    <div className="fwc-hero">
      <span className="fwc-num">{num}</span>
      {unit != null && <span className="fwc-unit">{unit}</span>}
      {delta}
    </div>
  );
}

/** Delta chip. Direction is decorative (arrow glyph); the text carries the
 *  full meaning, so the chip is never color-alone. */
export function KitDelta({ dir, children }: { dir: 'up' | 'down' | 'flat'; children: React.ReactNode }) {
  return (
    <span className={`fwc-delta ${dir === 'flat' ? '' : dir}`.trim()}>
      {dir !== 'flat' && <span className="fwc-arr">{dir === 'up' ? '▲' : '▼'}</span>}
      {children}
    </span>
  );
}

/** Horizontal bar row: swatch/dot + label | track+fill | count. */
export function KitRow({
  label, color, width, count, note, dot, onClick, title, swatch,
}: {
  label: React.ReactNode;
  /** fill + swatch color (CSS color or var()) */
  color: string;
  /** The swatch's own colour when it names an entity (a platform) and the bar is a tone of ink (row 75). */
  swatch?: string;
  /** 0..100 */
  width: number;
  count: React.ReactNode;
  /** A second, quieter line under the bar (a 95% interval). It used to ride in the count, a narrow column,
   *  and ran up to 97px past the card at 1280px (his walk of 12 Oct 2026). */
  note?: React.ReactNode;
  /** round platform dot instead of square swatch */
  dot?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div
      className={(onClick ? 'fwc-row drill' : 'fwc-row') + (note ? ' has-note' : '')}
      onClick={onClick}
      title={title}
      // A drill row is an interactive control, so give it button semantics and
      // keyboard activation; a plain (non-onClick) row stays inert.
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? title : undefined}
      onKeyDown={onClick
        ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }
        : undefined}
    >
      <span className="fwc-label">
        <span className={dot ? 'fwc-dot' : 'fwc-swatch'} style={{ ['--sw']: swatch ?? color } as CSSVars} />
        {label}
      </span>
      <span className="fwc-track">
        <span className="fwc-fill" style={{ ['--w']: `${Math.max(0, Math.min(100, width))}%`, ['--c']: color } as CSSVars} />
      </span>
      <span className="fwc-count">{count}</span>
      {note && <span className="fwc-note">{note}</span>}
    </div>
  );
}

export interface KitStackSeg { n: number; color: string; title: string }

/** Proportion bar with 2px surface gaps. Zero segments are dropped; each
 *  visible segment carries its title tooltip (kit law).
 *
 *  Accessibility audit found 2026-09-18: the `title` attribute was the ONLY
 *  way to read a segment's value — a CSS `:hover` tooltip has no keyboard
 *  trigger and no accessible-name equivalent, so a screen reader or
 *  keyboard-only reader could not get the number at all. `title` stays for
 *  pointer users; `tabIndex` + `aria-label` put the same value in the
 *  accessible name, so the bar is also a list of labelled values to anyone
 *  not using a mouse. */
export function KitStack({ segs, height }: { segs: KitStackSeg[]; height?: number }) {
  const visible = segs.filter((s) => s.n > 0);
  if (visible.length === 0) return null;
  return (
    <div className="fwc-stack" style={height ? { height } : undefined}>
      {visible.map((s, i) => (
        <span
          key={i}
          className="fwc-seg"
          style={{ flex: s.n, ['--c']: s.color } as CSSVars}
          title={s.title}
          role="img"
          aria-label={s.title}
          tabIndex={0}
        />
      ))}
    </div>
  );
}

export interface KitLegendItem { color: string; strong?: React.ReactNode; label: React.ReactNode }

export function KitLegend({ items, style }: { items: KitLegendItem[]; style?: React.CSSProperties }) {
  return (
    <div className="fwc-legend" style={style}>
      {items.map((it, i) => (
        <span key={i} className="fwc-item">
          <span className="fwc-swatch" style={{ ['--sw']: it.color } as CSSVars} />
          {it.strong != null && <strong>{it.strong}</strong>}
          {/* The label is wrapped rather than left loose. Bare text inside a
              flex container becomes one anonymous item, which cannot shrink
              below its own width, so a long sentence pushed the card wider than
              its column instead of taking a second line (Romanian at a 900px
              window, measured 2026-09-17). A span is an item that can give. */}
          <span className="fwc-item-label">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

export interface KitCol {
  /** tooltip text (kit law: every mark self-describes) */
  tip: string;
  /** stacked parts, top-first, pixel heights (mockup math lives in callers) */
  parts: { h: number; color?: string }[];
  /** highlighted column (late-night wash) */
  hi?: boolean;
  /** A value printed on top of the mark (the walk of 12 Oct 2026: bars with no value read as decoration). */
  value?: string;
}

/** Column chart. `height` is the plot height in px (mockup values: 96 daily,
 *  84 weekly, 52 mini, 64 hourly). Parts without a color render as the
 *  neutral base.
 *
 *  Accessibility audit found 2026-09-18: `data-tip` here only ever fed a CSS
 *  `:hover::after` tooltip (the column's own stylesheet) — the ONLY way to
 *  read a column's value, with no focus trigger and nothing for a screen
 *  reader. `tabIndex` + `aria-label` carry the same tip text into the
 *  accessible name, so each column is reachable by keyboard and readable by
 *  a screen reader without a tooltip library. */
export function KitCols({ cols, height, capped }: { cols: KitCol[]; height: number; capped?: boolean }) {
  return (
    <div className={capped ? 'fwc-cols capped' : 'fwc-cols'} style={{ ['--h']: `${height}px` } as CSSVars}>
      {cols.map((c, i) => (
        <span
          key={i}
          className={c.hi ? 'fwc-col hi' : 'fwc-col'}
          data-tip={c.tip}
          style={{ ['--bar']: `${c.parts.reduce((s, p) => s + p.h, 0) + 2 * Math.max(0, c.parts.length - 1) + (c.value !== undefined ? 16 : 0)}px` } as CSSVars}
          role="img"
          aria-label={c.tip}
          tabIndex={0}
        >
          {c.value !== undefined && <span className="fwc-col-val" aria-hidden="true">{c.value}</span>}
          {c.parts.map((p, j) => (
            <span
              key={j}
              className={p.color ? 'fwc-part' : 'fwc-part fwc-base'}
              style={{ height: p.h, ...(p.color ? { ['--c']: p.color } : {}) } as CSSVars}
            />
          ))}
        </span>
      ))}
    </div>
  );
}

export function KitAxis({ labels, perCol, capped }: { labels: string[]; perCol?: boolean; capped?: boolean }) {
  return (
    <div className={(perCol ? 'fwc-axis per-col' : 'fwc-axis') + (capped ? ' capped' : '')}>
      {labels.map((l, i) => <span key={i}>{l}</span>)}
    </div>
  );
}

/** 14-point sparkline for stat tiles (120x26 viewBox, mockup geometry). */
function KitSpark({ values, hot }: { values: number[]; hot?: boolean }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const step = 120 / (values.length - 1);
  const points = values
    .map((v, i) => `${Math.round(i * step)},${Math.round(24 - (v / max) * 20)}`)
    .join(' ');
  return (
    <svg className="fwc-spark" width="120" height="26" viewBox="0 0 120 26" aria-hidden="true">
      <polyline className={hot ? 'fwc-spark-hot' : 'fwc-spark-base'} points={points} />
    </svg>
  );
}

export function KitTile({
  value, label, sub, color, spark, sparkHot,
}: {
  value: React.ReactNode; label: React.ReactNode; sub?: React.ReactNode;
  color?: string; spark?: number[]; sparkHot?: boolean;
}) {
  return (
    <div className="fwc-tile">
      <span className="fwc-num" style={color ? { color } : undefined}>{value}</span>
      <span className="fwc-tile-label">{label}</span>
      {sub != null && <span className="fwc-tile-sub">{sub}</span>}
      {spark && <KitSpark values={spark} hot={sparkHot} />}
    </div>
  );
}

export function KitChip({ k, v }: { k: React.ReactNode; v: React.ReactNode }) {
  return (
    <span className="fwc-chip-stat">
      <span className="fwc-k">{k} </span>
      <span className="fwc-v">{v}</span>
    </span>
  );
}

// ---- mockup geometry math, shared by both tabs ----

/** Stacked day column: flagged part (min 2px when present) over neutral base.
 *  `plotH` is the usable pixel height (mockup: 92 in a 96px plot, 48 in 52). */
export function stackedColumn(
  total: number, flagged: number, max: number, plotH: number, flagColor: string,
): KitCol['parts'] {
  const totalH = Math.round((total / max) * plotH);
  const flaggedH = flagged > 0 ? Math.max(2, Math.round((flagged / max) * plotH)) : 0;
  const baseH = Math.max(0, totalH - flaggedH);
  const parts: KitCol['parts'] = [];
  if (flaggedH > 0) parts.push({ h: flaggedH, color: flagColor });
  parts.push({ h: baseH });
  return parts;
}
