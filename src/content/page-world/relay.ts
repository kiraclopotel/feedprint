// FeelingWise — Page-world relay.
//
// Content-script-side bridge. Listens for fw:platform-payload events emitted
// by the page-world interceptor (which runs in the MAIN world) and routes the
// JSON body to that platform's wire parser. Every parsed item goes into the
// wire store (./wire-store.ts), which holds what the platform said about the
// item until the DOM shows that item to the reader.
//
// NOTHING HERE DISPATCHES A RECORD. Until 2026-09-14 this file held a
// shadow-mode gate (`__FW_WIRE_LIVE__`) because a wire-emitted PostContent has
// no live DOM element and downstream consumers call `post.domRef.deref()`
// unguarded. The gate is gone along with the emit path it guarded: the wire
// now fills fields on the DOM item's record instead of making a record of its
// own, so there is no undefined domRef to crash on and no second record to
// dedup away. See wire-store.ts for why emitting was refused.
//
// The stand-down gate is applied HERE and not in the page realm: the surface
// inventory (src/content/post-path/surfaces.ts, docs/design/SURFACES-2026-09-06.md)
// lives in the isolated world and the page-world bundle must keep zero
// imports. A live chat, a notifications tray or a marketplace is recognised
// and its payloads are dropped before any parse.

import type { PostContent, Platform } from '../../types/post';
import { parseXPayload } from '../platforms/wire/x';
import { parseFacebookPayload } from '../platforms/wire/facebook';
import { parseInstagramPayload } from '../platforms/wire/instagram';
import { parseTiktokPayload } from '../platforms/wire/tiktok';
import { parseYoutubePayload } from '../platforms/wire/youtube';
import type { WireContext, WireParser } from '../platforms/wire/shared';
import { rememberWireItem } from './wire-store';
import { shouldStandDown } from '../post-path/surfaces';
import { fwDebug } from '../fw-log';
import { bumpCounter } from '../../diagnostics/diagnostics';

/**
 * One parser per platform. A missing key means the platform's page-world
 * payloads are not parsed at all; today all five are present, which is what
 * PLAN-2026-09-14 item 4 asked for.
 */
const PARSERS: Partial<Record<Platform, WireParser>> = {
  twitter: parseXPayload,
  facebook: parseFacebookPayload,
  instagram: parseInstagramPayload,
  tiktok: parseTiktokPayload,
  youtube: parseYoutubePayload,
};

const PLATFORMS: ReadonlySet<string> = new Set<string>([
  'twitter', 'facebook', 'instagram', 'tiktok', 'youtube',
]);

interface PlatformPayload {
  platform?: string;
  url?: string;
  body?: unknown;
}

function currentContext(): WireContext {
  try {
    return { pathname: window.location.pathname, search: window.location.search };
  } catch {
    return { pathname: '/' };
  }
}

/**
 * Parse one payload and file what it said into the wire store. Exported so a
 * test can drive the whole relay decision without dispatching a DOM event.
 * Returns the items it filed, for the test and the debug line.
 */
export function receiveWirePayload(
  platform: string,
  url: string,
  body: unknown,
  ctx: WireContext = currentContext(),
): PostContent[] {
  if (!PLATFORMS.has(platform)) return [];
  const parser = PARSERS[platform as Platform];
  if (!parser) return [];
  // A surface the inventory stands down on is not read, whatever the
  // endpoint said. A live chat serves a comment stream that never ends.
  if (shouldStandDown(platform as Platform, ctx.pathname)) return [];

  let posts: PostContent[];
  try {
    posts = parser(url, body, ctx);
  } catch {
    // A wire parser threw on an unfamiliar shape. The DOM adapter is still
    // running, so nothing is lost but this one payload. Counted by platform (the name was
    // checked against the five above), so a site change that breaks a parser shows in the
    // diagnostics.
    bumpCounter(`parserThrew.${platform}`);
    return [];
  }

  for (const post of posts) rememberWireItem(post);
  return posts;
}

/**
 * Install the relay. Returns a disposer that detaches the listener.
 * Multiple installs are NOT idempotent — each attaches its own listener
 * (caller responsible for tracking).
 */
export function installPageWorldRelay(): () => void {
  const handler = (event: Event): void => {
    const ce = event as CustomEvent<PlatformPayload>;
    const detail = ce.detail;
    if (!detail || typeof detail !== 'object') return;
    const { platform, url, body } = detail;
    if (!platform || !url) return;

    const filed = receiveWirePayload(platform, url, body);
    if (filed.length > 0) {
      fwDebug(`[FW wire] ${platform} filed ${filed.length} item(s) from ${url.slice(0, 80)}`);
    }
  };

  document.addEventListener('fw:platform-payload', handler);
  return () => document.removeEventListener('fw:platform-payload', handler);
}
