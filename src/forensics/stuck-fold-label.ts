// The fold control's label, stuck to the end of a text the recorder was handed.
//
// Facebook and Instagram draw the "See more" / "more" control INSIDE the post's body, so the
// adapter's textContent read takes the control's words with the post's: in the owner's record
// (read 12 Oct 2026, 32,748 records) 2,082 of 2,083 Facebook posts marked cut, 47 of 47 cut
// comments, 10 of 10 cut videos and 206 of 206 cut Instagram posts end with the label, and so do
// 14 posts marked whole and 83 marked folded. The label is the platform's button, not anything
// the author wrote, and it made the stored text longer than the post and wrong at its end.
//
// The text is kept as the content script holds it until it is written: the guards that check a
// post against the page (the anchor, the recycle recovery) compare it with the element's own
// text and must keep agreeing. The one place that writes a record calls this, so every path
// (a posted item, a cancelled one, a comment, a post read on request) stores the text without
// the label, and the dashboard calls it for the records written before.
//
// What stays: the ellipsis in front of the label, which is the record's own sign that the text
// was cut. What is never touched: a text that is only the label, a platform that draws its
// control beside the body (X, YouTube, TikTok), and a word at the end of a sentence that merely
// is a label's word ("for more", "see more" in a post with no control and no ellipsis).

import { FOLD_LABELS } from '../core/fold-labels';
import type { TextCapture } from '../types/forensic';

/** The platforms whose control sits inside the body they hand over. */
const CONTROL_INSIDE_THE_BODY = new Set(['facebook', 'instagram']);

const ENDS_IN_ELLIPSIS = /(?:…|\.\.\.)\s*$/u;
const ENDS_IN_SPACE = /\s$/u;
const HAS_SPACE = /\s/u;
const TRAILING_SPACE = /\s+$/u;
const NOTHING_BUT_DOTS = /[\s.…]/gu;

const LABELS_LONGEST_FIRST: readonly string[] = [...FOLD_LABELS].sort((a, b) => b.length - a.length);

/**
 * `text` without a fold control's label stuck to its end, or `text` itself.
 *
 * A label of several words ("See more", "Vezi mai mult") goes when an ellipsis stands before it,
 * or when the page found a control (cut, folded) and a space stands before it. A one-word label
 * ("more") is also a word the author may have ended on, so it goes only when both the ellipsis
 * and the page's control are there.
 */
export function withoutStuckFoldLabel(text: string, platform: string, textCapture?: TextCapture): string {
  if (!CONTROL_INSIDE_THE_BODY.has(platform) || !text) return text;
  const trimmed = text.replace(TRAILING_SPACE, '');
  const lower = trimmed.toLowerCase();
  // A case change that moves the length (some Turkish capitals) leaves no safe place to cut.
  if (lower.length !== trimmed.length) return text;
  const controlFound = textCapture === 'cut' || textCapture === 'folded';
  for (const label of LABELS_LONGEST_FIRST) {
    if (!lower.endsWith(label)) continue;
    const before = trimmed.slice(0, trimmed.length - label.length);
    // Nothing but dots in front of it: no post to take it off.
    if (before.replace(NOTHING_BUT_DOTS, '') === '') return text;
    const afterEllipsis = ENDS_IN_ELLIPSIS.test(before);
    const separated = ENDS_IN_SPACE.test(before);
    const severalWords = HAS_SPACE.test(label);
    const stuck = severalWords
      ? afterEllipsis || (controlFound && separated)
      : afterEllipsis && controlFound;
    // The longest label that ends the text decides: a shorter label inside it is part of its words.
    return stuck ? before.replace(TRAILING_SPACE, '') : text;
  }
  return text;
}
