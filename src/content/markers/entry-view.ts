// Which view a flagged post or comment opens on. One marker, one walk, three entry points (12 Oct 2026):
//   Silent (child)  opens on the rewrite, with no mark;
//   Calm (teen)     opens on the rewrite, green, and a tap goes to the reason and then the original;
//   Open (adult)    opens on the author's own words, red, and a tap goes to the reason and then the calm version.
// The original is offered behind a mark only where there is a mark to press: with the mark switched off, Open shows the
// rewrite as it did before the walk existed, since nothing on the page could carry the tap that gives the original back.

import type { Mode } from '../../types/mode';

export function opensOnOriginal(mode: Mode, markShown: boolean): boolean {
  return mode === 'adult' && markShown;
}
