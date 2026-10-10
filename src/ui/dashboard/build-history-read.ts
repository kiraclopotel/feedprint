// Dashboard-side READER for the build history the service worker writes.
//
// Deliberately does not import `storage/build-history.ts`. That module is in the
// service worker's graph, and importing it from the dashboard made the bundler
// hoist the SW's modules into a shared chunk, moving the baked `fwbid-` build id
// out of dist/service-worker.js. check-sw-bundle gate 4 caught it. The key and
// the row shape are duplicated here on purpose and locked by a test that asserts
// the two constants match.
export const BUILD_HISTORY_KEY_READ = 'fwBuildHistory';

// The build id is a vite `define`, inlined into EVERY bundle independently, so
// the dashboard reads its own copy. Importing `background/dev-reload` for this
// is what dragged the service worker's modules into a shared chunk and moved the
// baked id out of dist/service-worker.js (check-sw-bundle gate 4). The dashboard
// must never import from `background/`.
declare const __FW_BUILD_ID__: string;
export function bakedBuildId(): string {
  return typeof __FW_BUILD_ID__ !== 'undefined' ? __FW_BUILD_ID__ : '';
}

export interface BuildRunRow {
  buildId: string;
  version: string;
  firstSeen: string;
  lastSeen: string;
  boots: number;
}

function isRow(v: unknown): v is BuildRunRow {
  const r = v as Partial<BuildRunRow> | null;
  return !!r && typeof r.buildId === 'string' && typeof r.firstSeen === 'string' && typeof r.lastSeen === 'string';
}

/** Newest first. Empty on any failure — this is a debugging aid, never a gate. */
export async function readBuildHistory(): Promise<BuildRunRow[]> {
  try {
    const got = await chrome.storage.local.get(BUILD_HISTORY_KEY_READ);
    const raw = (got as Record<string, unknown>)[BUILD_HISTORY_KEY_READ];
    if (!Array.isArray(raw)) return [];
    return (raw as unknown[]).filter(isRow)
      .sort((a, b) => (a.firstSeen < b.firstSeen ? 1 : a.firstSeen > b.firstSeen ? -1 : 0));
  } catch {
    return [];
  }
}

/** The instant the CURRENT build started here, or null when unknown. */
export function currentBuildSinceRow(runs: BuildRunRow[], buildId: string): string | null {
  return runs.find((r) => r.buildId === buildId)?.firstSeen ?? null;
}

/**
 * True when the data in front of the reader was produced by more than one build.
 * The single most important field in a diagnostic captured after a rebuild.
 */
export function spansMultipleBuildsRow(runs: BuildRunRow[], dataStartIso: string | null): boolean {
  if (!dataStartIso || runs.length < 2) return false;
  return runs.some((r) => r.firstSeen > dataStartIso);
}
