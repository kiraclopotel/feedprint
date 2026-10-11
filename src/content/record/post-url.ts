// Post URL construction for chain records and the media start gates, plus
// the two pure room helpers (caption truncation, permalink-derived room).
// Pure: reads location.href and the document host, writes one diagnostics
// counter, touches no DOM. Extracted from content/index.ts per
// docs/audits/2026-08-23-objective-audit/wave4-architecture (Proposal A, step 2).

import type { PostContent } from '../../types/post';
import { bumpCounter } from '../../diagnostics/diagnostics';
import { currentDocumentHost, isForeignPostUrlHost, normalizePostUrlHost } from './post-url-host';

// A record falls back to the address of the page a post was seen on, and a
// search box writes what the person typed into that address. Feedprint records
// no searches, so only the parameters that name a post, a photo, a video or a
// playlist on that site are kept, and the fragment goes too.
const PAGE_NAMING_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'facebook.com': ['story_fbid', 'id', 'fbid', 'set', 'v', 'multi_permalinks'],
  'youtube.com': ['v', 'list'],
};

function pageAddressForRecord(href: string): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href.split(/[?#]/)[0];
  }
  const naming = PAGE_NAMING_PARAMS[normalizePostUrlHost(url.hostname)] ?? [];
  const kept = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    if (naming.includes(name)) kept.append(name, value);
  }
  url.search = kept.toString();
  url.hash = '';
  return url.toString();
}

/** The current page's address as a record may keep it, or '' where there is no page. */
export function currentPageAddress(): string {
  return typeof location !== 'undefined' && location.href ? pageAddressForRecord(location.href) : '';
}

// synthetic-UUID detection. When a per-platform adapter
// fails to extract a real post code from the DOM (e.g., IG returns null from
// _extractPostId, falls back to crypto.randomUUID()), the resulting "id" is a
// standard UUID v4 (8-4-4-4-12 hex with dashes). Constructing a per-platform
// URL with this synthetic id produces a DEAD LINK (for example, constructing
// `/p/<uuid>/` when no platform post has that code). A forensic-export review
// confirmed that the dashboard rendered such a dead URL as a clickable link.
//
// Fix: detect synthetic UUIDs and fall back to location.href (the page URL
// the child was on when FW scanned the post). Worst case the parent gets a
// less-specific URL, not a broken one.
// Match a v4 UUID anywhere in the id string. Anchored ^...$ misses the
// platform-prefixed cases the adapters generate when extraction fails
// (FB: `fb-post-<uuid>` / `fb-vid-<uuid>`, IG/YT/TT: raw `<uuid>`). All of
// these should fall through to location.href in buildPostUrl rather than
// produce a guaranteed-dead URL like `facebook.com/fb-post-<uuid>`.
const SYNTHETIC_UUID_REGEX = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i;
export function isSyntheticUuid(id: string): boolean {
  return SYNTHETIC_UUID_REGEX.test(id);
}

// Host-disagreement observation. One line per distinct pairing per session, so
// a real cross-surface leak is visible in both the console and Copy Diagnostics
// without a repeating post-by-post log. Observation only: the URL is returned
// unchanged, because a URL that is wrong is still the evidence of what happened.
const announcedForeignPostUrlHosts = new Set<string>();
function notePostUrlHost(post: PostContent, sourceUrl: string): void {
  const documentHost = currentDocumentHost();
  if (!isForeignPostUrlHost(sourceUrl, documentHost)) return;
  bumpCounter('postUrlForeignHost');
  let host = '';
  try { host = new URL(sourceUrl).hostname; } catch { host = 'unparseable'; }
  const key = `${post.platform}|${documentHost}|${host}`;
  if (announcedForeignPostUrlHosts.has(key)) return;
  announcedForeignPostUrlHosts.add(key);
  console.warn(
    `[FeelingWise] post URL host disagrees with the page it was extracted on: `
    + `${post.platform} record on ${documentHost} carries a ${host} URL`,
  );
}

export function buildPostUrl(post: PostContent): string {
  if (post.sourceUrl) {
    notePostUrlHost(post, post.sourceUrl);
    return post.sourceUrl;
  }

  // synthetic-UUID short-circuit: when the adapter generated a
  // random UUID instead of extracting a real platform-side post code, the
  // current location is a more honest fallback than a guaranteed-dead URL.
  if (post.id && isSyntheticUuid(post.id)) {
    return currentPageAddress();
  }

  if (post.platform === 'twitter' && post.author && post.id) {
    const handle = post.author.replace(/^@/, '');
    if (/^[A-Za-z0-9_]+$/.test(handle)) {
      return `https://x.com/${handle}/status/${post.id}`;
    }
  }
  // Facebook URLs require a user slug PLUS a path segment (`/posts/<id>`,
  // `/permalink/<id>`, `/reel/<id>`, `/videos/<id>`). The id alone routes
  // to a USER page, not the post. `_extractPostUrl` captures the full URL
  // when it's present in the DOM; when it isn't, fall back to the current
  // page URL rather than fabricate a guaranteed-dead URL.
  if (post.platform === 'facebook') {
    return currentPageAddress();
  }
  if (post.platform === 'instagram' && post.id) {
    return `https://www.instagram.com/p/${post.id}/`;
  }
  if (post.platform === 'tiktok' && post.id && post.author && post.author !== 'unknown') {
    const handle = post.author.replace(/^@/, '');
    return `https://www.tiktok.com/@${handle}/video/${post.id}`;
  }
  if (post.platform === 'youtube' && post.id) {
    return `https://www.youtube.com/watch?v=${post.id}`;
  }
  // Final fallback — use the current page URL when nothing else fits.
  // location.href is the surface FW saw the post on, so at minimum a click
  // navigates the parent to the right place (or close to it) rather than
  // leaving them with a broken "no URL" state.
  return currentPageAddress();
}


/**
 * denormalized room-caption truncation.
 *
 * Bounds the per-comment chain-record growth caused by carrying the room
 * caption inline on successful comment records. 200 chars covers ~95% of TikTok
 * captions verbatim and trims the long-tail Twitter/FB threads. Recipient
 * who wants the verbatim caption can either visit roomUrl (the live source
 * page) or read the room record's `originalText` (the caption record in
 * the chain).
 *
 * Truncation marker is the U+2026 ellipsis "…" appended after 200 chars
 * (197 chars of caption + ellipsis = 200 chars total). The marker is
 * deliberate: a recipient reading "FW says the caption was 'X…'" knows the
 * text was truncated for chain-size discipline, not malformed.
 *
 * Empty / missing captions return "" — undefined-omitted by canonical-payload
 * preserves byte-stable hash for legacy records.
 */
const ROOM_CAPTION_MAX_CHARS = 200;
const ROOM_CAPTION_ELLIPSIS = '…';
export function truncateRoomCaption(caption: string | undefined | null): string {
  if (!caption) return '';
  const trimmed = caption.trim();
  if (trimmed.length <= ROOM_CAPTION_MAX_CHARS) return trimmed;
  return trimmed.slice(0, ROOM_CAPTION_MAX_CHARS - ROOM_CAPTION_ELLIPSIS.length) + ROOM_CAPTION_ELLIPSIS;
}

/**
 * Derive a comment bucket's room (post URL + author) from the page permalink
 * captured at bucket creation — the TikTok /@author/video/<id> (or /photo/)
 * shape. Returns null unless the permalink's item id EQUALS the bucket's
 * parentVideoId: the id match is the correctness gate (a permalink left over
 * from a different video never stamps the wrong room). Pure.
 */
export function roomFromPermalink(
  permalinkUrl: string | undefined,
  parentVideoId: string,
): { url: string; author: string } | null {
  if (!permalinkUrl || !parentVideoId) return null;
  try {
    const u = new URL(permalinkUrl);
    const m = u.pathname.match(/^\/@([^/]+)\/(?:video|photo)\/(\d+)/);
    if (!m || m[2] !== parentVideoId) return null;
    return { url: u.origin + u.pathname, author: '@' + m[1] };
  } catch {
    return null;
  }
}
