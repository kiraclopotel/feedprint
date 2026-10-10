// What a hidden item needs on every path: its media silenced, and on Instagram a line saying why
// the kept box is blank. Kept out of injector.ts because its imports reach the AI client, and Off's
// ad blockers need these without it.
import { videoFeedItemOf, silenceVideoItem } from './protection/video-feed-hide';

/**
 * Hiding a video with visibility or display does not stop its sound, so every media element in
 * `root` (and `root` itself) is muted and paused; muting moves no layout, so unlike display:none
 * it cannot set off TikTok's auto-advance to the next video. On a single-player video feed the
 * platform carries `muted` over to the next video, so there the item is paused and kept paused and
 * `muted` goes back to the user's own state.
 */
export function muteAndPauseMedia(root: ParentNode): void {
  const els: HTMLMediaElement[] = [];
  if (root instanceof HTMLMediaElement) els.push(root);
  root.querySelectorAll<HTMLMediaElement>('video, audio').forEach((m) => els.push(m));
  const scopedItems = new Set<HTMLElement>();
  for (const m of els) {
    const feed = videoFeedItemOf(m);
    if (feed) {
      if (!scopedItems.has(feed.item)) {
        scopedItems.add(feed.item);
        silenceVideoItem(feed.item);
      }
      continue;
    }
    try {
      m.muted = true;
      m.pause();
    } catch {
      // media element in a transitional state — best effort
    }
  }
}

export const AD_SLOT_NOTE_ATTR = 'data-fw-ad-slot-note';

/**
 * Instagram keeps a hidden ad's box, which reads as an unexplained gap, so one line says an ad was
 * there. The line is absolutely positioned because Instagram places and loads its feed from the
 * heights it has measured: shrinking the box to 0 or to 60px stopped the feed loading on the
 * live page.
 */
export function noteAdSlot(container: HTMLElement, text: string): void {
  if (container.querySelector(`:scope > [${AD_SLOT_NOTE_ATTR}]`)) return;
  const position = getComputedStyle(container).position;
  // '' is jsdom, which computes no position at all; a browser says 'static'.
  if (!position || position === 'static') {
    container.setAttribute('data-fw-prev-position', container.style.position);
    container.style.setProperty('position', 'relative');
  }
  const note = document.createElement('div');
  note.setAttribute(AD_SLOT_NOTE_ATTR, 'true');
  note.textContent = text;
  note.style.cssText = 'visibility:visible;position:absolute;top:0;left:0;right:0;padding:14px 16px;'
    + 'font:12px/1.4 system-ui,sans-serif;color:#8e8e8e;text-align:center;pointer-events:none;';
  container.prepend(note);
}

/** Reverse noteAdSlot: the note goes, the box's position comes back. */
export function removeAdSlotNote(container: HTMLElement): void {
  container.querySelectorAll(`:scope > [${AD_SLOT_NOTE_ATTR}]`).forEach(n => n.remove());
  const prev = container.getAttribute('data-fw-prev-position');
  if (prev !== null) {
    if (prev) container.style.setProperty('position', prev);
    else container.style.removeProperty('position');
    container.removeAttribute('data-fw-prev-position');
  }
}
