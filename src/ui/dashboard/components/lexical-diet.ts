// Patterns-tab data layer — the "emotional diet" lexical league table.
//
// DETERMINISTIC + FREE: re-derives profanity/slur term frequencies from the
// text already on the forensic chain — no AI call, no new capture, nothing
// the device hasn't already recorded. Answers the parent's "which words
// dominated my child's feed this <window>?" by running the SAME matcher the
// protection path uses (src/core/profanity-filter.ts) over each record's
// captured text surfaces, then tallying canonical dictionary terms.
//
// The aggregated surfaces are the three the child was actually exposed to:
//   • originalText            — typed post/comment/reply text
//   • videoContext.overlayText — burned-in on-screen text
//   • videoContext.transcript  — speech-to-text of the audio track
// videoContext.scene is deliberately EXCLUDED: it is the vision model's own
// neutral prose ABOUT the video, not language the child saw or heard, so
// counting it would attribute the model's words to the feed.
//
// Pure transform: ForensicRecord[] -> SwearLeagueEntry[]. Unit-testable
// without mounting React (same pattern as group-records.ts / metric-growth.ts).

import type { ForensicRecord } from '../../../types/forensic';
import { filterProfanity, type ProfanityTier } from '../../../core/profanity-filter';

export interface SwearLeagueEntry {
  /** Canonical dictionary term — inflections fold to the stem (fucking → fuck). */
  term: string;
  /** Whether the term is an identity slur or casual profanity. */
  tier: 'slur' | 'profanity';
  /** Total occurrences across every matched text surface in range. */
  count: number;
  /**
   * Distinct record ids carrying the term, newest-first. The aggregate clicks
   * down to these (Patterns copy rule: every number names verifiable members).
   */
  recordIds: string[];
  /** ISO timestamp of the most recent record carrying the term. */
  lastSeen: string;
  /** Distinct platforms the term was seen on, sorted. */
  platforms: string[];
}

export interface LexicalDietOptions {
  /** Lower bound (ISO). Records with timestamp < since are skipped. */
  since?: string;
  /** Upper bound (ISO). Records with timestamp > until are skipped. */
  until?: string;
}

interface Tally {
  term: string;
  tier: 'slur' | 'profanity';
  count: number;
  /** id → newest timestamp seen for that record (drives newest-first order). */
  recordTs: Map<string, string>;
  lastSeen: string;
  platforms: Set<string>;
}

// The two disjoint dictionaries, paired with the tier label each match earns.
// Running the matcher once per tier lets every term carry its own tier without
// re-deriving membership (the slur and profanity word lists never overlap).
const TIER_PASSES: ReadonlyArray<{ label: 'slur' | 'profanity'; filterTier: ProfanityTier }> = [
  { label: 'slur', filterTier: 'slurs' },
  { label: 'profanity', filterTier: 'profanity' },
];

/** The captured text surfaces a child was actually exposed to in one record. */
function recordTextSurfaces(r: ForensicRecord): string[] {
  const out: string[] = [];
  if (r.originalText) out.push(r.originalText);
  if (r.videoContext?.overlayText) out.push(r.videoContext.overlayText);
  if (r.videoContext?.transcript) out.push(r.videoContext.transcript);
  return out;
}

export function buildSwearLeagueTable(
  records: ForensicRecord[],
  opts: LexicalDietOptions = {},
): SwearLeagueEntry[] {
  const tallies = new Map<string, Tally>();

  for (const r of records) {
    if (opts.since && r.timestamp < opts.since) continue;
    if (opts.until && r.timestamp > opts.until) continue;

    const surfaces = recordTextSurfaces(r);
    if (surfaces.length === 0) continue;

    for (const { label, filterTier } of TIER_PASSES) {
      for (const text of surfaces) {
        // mode only governs rewrite-vs-flag, never WHICH terms match, so the
        // 'child' literal is an arbitrary deterministic choice here.
        const { matches } = filterProfanity(text, 'child', { tier: filterTier });
        for (const term of matches) {
          let t = tallies.get(term);
          if (!t) {
            t = {
              term,
              tier: label,
              count: 0,
              recordTs: new Map(),
              lastSeen: r.timestamp,
              platforms: new Set(),
            };
            tallies.set(term, t);
          }
          t.count++;
          t.recordTs.set(r.id, r.timestamp);
          if (r.timestamp > t.lastSeen) t.lastSeen = r.timestamp;
          if (r.platform) t.platforms.add(r.platform);
        }
      }
    }
  }

  return [...tallies.values()]
    .map((t) => ({
      term: t.term,
      tier: t.tier,
      count: t.count,
      recordIds: [...t.recordTs.entries()]
        .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0))
        .map(([id]) => id),
      lastSeen: t.lastSeen,
      platforms: [...t.platforms].sort(),
    }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
}
