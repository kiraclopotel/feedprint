// What no filter may hide, whatever its rule says (11 Oct 2026).
//
// Off and the engagement filters hide things by what they look like: a row of buttons, a label, a count. A site
// changes how it draws a page, and a rule that was right on Monday finds a match somewhere it never meant to. The
// owner saw it on Facebook: with Off on, the card that opens when the pointer rests on an account name lost its
// choices to unfollow and to block. Making each rule's guess better is a race against the site; the answer that
// holds is a short list of places and controls that no rule may take, checked at the one door every filter passes
// through (engagement/mark-hidden.ts). A miss then costs one stray button left on screen. A wrong hide costs the person their
// way out of something they did not want to see.
//
//   1. Anything inside a menu, a menubar, a tooltip, a list of choices or an alert dialog. These are layers a person
//      opened on purpose and they are never part of a feed.
//   2. The controls by which a person acts on an account: block, unfollow, unfriend, report. The control itself, a
//      wrapper that is little more than the control (a row, a bar), and anything inside one. A whole post or an
//      ad module that happens to hold a "Report ad" link is much more than that and is not protected by it.
//
// The words are a starting list in the nine languages the engagement finder already knows. A word missing here
// costs nothing worse than today; a menu or a control the roles name is protected whatever its words.

/** Roles of layers that are never feed content. A role=dialog is not here: a post can open in one. */
const POPUP_LAYER_ROLES: readonly string[] = ['menu', 'menubar', 'tooltip', 'listbox', 'alertdialog'];
const POPUP_LAYER_SELECTOR = POPUP_LAYER_ROLES.map((role) => `[role="${role}"]`).join(', ');

/**
 * The same refusal as a selector tail, for a rule written in a stylesheet: `:not(...)` of the layer and everything in
 * it. A hide done in JavaScript asks protectedRegionReason; a hide done in CSS cannot ask, so style-tag.ts appends
 * this to every hiding rule it is given.
 */
export const POPUP_LAYER_GATE_CSS =
  `:not(:is(${POPUP_LAYER_ROLES.map((role) => `[role="${role}"], [role="${role}"] *`).join(', ')}))`;

/** What a person can press. */
const CONTROL_SELECTOR =
  'button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], [role="option"]';

/** A wrapper holding more controls than this is a post or a module, not a row or a bar. */
const SMALL_WRAPPER_MAX_CONTROLS = 8;

/**
 * The largest box, in pixels, that still counts as a card laid over the page rather than a page of its own. The
 * hover card on an account name is a dialog or tooltip layer 230 to 520 wide and 100 to 480 high (the sizes a
 * userscript that works on it looks for); a photo viewer or a post opened in a dialog is far larger.
 */
const CARD_MAX_WIDTH = 520;
const CARD_MAX_HEIGHT = 480;

/** The longest label that is a control's name and not a sentence. */
const LABEL_MAX_CHARS = 60;

// Folded (lower case, no accents) and matched at the start of a word, so "block" finds "Block this person" and
// "Blocked", and does not find "roadblock".
const SAFETY_STEMS: readonly string[] = [
  // block
  'block', 'bloch', 'bloque', 'blockier', 'blocca', 'bloccare', 'zablokuj', 'letilt',
  // unfollow
  'unfollow', 'nu mai urmar', 'dejar de seguir', 'ne plus suivre', 'nicht mehr folgen', 'deixar de seguir',
  'smetti di seguire', 'przestan obserwowac', 'kovetes megszuntet',
  // unfriend
  'unfriend', 'elimina din prieteni', 'elimina din lista de prieteni', 'eliminar de tus amigos', 'eliminar de amigos',
  'supprimer de vos amis', 'retirer des amis', 'aus freunden entfernen', 'freundschaft beenden',
  'desfazer amizade', 'remover amizade', 'rimuovi dagli amici', 'usun ze znajomych', 'baratok kozul',
  // report
  'report', 'raport', 'denunci', 'signal', 'melden', 'segnal', 'zglos', 'jelent',
];

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function labelOf(control: Element): string {
  const aria = control.getAttribute('aria-label');
  const raw = aria && aria.trim() ? aria : (control.textContent ?? '');
  return raw.trim().length > LABEL_MAX_CHARS ? '' : raw;
}

/** True when a control's name is one of the safety words. */
export function isSafetyControl(control: Element): boolean {
  const label = fold(labelOf(control));
  if (!label) return false;
  const padded = ` ${label}`;
  return SAFETY_STEMS.some((stem) => padded.includes(` ${stem}`));
}

/**
 * True when the element is, or sits in, a dialog that is small on screen and holds no post: a card, not a page. A box
 * with no size (not laid out, or hidden) is not judged.
 */
function inSmallCardDialog(el: HTMLElement): boolean {
  const dialog = el.closest('[role="dialog"]');
  if (!dialog) return false;
  if (dialog.querySelector('[role="article"]')) return false;
  const box = dialog.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.width <= CARD_MAX_WIDTH && box.height <= CARD_MAX_HEIGHT;
}

/**
 * Why the door should refuse to hide this element, or null when it may. `popup-layer`: it is, or sits inside, a menu,
 * a tooltip, a list of choices or a small card dialog. `safety-control`: it is, sits inside, or is a small wrapper around, a control for
 * blocking, unfollowing, unfriending or reporting.
 */
export function protectedRegionReason(el: HTMLElement): 'popup-layer' | 'safety-control' | null {
  if (el.closest(POPUP_LAYER_SELECTOR) || inSmallCardDialog(el)) return 'popup-layer';

  const own = el.closest(CONTROL_SELECTOR);
  if (own && isSafetyControl(own)) return 'safety-control';

  const inside = el.querySelectorAll(CONTROL_SELECTOR);
  if (inside.length > 0 && inside.length <= SMALL_WRAPPER_MAX_CONTROLS) {
    for (const control of inside) if (isSafetyControl(control)) return 'safety-control';
  }
  return null;
}
