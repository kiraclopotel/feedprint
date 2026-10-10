// The redaction marker's input shape (evidence-gap register item 20, part 1,
// 2026-09-06, owner's yes the same day). In types/ so the dashboard, the
// message union and the chain writer share one definition across the layering
// rule. Meaning: src/forensics/redaction.ts.

export interface RedactionMarkerInput {
  /** The record withheld. */
  recordId: string;
  /** Its integrityHash, so the marker binds to those exact bytes. */
  recordHash: string;
  /** The fields withheld from every export and every dashboard view. */
  fields: string[];
  /** The parent's reason, at most 200 characters; may be empty. */
  reason: string;
}
