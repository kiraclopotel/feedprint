// The gap marker's input shape (evidence-gap register item 9, 2026-09-06).
// Lives in types/ so the content ledger, the message union and the chain
// writer share one definition across the layering rule. What each reason and
// count mean: src/forensics/gap-marker.ts.

import type { Platform } from './post';

export type GapReason =
  | 'retry-overflow'
  | 'retry-exhausted'
  | 'delivery-quarantined'
  | 'backlog-overflow'
  | 'backlog-hidden'
  | 'recorder-down'
  | 'churn-breaker'
  | 'heap-valve'
  | 'context-invalidated'
  | 'chain-lost'
  | 'key-replaced';

/** Why the signing key changed under the chain: the origin ledger's words, or the restore's. */
export type KeyReplacedOrigin = 'generated-storage-empty' | 'restored-from-backup' | 'records-restored' | 'unknown';

export type GapUnit = 'records' | 'nodes' | 'events';

export interface GapMarkerInput {
  reason: GapReason;
  /** The platform the loss happened on; 'unknown' when the loss site has none. */
  platform: Platform | 'unknown';
  count: number;
  unit: GapUnit;
  fromISO: string;
  toISO: string;
  /**
   * `chain-lost` only: the two halves of what went, stated separately, because
   * one number cannot carry them. The active chain is capped and re-based every
   * month, so its height describes the current month; the archives hold every
   * month before it and die in the same eviction. `archivedRecords` is null
   * when the months were known to exist and their size was never counted.
   *
   * Appended to the hashed line only when present, so no marker written before
   * this field existed hashes any differently.
   */
  lost?: { chainPositions: number; archivedMonths: number; archivedRecords: number | null };
  /**
   * `key-replaced` only: the fingerprint that signed the chain's newest record before the change,
   * the one that signs from this marker on, and why. Appended to the hashed line only when present.
   */
  key?: { previous: string; next: string; origin: KeyReplacedOrigin };
}
