// The import marker's input shape (evidence-gap register item 15, 2026-09-06).
// In types/ so the dashboard, the message union and the chain writer share
// one definition across the layering rule. What it means and why:
// src/forensics/import-marker.ts.

export interface ImportMarkerInput {
  /** Records added to the salvage store in this pass. */
  imported: number;
  /** Records the store already held. */
  alreadyPresent: number;
  /** Records refused (hash mismatch, or a signature that failed under a held key). */
  rejected: number;
  /** Signing-key fingerprints the imported records name, sorted. */
  epochs: string[];
  /** SHA-256 over the sorted ids of the records imported in this pass, joined by newline. */
  idsDigest: string;
}
