// FeelingWise - Author profile lookup for content realms
//
// Author profiles live in the extension-origin IndexedDB that only the
// service worker writes (AUTHOR_UPDATE). A content script cannot open that
// database: its `indexedDB` is the host page's origin, so a direct read
// always saw an empty store and the exposure counters always read zero.
// Content realms ask the service worker instead with GET_AUTHOR_PROFILE.
//
// A short per-realm cache bounds the round trips while a feed scrolls
// (the same author appears in many consecutive posts). Profiles only
// change by whole sightings, so serving one up to CACHE_TTL_MS old cannot
// misapply the boost by more than one post.

import { safeSendMessage } from '../storage/context-guard';
import type { AuthorProfile } from './author-store';
import type { FWMessage, GetAuthorProfileResponse } from '../types/messages';

const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  profile: AuthorProfile | null;
  at: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(handle: string, platform: string | undefined): string {
  return platform === undefined ? handle : `${handle}@${platform}`;
}

/**
 * Resolve an author's profile through the service worker. Resolves null
 * when the author is unknown, the worker is unreachable, or the reply is
 * malformed; the caller treats null as "no boost".
 */
export async function fetchAuthorProfile(
  handle: string,
  platform?: string,
  now: number = Date.now(),
): Promise<AuthorProfile | null> {
  const key = cacheKey(handle, platform);
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.profile;

  const message: FWMessage = { type: 'GET_AUTHOR_PROFILE', payload: { handle, platform } };
  const pending = safeSendMessage(message);
  if (!pending) return null;

  let profile: AuthorProfile | null = null;
  try {
    const reply = (await pending) as GetAuthorProfileResponse | undefined;
    if (reply && reply.ok && reply.profile && typeof reply.profile === 'object') {
      profile = reply.profile;
    }
  } catch {
    profile = null;
  }

  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { profile, at: now });
  return profile;
}

export function _resetAuthorProfileCacheForTests(): void {
  cache.clear();
}
