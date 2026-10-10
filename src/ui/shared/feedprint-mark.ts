// The Feedprint mark, the fp tile, as numbers: the same drawing the toolbar and store icons are exported from
// (docs/design/logos/round3/marks/fp.svg, made into PNGs by docs/design/logos/icons/export-icons.mjs). The popup and
// the dashboard draw it inline from here. A test reads fp.svg and fails when any number below differs from it, so a
// change to the icon cannot leave the extension's own pages showing an older mark.

export const FP_VIEWBOX = 48;
// The pages' Mark shows the tile without the icon's empty margin, keeping one unit on each side so the tile's edge
// and the letters' shadow are not clipped.
export const FP_MARK_VIEWBOX = '3 3 42 42';

// The rounded tile and its two fills: the purple gradient, then a light-to-dark sheen over it.
export const FP_TILE = { x: 4, y: 4, width: 40, height: 40, rx: 9 } as const;
export const FP_FILL = {
  x1: 0, y1: 0, x2: 48, y2: 48,
  stops: [[0, '#ad95ff', 1], [0.55, '#6b4dff', 1], [1, '#3516bd', 1]],
} as const;
export const FP_SHEEN = {
  x1: 0, y1: 2, x2: 0, y2: 46,
  stops: [[0, '#fff', 0.4], [0.1, '#fff', 0.14], [0.5, '#fff', 0], [0.78, '#000', 0], [1, '#000', 0.22]],
} as const;
export const FP_SHADOW = { dx: 0, dy: 0.9, stdDeviation: 0.7, floodColor: '#000', floodOpacity: 0.3 } as const;

// The letters f and p, white strokes placed on the tile by one transform.
export const FP_LETTERS_TRANSFORM = 'translate(24 24) scale(0.6879) translate(-15.699999999999996 -27.5)';
export const FP_LETTERS = [
  { d: 'M3 36 V18.5 A6 6 0 0 1 9 12.5 H10 M-0.5 21.6 H7', strokeWidth: 7.849999999999999 },
  { d: 'M19.799999999999997 42 V21.6 M19.799999999999997 28.8 a5.8 7.2 0 1 0 11.6 0 a5.8 7.2 0 1 0 -11.6 0', strokeWidth: 7.849999999999999 },
] as const;
