// Whether the dashboard speaks of the AI reading at all. A free install never meets the word: the reading is not on
// offer to it, and a filter, card or footnote about something a person cannot have reads as a fault or as an upsell.
// One function, so every place that hides the wording asks the same question.

import type { LicenseTier } from '../../storage/license';

/** null is "not read yet": nothing about the AI shows until the licence has been read. */
export function offersReading(tier: LicenseTier | null): boolean {
  return tier !== null && tier !== 'free';
}
