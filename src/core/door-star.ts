// A swearing comment starred at the door before its reading comes back (12 Oct 2026, the Tester's full test).
//
// With a key the swear mask waited for the reading batch: 6.7 s to 13.5 s on a quiet page, and for as long as the
// reading failed when the service answered 500, which left the words as written. The mask is a rule, so it is applied
// the moment the comment is handed over, and the batch goes on to read the comment as before. The star is only the
// page's text: the batch scored the ORIGINAL words and still has to find the row by them, rewrite or hide it, or put
// the same stars back. This note is what lets it: for as long as the row's text holder shows exactly the stars the door
// wrote, the row's own text, as anything that checks it reads it, is the words the comment was scored on.
//
// Pure module, no DOM mutation. Read by the anchor check (forensics/anchor-revalidation.ts) and by the comment row
// builder (content/protection/comment-overlay.ts); written by the door's mask (content/protection/protection-terminals.ts).

export interface DoorStar {
  /** The text holder, whose text the star replaced. */
  textEl: HTMLElement;
  /** What the row reads as to the anchor check before the star (the row's own text, covers left out). */
  rootOriginal: string;
  /** The text holder's trimmed text before the star, and as it stood right after it. */
  entryOriginal: string;
  entryMasked: string;
}

const stars = new WeakMap<HTMLElement, DoorStar>();

const trimmed = (el: Element): string => (el.textContent ?? '').trim();

/**
 * Note a star the door has just written on `rootEl`. `textEl` is the node whose text was replaced and `before` holds
 * the two texts as they stood just before the swap: the row's, as the anchor check reads it, and the holder's.
 */
export function noteDoorStar(rootEl: HTMLElement, textEl: HTMLElement, before: { root: string; entry: string }): void {
  stars.set(rootEl, { textEl, rootOriginal: before.root, entryOriginal: before.entry, entryMasked: trimmed(textEl) });
}

/** The star this row still shows, or null: none was written, or the page or a later swap has since replaced the text. */
export function doorStarStanding(rootEl: HTMLElement): DoorStar | null {
  const star = stars.get(rootEl);
  if (!star) return null;
  if (star.textEl !== rootEl && !rootEl.contains(star.textEl)) return null;
  return trimmed(star.textEl) === star.entryMasked ? star : null;
}

/** The row's text as it was scored while the row shows the door's stars; the live text otherwise. */
export function textBeforeDoorStar(rootEl: HTMLElement, live: string): string {
  return doorStarStanding(rootEl)?.rootOriginal ?? live;
}

/** Whether this comment's row is connected and still shows the door's stars (the page has not moved it or replaced them). */
export function postShowsDoorStar(domRef: WeakRef<HTMLElement> | undefined): boolean {
  const el = domRef?.deref();
  return !!el && el.isConnected && doorStarStanding(el) !== null;
}

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/**
 * A post read from a row that still shows the door's stars is the comment the stars replaced, not a new comment that
 * says "****". The batch gives a comment back for reading again when it was off screen at the flush (the viewport gate),
 * when a cooldown refused it, or when its bucket was abandoned; the extractor then reads the page, which now holds the
 * stars. Left alone that read becomes a second comment with the starred words, judged and recorded as such ("pass", with
 * no swearing to mask), and the comment that was starred is never recorded (the Tester's record check of mv4tym2p, 12 Oct
 * 2026). Returns whether the post's words were put back to the ones the star replaced.
 */
export function restoreScoredText(post: { text: string; domRef?: WeakRef<HTMLElement> }): boolean {
  const el = post.domRef?.deref();
  const star = el ? doorStarStanding(el) : null;
  if (!star || squash(post.text) !== squash(star.entryMasked)) return false;
  post.text = star.entryOriginal;
  return true;
}
