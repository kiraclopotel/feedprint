// The dashboard's chart colours, from the house system (docs/design/site-v6/DESIGN.md): two meaning colours and tones
// of ink. Noise marks a thing taken out of the feed; every other quantity is a tone of ink, told apart by its label,
// because a dozen technique and platform hues read as decoration and none of them carries a meaning a reader keeps.
// Each falls back to the old token so a page without the house sheet still draws.

export const TONE = {
  ink: 'var(--fw-ink, var(--fw-text))',
  mid: 'var(--fw-muted)',
  light: 'var(--fw-line, var(--fw-border))',
  noise: 'var(--fw-noise, var(--fw-red))',
  /** Receipts' own colour: a thing it wrote down and left as it was, the passed share. */
  record: 'var(--fw-record, var(--fw-teal))',
  /** A second taken-out quantity beside the first in one stacked bar. */
  noiseSoft: 'color-mix(in oklch, var(--fw-noise, var(--fw-red)) 50%, var(--fw-ground, var(--fw-bg)))',
} as const;
