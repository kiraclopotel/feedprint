// An emoji drawn as a picture, and the text it stands for. Sites draw many emoji as small images whose alt attribute
// is the emoji itself, so an element's textContent leaves them out. One place decides what counts as an emoji picture
// (the text swap's refusal rule in content/text-box.ts and the readers of emoji-only comments both ask it) and how
// such a comment is read back (the reader that took the text and the render gate that checks it must agree).

const EMOJI_ONLY = /^[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0f\s]+$/u;
const EMOJI_PICTURE_MAX_PX = 32;

/** The data attribute (`data-fw-text-from-pictures`) a reader puts on a body it took from its emoji pictures. */
export const TEXT_FROM_PICTURES_ATTRIBUTE = 'fwTextFromPictures';

export function isEmojiPicture(img: Element): boolean {
  const alt = img.getAttribute('alt') ?? '';
  if (alt.length > 0 && EMOJI_ONLY.test(alt)) return true;
  const w = Number(img.getAttribute('width'));
  const h = Number(img.getAttribute('height'));
  return w > 0 && h > 0 && w <= EMOJI_PICTURE_MAX_PX && h <= EMOJI_PICTURE_MAX_PX;
}

/** A picture that stands for an emoji by its alt text alone: the alt is nothing but emoji, whatever the file or its size. */
export function isEmojiAltPicture(img: Element): boolean {
  const alt = (img.getAttribute('alt') ?? '').trim();
  return alt.length > 0 && alt.length <= 16 && EMOJI_ONLY.test(alt);
}

/**
 * The emoji of the pictures in an element, in page order, joined with nothing between. A picture with no alt adds
 * nothing. Used only for a body that has no words of its own: a body with words keeps its words, so a comment's
 * record is the same as it was before this existed.
 */
export function emojiPictureText(el: Element): string {
  let out = '';
  for (const img of el.querySelectorAll('img')) {
    if (!isEmojiPicture(img)) continue;
    out += (img.getAttribute('alt') ?? '').trim();
  }
  return out;
}
