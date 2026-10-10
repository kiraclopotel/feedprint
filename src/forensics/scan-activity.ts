// FeelingWise — scan-activity summarizer (pure).
//
// The scan-log (src/forensics/scan-log.ts, IDB `feelingwise-scans`) records
// EVERY post the pipeline processed — the denominator without which we only
// ever see the numerator (posts acted on) and can't state a real rate. This
// turns the raw event list into an honest "what happened on the feeds today"
// summary for the debug tab: how many posts were scanned, how many got a
// protective action, and the per-platform / per-feed breakdown.
//
// HONESTY NOTE: a 'cancelled' event (a scan that did NOT complete — AI
// failure / stale-queue cancel, common on the free tier) must never be
// folded into a "flagged" count — that would overstate protection. This
// summarizer keeps `cancelled` SEPARATE so "acted-on %" is computed only over
// scans that actually finished. Pure — operates on the event list the
// dashboard reads via getScanEvents(); no IDB, no chrome, no Date math beyond
// reading the already-stored hour.
//
// PRIVACY: deliberately excludes per-author breakdown (handles are content) —
// the threat-landscape/author view is a separate, later panel. Counts only.

import type { ScanEvent } from './scan-log';

/** Actions that represent FW taking a protective step on a post. */
const PROTECTIVE_ACTIONS: ReadonlySet<ScanEvent['action']> = new Set([
  'neutralize', 'collapse', 'hide', 'mark',
  'comments-hidden', 'comments-educational', 'comments-rewritten',
]);

interface ScanGroupActivity {
  key: string;
  scanned: number;
  actedOn: number;
  /** actedOn / (scanned - cancelled in this group) × 100, rounded; 0 when none completed. */
  actedPct: number;
}

export interface ScanActivitySummary {
  totalScanned: number;
  /** Posts left as-is (action 'pass'). */
  passed: number;
  /** Posts that got a protective action (softened / hidden / marked / collapsed). */
  actedOn: number;
  /** Scans that did NOT complete (AI failure / stale-queue cancel) — not a flag. */
  cancelled: number;
  /** actedOn / (totalScanned - cancelled) × 100, rounded; 0 when nothing completed. */
  actedPct: number;
  /** Per-platform, sorted by scanned desc. */
  platforms: ScanGroupActivity[];
  /** Per-feed-source, sorted by scanned desc. */
  feedSources: ScanGroupActivity[];
  /** Hour (0–23 local) with the most scans, or null when no events. */
  busiestHour: number | null;
}

interface Tally { scanned: number; actedOn: number; cancelled: number }

function newTally(): Tally { return { scanned: 0, actedOn: 0, cancelled: 0 }; }

function groupPct(t: Tally): number {
  const completed = t.scanned - t.cancelled;
  return completed > 0 ? Math.round((t.actedOn / completed) * 100) : 0;
}

function toGroups(map: Map<string, Tally>): ScanGroupActivity[] {
  return Array.from(map.entries())
    .map(([key, t]): ScanGroupActivity => ({ key, scanned: t.scanned, actedOn: t.actedOn, actedPct: groupPct(t) }))
    .sort((a, b) => b.scanned - a.scanned || a.key.localeCompare(b.key));
}

/**
 * Summarize scan-log events into an honest activity report. Pure. Pass the
 * list straight from `getScanEvents()`.
 */
export function summarizeScanActivity(events: ScanEvent[]): ScanActivitySummary {
  const byPlatform = new Map<string, Tally>();
  const byFeed = new Map<string, Tally>();
  const byHour = new Array<number>(24).fill(0);

  let passed = 0, actedOn = 0, cancelled = 0;

  for (const e of events) {
    const isProtective = PROTECTIVE_ACTIONS.has(e.action);
    const isCancelled = e.action === 'cancelled';
    if (e.action === 'pass') passed++;
    else if (isCancelled) cancelled++;
    else if (isProtective) actedOn++;

    const pt = byPlatform.get(e.platform) ?? newTally();
    pt.scanned++; if (isProtective) pt.actedOn++; if (isCancelled) pt.cancelled++;
    byPlatform.set(e.platform, pt);

    const fsKey = e.feedSource || 'unknown';
    const ft = byFeed.get(fsKey) ?? newTally();
    ft.scanned++; if (isProtective) ft.actedOn++; if (isCancelled) ft.cancelled++;
    byFeed.set(fsKey, ft);

    const hour = new Date(e.timestamp).getHours();
    if (hour >= 0 && hour <= 23) byHour[hour]++;
  }

  const totalScanned = events.length;
  const completed = totalScanned - cancelled;

  let busiestHour: number | null = null;
  let busiestCount = -1;
  for (let h = 0; h < 24; h++) {
    if (byHour[h] > busiestCount) { busiestCount = byHour[h]; busiestHour = h; }
  }
  if (busiestCount <= 0) busiestHour = null;

  return {
    totalScanned,
    passed,
    actedOn,
    cancelled,
    actedPct: completed > 0 ? Math.round((actedOn / completed) * 100) : 0,
    platforms: toGroups(byPlatform),
    feedSources: toGroups(byFeed),
    busiestHour,
  };
}
