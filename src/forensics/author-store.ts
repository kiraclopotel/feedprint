// FeelingWise - the author profile store.
//
// Per-account counts on this device (sightings, flags, distinct days, repeated
// creatives), derived from the chain and rebuildable from it. Read by the
// dashboard's repeat-source view and by the pipeline's exposure notice. Since
// 2.5.1 nothing here raises or lowers a verdict: the suspicion boost that
// once lifted L1 confidences for a "repeat offender" is gone (judge the item,
// not the author; docs/compliance/DPIA.md section 5).

import { assertExtensionRealm } from '../storage/realm-guard';
import type { AuthorProfile } from '../types/author-profile';

const DB_NAME = 'feelingwise-authors';
// V2: keyPath moved from 'handle' to the composite 'profileKey'
// (handle@platform) so the same handle on two platforms no longer merges
// into one profile. Author profiles are DERIVED analytics, not the evidence
// chain, so the v1→v2 migration drops and rebuilds the store rather than
// re-keying — counts repopulate from live traffic.
const DB_VERSION = 2;
const STORE_NAME = 'profiles';


/**
 * Exposure thresholds, set from the measured distribution of this reader's
 * own three-month record (`docs/audits/2026-08-25-true-judgement/NARRATOR.md`,
 * computation in `corpus/derived/2026-08-25-true-judgement/p5b/`), not from
 * taste:
 *
 *   distinct days per source   p95 = 2 (X, Instagram), 4 (Facebook), 1 (TikTok)
 *   sightings of one creative  p95 = 2–3 on every platform
 *
 * Both constants therefore sit above the 95th percentile on every platform.
 * Together they touch 343 of 31,283 accounts (1.1%) and, rate-limited to one
 * notice per source per day, 3.7% of posts.
 *
 * Why a count and not a severity score: the judged sample rates 95.8% of
 * advertising below severity 4, so a severity floor cannot see a campaign at
 * all. One advert is mild and the judges are right about that. The thirty-
 * third airing is the thing worth naming, and it is only visible by counting.
 */
export const EXPOSURE_DISTINCT_DAYS = 7;
export const EXPOSURE_SAME_CREATIVE = 5;

/** Cap on tracked creatives per source. Bounds unbounded map growth. */
const MAX_TRACKED_CREATIVES = 20;

/**
 * Identity of one piece of copy, for the creative counter only.
 *
 * Deliberately NOT the verdict cache key from `pipeline.ts`: that key mixes in
 * platform, mode, locale and output language because a rewrite depends on all
 * of them, whereas "the same advert again" is a property of the words alone.
 * Deliberately not sha256 either — this is a bucket key for at most twenty
 * entries per source, it is compared only against itself, and it has to be
 * callable synchronously from both the content realm and the pipeline.
 * FNV-1a, 32-bit.
 */
export function creativeHash(text: string): string {
  const norm = text.trim().toLowerCase().replace(/\s+/g, ' ');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}

export interface ExposurePressure {
  fired: boolean;
  reason: 'days' | 'creative' | null;
  distinctDays: number;
  creativeCount: number;
}

/**
 * Has this source reached the reader often enough to be worth naming?
 *
 * Pure and synchronous so the pipeline can call it on an already-fetched
 * profile without a second round trip. Reads prior state only: the current
 * sighting is recorded by `updateAuthorProfile` after the decision, so a
 * source crossing the line is named on the sighting that crosses it, never
 * retroactively on the one that made it.
 */
export function getExposurePressure(
  profile: AuthorProfile | null,
  textHash?: string,
): ExposurePressure {
  const distinctDays = profile?.distinctDays ?? 0;
  const creativeCount = (textHash && profile?.creatives?.[textHash]) || 0;
  if (distinctDays >= EXPOSURE_DISTINCT_DAYS) {
    return { fired: true, reason: 'days', distinctDays, creativeCount };
  }
  if (creativeCount >= EXPOSURE_SAME_CREATIVE) {
    return { fired: true, reason: 'creative', distinctDays, creativeCount };
  }
  return { fired: false, reason: null, distinctDays, creativeCount };
}

/**
 * Composite IDB key for an author profile. Namespacing by platform keeps a
 * handle that exists on two platforms (e.g. @user on TikTok and @user on
 * Instagram) as two distinct profiles instead of merging their counts.
 */
export function authorProfileKey(handle: string, platform: string): string {
  return `${handle}@${platform}`;
}

// Extension-origin only. The service worker is the single writer
// (AUTHOR_UPDATE) and the single reader for content realms
// (GET_AUTHOR_PROFILE, see author-profile-client.ts); the dashboard reads
// directly at the same origin. Opening from a content script used to
// create an empty copy of this database in the host page's origin.
function openDB(): Promise<IDBDatabase> {
  assertExtensionRealm(DB_NAME);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      // Derived-analytics store: drop any prior (handle-keyed) store and
      // recreate it on the composite keyPath. Acceptable per the M18 fix
      // because these counts are recomputable from live traffic, NOT
      // forensic-chain evidence.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME, { keyPath: 'profileKey' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAuthorProfile(
  handle: string,
  platform?: string,
): Promise<AuthorProfile | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      // Exact platform-namespaced lookup when the caller knows the platform.
      if (platform !== undefined) {
        const request = store.get(authorProfileKey(handle, platform));
        request.onsuccess = () => { db.close(); resolve(request.result ?? null); };
        request.onerror = () => { db.close(); reject(request.error); };
        return;
      }
      // Handle-only callers get the highest-traffic profile for that handle
      // across platforms, never a cross-platform merge of counts.
      const request = store.getAll();
      request.onsuccess = () => {
        db.close();
        const matches = (request.result as AuthorProfile[]).filter(p => p.handle === handle);
        if (matches.length === 0) { resolve(null); return; }
        matches.sort((a, b) => b.totalSeen - a.totalSeen);
        resolve(matches[0]);
      };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  } catch {
    return null;
  }
}

/**
 * Every stored author profile. Read-only; the dashboard's escalation view
 * (analytics.computeAuthorEscalation) is the consumer. Failure degrades to
 * an empty list — the panel simply shows no trend chips.
 */
export async function getAllAuthorProfiles(): Promise<AuthorProfile[]> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result as AuthorProfile[]); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  } catch {
    return [];
  }
}

/**
 * Record one sighting's exposure counters on a profile, in place.
 *
 * Split out of `updateAuthorProfile` so the counting rules are reachable
 * without IndexedDB, which the test environment does not provide.
 */
export function applyExposureSighting(
  profile: AuthorProfile,
  day?: string,
  textHash?: string,
): void {
  // A day counts once however many posts it carried, so one long scroll
  // through one source is one day, not fifty sightings.
  //
  // `>` rather than `!==`: sightings are stamped at render time so the day is
  // monotonic in practice, and the strict comparison means an out-of-order or
  // replayed sighting cannot inflate the count. `YYYY-MM-DD` sorts correctly.
  if (day && (profile.lastSeenDay === undefined || day > profile.lastSeenDay)) {
    profile.distinctDays = (profile.distinctDays ?? 0) + 1;
    profile.lastSeenDay = day;
  }
  if (textHash) {
    const creatives = profile.creatives ?? {};
    // Evict the least-seen creative once the map is full, and only when the
    // incoming hash is genuinely new — an already-tracked creative always
    // increments, so a long-running advert can never be evicted by churn.
    if (creatives[textHash] === undefined
        && Object.keys(creatives).length >= MAX_TRACKED_CREATIVES) {
      const coldest = Object.entries(creatives).sort((a, b) => a[1] - b[1])[0];
      if (coldest) delete creatives[coldest[0]];
    }
    creatives[textHash] = (creatives[textHash] ?? 0) + 1;
    profile.creatives = creatives;
  }
}

export async function updateAuthorProfile(
  handle: string,
  platform: string,
  flagged: boolean,
  techniques: string[],
  /** UTC calendar day of this sighting, `YYYY-MM-DD`. Omitted → day not counted. */
  day?: string,
  /** Hash of this sighting's copy. Omitted → creative not counted. */
  textHash?: string,
): Promise<AuthorProfile> {
  const db = await openDB();
  const now = new Date().toISOString();
  const key = authorProfileKey(handle, platform);

  // Get existing or create new
  const existing: AuthorProfile | undefined = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const profile: AuthorProfile = existing ?? {
    profileKey: key,
    handle,
    platform,
    totalSeen: 0,
    totalFlagged: 0,
    techniques: {},
    firstSeen: now,
    lastSeen: now,
  };

  profile.totalSeen++;
  if (flagged) {
    profile.totalFlagged++;
    for (const t of techniques) {
      profile.techniques[t] = (profile.techniques[t] || 0) + 1;
    }
  }
  profile.lastSeen = now;
  profile.platform = platform;

  applyExposureSighting(profile, day, textHash);

  // Put (upsert)
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(profile);
    tx.oncomplete = () => { db.close(); resolve(profile); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    // A commit that fails after the put succeeded fires only abort; the worker holds this account's lock until the update settles.
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error('author profile update aborted')); };
  });
}

/**
 * Full-state reset support. Wipes all author profiles
 * (entity-resolution cache). Called by `resetForensicChain` so the
 * dashboard's per-author flag rates drop to zero alongside the Chain A
 * wipe. A failure rejects, so the reset can tell the parent this part was
 * not cleared; the reset settles each clear on its own.
 */
export async function clearAuthorProfiles(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
      // A commit that fails after the clear succeeded fires only abort; without this the reset never settles.
      tx.onabort = () => { db.close(); reject(tx.error ?? new Error('author profile clear aborted')); };
    });
  } catch (err) {
    console.warn('[FeelingWise] Author profile clear failed:', err);
    throw err;
  }
}

// The shape lives in src/types/author-profile.ts so the types layer imports nothing (PLAN-2026-09-16 item 8.6);
// every importer of this module keeps working through this re-export.
export type { AuthorProfile } from '../types/author-profile';
