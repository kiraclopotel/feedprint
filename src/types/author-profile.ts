// AuthorProfile: the shape, with no behavior attached.
//
// It was declared in src/forensics/author-store.ts, and src/types/messages.ts imported it from there, which made the
// types layer depend on a layer above it (PLAN-2026-09-16 item 8.6). The module keeps its logic and
// re-exports this name, so nothing that imports it had to change.

export interface AuthorProfile {
  /** IDB key: `${handle}@${platform}` so the same handle on two platforms is two profiles. */
  profileKey: string;
  handle: string;
  platform: string;
  totalSeen: number;
  totalFlagged: number;
  techniques: Record<string, number>;
  firstSeen: string;
  lastSeen: string;
  /**
   * Exposure counters. Optional because profiles written before this field
   * existed stay readable — every consumer defaults them, so no DB version
   * bump is needed and no counts are dropped.
   *
   * `distinctDays` counts calendar days (UTC) on which this source reached
   * the reader at all, not sightings. `creatives` counts sightings of one
   * exact piece of copy, so nine adverts aired forty times read as nine
   * entries, not forty.
   */
  distinctDays?: number;
  lastSeenDay?: string;
  creatives?: Record<string, number>;
}
