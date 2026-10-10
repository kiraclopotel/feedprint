import { currentSurfaceSessionId } from '../content/record/impression-order';

export const PROTECTION_HEALTH_FRESH_MS = 15_000;
export const PROTECTION_SLOW_MS = 30_000;

const STORAGE_KEY = 'fw_protection_health_v1';
const PERSIST_DEBOUNCE_MS = 1_000;
const HEARTBEAT_MS = 5_000;
const MAX_STORED_SESSIONS = 20;

export type ProtectionOwnerScope = 'post' | 'generic';
export type ProtectionHealthState = 'checking' | 'slow' | 'broken' | 'idle' | 'stale';

export interface ProtectionIssueSummary {
  protectionState: ProtectionHealthState | null;
}

export interface ProtectionHealthSnapshot {
  version: 1;
  observedAt: number;
  host: string;
  surfaceSessionId: string;
  liveHosts: number;
  visibleHosts: number;
  oldestMs: number;
  owners: Record<ProtectionOwnerScope, number>;
  ownerlessHosts: number;
  missingOverlayHosts: number;
}

export interface ProtectionCoverState {
  element: HTMLElement;
  overlay: HTMLElement;
  mountedAt: number;
  ownerScopes: readonly ProtectionOwnerScope[];
}

interface StoredProtectionCoverState {
  element: WeakRef<HTMLElement>;
  overlay: WeakRef<HTMLElement>;
  mountedAt: number;
  ownerScopes: readonly ProtectionOwnerScope[];
}

let coverByElement = new WeakMap<HTMLElement, StoredProtectionCoverState>();
const liveCovers = new Set<StoredProtectionCoverState>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

interface ProtectionHealthStore {
  version: 1;
  date: string;
  sessions: Record<string, ProtectionHealthSnapshot>;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function schedulePersist(): void {
  if (persistTimer !== null) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void persistProtectionHealth();
  }, PERSIST_DEBOUNCE_MS);
}

function ensureHeartbeat(): void {
  if (heartbeatTimer !== null || liveCovers.size === 0) return;
  heartbeatTimer = setInterval(() => {
    if (liveCovers.size === 0) {
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      return;
    }
    void persistProtectionHealth();
  }, HEARTBEAT_MS);
}

export function syncProtectionCover(state: ProtectionCoverState): void {
  const existing = coverByElement.get(state.element);
  if (existing) {
    existing.overlay = new WeakRef(state.overlay);
    existing.mountedAt = state.mountedAt;
    existing.ownerScopes = [...state.ownerScopes];
    // A platform may temporarily detach and then reconnect the same protected
    // host. Snapshot pruning removes detached entries from the iterable set,
    // so every authoritative sync must restore the existing weak entry.
    liveCovers.add(existing);
  } else {
    const stored: StoredProtectionCoverState = {
      element: new WeakRef(state.element),
      overlay: new WeakRef(state.overlay),
      mountedAt: state.mountedAt,
      ownerScopes: [...state.ownerScopes],
    };
    coverByElement.set(state.element, stored);
    liveCovers.add(stored);
  }
  schedulePersist();
  ensureHeartbeat();
}

export function removeProtectionCover(element: HTMLElement): void {
  const stored = coverByElement.get(element);
  if (stored) liveCovers.delete(stored);
  coverByElement.delete(element);
  schedulePersist();
  if (liveCovers.size === 0 && heartbeatTimer !== null) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const view = element.ownerDocument.defaultView;
  const style = view?.getComputedStyle(element);
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  const rect = element.getBoundingClientRect();
  const viewportHeight = view?.innerHeight ?? 0;
  const viewportWidth = view?.innerWidth ?? 0;
  return rect.width > 0
    && rect.height > 0
    && rect.bottom > 0
    && rect.right > 0
    && rect.top < viewportHeight
    && rect.left < viewportWidth;
}

export function currentProtectionHealthSnapshot(
  observedAt = Date.now(),
  monotonicNow = performance.now(),
): ProtectionHealthSnapshot {
  const covers: Array<{
    element: HTMLElement;
    overlay: HTMLElement | undefined;
    mountedAt: number;
    ownerScopes: readonly ProtectionOwnerScope[];
  }> = [];
  for (const state of liveCovers) {
    const element = state.element.deref();
    if (!element?.isConnected) {
      liveCovers.delete(state);
      continue;
    }
    covers.push({
      element,
      overlay: state.overlay.deref(),
      mountedAt: state.mountedAt,
      ownerScopes: state.ownerScopes,
    });
  }
  const owners: Record<ProtectionOwnerScope, number> = {
    post: 0,
    generic: 0,
  };
  let oldestMs = 0;
  let visibleHosts = 0;
  let ownerlessHosts = 0;
  let missingOverlayHosts = 0;
  for (const state of covers) {
    // CHILD-3 / M86: a public-SPA retained cover stays connected but off-screen
    // and is never re-extracted, so its mountedAt ages indefinitely. Counting
    // that toward oldestMs made assessProtectionHealth report a false slow (and,
    // via a downstream stuck cover, broken) signal for benign over-protection.
    // Only a cover the child is actually facing (visible) contributes to the
    // stuck-age; a genuinely hung on-screen cover still surfaces as slow.
    if (isVisible(state.element)) {
      visibleHosts++;
      oldestMs = Math.max(oldestMs, Math.max(0, monotonicNow - state.mountedAt));
    }
    if (state.ownerScopes.length === 0) ownerlessHosts++;
    for (const scope of state.ownerScopes) owners[scope]++;
    if (!state.overlay || state.overlay.parentElement !== state.element || !state.overlay.isConnected) {
      missingOverlayHosts++;
    }
  }
  return {
    version: 1,
    observedAt,
    host: typeof location === 'undefined' ? '' : location.hostname,
    surfaceSessionId: currentSurfaceSessionId(),
    liveHosts: covers.length,
    visibleHosts,
    oldestMs: Math.round(oldestMs),
    owners,
    ownerlessHosts,
    missingOverlayHosts,
  };
}

function coerceStore(raw: unknown): ProtectionHealthStore {
  if (raw && typeof raw === 'object') {
    const value = raw as Partial<ProtectionHealthStore>;
    if (value.version === 1 && value.date === today() && value.sessions && typeof value.sessions === 'object') {
      return { version: 1, date: value.date, sessions: { ...value.sessions } };
    }
  }
  return { version: 1, date: today(), sessions: {} };
}

async function persistProtectionHealth(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return;
  try {
    const got = await chrome.storage.local.get([STORAGE_KEY]);
    const store = coerceStore(got[STORAGE_KEY]);
    const snapshot = currentProtectionHealthSnapshot();
    store.sessions[snapshot.surfaceSessionId] = snapshot;
    const keep = Object.values(store.sessions)
      .sort((a, b) => b.observedAt - a.observedAt)
      .slice(0, MAX_STORED_SESSIONS);
    store.sessions = Object.fromEntries(keep.map(item => [item.surfaceSessionId, item]));
    await chrome.storage.local.set({ [STORAGE_KEY]: store });
  } catch {
    // Diagnostics are best-effort and must never affect protection.
  }
}

export async function readProtectionHealth(): Promise<ProtectionHealthSnapshot | null> {
  if (typeof chrome === 'undefined' || !chrome?.storage?.local) return null;
  try {
    const got = await chrome.storage.local.get([STORAGE_KEY]);
    const store = coerceStore(got[STORAGE_KEY]);
    const snapshots = Object.values(store.sessions);
    return aggregateProtectionHealthSnapshots(snapshots);
  } catch {
    return null;
  }
}

/**
 * Combine every fresh content-script session so a newly idle tab cannot mask
 * a slow or broken cover in another tab. If all sessions are stale, retain the
 * newest stale snapshot so the assessor can explicitly reject it as stale.
 */
export function aggregateProtectionHealthSnapshots(
  snapshots: readonly ProtectionHealthSnapshot[],
  now = Date.now(),
): ProtectionHealthSnapshot | null {
  if (snapshots.length === 0) return null;
  const fresh = snapshots.filter(item => now - item.observedAt <= PROTECTION_HEALTH_FRESH_MS);
  if (fresh.length === 0) {
    return snapshots.reduce((latest, item) => item.observedAt > latest.observedAt ? item : latest);
  }
  if (fresh.length === 1) return fresh[0];
  const hosts = [...new Set(fresh.map(item => item.host).filter(Boolean))].sort();
  return {
    version: 1,
    observedAt: Math.max(...fresh.map(item => item.observedAt)),
    host: hosts.join(', '),
    surfaceSessionId: `aggregate:${fresh.length}`,
    liveHosts: fresh.reduce((sum, item) => sum + item.liveHosts, 0),
    visibleHosts: fresh.reduce((sum, item) => sum + item.visibleHosts, 0),
    oldestMs: Math.max(...fresh.map(item => item.oldestMs)),
    owners: {
      post: fresh.reduce((sum, item) => sum + item.owners.post, 0),
      generic: fresh.reduce((sum, item) => sum + item.owners.generic, 0),
    },
    ownerlessHosts: fresh.reduce((sum, item) => sum + item.ownerlessHosts, 0),
    missingOverlayHosts: fresh.reduce((sum, item) => sum + item.missingOverlayHosts, 0),
  };
}

export function assessProtectionHealth(
  snapshot: ProtectionHealthSnapshot,
  now = Date.now(),
): ProtectionHealthState {
  if (now - snapshot.observedAt > PROTECTION_HEALTH_FRESH_MS) return 'stale';
  if (snapshot.ownerlessHosts > 0 || snapshot.missingOverlayHosts > 0) return 'broken';
  if (snapshot.liveHosts === 0) return 'idle';
  return snapshot.oldestMs > PROTECTION_SLOW_MS ? 'slow' : 'checking';
}

export function summarizeProtectionIssues(
  snapshot: ProtectionHealthSnapshot | null,
  now = Date.now(),
): ProtectionIssueSummary {
  return {
    protectionState: snapshot ? assessProtectionHealth(snapshot, now) : null,
  };
}

export function _resetProtectionHealthForTesting(): void {
  liveCovers.clear();
  coverByElement = new WeakMap();
  if (persistTimer !== null) clearTimeout(persistTimer);
  if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
  persistTimer = null;
  heartbeatTimer = null;
}
