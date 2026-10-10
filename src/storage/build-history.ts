// Which builds this install has actually run, and when.
//
// Why (support need identified 2026-08-02 06:21, after a night of shipping):
// updates needed to be traceable when debugging — something like a version
// or a chronology.
//
// The concrete failure it fixes: a Copy Diagnostics payload carries counters
// spanning hours, but nothing in it says which build produced them. A payload
// captured at 03:15 and read at 06:00 looks identical to one captured after a
// rebuild, so a reader cannot tell whether a number reflects the code they are
// holding. Today that cost a manual check of file timestamps on disk to work
// out that a diagnostic predated the morning's changes.
//
// The build id is already baked into every bundle (`__FW_BUILD_ID__`, vite
// define, mirrored into dist/build-id.json by check-sw-bundle.mjs). Nothing
// persisted it. This does.

// Realm note: this module is imported by the SERVICE WORKER ONLY. The dashboard
// reads the same key through `ui/dashboard/build-history-read.ts`. Importing it
// from both realms made the bundler hoist the SW's graph into a shared chunk and
// carried the baked build id out of service-worker.js, which check-sw-bundle
// gate 4 caught. The duplicated key is locked by a test.
export const BUILD_HISTORY_KEY = 'fwBuildHistory';
const KEY = BUILD_HISTORY_KEY;

/** Keep the tail bounded — this is a debugging aid, not an audit log. */
const MAX_RUNS = 20;

export interface BuildRun {
  /** Baked `__FW_BUILD_ID__` of the bundle that ran. */
  buildId: string;
  /** manifest.json version at the time, e.g. '1.6.0'. */
  version: string;
  /** ISO instant this install first observed this build. */
  firstSeen: string;
  /** ISO instant of the most recent boot of this build. */
  lastSeen: string;
  /** How many times this build has booted here. */
  boots: number;
}

async function read(): Promise<BuildRun[]> {
  try {
    const got = await chrome.storage.local.get(KEY);
    const raw = (got as Record<string, unknown>)[KEY];
    return Array.isArray(raw) ? (raw as BuildRun[]).filter(isRun) : [];
  } catch {
    return [];
  }
}

function isRun(v: unknown): v is BuildRun {
  const r = v as Partial<BuildRun> | null;
  return !!r && typeof r.buildId === 'string' && typeof r.firstSeen === 'string' && typeof r.lastSeen === 'string';
}

/**
 * Record that `buildId` is running now. Idempotent per build: the same build
 * booting again updates `lastSeen` and `boots` and never adds a row, so a
 * service worker that wakes fifty times a day does not fill the history.
 *
 * `nowIso` is injected so the caller owns the clock and the behavior is
 * testable without faking Date.
 */
export async function noteBuildRun(buildId: string, version: string, nowIso: string): Promise<BuildRun[]> {
  if (!buildId) return read();          // no baked id (vitest/node) — record nothing
  const runs = await read();
  const existing = runs.find((r) => r.buildId === buildId);
  if (existing) {
    existing.lastSeen = nowIso;
    existing.version = version || existing.version;
    existing.boots = (existing.boots ?? 0) + 1;
  } else {
    runs.push({ buildId, version, firstSeen: nowIso, lastSeen: nowIso, boots: 1 });
  }
  // Newest first by firstSeen, then trim the oldest away.
  runs.sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0));
  const trimmed = runs.slice(0, MAX_RUNS);
  try {
    await chrome.storage.local.set({ [KEY]: trimmed });
  } catch {
    // Storage failure must never break boot. The history is a convenience.
  }
  return trimmed;
}

/** Newest first. Empty when nothing has been recorded yet. */
export async function getBuildHistory(): Promise<BuildRun[]> {
  const runs = await read();
  return runs.slice().sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0));
}

// spansMultipleBuilds/currentBuildSince used to live here; this module is
// SW-only (see the realm note above) and neither the SW nor a test ever
// called them. `ui/dashboard/build-history-read.ts` carries the same logic
// under Row-suffixed names for the dashboard's own realm.
