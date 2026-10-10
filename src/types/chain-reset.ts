// ResetChainResult: the shape, with no behavior attached.
//
// It was declared in src/forensics/store.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

export interface ResetChainResult {
  recordsCleared: number;
  /**
   * Records copied into month archives before the clear. A reset no longer
   * destroys the record; it retires it. `archiveFailedReason` is set instead
   * when the copy could not be made, in which case NOTHING was cleared.
   */
  recordsArchived?: number;
  /**
   * Of `recordsArchived`, the rows that did not decode on this install. They
   * were moved as the bytes they were stored as rather than left to block the reset.
   */
  recordsCarriedUndecoded?: number;
  archiveFailedReason?: string;
  signingIdentityRetained: boolean;
  // Full-state reset also wipes these surfaces
  // so the dashboard "Reset" matches the user's expectation of clearing
  // everything FW has done. Booleans (not counts) because each underlying
  // store either succeeds or swallows-and-warns; counts would require an
  // extra round-trip per store for marginal informational value.
  scanLogCleared: boolean;
  authorProfilesCleared: boolean;
  verdictsCleared: boolean;
  // pipelineV3Cleared removed.
  diagnosticsCleared: boolean;
  usageStatsCleared: boolean;
  // True for every resolved reset. Marker preparation or atomic cutover
  // failure rejects the reset and leaves the source chain untouched.
  resetMarkerWritten: boolean;
  parentFeedbackCleared: boolean;
  /**
   * True iff the RFC 3161 chain-anchor sidecar was cleared. Anchors
   * reference chainPosition + integrityHash from the chain — surviving
   * anchors post-reset would point at deleted records (orphan rows). This
   * field surfaces the clear's success to the dashboard so an unexpected
   * false value is visible.
   */
  chainAnchorsCleared: boolean;
}
