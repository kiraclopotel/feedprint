// FeelingWise - what the platform's own JSON said about an item, held until
// the page shows that item to the reader.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a wire capture never creates a record.
// It fills in fields on the record the DOM-captured item already produces, at
// the one chokepoint every captured item passes through
// (`onPostDetected` in src/content/index.ts). So a wire capture cannot produce
// a second record for an item the DOM already captured, because it cannot
// produce a first one. That is the dedup guarantee, and it is structural: it
// does not depend on racing the DOM, on a timer, or on two texts matching.
//
// WHY NOT EMIT. A feed response carries the next forty items; the reader sees
// four of them. Emitting a record per parsed item would put items the reader
// never saw into the chain, which is exactly what the chain-mirror invariant
// forbids (src/types/post.ts, Encounter: "every byte in an Encounter traces to
// DOM-rendered content the child's eyes could have hit"). The DOM capture IS
// the proof of exposure, so the wire waits for it.
//
// WHAT IS FILLED, and never overwritten when the DOM already said something:
//   is_sponsored  the platform's own paid-placement flag. Standing decision 1
//                 (ads are never harm, and every ad served is recorded) rests
//                 on this flag being right; a boolean in the platform's JSON
//                 is a better witness than a translated DOM label string
//                 (src/content/engagement/ad-labels.ts).
//   feedSource    the surface (for you, following, home, profile, search).
//   mediaUrls     the media addresses the payload carried, merged with the
//                 ones the DOM read. This is how media presence reaches the
//                 record for an item whose DOM node holds a player and no img.
//   author        only when the DOM could not read a handle at all.
//
// The item's own text, since 2026-09-17 (PLAN-2026-09-17 item 6): filled only when the
// DOM read no text at all and the platform's data carried a caption, and then the
// record's `textCapture` is 'platform', so the record never claims the reader's page
// displayed text it did not. Until that day a caption-less TikTok For You video was
// judged by its room only (PLAN-2026-09-14 standing decision 3,
// src/content/post-path/room-verdict.ts); the room still decides where the wire has no
// caption either. Text the DOM did read is never overwritten, with one exception: a
// fragment cut at a "See more" or "Show more" control, when the platform's text for the
// same item is longer and begins with that fragment. The fragment was judged as if it were
// the whole post, so the whole text replaces it and the record is marked 'platform' too.

import type { PostContent } from '../../types/post';

/** Bounded so one long session cannot grow this without limit. */
const MAX_WIRE_ITEMS = 500;

/** The fields a wire capture is allowed to contribute to a record. */
export interface WireFields {
  feedSource?: PostContent['feedSource'];
  isSponsored?: boolean;
  mediaUrls?: string[];
  author?: string;
  /**
   * The caption the platform's JSON carried. Written to a record only when the
   * DOM read no text, and then marked `textCapture: 'platform'` (see the header);
   * also what the room-verdict gate reads (a post the platform itself says has
   * no caption is text-less for certain, not just text-less on this render).
   */
  text?: string;
}

const byIdentity = new Map<string, WireFields>();

/**
 * The identity two capture paths share. It is the pair the record already
 * keys on everywhere: the platform and the item's id, which is what
 * `forensicDedupKey` (src/content/record/forensic-gate.ts) and `sessionVerdictKey`
 * (src/content/post-path/late-verdict-cache.ts) are both built on top of, and what the
 * dashboard groups by (`parentVideoId`).
 *
 * Each wire parser stamps the id in the form its own DOM adapter stamps it
 * (`tk-vid-<videoId>`, `fb-post-<postId>`, `yt-vid-<v>`, the bare X rest_id,
 * the bare Instagram shortcode), so the two paths meet on the same string.
 */
export function wireIdentity(platform: string, id: string): string {
  return platform + '\u0000' + id;
}

function prune(): void {
  if (byIdentity.size < MAX_WIRE_ITEMS) return;
  const keys = Array.from(byIdentity.keys());
  for (let i = 0; i < keys.length / 2; i++) byIdentity.delete(keys[i]);
}

/**
 * Remember what the platform said about one item. Later captures of the same
 * identity fill gaps but never clobber a value that was already real: a
 * continuation response often repeats an item with fewer fields.
 */
export function rememberWireItem(post: PostContent): void {
  const key = wireIdentity(post.platform, post.id);
  const existing = byIdentity.get(key);
  const next: WireFields = {
    feedSource: existing?.feedSource ?? (post.feedSource !== 'unknown' ? post.feedSource : undefined),
    isSponsored: existing?.isSponsored === true ? true : post.is_sponsored === true ? true : existing?.isSponsored,
    mediaUrls: existing?.mediaUrls ?? post.mediaUrls,
    author: existing?.author ?? (post.author && post.author !== 'unknown' ? post.author : undefined),
    text: existing?.text ?? (post.text.trim().length > 0 ? post.text : undefined),
  };
  byIdentity.set(key, next);
  prune();
}

/** Ellipses this close to the end of a text mark a cut; past them is at most the control's own label. */
const CUT_TAIL = 40;

function squash(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

/**
 * Whether the platform's text is the whole of a text the page cut. `seenCut` is the page's own word that it cut the
 * text (X's "Show more" leaves no ellipsis); otherwise the shown text must end in an ellipsis, maybe followed by the
 * control's label, as Facebook's "… See more" does. Either way the shown part, without its ellipsis, must open the
 * platform's text and be shorter than it. A link the page shortens can break the match, and then the shown text stays.
 */
export function completesCutText(shown: string, platformText: string, seenCut = false): boolean {
  let prefix = squash(shown);
  const cutAt = Math.max(prefix.lastIndexOf('…'), prefix.lastIndexOf('...'));
  if (cutAt >= 0 && prefix.length - cutAt <= CUT_TAIL) prefix = prefix.slice(0, cutAt).trim();
  else if (!seenCut) return false;
  if (prefix.length < 20) return false;
  const whole = squash(platformText);
  return whole.length > prefix.length && whole.startsWith(prefix);
}

/** What the platform said about this item, or undefined if it said nothing. */
export function wireFieldsFor(platform: string, id: string): WireFields | undefined {
  return byIdentity.get(wireIdentity(platform, id));
}

/**
 * Fill the gaps on a DOM-captured item from what the platform's JSON said
 * about the same item. Mutates the post in place and returns the names of the
 * fields it filled, which is what the diagnostics counter and the tests read.
 *
 * Called once per item at `onPostDetected`, before `deriveAccountType` reads
 * `is_sponsored` and before the pipeline reads `feedSource`.
 */
export function enrichPostFromWire(post: PostContent): string[] {
  const wire = wireFieldsFor(post.platform, post.id);
  if (!wire) return [];
  const filled: string[] = [];

  if (post.is_sponsored !== true && wire.isSponsored === true) {
    post.is_sponsored = true;
    filled.push('is_sponsored');
  }
  if ((post.feedSource === undefined || post.feedSource === 'unknown') && wire.feedSource) {
    post.feedSource = wire.feedSource;
    filled.push('feedSource');
  }
  if ((!post.author || post.author === 'unknown') && wire.author) {
    post.author = wire.author;
    filled.push('author');
  }
  // The caption the page did not put in its HTML (M138). Only into an empty text, and the
  // record says where the text came from; a DOM-read text, even a short one, is never replaced.
  const wireText = wire.text?.trim() ?? '';
  if (post.text.trim().length === 0 && wireText.length > 0) {
    post.text = wireText;
    post.textCapture = 'platform';
    filled.push('text');
  } else if (wireText.length > 0 && completesCutText(post.text, wireText, post.textCapture === 'cut')) {
    post.text = wireText;
    post.textCapture = 'platform';
    filled.push('text');
  }
  if (wire.mediaUrls && wire.mediaUrls.length > 0) {
    const before = post.mediaUrls ?? [];
    const merged = [...before];
    for (const u of wire.mediaUrls) if (!merged.includes(u)) merged.push(u);
    if (merged.length > before.length) {
      post.mediaUrls = merged;
      filled.push('mediaUrls');
    }
  }
  return filled;
}

/** Page-life scoped; cleared on a route change and by the tests. */
export function clearWireStore(): void {
  byIdentity.clear();
}

export function _wireStoreSizeForTesting(): number {
  return byIdentity.size;
}
