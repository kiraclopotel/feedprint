// FeelingWise — registry of dashboard-originated inspection tabs.
//
// Tabs the parent dashboard opens ("View original" and the metrics recheck
// background tab) must NOT get protection re-applied: hiding the very post the
// parent came to inspect defeats "View original", and hiding content mid-
// re-extraction corrupts the recheck's metrics. The service worker grants each
// dashboard-opened tab an entry here; the content script asks IS_INSPECTION_TAB
// at startup and gates every DOM intervention on the answer.
//
// The registry is the SOLE source of the inspection flag. Only dashboard
// actions populate it, so a normal child tab can never match — the content
// side additionally fails closed (no match / no response = full protection).
//
// Two hard-won constraints shape the design (owner live repro 2026-08-01):
//
//   1. TAB-CREATE RACE. Content scripts run at document_start — the
//      IS_INSPECTION_TAB query can arrive BEFORE `chrome.tabs.create` has even
//      resolved in the SW, so a tabId-only registry answers {inspection:false}
//      for the very tab it is about to register. The grant is therefore written
//      as a URL-keyed PENDING entry BEFORE the tab is created, and bound
//      one-shot to the first tab whose sender URL matches. Once bound to a
//      tabId it never matches any other tab.
//
//   2. SW EVICTION. An MV3 worker can be evicted between granting and the
//      content query; an in-memory Map forgets the grant (safe direction, but
//      it silently breaks the feature). Grants live in chrome.storage.session:
//      they survive worker restarts but never a browser restart, and are
//      TTL'd so a recycled tabId cannot inherit inspection status.
//
// Fail-closed remains the law: any storage error, malformed entry, URL
// mismatch, or expiry resolves to "not an inspection tab" (full protection).

export type InspectionTabMode = 'reveal' | 'observe';

export interface InspectionGrant {
  mode: InspectionTabMode;
  /** Normalized post URL the grant was issued for (see normalizeInspectionUrl). */
  url: string;
  /** Bound tab id, or null while the grant is pending (tab not yet known). */
  tabId: number | null;
  expiresAt: number;
}

/** Default lifetime of an inspection grant. Long enough for a slow permalink
 *  load + the content script's startup query; short enough that a recycled
 *  tabId cannot plausibly still hold a grant. */
export const INSPECTION_TAB_TTL_MS = 120_000;

/** chrome.storage.session key holding the grant list. */
export const INSPECTION_GRANTS_STORAGE_KEY = 'fw-inspection-grants';

/**
 * Normalize a URL for grant matching: http(s) only, host lowercased,
 * leading `www.` dropped, twitter.com folded into x.com (the platform
 * redirects), query/hash/trailing-slash dropped. Returns null for anything
 * that is not an ordinary web address — a null never matches anything.
 */
export function normalizeInspectionUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    let host = u.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.slice(4);
    if (host === 'twitter.com') host = 'x.com';
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/** Minimal storage surface — chrome.storage.session in production, an
 *  in-memory stub in tests (which also lets tests simulate a SW restart by
 *  building a second registry over the same storage). */
export interface InspectionGrantStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function defaultStorage(): InspectionGrantStorage | null {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return null;
  return chrome.storage.session as unknown as InspectionGrantStorage;
}

function isValidGrant(g: unknown): g is InspectionGrant {
  if (!g || typeof g !== 'object') return false;
  const e = g as Partial<InspectionGrant>;
  return (
    (e.mode === 'reveal' || e.mode === 'observe') &&
    typeof e.url === 'string' &&
    (e.tabId === null || typeof e.tabId === 'number') &&
    typeof e.expiresAt === 'number'
  );
}

export function createInspectionRegistry(
  storage: InspectionGrantStorage | null = defaultStorage(),
  now: () => number = Date.now,
) {
  // Serialize every read-modify-write so two overlapping handlers in the same
  // SW realm cannot lose each other's update.
  let chain: Promise<unknown> = Promise.resolve();
  function serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  }

  async function load(): Promise<InspectionGrant[]> {
    if (!storage) return [];
    const raw = await storage.get(INSPECTION_GRANTS_STORAGE_KEY);
    const list = raw?.[INSPECTION_GRANTS_STORAGE_KEY];
    if (!Array.isArray(list)) return [];
    const t = now();
    return list.filter((g): g is InspectionGrant => isValidGrant(g) && g.expiresAt > t);
  }

  async function save(grants: InspectionGrant[]): Promise<void> {
    if (!storage) return;
    await storage.set({ [INSPECTION_GRANTS_STORAGE_KEY]: grants });
  }

  return {
    /**
     * Write a pending grant for a post URL BEFORE creating its tab. Must be
     * awaited before `chrome.tabs.create` so the grant is durably present by
     * the time the new tab's content script can possibly query.
     */
    grantForUrl(rawUrl: string, mode: InspectionTabMode, ttlMs: number = INSPECTION_TAB_TTL_MS): Promise<void> {
      return serialize(async () => {
        const url = normalizeInspectionUrl(rawUrl);
        if (!url) return; // non-web URL never gets a grant
        const grants = await load();
        grants.push({ mode, url, tabId: null, expiresAt: now() + ttlMs });
        await save(grants);
      });
    },

    /**
     * Bind the created tab's id to its pending grant (or record a fresh bound
     * grant if the pending one was already consumed by the startup query).
     */
    bindTab(rawUrl: string, mode: InspectionTabMode, tabId: number, ttlMs: number = INSPECTION_TAB_TTL_MS): Promise<void> {
      return serialize(async () => {
        const url = normalizeInspectionUrl(rawUrl);
        if (!url) return;
        const grants = await load();
        const already = grants.find(g => g.tabId === tabId);
        if (already) {
          already.mode = mode;
        } else {
          const pending = grants.find(g => g.tabId === null && g.url === url && g.mode === mode);
          if (pending) pending.tabId = tabId;
          else grants.push({ mode, url, tabId, expiresAt: now() + ttlMs });
        }
        await save(grants);
      });
    },

    /**
     * Resolve a content-script startup query. A tabId-bound grant wins; else a
     * pending grant whose URL exactly matches the sender's URL is bound
     * ONE-SHOT to this tab (covering the tab-create race). Anything else —
     * including any storage failure — is null: full protection.
     */
    lookup(tabId: number, senderUrl?: string): Promise<{ mode: InspectionTabMode } | null> {
      return serialize(async () => {
        try {
          const grants = await load();
          let hit = grants.find(g => g.tabId === tabId) ?? null;
          if (!hit) {
            const url = normalizeInspectionUrl(senderUrl);
            if (url) {
              const pending = grants.find(g => g.tabId === null && g.url === url);
              if (pending) {
                pending.tabId = tabId; // one-shot: bound forever to this tab
                hit = pending;
              }
            }
          }
          await save(grants);
          return hit ? { mode: hit.mode } : null;
        } catch {
          return null; // fail-closed
        }
      });
    },

    /** Wire to chrome.tabs.onRemoved so closed tabs never linger. */
    remove(tabId: number): Promise<void> {
      return serialize(async () => {
        try {
          const grants = await load();
          await save(grants.filter(g => g.tabId !== tabId));
        } catch { /* best-effort cleanup; TTL bounds any leftover */ }
      });
    },

    /** Live grant count (pending + bound), for tests. */
    size(): Promise<number> {
      return serialize(async () => (await load()).length);
    },
  };
}

