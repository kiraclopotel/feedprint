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
  /**
   * The exposure notice's own counters (13 Oct 2026). The three above counted every surface for ever, so a channel the
   * person subscribes to and a source the feed pushes read the same; the gate no longer reads them and nothing writes
   * them. A profile written before this change keeps them and starts these from empty.
   *
   * `recDays` are the UTC days (`YYYY-MM-DD`, each once, ascending, the last 30) on which the source reached the
   * person on the recommended feed; a visit the person made themselves (a followed feed, a profile, a thread they
   * opened, a search, a watch page) empties them, so the count means "pushed since you last went to it".
   * `creativeDays` are, for each piece of copy, the days of its last EXPOSURE_SAME_CREATIVE recommended sightings (a
   * day may repeat). `lastNoticedDay` is the day the notice last spoke for this source, kept here so a second tab or a
   * reload stays quiet.
   */
  recDays?: string[];
  creativeDays?: Record<string, string[]>;
  lastNoticedDay?: string;
}
