// Cross-tab drill payload and the feed's serve-order dividers. Pure data
// and one pure function, shared by the Activity feed (Dashboard.tsx) and the
// tabs that emit a drill (OverviewTab, ExposureView, PatternsTab,
// StatisticsTab). Lives outside Dashboard.tsx so no tab component needs to
// import the shell for a type (madge cycle 5).

import type { ForensicRecord } from '../../../types/forensic';
import type { RecordGroup } from './PostGroupCard';
import { isMarkerOnlyGroup } from './marker-runs';

// Cross-tab drill-down (queue item 5): Statistics/Exposure bars jump to the
// Activity feed pre-filtered. `technique` carries CANONICAL names (the same
// keys techniqueFilter compares against).
export interface ActivityDrill {
  platform?: 'all' | ForensicRecord['platform'];
  technique?: string | null;
  /**
   * Optional hour-of-day range [startHour, endHour] (inclusive 0-23) the
   * Exposure late-night / Patterns surfaces drill into. Filters the feed to
   * records whose local hour falls within the range. Back-compat: undefined
   * leaves the hour filter off.
   */
  hourRange?: [number, number] | null;
  /**
   * Optional room URL (the post/video a recurring thread is rooted under) the
   * Patterns re-serve / repeated-room surfaces drill into. Filters the feed to
   * records whose `roomUrl`/`postUrl` matches. Back-compat: undefined leaves
   * the room filter off.
   */
  roomUrl?: string | null;
  /**
   * Optional explicit set of record ids to narrow the feed to (a pre-computed
   * result set, e.g. a Patterns cluster). Back-compat: undefined leaves the
   * id filter off.
   */
  recordIds?: string[] | null;
  /**
   * Optional verdict narrowing the emitting bar counted under ('flagged' for
   * a Statistics bar built from the flagged set), so the feed opened equals
   * the number clicked. Added 13 Sep 2026 (wiring audit, part 1, finding 4).
   * undefined leaves the verdict chip at 'all'.
   */
  verdict?: 'all' | 'flagged' | 'passed' | 'blocked' | null;
  /**
   * Optional explicit date window [sinceISO, untilISO), untilISO exclusive,
   * carried by an Exposure period bar so the drill keeps the period it was
   * counted over (finding 5). undefined leaves the when chip at 'any'.
   */
  since?: string | null;
  until?: string | null;
  /** Monotonic stamp so re-clicking the same bar re-applies the filter. */
  seq: number;
}


// ─── Serve-order + session-gap derivation (queue item 3) ───
// A new "session" begins after a quiet gap of ≥ SESSION_GAP_MIN minutes
// (default 30, per the wiring contract). A divider between two consecutive
// groups carries either a session break (long gap) or a platform switch
// (short gap, different platform). Both are derived purely from `latestTs`
// + `platform` of adjacent groups — no schema field. Groups are sorted
// newest-first; we read the gap from the OLDER group up to the NEWER one so
// the divider above a group describes the time since the previous (older)
// item the child was served.
export const SESSION_GAP_MIN = 30;

export interface FeedDivider {
  kind: 'session' | 'switch';
  /**
   * Seconds between the end of the previously served group and the start of
   * this one, or `null` when the two are not consecutive in serve order and
   * no honest number exists.
   */
  gapSeconds: number | null;
  /** Platform the reader moved away from. */
  fromPlatform: string;
  /** Platform the reader moved to. */
  toPlatform: string;
}

/**
 * Dividers for the whole feed, one slot per group, computed in one pass.
 *
 * Rewritten 2026-08-02. The previous version was wrong in three independent
 * ways and the third one hid the first two:
 *
 *  1. It measured `latestTs`, a WRITE time, while the feed sorts on seen time.
 *     The sort's own comment records that write order is completion order and
 *     is inverted against seen order for 14% of adjacent records.
 *  2. It assumed `groups[idx + 1]` is always the previously served item. That
 *     is only true ACROSS sessions. WITHIN a session the sort is deliberately
 *     ascending, oldest-seen first, so `idx + 1` is the item served NEXT, not
 *     the one served before. The subtraction ran backwards on every
 *     within-session pair.
 *  3. `Math.max(0, ...)` then clamped every one of those negative results to
 *     zero and printed it as a measured value. That is why a platform switch
 *     always read `+0s`: a switch can only fall at a session seam, and at a
 *     seam the pairing above is wrong in exactly the direction the clamp
 *     erases.
 *
 * The rule now: a divider names the gap between two CONSECUTIVELY SERVED
 * groups or it names no gap at all. Within a session the previous item is the
 * one above; at the top of a session block it is the LAST-served group of the
 * older session below. If the numbers still come out backwards, the invariant
 * is broken and `gapSeconds` is null so the surface says nothing rather than
 * inventing a zero.
 */
export function computeFeedDividers(groups: RecordGroup[]): (FeedDivider | null)[] {
  // Housekeeping records were not served by any feed, and their platform is a
  // storage slot ("twitter" for every heartbeat), so measured as served items
  // they put a false platform switch around every one of them. Dividers are
  // worked out over what was served, and a marker line gets none.
  const out: (FeedDivider | null)[] = new Array(groups.length).fill(null);
  const served: number[] = [];
  groups.forEach((g, i) => { if (!isMarkerOnlyGroup(g)) served.push(i); });
  const inner = servedDividers(served.map((i) => groups[i]));
  inner.forEach((d, j) => { out[served[j]] = d; });
  return out;
}

function servedDividers(groups: RecordGroup[]): (FeedDivider | null)[] {
  const out: (FeedDivider | null)[] = new Array(groups.length).fill(null);
  if (groups.length === 0) return out;

  // Session blocks, in render order. The sort guarantees each session's groups
  // are contiguous; this only finds the edges.
  const blocks: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < groups.length; i++) {
    if (i === 0 || groups[i].sessionKey !== groups[i - 1].sessionKey) {
      blocks.push({ start: i, end: i });
    } else {
      blocks[blocks.length - 1].end = i;
    }
  }
  const blockOfIndex = new Map<number, number>();
  blocks.forEach((b, bi) => { for (let i = b.start; i <= b.end; i++) blockOfIndex.set(i, bi); });

  for (let i = 0; i < groups.length; i++) {
    const cur = groups[i];
    const bi = blockOfIndex.get(i)!;
    let prev: RecordGroup | null = null;
    if (i > blocks[bi].start) {
      // Inside a session the sort is ascending, so the item above was served
      // first. This is the one pairing the old code got right by accident and
      // then subtracted backwards.
      prev = groups[i - 1];
    } else if (bi + 1 < blocks.length) {
      // Top of a session block. Sessions render newest first, so the reader
      // arrived here from the block BELOW, and the item they actually left is
      // that session's LAST-served group, not its first.
      prev = groups[blocks[bi + 1].end];
    }
    if (!prev) continue;

    const startMs = Date.parse(cur.firstSeenAt || cur.latestTs);
    const endMs = Date.parse(prev.lastSeenAt || prev.latestTs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    const raw = Math.round((startMs - endMs) / 1000);
    // Backwards means these two were not consecutive in serve order after all.
    // Say nothing rather than print a fabricated zero.
    const gapSeconds = raw >= 0 ? raw : null;

    if (gapSeconds !== null && gapSeconds >= SESSION_GAP_MIN * 60) {
      out[i] = { kind: 'session', gapSeconds, fromPlatform: prev.platform, toPlatform: cur.platform };
      continue;
    }
    if (cur.platform !== prev.platform) {
      out[i] = { kind: 'switch', gapSeconds, fromPlatform: prev.platform, toPlatform: cur.platform };
    }
  }
  return out;
}
