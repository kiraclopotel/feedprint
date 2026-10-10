// The media addresses a post carried, as read (evidence-gap register item 14,
// 2026-09-06, owner's yes the same day).
//
// For an image or video post the record holds the poster's words and, on
// records from before 2.5.0, a model's description of the picture; the pixels
// were never kept and nothing named where they came from. This stamps the
// addresses the page itself carried for the post's media, exactly as read,
// so a copy obtained later (from the platform, or from the child's device)
// can be matched to the record by address. It is a list of strings inside
// the signature (`ForensicRecord.mediaUrls`), undefined-omitted, so records
// written before it hash as before.
//
// What it is not. The bytes are not fetched and not hashed: the platforms'
// media hosts are not in the extension's host permissions and a content
// script cannot read a cross-origin image's bytes, so a byte hash would need
// new permissions and a store review first. An address on a platform CDN can
// expire; the record keeps it as read, with the reading time on the record.
//
// Selection: media elements inside the post's frame (the platform's post
// container above the element the adapter handed over), at least
// MIN_EDGE pixels on their shorter rendered side (avatars and icons are
// smaller), http(s) only, deduplicated, at most MAX_URLS in DOM order.
// Absent means "not read", never "no media".

import type { Platform, PostContent } from '../../types/post';
import { bumpCounter } from '../../diagnostics/diagnostics';

export const MEDIA_URLS_MAX = 8;
export const MEDIA_MIN_EDGE = 120;

function httpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return s.length > 2048 ? null : s;
}

/** The media addresses inside `root`, in DOM order. Pure over the element. */
export function readMediaUrls(root: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined): void => {
    const u = httpUrl(raw);
    if (!u || seen.has(u) || out.length >= MEDIA_URLS_MAX) return;
    seen.add(u);
    out.push(u);
  };
  const big = (el: Element): boolean => {
    const r = (el as HTMLElement).getBoundingClientRect?.();
    const w = r?.width ?? 0, h = r?.height ?? 0;
    if (w > 0 || h > 0) return Math.min(w, h) >= MEDIA_MIN_EDGE;
    const img = el as HTMLImageElement;
    const nw = img.naturalWidth ?? 0, nh = img.naturalHeight ?? 0;
    return Math.min(nw, nh) >= MEDIA_MIN_EDGE;
  };
  for (const el of root.querySelectorAll('img, video, source')) {
    if (el.tagName === 'IMG') {
      if (!big(el)) continue;
      push((el as HTMLImageElement).currentSrc || el.getAttribute('src'));
    } else if (el.tagName === 'VIDEO') {
      const v = el as HTMLVideoElement;
      push(v.currentSrc || v.getAttribute('src'));
      push(v.getAttribute('poster'));
    } else {
      // <source> inside a <video>: the address the browser may have chosen.
      if (el.parentElement?.tagName === 'VIDEO') push(el.getAttribute('src'));
    }
  }
  return out;
}

/**
 * The post's frame above its text element. Instagram, Facebook and X hand
 * over the caption or the tweet text as `domRef` (the owner's export of
 * 2026-09-06 11:01: 3 of 59 posts carried an address), so the read climbs to
 * the platform's post container first and reads the media under it.
 */
const POST_FRAME: Record<Platform, string> = {
  twitter: 'article[data-testid="tweet"], article',
  facebook: '[role="article"]',
  instagram: 'article',
  tiktok: '[data-e2e="recommend-list-item-container"], article',
  youtube: 'ytd-rich-item-renderer, ytd-video-renderer, ytd-reel-video-renderer',
};

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * The frame to read, or null with the reason counted. A frame that no longer
 * carries the post's own text was recycled for another post and is refused:
 * an address read from it would name someone else's picture.
 */
export function mediaFrame(post: PostContent): Element | null {
  const el = post.domRef?.deref();
  if (!el) { bumpCounter('mediaUrls.noElement'); return null; }
  if (!el.isConnected) { bumpCounter('mediaUrls.detached'); return null; }
  const frame = (el.closest(POST_FRAME[post.platform] ?? 'article') as Element | null) ?? el;
  const want = squash(post.text ?? '').slice(0, 40);
  if (want) {
    if (!squash(frame.textContent ?? '').includes(want)) { bumpCounter('mediaUrls.recycled'); return null; }
    return frame;
  }
  // A post with no text (2026-09-19). The check above was written as
  // `if (want && ...)`, so a post whose text is empty skipped it entirely and
  // the frame came back unchecked.
  //
  // That is not a corner. tiktok.ts emits a record with text:'' for every
  // music-only video, saying in its own comment that the path "is the ONLY
  // place such a video can be recorded", and it hands over a WeakRef to the
  // container. mediaUrlsNow re-reads that live frame at chain-write time, after
  // the queue and after a model round trip, which is exactly the window a
  // virtualized feed recycles containers in. isConnected does not see it: the
  // node stays connected and holds somebody else's video. So the addresses
  // written into a signed record could be another post's, and the counter said
  // mediaUrls.found.
  //
  // With no text to compare, the post's own identity is the next best anchor,
  // and a caption-less video has one: the id the adapter resolved for it. If
  // the frame still carries that id anywhere a link or an attribute can hold
  // it, the frame is still this post's.
  //
  // Where there is no id either, the frame is refused rather than trusted.
  // mediaUrlsNow then falls back to the detection-time stamp, which was read
  // off the right container. A late-loading picture can be missed that way.
  // This file's own header settles which way to be wrong: "Absent means 'not
  // read', never 'no media'." A missing address is a gap. A wrong one is the
  // record naming somebody else's picture.
  // Both of the refusals below fall back to the detection-time stamp, so
  // neither loses the record and neither loses the addresses already read. They
  // are counted apart because they are not the same event, per the standing
  // rule that on a virtualized feed a missing identity during hydration is not
  // a conflicting one. One says the container now belongs to another post. The
  // other says this markup does not show whose it is, which is what a redesign
  // looks like on the day it lands, and is the operator's signal, not a defect.
  const id = post.parentVideoId ?? idFromUrl(post.sourceUrl);
  if (!id) { bumpCounter('mediaUrls.noAnchor'); return null; }
  switch (frameIdentity(frame, id)) {
    case 'ours': return frame;
    case 'another': bumpCounter('mediaUrls.recycled'); return null;
    default: bumpCounter('mediaUrls.noIdentity'); return null;
  }
}

/** The last path segment of a permalink, which is the platform's own id for it. */
function idFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const seg = url.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop();
  // Short segments are words like "video" or "p", never an id worth anchoring on.
  return seg && seg.length >= 6 ? seg : null;
}

/**
 * Whose frame this is: ours, another post's, or not saying.
 *
 * Read from the places a platform puts an id and a recycle overwrites: the
 * frame's own links and its data attributes. Deliberately a substring test over
 * a bounded set of attributes rather than a selector, so it does not turn into
 * one more thing that breaks when the markup is redrawn.
 *
 * 'another' is only returned on positive evidence: a permalink of the same
 * shape carrying a different id. Anything else is 'unknown', because a frame
 * that has not rendered its link yet has not said anything about whose it is.
 */
function frameIdentity(frame: Element, id: string): 'ours' | 'another' | 'unknown' {
  let sawOtherPermalink = false;
  for (const a of frame.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (href.includes(id)) return 'ours';
    // A permalink is a path with a numeric or long final segment. Another one
    // under this frame is the feed having moved somebody else in.
    if (/\/(video|p|reel|status|posts|shorts|watch)\/[\w.-]{6,}/.test(href)) sawOtherPermalink = true;
  }
  const nodes = [frame, ...frame.querySelectorAll('[id],[data-e2e],[data-video-id],[data-id],[data-testid]')];
  for (const node of nodes.slice(0, 40)) {
    for (const attr of node.attributes ?? []) {
      if ((attr.name.startsWith('data-') || attr.name === 'id') && attr.value.includes(id)) return 'ours';
    }
  }
  return sawOtherPermalink ? 'another' : 'unknown';
}

/**
 * The addresses at record time. Pictures load after a post is first seen,
 * so every emit site reads the live frame again here and falls back to the
 * detection-time stamp when the frame is gone or recycled.
 */
export function mediaUrlsNow(post: PostContent): string[] | undefined {
  try {
    const frame = mediaFrame(post);
    if (frame) {
      const urls = readMediaUrls(frame);
      if (urls.length > 0) { bumpCounter('mediaUrls.found'); return urls; }
      bumpCounter('mediaUrls.none');
    }
  } catch {
    bumpCounter('mediaUrls.threw');
  }
  return post.mediaUrls;
}

/**
 * Stamp `mediaUrls` on the post from its live frame. A post whose frame is
 * gone, or that carries no qualifying media yet, gets no stamp.
 */
export function stampMediaUrls(post: PostContent): void {
  try {
    const el = post.domRef?.deref();
    if (!el) return;
    const frame = (el.closest(POST_FRAME[post.platform] ?? 'article') as Element | null) ?? el;
    const urls = readMediaUrls(frame);
    if (urls.length > 0) post.mediaUrls = urls;
  } catch {
    // A DOM that throws on query is a DOM this stamp cannot read; leave the field absent.
  }
}
