// FeelingWise - the ways content arrives, per platform, and what the recorder
// does on each.
//
// Why this exists (2026-09-06). The recorder was built around main pages:
// feeds, permalinks, profiles, search, community posts. A platform serves
// content in many more shapes, and the ones it does not model were never
// named, so nothing said whether a page was "not ours" or "not yet ours".
// One of those shapes, a live chat, churns thousands of DOM mutations a
// minute for hours; an observer that treats it as a comment section is a
// leak by construction. The 4 GB heap on youtube.com of the same day turned
// out to be YouTube's own live chat (documented in Chromium, Firefox and
// Brave), not this extension, and the extension could not say so because
// it had no word for the surface.
//
// The inventory below is built from the platforms' own lists of where they
// rank content (Meta's system cards, TikTok's "How TikTok recommends
// content", X's published recommendation surfaces, YouTube's own pages) and
// from the paths the adapters handle today. Each entry names a surface and
// one of three treatments:
//
//   modeled     an adapter extracts here and the record is meant to hold it
//   stand-down  recognised, and deliberately not extracted: live and
//               streaming chats (unbounded churn, no post to keep), notifications,
//               marketplaces, dating, shops, account and history pages, media
//               players. The recorder does no work there and counts the visit.
//   excluded    private messages; already outside the content-script match
//               patterns in the manifest, listed so the inventory is complete.
//
// A path no rule names is `unmodeled`: the recorder behaves as before (the
// adapters decide) and counts the sighting under `surface.unmodeled:<platform>`,
// so the next diagnostics paste says which paths the inventory still lacks.
// That default is deliberate: standing down on an unknown path would remove
// protection silently; counting it makes the gap visible.
//
// Rules match on the URL path only. Every platform here is a single-page app
// whose paths are stable across redesigns in a way selectors are not; when a
// surface cannot be told from its path (a live chat that opens inside a feed,
// a story viewer over a profile) the DOM-level guards stay where they are
// (chat overlays in interceptor.ts, the story and reel surfaces in
// surface-detector.ts). This file is the map; it is not the only wall.

import type { Platform } from '../../types/post';
import { bumpCounter } from '../../diagnostics/diagnostics';

export type SurfaceTreatment = 'modeled' | 'stand-down' | 'excluded';

export interface SurfaceRule {
  /** Stable name, `<platform>-<surface>`, used in counters and in the diagnostics paste. */
  surface: string;
  treatment: SurfaceTreatment;
  /** Where the platform itself names this surface, or which adapter handles it. */
  note: string;
  match: (pathname: string) => boolean;
}

export interface SurfaceClass {
  surface: string;
  treatment: SurfaceTreatment | 'unmodeled';
}

const starts = (...prefixes: string[]) => (p: string) => prefixes.some((x) => p === x || p.startsWith(x));
const exact = (...paths: string[]) => (p: string) => paths.includes(p);
const re = (r: RegExp) => (p: string) => r.test(p);

/** Facebook. Meta's Facebook system cards: Feed, Feed recommendations, ranked comments, Reels, Stories, Video, Search, Groups feed, a group's feed, suggested groups, Pages, People You May Know, Notifications, Marketplace, Dating. */
const FACEBOOK: SurfaceRule[] = [
  { surface: 'facebook-messages', treatment: 'excluded', note: 'private messages; excluded by the manifest', match: starts('/messages', '/messenger') },
  { surface: 'facebook-live', treatment: 'stand-down', note: 'live video with a live comment stream; unbounded churn', match: starts('/live', '/gaming') },
  { surface: 'facebook-stories', treatment: 'stand-down', note: 'Stories viewer; a story is a media surface the adapter does not model', match: starts('/stories') },
  { surface: 'facebook-notifications', treatment: 'stand-down', note: 'Meta card: Notifications; a list of pointers, not posts', match: starts('/notifications') },
  { surface: 'facebook-marketplace', treatment: 'stand-down', note: 'Meta card: Marketplace; listings, not posts', match: starts('/marketplace') },
  { surface: 'facebook-dating', treatment: 'stand-down', note: 'Meta card: Dating', match: starts('/dating') },
  { surface: 'facebook-account', treatment: 'stand-down', note: 'settings, privacy, help, ads preferences, saved and memories tools', match: starts('/settings', '/privacy', '/help', '/adpreferences', '/ads/', '/saved', '/bookmarks', '/memories', '/policies', '/legal') },
  { surface: 'facebook-home-feed', treatment: 'modeled', note: 'Meta card: Feed and Feed recommendations; adapter facebook.ts', match: exact('/', '/home.php', '/home') },
  { surface: 'facebook-reel', treatment: 'modeled', note: 'Meta card: Reels; adapter facebook.ts (video pipeline)', match: starts('/reel/', '/reels') },
  { surface: 'facebook-watch', treatment: 'modeled', note: 'Meta card: Video; the Watch feed is a feed of video posts', match: starts('/watch') },
  { surface: 'facebook-groups', treatment: 'modeled', note: 'Meta cards: Groups feed and a single group feed; article units', match: starts('/groups') },
  { surface: 'facebook-search', treatment: 'modeled', note: 'Meta card: Search; results are posts', match: starts('/search') },
  { surface: 'facebook-permalink', treatment: 'modeled', note: 'a post, photo or video page with its ranked comments', match: re(/^\/(photo|photos|posts|permalink|story|share|video|videos)\b|^\/[A-Za-z0-9.]+\/(posts|videos|photos)\//) },
  { surface: 'facebook-events', treatment: 'modeled', note: 'event pages carry a discussion feed of posts', match: starts('/events') },
  { surface: 'facebook-profile', treatment: 'modeled', note: 'a profile or page timeline', match: re(/^\/(profile\.php|pages\/|[A-Za-z0-9.]+\/?$)/) },
];

/** Instagram. Meta's Instagram system cards: Feed, Feed recommendations, Stories, Explore, Reels, Search, Comments, Suggested accounts, Notifications. */
const INSTAGRAM: SurfaceRule[] = [
  { surface: 'instagram-direct', treatment: 'excluded', note: 'private messages; excluded by the manifest', match: starts('/direct') },
  { surface: 'instagram-live', treatment: 'stand-down', note: 'live broadcast with a live comment stream', match: re(/^\/[^/]+\/live\b/) },
  { surface: 'instagram-stories', treatment: 'stand-down', note: 'Meta card: Stories; a media viewer the adapter does not model', match: starts('/stories') },
  { surface: 'instagram-notifications', treatment: 'stand-down', note: 'Meta card: Notifications', match: starts('/accounts/activity', '/notifications') },
  { surface: 'instagram-account', treatment: 'stand-down', note: 'settings and account pages', match: starts('/accounts', '/your_activity', '/legal', '/about') },
  { surface: 'instagram-home-feed', treatment: 'modeled', note: 'Meta card: Feed and Feed recommendations; adapter instagram.ts', match: exact('/') },
  { surface: 'instagram-explore', treatment: 'modeled', note: 'Meta card: Explore; a grid of posts the adapter reads as posts', match: starts('/explore') },
  { surface: 'instagram-reels', treatment: 'modeled', note: 'Meta card: Reels; video pipeline', match: starts('/reels', '/reel/') },
  { surface: 'instagram-post', treatment: 'modeled', note: 'a post with its comments', match: starts('/p/') },
  { surface: 'instagram-search', treatment: 'modeled', note: 'Meta card: Search', match: starts('/search') },
  { surface: 'instagram-profile', treatment: 'modeled', note: 'a profile grid', match: re(/^\/[^/]+\/?(tagged|reels|saved)?\/?$/) },
];

/** TikTok. "How TikTok recommends content": For You, Following, Friends, LIVE, STEM, Explore, Nearby, Shop, Search, Notifications, Comments, Stories, account recommendations. */
const TIKTOK: SurfaceRule[] = [
  { surface: 'tiktok-inbox', treatment: 'excluded', note: 'messages and inbox; excluded by the manifest', match: starts('/messages', '/inbox') },
  { surface: 'tiktok-live', treatment: 'stand-down', note: 'TikTok: LIVE; a live comment stream, unbounded churn', match: re(/^\/live\b|^\/@[^/]+\/live\b/) },
  { surface: 'tiktok-shop', treatment: 'stand-down', note: 'TikTok: Shop; products, not posts', match: starts('/shop', '/business') },
  { surface: 'tiktok-notifications', treatment: 'stand-down', note: 'TikTok: Notifications', match: starts('/notifications', '/activity') },
  { surface: 'tiktok-account', treatment: 'stand-down', note: 'settings, upload and creator tools', match: starts('/setting', '/upload', '/creator', '/tiktokstudio', '/legal') },
  { surface: 'tiktok-for-you', treatment: 'modeled', note: 'TikTok: For You; adapter tiktok.ts', match: exact('/', '/foryou', '/en', '/en/') },
  { surface: 'tiktok-following', treatment: 'modeled', note: 'TikTok: Following and Friends', match: starts('/following', '/friends') },
  { surface: 'tiktok-explore', treatment: 'modeled', note: 'TikTok: Explore, STEM and Nearby feeds', match: starts('/explore', '/channel', '/stem', '/nearby') },
  { surface: 'tiktok-search', treatment: 'modeled', note: 'TikTok: Search', match: starts('/search', '/tag/', '/music/') },
  { surface: 'tiktok-permalink', treatment: 'modeled', note: 'a video page with its comment panel', match: re(/^\/@[^/]+\/(video|photo)\//) },
  { surface: 'tiktok-profile', treatment: 'modeled', note: 'a profile grid', match: re(/^\/@[^/]+\/?$/) },
];

/** X. The published recommendation surfaces: For You timeline, Search, Explore, Notifications, follow recommendations; plus Communities, Spaces and live broadcasts. */
const TWITTER: SurfaceRule[] = [
  { surface: 'twitter-messages', treatment: 'excluded', note: 'direct messages; excluded by the manifest', match: starts('/messages', '/i/chat') },
  { surface: 'twitter-spaces', treatment: 'stand-down', note: 'Spaces, audio rooms with a live reaction stream', match: starts('/i/spaces') },
  { surface: 'twitter-broadcasts', treatment: 'stand-down', note: 'live video broadcasts with a live chat', match: starts('/i/broadcasts', '/i/live') },
  { surface: 'twitter-notifications', treatment: 'stand-down', note: 'X: Notifications; pointers, not the timeline', match: starts('/notifications') },
  { surface: 'twitter-account', treatment: 'stand-down', note: 'settings, premium, bookmarks tools, jobs, grok', match: starts('/settings', '/i/premium', '/i/premium_sign_up', '/i/flow', '/i/grok', '/jobs', '/i/jobs', '/i/verified', '/compose') },
  { surface: 'twitter-home-feed', treatment: 'modeled', note: 'X: For You and Following timelines; adapter twitter.ts', match: exact('/', '/home') },
  { surface: 'twitter-explore', treatment: 'modeled', note: 'X: Explore and trends lead to timelines of posts', match: starts('/explore') },
  { surface: 'twitter-search', treatment: 'modeled', note: 'X: Search; results are a timeline of posts', match: starts('/search', '/hashtag/') },
  { surface: 'twitter-communities', treatment: 'modeled', note: 'Communities are timelines of posts', match: starts('/i/communities') },
  { surface: 'twitter-lists', treatment: 'modeled', note: 'a list is a timeline of posts', match: starts('/i/lists') },
  { surface: 'twitter-bookmarks', treatment: 'modeled', note: 'bookmarks render as a timeline', match: starts('/i/bookmarks') },
  { surface: 'twitter-permalink', treatment: 'modeled', note: 'a post with its replies', match: re(/^\/[^/]+\/status\//) },
  { surface: 'twitter-profile', treatment: 'modeled', note: 'a profile timeline', match: re(/^\/[^/]+\/?(with_replies|media|likes|highlights)?\/?$/) },
];

/** YouTube. Home, Watch next, Shorts, Subscriptions, Search, Comments, Community posts, notifications; live streams carry a live chat in their own frame. */
const YOUTUBE: SurfaceRule[] = [
  { surface: 'youtube-live-chat', treatment: 'stand-down', note: 'the live chat frame, live or replay; documented to grow the page heap without bound on its own', match: starts('/live_chat') },
  { surface: 'youtube-live', treatment: 'stand-down', note: 'the live tab of a channel and live listings', match: re(/^\/live\b|^\/@[^/]+\/streams\b|^\/channel\/[^/]+\/streams\b/) },
  { surface: 'youtube-account', treatment: 'stand-down', note: 'history, library, playlists, settings, reports, the studio', match: starts('/feed/history', '/feed/library', '/feed/you', '/playlist', '/account', '/reporthistory', '/paid_memberships', '/premium', '/t/') },
  { surface: 'youtube-embed', treatment: 'stand-down', note: 'the embedded player', match: starts('/embed') },
  { surface: 'youtube-watch', treatment: 'modeled', note: 'the watch page; comments via yt-watch-comments.ts, the interceptor stands down here (OOM fix)', match: exact('/watch') },
  { surface: 'youtube-shorts', treatment: 'modeled', note: 'Shorts; video pipeline', match: starts('/shorts') },
  { surface: 'youtube-home', treatment: 'modeled', note: 'Home, Subscriptions, Trending and Explore grids; adapter youtube.ts', match: (p) => p === '/' || p.startsWith('/feed/subscriptions') || p.startsWith('/feed/trending') || p.startsWith('/feed/explore') },
  { surface: 'youtube-search', treatment: 'modeled', note: 'search results', match: starts('/results') },
  { surface: 'youtube-community', treatment: 'modeled', note: 'community posts on a channel or as a post page; adapter youtube.ts', match: re(/^\/post\/|^\/(@[^/]+|channel\/[^/]+|c\/[^/]+)\/(community|posts)\b/) },
  { surface: 'youtube-channel', treatment: 'modeled', note: 'a channel page', match: re(/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/) },
];

export const SURFACE_RULES: Readonly<Record<Platform, readonly SurfaceRule[]>> = {
  facebook: FACEBOOK,
  instagram: INSTAGRAM,
  tiktok: TIKTOK,
  twitter: TWITTER,
  youtube: YOUTUBE,
};

const cache = new Map<string, SurfaceClass>();

/** Which surface a path is, and what the recorder does there. First matching rule wins; no rule is `unmodeled`. */
export function classifySurface(platform: Platform, pathname: string): SurfaceClass {
  const key = `${platform}|${pathname}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const rules = SURFACE_RULES[platform] ?? [];
  let out: SurfaceClass = { surface: `${platform}-unmodeled`, treatment: 'unmodeled' };
  for (const rule of rules) {
    if (rule.match(pathname)) { out = { surface: rule.surface, treatment: rule.treatment }; break; }
  }
  if (cache.size > 500) cache.clear();
  cache.set(key, out);
  return out;
}

/** True when the recorder should do no extraction work on this path. */
export function shouldStandDown(platform: Platform, pathname: string): boolean {
  const t = classifySurface(platform, pathname).treatment;
  return t === 'stand-down' || t === 'excluded';
}

const sighted = new Set<string>();

/**
 * Count a sighting once per page life: `surface.standDown:<surface>` when the
 * recorder stood down there, `surface.unmodeled:<platform>:<first path
 * segment>` when no rule named the path. Both reach Copy Diagnostics, so the
 * next paste says where the recorder chose not to work and which paths the
 * inventory still lacks. Bounded: after 200 distinct keys nothing new is counted.
 *
 * The first path segment is often an account handle (facebook.com/<name>,
 * x.com/<handle>) and diagnostics are pasted to support, so the segment goes
 * into the key as a short FNV-1a hash, never as the word. Two sightings of the
 * same path still count once, and the same hash on two pastes means the same
 * path, which is all the inventory needs. Item 3b, 2026-09-13.
 */
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function noteSurfaceSighting(platform: Platform, pathname: string, cls: SurfaceClass): void {
  let key: string;
  if (cls.treatment === 'unmodeled') {
    const head = pathname.split('/').filter(Boolean)[0] ?? '';
    key = `surface.unmodeled:${platform}:${head ? shortHash(head.toLowerCase()) : 'root'}`;
  } else if (cls.treatment === 'stand-down' || cls.treatment === 'excluded') {
    key = `surface.standDown:${cls.surface}`;
  } else {
    return;
  }
  if (sighted.has(key) || sighted.size >= 200) return;
  sighted.add(key);
  bumpCounter(key);
}

export function _resetSurfaceSightingsForTesting(): void {
  sighted.clear();
  cache.clear();
}

/** Every rule, for the inventory test and the diagnostics page. */
export function listSurfaces(): ReadonlyArray<{ platform: Platform; surface: string; treatment: SurfaceTreatment; note: string }> {
  const out: Array<{ platform: Platform; surface: string; treatment: SurfaceTreatment; note: string }> = [];
  for (const platform of Object.keys(SURFACE_RULES) as Platform[]) {
    for (const r of SURFACE_RULES[platform]) out.push({ platform, surface: r.surface, treatment: r.treatment, note: r.note });
  }
  return out;
}
