/**
 * Platform switches as a countable event, and the after-switch window against
 * the baseline (capability audit 2026-09-06, P1 item 6). The first cross-
 * platform number the record can support honestly: no new field, no claim
 * about serve order or intent, only what the recorder observed in time order.
 *
 * A switch is two consecutive content records, in timestamp order, on
 * different platforms, inside one sitting (gap under SESSION_GAP_MIN minutes,
 * the same rule the Activity dividers use). A gap of a sitting or more is a
 * new sitting, not a switch. The after-switch window is the first
 * `windowSize` content records on the new platform after a switch, cut short
 * by the next switch or sitting boundary. The baseline is every content
 * record outside any window. Both shares carry k, n and a Wilson interval.
 *
 * Content pool and flag rule: the Statistics balance rule (environment and
 * system markers out; pass, blocked and the flagged family decided; a record
 * with no verdict counts as flagged because those predate the field).
 */
import type { ForensicRecord } from '../types/forensic';
import { isSystemMarkerRecord } from './system-records';
import { isPaidPlacement } from './paid-placement';
import { isCountedFlagVerdict } from './flag-verdict';
import { wilson, type Share } from './wilson';

const DEFAULT_SWITCH_WINDOW = 5;
const DEFAULT_SITTING_GAP_MIN = 30;

interface PlatformSwitchPair {
  from: string;
  to: string;
  count: number;
}

export interface PlatformSwitchSignal {
  /** Content records that entered the count (the denominator of everything below). */
  content: number;
  /** Switches observed inside sittings. */
  switches: number;
  /** Switches by direction, most first. */
  pairs: PlatformSwitchPair[];
  /** Records considered per window. */
  windowSize: number;
  /** Flagged share inside after-switch windows, or null when there was no switch. */
  window: Share | null;
  /** Flagged share of content records outside every window, or null when nothing is outside. */
  baseline: Share | null;
  /** Ids of the records inside windows, for a drill. */
  windowRecordIds: string[];
}

function isContent(r: ForensicRecord): boolean {
  if (r.kind === 'environment' || isSystemMarkerRecord(r)) return false;
  const v = r.verdict;
  // "Seen a lot" was not read, so it is on neither side of the share (as on the Statistics page).
  return v === 'pass' || v === 'masked' || v === 'blocked' || isCountedFlagVerdict(r);
}

/** Flagged, minus advertising (standing decision 1, 2026-09-14). A platform
 *  whose feed is mostly ads would otherwise read as the platform whose feed is
 *  mostly flagged, which is the reverse of what this signal is for. */
function isFlagged(r: ForensicRecord): boolean {
  if (isPaidPlacement(r)) return false;
  return isCountedFlagVerdict(r);
}

export function computePlatformSwitches(
  records: ForensicRecord[],
  opts: { windowSize?: number; sittingGapMin?: number } = {},
): PlatformSwitchSignal {
  const windowSize = Math.max(1, Math.floor(opts.windowSize ?? DEFAULT_SWITCH_WINDOW));
  const gapMs = Math.max(0, opts.sittingGapMin ?? DEFAULT_SITTING_GAP_MIN) * 60_000;

  const ordered = records
    .filter((r) => isContent(r) && Number.isFinite(Date.parse(r.timestamp)))
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const pairCounts = new Map<string, PlatformSwitchPair>();
  const inWindow = new Set<string>();
  let switches = 0;
  let remaining = 0; // records still to take into the current window

  for (let i = 0; i < ordered.length; i++) {
    const cur = ordered[i];
    const prev = i > 0 ? ordered[i - 1] : null;
    const sameSitting = prev !== null && Date.parse(cur.timestamp) - Date.parse(prev.timestamp) < gapMs;
    if (!sameSitting) {
      remaining = 0; // a new sitting closes any open window
    } else if (prev && prev.platform !== cur.platform) {
      switches++;
      const key = `${prev.platform}>${cur.platform}`;
      const pair = pairCounts.get(key);
      if (pair) pair.count++; else pairCounts.set(key, { from: prev.platform, to: cur.platform, count: 1 });
      remaining = windowSize; // a switch opens a window (and closes the previous one)
    }
    if (remaining > 0) {
      inWindow.add(cur.id);
      remaining--;
    }
  }

  let wk = 0, wn = 0, bk = 0, bn = 0;
  for (const r of ordered) {
    if (inWindow.has(r.id)) { wn++; if (isFlagged(r)) wk++; }
    else { bn++; if (isFlagged(r)) bk++; }
  }

  return {
    content: ordered.length,
    switches,
    pairs: [...pairCounts.values()].sort((a, b) => b.count - a.count || a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    windowSize,
    window: wilson(wk, wn),
    baseline: wilson(bk, bn),
    windowRecordIds: ordered.filter((r) => inWindow.has(r.id)).map((r) => r.id),
  };
}
