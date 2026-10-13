// The dashboard's chart colours, from the house system (docs/design/site-v6/DESIGN.md): two meaning colours and tones
// of ink. Noise marks a thing taken out of the feed; every other quantity is a tone of ink, told apart by its label,
// because a dozen technique and platform hues read as decoration and none of them carries a meaning a reader keeps.
// Each falls back to the old token so a page without the house sheet still draws.

export const TONE = {
  ink: 'var(--fw-ink, var(--fw-text))',
  mid: 'var(--fw-muted)',
  /** A neutral quantity drawn as a bar: 3:1 and above against the card (row 6, 12 Oct 2026); hairlines keep --fw-line. */
  light: 'var(--fwc-neutral, var(--fw-line, var(--fw-border)))',
  /** Flagged, in the colour the Feed log, the pills and the usage bar give it (row 4, 12 Oct 2026). */
  flagged: 'var(--fw-warn, var(--fw-amber))',
  noise: 'var(--fw-noise, var(--fw-red))',
  /** Receipts' own colour: a thing it wrote down and left as it was, the passed share. */
  record: 'var(--fw-record, var(--fw-teal))',
  /** A second taken-out quantity beside the first in one stacked bar. */
  noiseSoft: 'color-mix(in oklch, var(--fw-noise, var(--fw-red)) 50%, var(--fw-ground, var(--fw-bg)))',
  /** The tone of the comment sections, a diverging scale (his walk of 12 Oct 2026: three greys read as nothing). */
  tonePos: 'var(--fw-tone-pos, var(--fw-ink))',
  toneNeu: 'var(--fw-tone-neu, var(--fw-muted))',
  toneNeg: 'var(--fw-tone-neg, var(--fw-line))',
} as const;
