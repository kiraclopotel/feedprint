// FeelingWise — brand assets as React components.
//
// Inline SVGs: zero asset request, scale perfectly, no flash of unstyled
// content, work offline at popup mount. Feedprint's mark is the fp tile, drawn
// from the numbers in feedprint-mark.ts, which a test holds equal to the SVG the
// toolbar and store icons are exported from, so the pages and the icons match.

import { CSSProperties, useId } from 'react';
import {
  FP_FILL, FP_LETTERS, FP_LETTERS_TRANSFORM, FP_MARK_VIEWBOX, FP_SHADOW, FP_SHEEN, FP_TILE, FP_VIEWBOX,
} from './feedprint-mark';

interface BrandProps {
  size?: number;
  style?: CSSProperties;
  className?: string;
}

// The gradient and shadow ids are per drawing: the popup and the dashboard can
// show the mark more than once, and two equal ids on one page let one drawing
// borrow the other's fill. useId's characters are trimmed to the ones url(#…)
// accepts.
function useMarkIds(): { fill: string; sheen: string; shadow: string } {
  const id = useId().replace(/[^A-Za-z0-9_-]/g, '');
  return { fill: `fp-fill-${id}`, sheen: `fp-sheen-${id}`, shadow: `fp-shadow-${id}` };
}

function FpTile({ ids }: { ids: { fill: string; sheen: string; shadow: string } }) {
  const stops = (list: readonly (readonly [number, string, number])[]) =>
    list.map(([offset, color, opacity]) => <stop key={offset} offset={offset} stopColor={color} stopOpacity={opacity} />);
  return (
    <>
      <defs>
        <linearGradient id={ids.fill} gradientUnits="userSpaceOnUse" x1={FP_FILL.x1} y1={FP_FILL.y1} x2={FP_FILL.x2} y2={FP_FILL.y2}>
          {stops(FP_FILL.stops)}
        </linearGradient>
        <linearGradient id={ids.sheen} gradientUnits="userSpaceOnUse" x1={FP_SHEEN.x1} y1={FP_SHEEN.y1} x2={FP_SHEEN.x2} y2={FP_SHEEN.y2}>
          {stops(FP_SHEEN.stops)}
        </linearGradient>
        <filter id={ids.shadow} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow dx={FP_SHADOW.dx} dy={FP_SHADOW.dy} stdDeviation={FP_SHADOW.stdDeviation} floodColor={FP_SHADOW.floodColor} floodOpacity={FP_SHADOW.floodOpacity} />
        </filter>
      </defs>
      <g fill={`url(#${ids.fill})`}><rect {...FP_TILE} /></g>
      <g fill={`url(#${ids.sheen})`}><rect {...FP_TILE} /></g>
      <g fill="#fff" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${ids.shadow})`}>
        <g transform={FP_LETTERS_TRANSFORM}>
          {FP_LETTERS.map((l) => <path key={l.d} d={l.d} fill="none" stroke="#fff" strokeWidth={l.strokeWidth} />)}
        </g>
      </g>
    </>
  );
}

// Mark: the fp tile alone. The dashboard header carries the product through it.
export function Mark({ size = 32, style, className }: BrandProps) {
  const ids = useMarkIds();
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={FP_MARK_VIEWBOX} width={size} height={size} fill="none" style={style} className={className} aria-hidden="true">
      <FpTile ids={ids} />
    </svg>
  );
}

// Wordmark: the fp tile and the product's name, 320x64 viewBox, used in the
// popup header.
//
// The text uses `fill="currentColor"` and the SVG inherits its color from
// `var(--fw-text)`, so the wordmark flips with the theme; the tile carries its
// own colours and reads on either.
export function Wordmark({ size = 32, style, className }: BrandProps) {
  const ids = useMarkIds();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 320 64"
      width={(size * 320) / 64}
      height={size}
      fill="none"
      style={{ color: 'var(--fw-text)', ...style }}
      className={className}
      // aria-label on a bare <svg> is not reliably exposed without an
      // explicit role (accessibility audit, 2026-09-18): most screen readers
      // only look for an accessible name on elements whose role already
      // carries one, and an <svg> with no role is not among them.
      role="img"
      aria-label="Feedprint by FeelingWise"
    >
      <g transform={`scale(${64 / FP_VIEWBOX})`}>
        <FpTile ids={ids} />
      </g>
      {/* The name is the header's largest word and the byline can be read (the polish read of 12 Oct 2026, row 1): at
          28 px tall they were 10.5 px and 5.25 px type, smaller than the tabs. */}
      <text
        x="74" y="31"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="30" fontWeight="600" letterSpacing="-0.4"
        fill="currentColor"
      >
        Feedprint
      </text>
      <text
        x="74" y="54"
        fontFamily="system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
        fontSize="19" fontWeight="500" letterSpacing="0.2"
        fill="currentColor" opacity="0.8"
      >
        by FeelingWise
      </text>
    </svg>
  );
}
