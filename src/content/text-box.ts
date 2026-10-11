// Whether a box is a text element or a card. A text swap in a box that holds a video, a picture or a
// control would delete it along with the words, and a reader that picks a post's body should not
// pick such a box when a text box sits inside it. One test for both, so they cannot drift apart.

import { isEmojiPicture } from '../core/emoji-picture';

// Content a text swap would delete along with the words. Emoji pictures are
// not in this set: the swap removes those on purpose.
const NON_TEXT_PAYLOAD_SELECTOR = 'video, audio, iframe, canvas, picture, button, input, textarea, select, img';

// What FeelingWise itself puts inside a post: the marker button, the hide and reveal controls, the
// reading card, the checking shield. Its own controls are not the site's media, and counting them
// would make every later put-back on a marked post refuse. Listed by name, not by a "fw-" prefix,
// so a site's own class can never pass as ours.
export const OWN_CHROME_SELECTOR = '[data-fw-essential], .fw-teen-marker, [data-fw-hide-notice], '
  + '[data-fw-comment-reveal], [data-fw-read-answer], .fw-provisional-shield';

function isOwnChrome(node: Element, box: HTMLElement): boolean {
  const chrome = node.closest(OWN_CHROME_SELECTOR);
  return chrome !== null && chrome !== box && box.contains(chrome);
}

/**
 * True when the box holds a video, a picture or a control beside its words, so it is a
 * card and not a text element. A platform that hands over a whole card would lose those
 * on the swap; the writer refuses instead and the caller's own check reports the failure.
 */
export function holdsMoreThanWords(el: HTMLElement): boolean {
  for (const node of el.querySelectorAll(NON_TEXT_PAYLOAD_SELECTOR)) {
    if (node.tagName === 'IMG' && isEmojiPicture(node)) continue;
    if (isOwnChrome(node, el)) continue;
    return true;
  }
  return false;
}

