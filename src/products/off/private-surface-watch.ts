// Off — noticing that the page became a private conversation.
//
// The standing rule is that private surfaces are out of scope for every
// filter. Off honoured it once, at boot: `content.ts` returned early when the
// first URL was a DM path, and never looked again. Every one of these sites is
// a single page application, so walking from the feed into Messages changes
// the URL without loading anything, and until 2026-09-19 Off's filters kept
// running there: the word filter, the emoji stripper, the comment block, the
// picker, all of them, over a private conversation.
//
// The recorder has always re-checked, on every route change, and releases its
// covers when the answer turns private (`content/index.ts`). This is the same
// check for the free product, in the shape its filters already use for SPA
// navigation (reels-blocker, ai-content-blocker): a popstate listener plus a
// slow tick, because pushState and replaceState fire no event of their own.
//
// It reports a CHANGE, not a state, so a caller cannot double-stop or
// double-start. The URL gate is one of three defenses and the coarsest; the
// DOM-region gates inside the filters stay exactly where they are.

export interface PrivateSurfaceWatch {
  /** True when the page is a private conversation right now. */
  isPrivate: () => boolean;
  /** The page has just become one: stop everything. */
  onEnter: () => void;
  /** The page has just stopped being one: start again. */
  onLeave: () => void;
  /** How often to re-read the URL. Defaults to the 2s the other filters use. */
  intervalMs?: number;
}

export const PRIVATE_SURFACE_POLL_MS = 2000;

/** Watch for the page turning into a private conversation, and back. */
export function watchPrivateSurface(w: PrivateSurfaceWatch): () => void {
  let wasPrivate = w.isPrivate();
  const check = (): void => {
    const now = w.isPrivate();
    if (now === wasPrivate) return;
    wasPrivate = now;
    if (now) w.onEnter(); else w.onLeave();
  };
  window.addEventListener('popstate', check);
  const timer = setInterval(check, w.intervalMs ?? PRIVATE_SURFACE_POLL_MS);
  return () => {
    window.removeEventListener('popstate', check);
    clearInterval(timer);
  };
}
