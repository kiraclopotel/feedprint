// "How groups behave" — per-group aggregate over the forensic records (slice 2).
//
// Groups the records the child saw by `sourceContainer` (the Facebook group
// name, set only on accountType==='group' records). For each group it reports
// what the parent asked to see: how many posts were seen, how many FW flagged,
// the average severity of the flagged ones, and the most common technique.
//
// Pure + display-only — reuses the same flagged-set + peak-severity conventions
// as FeedCard / computeStats so the panel agrees with the rest of the dashboard.

import type { ForensicRecord } from '../../../types/forensic';
import { isFlaggedItem } from '../record-sets';
import { canonicalizeTechniqueForStats } from '../../../forensics/technique-canonical';

export interface GroupBehavior {
  /** The group's name (sourceContainer). */
  name: string;
  /** Distinct records seen that lived in this group. */
  postsSeen: number;
  /** How many of them FW flagged (flagged / flagged-hidden / the legacy no-verdict record). */
  flaggedCount: number;
  /** Mean peak-severity across the flagged records (0-10), or null if none flagged. */
  avgSeverity: number | null;
  /** Most frequent technique name across the flagged records, or null. */
  dominantTechnique: string | null;
}

// The same reading of "flagged" the Overview, Statistics and the Activity
// badge use (record-sets.ts isFlaggedItem): a record with no verdict
// predates the field and was only ever written when flagged. This panel had
// its own narrower copy (wiring audit 13 Sep, D2-14).
const isFlagged = isFlaggedItem;

function peakSeverity(r: ForensicRecord): number {
  return (r.techniques ?? []).reduce((mx, t) => Math.max(mx, t.severity ?? 0), 0);
}

/**
 * Aggregate the records by their Facebook group, sorted by flagged count
 * (desc), then posts seen (desc), then name. Records without a group container
 * are ignored.
 */
export function computeGroupBehavior(records: ForensicRecord[]): GroupBehavior[] {
  const byGroup = new Map<string, ForensicRecord[]>();
  for (const r of records) {
    if (r.accountType !== 'group' || !r.sourceContainer) continue;
    const bucket = byGroup.get(r.sourceContainer);
    if (bucket) bucket.push(r);
    else byGroup.set(r.sourceContainer, [r]);
  }

  const out: GroupBehavior[] = [];
  for (const [name, recs] of byGroup) {
    const flagged = recs.filter(isFlagged);
    const severities = flagged.map(peakSeverity);
    const avgSeverity = severities.length > 0
      ? Math.round((severities.reduce((a, b) => a + b, 0) / severities.length) * 10) / 10
      : null;

    const techFreq = new Map<string, number>();
    for (const r of flagged) {
      for (const t of r.techniques ?? []) {
      // Canonicalised, the way StatisticsTab has always done it (2026-09-19).
      // The judge drifts between spellings of one technique, which is why
      // technique-canonical.ts exists and why its map is full of Romanian:
      // 'genuine-opinie' and 'opinie sinceră' are 'genuine-opinion', 'batjocură'
      // is 'mockery'. Counting the raw name splits one technique's votes across
      // its spellings, so a dominant technique can be named wrongly, and the
      // label falls through to the raw id because PRETTY_TECHNIQUE is keyed on
      // the canonical names.
        const name = canonicalizeTechniqueForStats(t.name);
        techFreq.set(name, (techFreq.get(name) ?? 0) + 1);
      }
    }
    let dominantTechnique: string | null = null;
    let max = 0;
    for (const [tech, n] of techFreq) {
      if (n > max) { max = n; dominantTechnique = tech; }
    }

    out.push({ name, postsSeen: recs.length, flaggedCount: flagged.length, avgSeverity, dominantTechnique });
  }

  out.sort((a, b) =>
    b.flaggedCount - a.flaggedCount || b.postsSeen - a.postsSeen || a.name.localeCompare(b.name));
  return out;
}
