// "Block this", in Off and in Feedprint: the human in the loop of the structure map.
//
// The popup arms the picker (a timestamp in chrome.storage.local, no new
// permission); the visible tab's content script takes the next click. A
// click inside a post hides that author's posts for good through the account
// rule the word filter already enforces. A click on anything else (a tray, a
// panel, a suggestion) is remembered as a SHAPE: the selectors from the box
// up to the nearest anchor (a role, an aria-label, a data-testid / data-e2e /
// data-pagelet value, a custom-element tag, or a heading's text), plus the
// box's child tags. Never a class name, never post text. The shape is hidden
// whenever it comes back, under the same guards as every other rule: never
// the page's main column or feed, never a box holding two or more posts. A
// box with no anchor within six levels is refused with a message, because a
// bare div chain would match half the page. Device only. In Feedprint the
// box is hidden on screen only: capture never reads the marker, so the
// record keeps what the platform served.

import type { Platform } from '../../types/post';
import {
  type FWSettings, type PickedBlock, getSettings, saveSettings, updateFeature,
} from '../../storage/settings';
import type { ParentBlocklistValue } from '../../core/parent-blocklist';
import { isOffProduct } from '../../product';
import { resolveUiLanguage, type ResolvedUiLanguage } from '../../i18n';
import { MARKER_STRINGS } from '../../i18n/marker-strings';
import { CONTAINER_SELECTORS, hideTargetFor, readAuthor, tiktokCommentItem } from './word-filter';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { markHidden } from './mark-hidden';
import { observeAddedRoots } from './added-roots';
import { isContextAlive } from '../../storage/context-guard';

export const PICKER_ARMED_KEY = 'fwPickerArmedAt';
/**
 * The answer: the `at` value of the arming a tab actually took. The popup has
 * the `storage` permission and nothing else, so it cannot ask what page is in
 * front of it; before 2026-09-19 it wrote the arming, closed itself, and had
 * no way to learn that no tab was listening. On an unsupported site, on a
 * private-message surface (where the content script deliberately does not
 * run), or on a tab open since before Off was installed, the button did
 * nothing at all and said nothing. This key is how a tab says "I have it".
 */
export const PICKER_ACK_KEY = 'fwPickerArmedAck';
export const PICKED_HIDDEN_MARKER = 'data-fw-picked';

/**
 * How long the popup waits for that answer. The content script answers from a
 * storage listener it already holds, so this is one round trip on a loaded
 * page: long enough that a busy tab still wins, short enough that a person on
 * the wrong page is not left watching a button.
 */
export const PICK_ANSWER_MS = 500;

/**
 * True when some tab took the arming stamped `at`. Lives beside the key it
 * waits on so the two halves of the handshake cannot drift apart: the content
 * script's answer is written a few lines below, in `startPicker`.
 */
export async function pickWasTaken(at: number): Promise<boolean> {
  const answered = await new Promise<boolean>((resolve) => {
    const onChange = (changes: Record<string, chrome.storage.StorageChange>): void => {
      if (changes[PICKER_ACK_KEY]?.newValue !== at) return;
      chrome.storage.onChanged.removeListener(onChange);
      resolve(true);
    };
    chrome.storage.onChanged.addListener(onChange);
    setTimeout(() => {
      chrome.storage.onChanged.removeListener(onChange);
      resolve(false);
    }, PICK_ANSWER_MS);
  });
  if (answered) return true;
  // One last look, in case the answer landed between the timeout firing and
  // the listener coming off.
  const late = await chrome.storage.local.get(PICKER_ACK_KEY);
  return late[PICKER_ACK_KEY] === at;
}
const ARM_TTL_MS = 60_000;
const NEVER = 'html, body, main, [role="main"], [role="feed"], [role="dialog"], form, header, footer';
const ANCHOR_ATTRS = ['role', 'aria-label', 'data-testid', 'data-e2e', 'data-pagelet'] as const;
const HEADING = 'h1, h2, h3, h4';

export interface Shape { chain: string[]; children: string; heading?: string }

function esc(v: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, '\\$&');
}

function headingText(el: Element): string {
  const h = el.querySelector(HEADING);
  const t = (h?.textContent ?? '').trim();
  return t.length > 0 && t.length <= 60 ? t : '';
}

function hasAnchor(el: Element): boolean {
  if (el.tagName.includes('-')) return true;
  return ANCHOR_ATTRS.some(a => (el.getAttribute(a) ?? '') !== '');
}

/** One level of a shape: the tag plus the values that name it, no classes. */
function selectorFor(el: Element): string {
  let s = el.tagName.toLowerCase();
  for (const a of ANCHOR_ATTRS) {
    const v = el.getAttribute(a);
    if (v) s += `[${a}="${esc(v)}"]`;
  }
  return s;
}

function childTags(el: Element): string {
  return Array.from(el.children).map(c => c.tagName.toLowerCase()).join(',');
}

/**
 * The shape of a box, or null when nothing within six levels names it. A
 * box with a heading of its own is named by that heading (platform UI copy
 * such as "Suggested for you"), the one text a shape may carry.
 */
export function shapeFor(box: Element): Shape | null {
  const chain: string[] = [];
  let cur: Element | null = box;
  for (let i = 0; cur && i < 6; i++) {
    if (cur.matches(NEVER)) return null;
    chain.push(selectorFor(cur));
    if (hasAnchor(cur)) return { chain, children: childTags(box) };
    cur = cur.parentElement;
  }
  const heading = headingText(box);
  return heading ? { chain: [selectorFor(box)], children: childTags(box), heading } : null;
}

function guard(el: Element, platform: Platform): boolean {
  if (el.matches(NEVER)) return false;
  // A private conversation is out of scope for every filter, and the picker is
  // the one that would carry it furthest: a shape is scanned against the whole
  // document every two seconds, so a shape recorded anywhere that happens to
  // match a message row would hide chat messages on every later visit. NEVER
  // above stops the chat dialog ITSELF from being taken; it says nothing about
  // the rows inside it, and it does not mention [role="log"] at all.
  // Found reading the free product on 2026-09-19.
  if (isInPrivateChatSubtree(el)) return false;
  if (el.querySelectorAll(CONTAINER_SELECTORS[platform]).length >= 2) return false;
  const r = el.getBoundingClientRect();
  return r.width >= 24 && r.height >= 24;
}

/** True when `el` sits in the remembered shape: the selector chain level by level and the same child tags. */
export function matchesShape(el: Element, shape: Shape): boolean {
  let cur: Element | null = el;
  for (const sel of shape.chain) {
    if (!cur || !cur.matches(sel)) return false;
    cur = cur.parentElement;
  }
  if (shape.heading && headingText(el) !== shape.heading) return false;
  return childTags(el) === shape.children;
}

export type Boundary =
  | { kind: 'post'; el: Element; container: Element; author?: string }
  | { kind: 'box'; el: Element };

/** What a click on `target` would hide, or null when nothing safe is there. */
export function boundaryFor(target: Element, platform: Platform): Boundary | null {
  // Refused inside a private conversation, before either branch. The account
  // branch below never reaches guard(), and it is the worse of the two: it
  // reads the author's name off the box and writes it into the blocklist, so a
  // click on a message row would put the name of the person someone is talking
  // to privately into stored settings. Returning null here shows the same
  // "nothing to block there" message as any other refused pick.
  if (isInPrivateChatSubtree(target)) return null;
  // A TikTok comment is the box around its parts (name, picture, text).
  const item = platform === 'tiktok' ? tiktokCommentItem(target) : null;
  const post = item ?? target.closest(CONTAINER_SELECTORS[platform]);
  if (post) {
    const box = item ?? hideTargetFor(post as HTMLElement, platform);
    return { kind: 'post', el: box, container: post, author: readAuthor(box, platform) };
  }
  let cur: Element | null = target;
  for (let i = 0; cur && i < 12; i++) {
    if (cur.matches(NEVER)) return null;
    if ((hasAnchor(cur) || headingText(cur) !== '') && guard(cur, platform)) return { kind: 'box', el: cur };
    cur = cur.parentElement;
  }
  return null;
}

function hideBox(el: HTMLElement, reason: string): void {
  if (!markHidden(el, { marker: PICKED_HIDDEN_MARKER, value: 'true', reason, feature: 'picker' })) return;
  el.style.setProperty('display', 'none', 'important');
}

function resetPickedDOM(): void {
  document.querySelectorAll<HTMLElement>(`[${PICKED_HIDDEN_MARKER}="true"]`).forEach((el) => {
    el.removeAttribute(PICKED_HIDDEN_MARKER);
    el.removeAttribute('data-fw-block-reason');
    el.style.removeProperty('display');
  });
}

/** Hide every remembered shape for this platform under `root`. */
export function scanPicked(root: ParentNode, platform: Platform, picks: readonly PickedBlock[]): number {
  let hidden = 0;
  for (const pick of picks) {
    if (pick.platform !== platform || pick.chain.length === 0) continue;
    const candidates = new Set<Element>();
    try {
      if (pick.heading) {
        // Named by a heading: start from headings with that text and climb
        // to the box, instead of testing every element of the box's tag.
        root.querySelectorAll(HEADING).forEach((h) => {
          if ((h.textContent ?? '').trim() !== pick.heading) return;
          const box = h.parentElement?.closest(pick.chain[0]);
          if (box) candidates.add(box);
        });
      } else {
        if (root instanceof Element && root.matches(pick.chain[0])) candidates.add(root);
        root.querySelectorAll(pick.chain[0]).forEach(c => candidates.add(c));
      }
    } catch { continue; }
    for (const c of candidates) {
      if (!(c instanceof HTMLElement) || c.getAttribute(PICKED_HIDDEN_MARKER) === 'true') continue;
      if (!matchesShape(c, pick) || !guard(c, platform)) continue;
      hideBox(c, 'picker:shape');
      hidden++;
    }
  }
  return hidden;
}

/** Apply the remembered shapes, and follow the list as the popup changes it. */
export function startPickedBlocks(platform: Platform, settings: FWSettings): () => void {
  let picks = (settings.pickedBlocks ?? []).filter(p => p.platform === platform);
  const scanAll = (): void => { if (picks.length > 0) scanPicked(document, platform, picks); };
  scanAll();
  const stopAdded = observeAddedRoots((roots) => { if (picks.length > 0) for (const root of roots) scanPicked(root, platform, picks); });
  const interval = setInterval(scanAll, 2000);
  const listener = (changes: Record<string, chrome.storage.StorageChange>): void => {
    if (!changes.pickedBlocks) return;
    const next = (changes.pickedBlocks.newValue as PickedBlock[] | undefined) ?? [];
    picks = next.filter(p => p.platform === platform);
    // A removed pick must let its boxes back: reset, then re-apply what is left.
    resetPickedDOM();
    scanAll();
  };
  // An extension reloaded under the tab leaves this script without storage events; it goes quiet instead of throwing.
  if (isContextAlive()) chrome.storage.onChanged.addListener(listener);
  return () => {
    stopAdded();
    clearInterval(interval);
    chrome.storage?.onChanged?.removeListener(listener);
    resetPickedDOM();
  };
}

// ─── The pick itself ───

/** The popup a pick is undone in, named in the toast. */
const productName = (): string => (isOffProduct() ? 'Off' : 'Feedprint');

export function toast(text: string): void {
  const el = document.createElement('div');
  el.setAttribute('data-fw-picker-toast', 'true');
  el.textContent = text;
  el.style.cssText = 'position:fixed;left:50%;bottom:32px;transform:translateX(-50%);z-index:2147483647;'
    + 'background:#111;color:#fff;padding:10px 16px;border-radius:10px;font:13px/1.4 system-ui,sans-serif;'
    + 'box-shadow:0 4px 18px rgba(0,0,0,.35);pointer-events:none;max-width:80vw;';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/** What the popup shows for a pick; '' when the box names itself nowhere (the popup says so). */
function labelFor(el: Element): string {
  const role = el.getAttribute('role');
  const l = el.getAttribute('aria-label') || headingText(el) || (role && role !== 'none' && role !== 'presentation' ? role : '');
  return l.length > 40 ? `${l.slice(0, 39)}…` : l;
}

function sameShape(a: Shape, b: Shape): boolean {
  return a.chain.join(' > ') === b.chain.join(' > ') && a.children === b.children && (a.heading ?? '') === (b.heading ?? '');
}

async function rememberShape(box: Element, platform: Platform): Promise<boolean> {
  const shape = shapeFor(box);
  if (!shape) return false;
  const fresh = await getSettings();
  // The same box picked again (it came back in a form the shape did not
  // match, or the pick was repeated) adds nothing to the list.
  if ((fresh.pickedBlocks ?? []).some(p => p.platform === platform && sameShape(p, shape))) return true;
  const pick: PickedBlock = {
    id: `pk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    platform,
    createdAt: new Date().toISOString(),
    chain: shape.chain,
    children: shape.children,
    ...(shape.heading ? { heading: shape.heading } : {}),
    label: labelFor(box),
  };
  await saveSettings({ pickedBlocks: [...(fresh.pickedBlocks ?? []), pick] });
  return true;
}

async function rememberAccount(handle: string): Promise<void> {
  await updateFeature('parent-blocklist', (cur) => {
    const value = (cur.value as ParentBlocklistValue | undefined) ?? { words: [], phrases: [], accounts: [] };
    const accounts = value.accounts.includes(handle) ? value.accounts : [...value.accounts, handle];
    return { ...cur, enabled: true, value: { ...value, accounts } };
  });
}

export interface ArmPickOptions {
  /** The toast shown when the crosshair appears. */
  hint: string;
  /** With `many` the picker stays armed after each pick until Esc. */
  many?: boolean;
  /** Called with what the click landed on (null when nothing safe was there). */
  onPick: (boundary: Boundary | null) => void;
  onDone: () => void;
}

/**
 * Arm the crosshair on this page and hand each click's boundary to the
 * caller; returns the disarm function. Off's "block this" and the recorder's
 * "read this for me" share this: the outline, the click capture, Esc, and
 * the boundary rule are the same, only what happens to the pick differs.
 */
export function armPick(platform: Platform, opts: ArmPickOptions): () => void {
  const many = opts.many === true;
  const outline = document.createElement('div');
  outline.setAttribute('data-fw-picker-outline', 'true');
  outline.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;display:none;'
    + 'outline:2px solid #14b8a6;outline-offset:-2px;background:rgba(20,184,166,.12);border-radius:6px;';
  const cursor = document.createElement('style');
  cursor.textContent = '*{cursor:crosshair!important}';
  document.body.append(outline, cursor);
  toast(opts.hint);

  let current: Boundary | null = null;
  const place = (b: Boundary | null): void => {
    current = b;
    if (!b) { outline.style.display = 'none'; return; }
    const r = b.el.getBoundingClientRect();
    outline.style.display = 'block';
    outline.style.left = `${r.left}px`; outline.style.top = `${r.top}px`;
    outline.style.width = `${r.width}px`; outline.style.height = `${r.height}px`;
  };
  const onMove = (e: MouseEvent): void => {
    const target = e.target instanceof Element ? e.target : null;
    place(target && !target.hasAttribute('data-fw-picker-outline') ? boundaryFor(target, platform) : null);
  };
  const stop = (): void => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    outline.remove();
    cursor.remove();
    opts.onDone();
  };
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); stop(); } };
  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.target instanceof Element ? e.target : null;
    const b = current ?? (target ? boundaryFor(target, platform) : null);
    if (many) place(null); else stop();
    opts.onPick(b);
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);
  return stop;
}

/**
 * Arm Off's "block this" on this page; returns the disarm function. With
 * `many` (the owner asked that a user can block several things in a row) the
 * picker stays armed after each pick until Esc.
 */
export function arm(platform: Platform, lang: ResolvedUiLanguage, onDone: () => void, many = false): () => void {
  const t = MARKER_STRINGS[lang];
  return armPick(platform, {
    hint: many ? t.pickHintMany : t.pickHint,
    many,
    onDone: () => {
      void chrome.storage.local.remove(PICKER_ARMED_KEY);
      onDone();
    },
    onPick: (b) => {
      if (!b) { toast(t.pickRefused); return; }
      // Hide first, so the click answers at once; the write follows.
      if (b.kind === 'post') {
        if (!b.author) { toast(t.pickRefused); return; }
        hideBox(b.el as HTMLElement, 'picker:account');
        toast(t.pickHiddenAccount(b.author, productName()));
        void rememberAccount(b.author);
        return;
      }
      if (!shapeFor(b.el)) { toast(t.pickRefused); return; }
      hideBox(b.el as HTMLElement, 'picker:shape');
      toast(t.pickHiddenShape(productName()));
      void rememberShape(b.el, platform);
    },
  });
}

/** Listen for the popup's arming timestamp; the visible tab takes the pick. */
export function startPicker(platform: Platform, settings: FWSettings): () => void {
  const lang = resolveUiLanguage(settings.uiLanguage);
  let disarm: (() => void) | null = null;
  const listener = (changes: Record<string, chrome.storage.StorageChange>): void => {
    const c = changes[PICKER_ARMED_KEY];
    if (!c) return;
    // The popup writes a number (one pick) or { at, many } (until Esc).
    const v = c.newValue as number | { at?: number; many?: boolean } | undefined;
    const at = typeof v === 'number' ? v : typeof v?.at === 'number' ? v.at : null;
    // The key is removed when a pick completes in any window; every other
    // visible window that armed on the same press stands down here.
    if (at === null) { disarm?.(); return; }
    if (Date.now() - at > ARM_TTL_MS || document.visibilityState !== 'visible') return;
    disarm?.();
    disarm = arm(platform, lang, () => { disarm = null; }, typeof v === 'object' && v.many === true);
    // Answered only once the crosshair is really up, so the popup's message
    // means what it says. Every visible window that armed on the same press
    // writes the same value, which is why it is the arming's own timestamp
    // and not a counter.
    void chrome.storage.local.set({ [PICKER_ACK_KEY]: at });
  };
  if (isContextAlive()) chrome.storage.onChanged.addListener(listener);
  return () => { chrome.storage?.onChanged?.removeListener(listener); disarm?.(); };
}
