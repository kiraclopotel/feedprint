// The popup's two kinds of life, each a class on the page's root so popup-life.css holds both and the build picks:
// depth (a tinted header, a second accent on the today card, one level of elevation, a filled ACTIVE chip) and motion
// (the today count counts up when Home opens, switches slide, cards settle in when their screen opens). Every movement
// follows a change the person made or saw happen, ends within 700 ms, and none runs when the system asks for reduced
// motion.

export const POPUP_LIFE: { readonly depth: boolean; readonly motion: boolean } = { depth: true, motion: false };

/** The count-up's length; the motion rule caps every animation at 700 ms. */
export const COUNT_UP_MS = 600;

export function applyPopupLife(root: HTMLElement = document.documentElement): void {
  root.classList.toggle('fw-life-depth', POPUP_LIFE.depth);
  root.classList.toggle('fw-life-motion', POPUP_LIFE.motion);
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
