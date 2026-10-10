// The repair marker's input shape (evidence-gap register item 18, 2026-09-06).
// In types/ so the dashboard, the message union and the chain writer share
// one definition across the layering rule. Meaning: src/forensics/repair-marker.ts.

export interface RepairMarkerInput {
  /** When the repair ran, from the heal log. */
  at: string;
  /** 'position-solve': the relegation position recovery; 'reanchor': the pre-2026-06-11 re-anchor. */
  method: 'position-solve' | 'reanchor';
  /** Records whose stored hash matched a recovered position, or records relegated by the re-anchor. */
  repairedCount: number;
  /** Records no candidate matched; left as they were. */
  unrepairedCount: number;
  /** False when the run itself failed; `error` then names it. */
  healed: boolean;
  error?: string;
}
