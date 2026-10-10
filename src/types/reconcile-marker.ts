// The reconciliation marker's input shape (evidence-gap register item 10,
// 2026-09-06). In types/ so the dashboard, the message union and the chain
// writer share one definition across the layering rule. Meaning:
// src/forensics/reconcile-marker.ts.
//
// Why a ninth marker kind rather than one of the eight. The gap marker states
// a bound on what was lost; the heartbeat states that the recorder was alive
// over a window. A reconciliation states neither: it says an outside document
// was compared against the record on a given day, and how much of the record
// that document supports. Putting it in gap-marker's reason list would make
// "reason=reconciled" a lie about what a gap marker means, and the heartbeat
// is written by an alarm on its own schedule and cannot carry a thing a parent
// did once. So it is its own kind, and it is the ninth and last for this
// register.
//
// Nothing here names a person, a post, an author or a file. The digest
// identifies which document was used without keeping any of it.

export interface ReconcileMarkerInput {
  /**
   * SHA-256 over the DECODED TEXT of the files that were opened, joined in the
   * order the picker handed them over and separated by a NUL byte. Not a hash
   * of the archive as the platform sent it, and not a hash of any one file:
   * it is a fingerprint of this reading of this selection. Its use is that the
   * same person can re-open the same files and reach the same value, so a
   * comparison can be repeated and shown to have been run over the same input.
   * Corrected 2026-09-18, when this field's own comment said "bytes" and the
   * export told every reader that the platform's copy would produce it.
   */
  archiveDigest: string;
  /** The platforms whose archives were read, sorted. */
  platforms: string[];
  /** The window the archive itself covers. */
  fromISO: string;
  toISO: string;
  /** How far apart an archive instant and a capture could be and still be the same sighting. */
  windowMinutes: number;
  /** Records the archive supports, by an address on both sides. */
  corroboratedByUrl: number;
  /** Records the archive supports, by author and time only. */
  corroboratedByAuthorAndTime: number;
  /** Sightings inside the compared period that the archive does not mention. */
  unmatchedRecords: number;
  /** Things the archive lists inside the compared period that the recorder has no record of. */
  unmatchedArchiveItems: number;
  /** Records outside the period the archive covers; neither side speaks for these. */
  recordsOutsideWindow: number;
  /**
   * The four fields below are optional for one reason only: a marker written
   * before 2026-09-18 does not carry them, and reconcileMarkerText appends
   * each one only when it is present, so every line written before that date
   * still renders byte for byte as it was hashed and signed. Anything the
   * dashboard writes from now on carries all four.
   */
  /**
   * Things the archive lists from outside the period the recorder itself
   * covers. Before 2026-09-18 these sat inside unmatchedArchiveItems, so a
   * week-old install reading a ninety-day export reported eighty-three days of
   * the platform's own impressions as things the recorder had no record of.
   */
  archiveItemsOutsideCoverage?: number;
  /**
   * Chain-housekeeping markers left out before counting. They carry no author
   * and no address and can never match, so before 2026-09-18 every one of them
   * was added to unmatchedRecords. Naming the number is how the marker says
   * what population the counts are over.
   */
  systemMarkersExcluded?: number;
  /**
   * The period the counts are over: where the archive's window and the
   * recorder's own coverage overlap. fromISO and toISO above are the archive's
   * window alone and are wider than this whenever the install is younger than
   * the export.
   */
  comparedFromISO?: string;
  comparedToISO?: string;
}
