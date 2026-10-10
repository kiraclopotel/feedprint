// What a marked TikTok video gets, by mode. The record's anchor on TikTok's feed is the whole video
// item, and a text writer handed that item finds no text node or span of its own, so it replaced the
// item's contents (video, caption and buttons) with the rewrite. On a video item the words live in
// the caption and nowhere else, and each mode gets one clear outcome:
//   Child: the video is skipped (hidden, and the feed moves on when it was the one on screen).
//   Teen:  the caption is rewritten; the video plays.
//   Adult: the caption keeps its words and is marked in yellow; the video plays.
// A fold has no meaning on a video (the caption folds, the video goes on playing), so a fold on a
// video item is a hide in every mode; Teen and Adult keep the notice with "show anyway".
// Instagram Reels follow the same rule with one difference: the record's anchor is the caption
// itself, and a reel's box is reused for the next reel, so Child's skip lands on the caption (the
// kind line) and the reel is paused, never the box hidden. Moving on to the next reel by itself
// waits for Instagram's reels scroller to be read on a live page. YouTube Shorts captions are not
// read, so Shorts keep their path.

import type { Mode } from '../../types/mode';
import { videoFeedItemOf } from '../protection/video-feed-hide';

const CAPTION_SELECTOR = '[data-e2e="video-desc"], [data-e2e="browse-video-desc"]';

export const YELLOW_ATTR = 'data-fw-yellow';

export interface VideoWords {
  readonly item: HTMLElement;
  /** The caption inside the item, or null when the item has none loaded. */
  readonly caption: HTMLElement | null;
  /** What a Child skip hides: the whole item on TikTok, the caption on a reel. */
  readonly skipTarget: HTMLElement;
}

/** When `el` is a TikTok video item or an Instagram reel's caption: the item, its caption, the skip target. */
export function videoWordsOf(el: HTMLElement): VideoWords | null {
  const feed = videoFeedItemOf(el);
  if (!feed) return null;
  if (feed.surface.name === 'instagram-reels') {
    // The record is anchored on the caption; handed the box itself there is no caption to aim at,
    // and hiding the box would hide the reels after it.
    if (el === feed.item || !feed.item.contains(el)) return null;
    return { item: feed.item, caption: el, skipTarget: el };
  }
  if (!feed.surface.name.startsWith('tiktok')) return null;
  const caption = el.closest<HTMLElement>(CAPTION_SELECTOR)
    ?? feed.item.querySelector<HTMLElement>(CAPTION_SELECTOR);
  return { item: feed.item, caption: caption && feed.item.contains(caption) ? caption : null, skipTarget: feed.item };
}

/** On a video item a fold becomes a hide; everything else keeps its kind. */
export function kindOnVideo(el: HTMLElement, kind: 'hide' | 'collapse'): 'hide' | 'collapse' {
  return kind === 'collapse' && videoWordsOf(el) ? 'hide' : kind;
}

/** What a rewrite of a video item's words does in this mode. */
export function rewriteOnVideo(mode: Mode): 'skip' | 'rewrite-caption' | 'mark-caption-yellow' {
  if (mode === 'child') return 'skip';
  if (mode === 'adult') return 'mark-caption-yellow';
  return 'rewrite-caption';
}

/** The caption keeps its words and gets a soft yellow background. Idempotent. */
export function markCaptionYellow(caption: HTMLElement): boolean {
  caption.setAttribute(YELLOW_ATTR, 'true');
  caption.style.setProperty('background-color', 'rgba(255, 214, 10, 0.35)', 'important');
  caption.style.setProperty('border-radius', '4px');
  return caption.style.getPropertyValue('background-color') !== '';
}
