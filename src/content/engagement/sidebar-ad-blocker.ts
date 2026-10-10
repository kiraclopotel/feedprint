// FeelingWise — sidebar / banner ad remover.
//
// FEED ads are removed by the post pipeline (injector.ts `injectAdHide`).
// Promoted content in a platform's RIGHT-RAIL sidebar (X's "Ad" banner units)
// is NOT a feed post, so it needs a separate element-hider. Gated on the same
// `block-ads` setting. The whole ad MODULE is hidden (`display:none` → the
// sidebar closes the gap), and the trends / "Who to follow" / Premium modules
// are NEVER touched — the ONLY trigger is the platform's leaf "Ad" / "Promoted"
// label, which those modules don't carry.
//
// Reliability posture: the worst case is a MISSED ad (it stays visible, same as
// today) — never a hidden non-ad, because an ad label is the precondition for
// any hide. The X sidebar structure (modules are direct children of a stacked
// module list) was live-verified 2026-06-15; YouTube + Facebook right-rail ads
// use different structures and are not covered yet (add a selector + re-verify).

import type { Platform } from '../../types/post';
import { isFeatureEnabled, type FWSettings } from '../../storage/settings';
import { hideElement } from './mark-hidden';
import { isAdLabelElement, LABEL_BEARERS } from './ad-labels';
import { isInPrivateChatSubtree } from '../platforms/adapter';
import { decisionForBlock } from '../record/decision';
import { currentPageAddress } from '../record/post-url';
import { recordBlocked } from './recorder-sink';

/** Per-platform right-rail container. Only platforms with a mapped sidebar
 *  are scanned; everything else is a no-op. X was live-verified 2026-06-15.
 *  Facebook's right column ([role="complementary"]) was added 2026-09-03
 *  after the owner's live test showed its sponsored panel surviving Off; the
 *  module-boundary walk is the same, so a structure it cannot resolve is a
 *  missed panel, never a hidden contact list. Not yet live-verified. */
const SIDEBAR_SELECTORS: Partial<Record<Platform, string>> = {
  twitter: '[data-testid="sidebarColumn"]',
  facebook: '[role="complementary"]',
};

const HIDDEN_ATTR = 'data-fw-sidebar-ad-hidden';
/** Set once a module's record is written, so a re-hide after a toggle does not write it twice. */
const LOGGED_ATTR = 'data-fw-sidebar-ad-logged';
const THROTTLE_MS = 600;

/**
 * The ad MODULE = the ancestor of the "Ad" label that is a direct child of the
 * sidebar's stacked module list — i.e. the ancestor along the path whose parent
 * has the MOST children (the module list stacks ~9 modules). Returns null when
 * the path never reaches a clearly-stacked list (guards against an over-hide on
 * an unexpected structure).
 */
function resolveAdModule(label: HTMLElement, root: HTMLElement): HTMLElement | null {
  // The module is named by what it is, not where it sits: the smallest
  // ancestor of the label that also holds an outbound link, the ad the
  // label labels. Facebook's right column (owner's DevTools, 2026-09-03
  // 08:10) keeps the "Sponsored" heading and the ad units in sibling
  // branches under one section; a walk that picked the level with the most
  // siblings hid the heading's branch and left the ads. The guard against an
  // over-hide: the section carries one heading at most, its own, so a block
  // that also holds "Contacts" or any other heading is never taken.
  let cur: HTMLElement | null = label.parentElement;
  while (cur && cur !== root && !hasOutboundLink(cur)) cur = cur.parentElement;
  if (!cur || cur === root || headingCount(cur) > 1) return null;
  // Then up to the section: stop under the first ancestor that is a stack of
  // sections (two or more children with content of their own, or a second
  // heading), which is the module list on X and the column body on Facebook.
  while (cur.parentElement && cur.parentElement !== root) {
    const parent: HTMLElement = cur.parentElement;
    if (headingCount(parent) > 1 || contentChildren(parent) >= 2) break;
    cur = parent;
  }
  return cur;
}

function headingCount(el: Element): number {
  return el.querySelectorAll('h1, h2, h3').length;
}

function contentChildren(el: Element): number {
  let n = 0;
  for (const c of el.children) if ((c.textContent ?? '').trim().length > 0) n++;
  return n;
}

/** A link that leaves the page's host: the ad's own destination, or the platform's click redirector. */
function outboundLink(el: Element): URL | null {
  const here = el.ownerDocument.defaultView?.location.hostname ?? '';
  for (const a of el.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (!/^https?:/i.test(href)) continue;
    try {
      const url = new URL(href);
      if (url.hostname !== here) return url;
    } catch { /* not a URL */ }
  }
  return null;
}
const hasOutboundLink = (el: Element): boolean => outboundLink(el) !== null;

/**
 * Hides each sidebar ad module under `root`. With `record` (the running blocker passes it), each module is also
 * written to the record once per page life, read before it is hidden: the record keeps every ad Receipts hides. In
 * Off the record call is a no-op (recorder-sink.ts).
 */
export function hideSidebarAds(root: HTMLElement, record?: { platform: Platform; mode: FWSettings['mode'] }): void {
  const labels: HTMLElement[] = [];
  // A text leaf, an SVG word (Facebook draws labels as <use> chains, see
  // ad-labels.ts svgUseText) or an aria-label; the fold inside
  // isAdLabelText drops the zero-width space Facebook appends to its
  // "Sponsored" heading.
  root.querySelectorAll<HTMLElement>(LABEL_BEARERS).forEach((el) => {
    // Facebook's right column is where the contacts list and the chat dock
    // live, and the module walk below climbs until it finds a stack of
    // sections, so a label read inside a conversation could take the
    // conversation with it. Nothing in a private surface is a sidebar ad.
    // Added 2026-09-19 with the other four gates.
    if (isInPrivateChatSubtree(el)) return;
    if (isAdLabelElement(el)) labels.push(el);
  });
  for (const label of labels) {
    const moduleEl = resolveAdModule(label, root);
    if (!moduleEl || moduleEl.getAttribute(HIDDEN_ATTR) === 'true') continue;
    // What the record keeps is read before the hide; the record is written once the hide has landed, so it never
    // says an ad was hidden that is still on screen (the same order as the media-only blocker).
    const caption = (moduleEl.textContent ?? '').replace(/\s+/g, ' ').trim();
    const destination = adDestination(moduleEl);
    // Previously the one hide site with neither a reason stamp nor a counter
    // tick; markHidden supplies both.
    const hid = hideElement(moduleEl, {
      marker: HIDDEN_ATTR, value: 'true',
      reason: 'block-ads:sidebar-module',
    });
    if (!hid || !record || moduleEl.getAttribute(LOGGED_ATTR) === 'true') continue;
    moduleEl.setAttribute(LOGGED_ATTR, 'true');
    recordBlocked({
      platform: record.platform,
      mode: record.mode,
      // A sidebar ad names no account the way a post does; its words and its site say who placed it.
      author: '',
      // No outbound link: the page address still says which surface served the ad (as media-only-ad-blocker.ts).
      postUrl: destination ?? currentPageAddress(),
      blockReason: 'ads',
      matchedToken: 'sidebar-ad-label',
      decision: decisionForBlock({ mode: record.mode, blockReason: 'ads', matchedToken: 'sidebar-ad-label', applied: 'hide', mask: false }),
      caption,
    });
  }
}

/**
 * The site the ad points at, when it has an outbound link: the one identifier a sidebar ad carries. Only the origin
 * is kept, since a click redirector's address can carry tokens about the person who saw it.
 */
function adDestination(moduleEl: HTMLElement): string | undefined {
  return outboundLink(moduleEl)?.origin;
}

/**
 * Start the sidebar ad remover for `platform`. No-op unless block-ads is on AND
 * the platform has a verified sidebar selector. Returns a disposer that stops
 * the observer and restores any hidden module.
 */
export function startSidebarAdBlocker(platform: Platform, settings: FWSettings): () => void {
  if (!isFeatureEnabled(settings, 'block-ads', platform)) return () => {};
  const sel = SIDEBAR_SELECTORS[platform];
  if (!sel) return () => {};

  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  let lastRun = 0;
  const run = () => {
    timer = 0;
    lastRun = Date.now();
    document.querySelectorAll<HTMLElement>(sel).forEach((root) => hideSidebarAds(root, { platform, mode: settings.mode }));
  };
  // Throttle to keep the observer cheap on X's busy DOM — at most one scan per
  // THROTTLE_MS, and only the small sidebar subtree is scanned each time.
  const schedule = () => {
    if (timer) return;
    const wait = Math.max(0, THROTTLE_MS - (Date.now() - lastRun));
    timer = setTimeout(run, wait);
  };

  run();
  const mo = new MutationObserver(schedule);
  mo.observe(document.body, { childList: true, subtree: true });

  return () => {
    mo.disconnect();
    if (timer) clearTimeout(timer);
    document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}="true"]`).forEach((el) => {
      el.removeAttribute(HIDDEN_ATTR);
      el.style.removeProperty('display');
    });
  };
}
