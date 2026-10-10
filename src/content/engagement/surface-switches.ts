// The surface switches (owner 2026-09-03, idea 2 of the fourth look): the
// Stories and Reels trays, the suggestion blocks, Marketplace, Groups and the
// right column, per platform, DOM only, free.
//
// Every rule is built the structure map's way (docs/spec/STRUCTURE-MAP.md):
// an anchor the platform cannot drop (a link to its own route such as
// /stories/, /reel/, /explore/people/, /marketplace/; a landmark role; the
// feed unit's own attribute) and a box computed from the anchor by
// relationship (climb to the first ancestor whose parent is a stack of
// sections), never by class name. The worst case is a missed surface, never
// a hidden feed: a box that would take the page's main column, two or more
// posts, or a place to type is refused. Marketplace and Groups also hide
// their own pages by URL, the way the Reels pages are hidden.

import type { Platform } from '../../types/post';
import { isFeatureEnabled, type FeatureId, type FWSettings } from '../../storage/settings';
import { hideElement } from './mark-hidden';
import { observeAddedRoots } from './added-roots';
import { CONTAINER_SELECTORS } from './word-filter';
import { isInPrivateChatSubtree } from '../platforms/adapter';

export const SURFACE_HIDDEN_MARKER = 'data-fw-surface';
const NEVER = 'html, body, main, [role="main"], [role="feed"], [role="dialog"], form, header, footer';
const TYPING = 'textarea, [contenteditable="true"], [role="textbox"]';
const FULL_PASS_MS = 2000;

type SurfaceFeature = Extract<FeatureId,
  'hide-stories' | 'hide-suggestions' | 'hide-marketplace' | 'hide-groups' | 'hide-right-column' | 'block-reels'>;

interface SurfaceRule {
  /** `<platform>:<surface>`, the marker value and the reason's detail. */
  id: string;
  feature: SurfaceFeature;
  platform: Platform;
  /** The boxes under `root` this rule would hide; each is guarded before the hide. */
  find(root: ParentNode): Element[];
  /** The box legitimately holds post-shaped tiles (a shelf of Shorts), so the two-posts guard is the rule's own. */
  allowPosts?: boolean;
}

/** A whole page hidden by its route, the way the Reels pages are. */
interface PageRule {
  id: string;
  feature: SurfaceFeature;
  platform: Platform;
  path: RegExp;
}

// ─── Relationships ───

/**
 * The pathname of a link on this host; '' for an outbound or unparsable one.
 * String work only: measured 2026-09-03, `new URL` on every anchor of a
 * 28k-node page doubled the insert-to-hide latency.
 */
function pathOf(a: Element): string {
  const href = a.getAttribute('href') ?? '';
  if (href.startsWith('/')) return href.startsWith('//') ? '' : href.split(/[?#]/, 1)[0];
  if (!/^https?:\/\//i.test(href)) return '';
  const rest = href.slice(href.indexOf('//') + 2);
  const slash = rest.indexOf('/');
  const host = (slash < 0 ? rest : rest.slice(0, slash)).toLowerCase();
  if (host !== location.hostname.toLowerCase()) return '';
  return slash < 0 ? '/' : rest.slice(slash).split(/[?#]/, 1)[0];
}

/** The links under `el` whose path passes `test`; `sel` narrows the candidates by attribute first. */
function links(el: ParentNode, test: (path: string) => boolean, sel = 'a[href]'): HTMLAnchorElement[] {
  const out: HTMLAnchorElement[] = [];
  el.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => { if (test(pathOf(a))) out.push(a); });
  return out;
}

function contentChildren(el: Element): number {
  let n = 0;
  for (const c of el.children) if ((c.textContent ?? '').trim().length > 0) n++;
  return n;
}

/**
 * From an anchor up to its section: the first ancestor whose parent is a
 * stack of sections (two or more children with content of their own). The
 * same walk as the sidebar ad blocker's, without its root.
 */
function sectionOf(el: Element): Element | null {
  let cur: Element = el;
  while (cur.parentElement) {
    const parent: Element = cur.parentElement;
    if (parent.matches(NEVER) || contentChildren(parent) >= 2) return cur;
    cur = parent;
  }
  return null;
}

/** A nav entry: the link's list item, else the link and its single-child wrappers. */
function navEntryOf(a: Element): Element {
  const li = a.closest('li');
  if (li) return li;
  let cur: Element = a;
  while (cur.parentElement && cur.parentElement.children.length === 1 && !cur.parentElement.matches(NEVER)) {
    cur = cur.parentElement;
  }
  return cur;
}

/** The first element under `root`, top-most, with `min` or more children of its own content. */
function stackUnder(root: Element, min: number): Element | null {
  const queue: Element[] = [root];
  while (queue.length > 0) {
    const el = queue.shift() as Element;
    if (el !== root && contentChildren(el) >= min) return el;
    queue.push(...Array.from(el.children));
  }
  return null;
}

function guard(box: Element, rule: SurfaceRule): boolean {
  if (box.matches(NEVER) || box.querySelector(TYPING)) return false;
  // The same gap the picker had, found the same day (2026-09-19): NEVER holds
  // `[role="dialog"]`, so a chat window cannot be taken whole, and says
  // nothing about a box inside one; `[role="log"]` is not in that list at all.
  // TYPING refuses a box holding a composer, which catches an open chat
  // window, and not a read-only message list.
  if (isInPrivateChatSubtree(box)) return false;
  if (!rule.allowPosts && box.querySelectorAll(CONTAINER_SELECTORS[rule.platform]).length >= 2) return false;
  return true;
}

// ─── The rules, per platform ───

const isStory = (p: string): boolean => p.startsWith('/stories/');
const isReel = (p: string): boolean => /^\/reels?\/./.test(p);
const isShort = (p: string): boolean => p.startsWith('/shorts/');
const STORY_LINKS = 'a[href*="/stories/"]';
const REEL_LINKS = 'a[href*="/reel"]';
const SHORT_LINKS = 'a[href*="/shorts"]';
const NAV_LINKS = '[role="navigation"] a[href]';

const RULES: SurfaceRule[] = [
  // Instagram. Read live 2026-09-03: the story tray is `[data-pagelet="story_tray"]`
  // (a `ul` of 13 buttons, no links) six divs under the feed column; the
  // "Suggested for you" block carries no role and no heading element, but its
  // "See all" link goes to /explore/people/, and the block is the middle of a
  // three-section stack (account row, suggestions, footer) in the column beside
  // the feed.
  {
    id: 'instagram:stories', feature: 'hide-stories', platform: 'instagram',
    find(root) {
      const out: Element[] = [];
      root.querySelectorAll('[data-pagelet="story_tray"], main ul').forEach((el) => {
        if (el.tagName === 'UL') {
          const items = Array.from(el.children).filter(li => li.tagName === 'LI');
          if (items.length < 5 || el.querySelector('a[href]') || !items.every(li => li.querySelector('button'))) return;
        }
        const box = sectionOf(el);
        if (box) out.push(box);
      });
      return out;
    },
  },
  {
    id: 'instagram:suggestions', feature: 'hide-suggestions', platform: 'instagram',
    find(root) {
      const out: Element[] = [];
      for (const a of links(root, p => p.startsWith('/explore/people'), 'a[href*="/explore/people"]')) {
        // Past the header row (the label and the See all link) to the box
        // that also holds the suggested profiles, then up to the section.
        let cards: Element | null = a.parentElement;
        while (cards && links(cards, p => p !== '' && !p.startsWith('/explore/people')).length < 2) cards = cards.parentElement;
        const box = cards ? sectionOf(cards) : null;
        if (box && !box.querySelector('article')) out.push(box);
      }
      return out;
    },
  },
  {
    id: 'instagram:right-column', feature: 'hide-right-column', platform: 'instagram',
    // The column beside the feed: the sibling, in a two-child row, of the
    // branch that holds the posts. No text, no role needed.
    find(root) {
      const article = root.querySelector('main article');
      let cur: Element | null = article;
      while (cur && cur.parentElement && !cur.parentElement.matches('main')) {
        const parent: Element = cur.parentElement;
        if (parent.children.length === 2) {
          const other = Array.from(parent.children).find(c => c !== cur) as Element;
          if (!other.querySelector('article')) return [other];
        }
        cur = parent;
      }
      return [];
    },
  },
  {
    id: 'instagram:reels-nav', feature: 'block-reels', platform: 'instagram',
    find(root) { return links(root, p => p === '/reels/', 'a[href*="/reels"]').map(navEntryOf); },
  },

  // Facebook. Read live 2026-09-03: the stories tray is a `[role="region"]`
  // labelled "Stories" holding `/stories/` links; the Reels tray is a feed
  // unit (`[aria-posinset]`) holding six `/reel/` links under a "Reels"
  // heading; Marketplace, Groups and Reels are `li` entries in the top and
  // left navigations; the right column is `[role="complementary"]` (the
  // sponsored panel and the contacts). "People you may know" is a feed unit
  // with a row of profile cards and a "See all" link; its link to
  // /friends/suggestions is the anchor (not yet read live: the feed stalled).
  {
    id: 'facebook:stories', feature: 'hide-stories', platform: 'facebook',
    find(root) {
      const out = new Set<Element>();
      for (const a of links(root, isStory, STORY_LINKS)) {
        const region = a.closest('[role="region"]');
        if (region && links(region, isStory, STORY_LINKS).length >= 2 && !region.querySelector('[aria-posinset]')) out.add(region);
      }
      return [...out];
    },
  },
  {
    id: 'facebook:reels-tray', feature: 'block-reels', platform: 'facebook',
    find(root) {
      const out: Element[] = [];
      root.querySelectorAll('[aria-posinset]').forEach((unit) => {
        if (links(unit, isReel, REEL_LINKS).length >= 3) out.push(unit);
      });
      return out;
    },
  },
  {
    id: 'facebook:reels-nav', feature: 'block-reels', platform: 'facebook',
    find(root) { return links(root, p => p === '/reel/', NAV_LINKS).map(navEntryOf); },
  },
  {
    id: 'facebook:suggestions', feature: 'hide-suggestions', platform: 'facebook',
    find(root) {
      const out = new Set<Element>();
      for (const a of links(root, p => p.startsWith('/friends/suggestions'), 'a[href*="/friends/suggestions"]')) {
        const unit = a.closest('[aria-posinset]');
        if (unit) out.add(unit);
      }
      return [...out];
    },
  },
  {
    id: 'facebook:marketplace', feature: 'hide-marketplace', platform: 'facebook',
    find(root) { return links(root, p => p.startsWith('/marketplace'), NAV_LINKS).map(navEntryOf); },
  },
  {
    id: 'facebook:groups', feature: 'hide-groups', platform: 'facebook',
    find(root) { return links(root, p => p === '/groups/', NAV_LINKS).map(navEntryOf); },
  },
  {
    id: 'facebook:right-column', feature: 'hide-right-column', platform: 'facebook',
    find(root) { return Array.from(root.querySelectorAll('[role="complementary"]')); },
  },

  // X. The sidebar is `[data-testid="sidebarColumn"]` (live-verified
  // 2026-06-15 for the ad modules): a stack of modules with the search box
  // first. The right column switch hides every module that is not the search
  // box; the suggestions switch hides the module with two or more follow
  // buttons (`data-testid` ending in -follow) and the timeline cells that hold
  // user cells and no post.
  {
    id: 'twitter:right-column', feature: 'hide-right-column', platform: 'twitter',
    find(root) {
      const out: Element[] = [];
      root.querySelectorAll('[data-testid="sidebarColumn"]').forEach((col) => {
        const stack = stackUnder(col, 2);
        if (!stack) return;
        for (const child of stack.children) if (!child.querySelector('input')) out.push(child);
      });
      return out;
    },
  },
  {
    id: 'twitter:suggestions', feature: 'hide-suggestions', platform: 'twitter',
    find(root) {
      const out = new Set<Element>();
      root.querySelectorAll('[data-testid$="-follow"]').forEach((btn) => {
        const cell = btn.closest('[data-testid="cellInnerDiv"]');
        if (cell) {
          if (!cell.querySelector('article')) out.add(cell);
          return;
        }
        const col = btn.closest('[data-testid="sidebarColumn"]');
        const stack = col ? stackUnder(col, 2) : null;
        if (!stack) return;
        for (const child of stack.children) {
          if (child.contains(btn) && child.querySelectorAll('[data-testid$="-follow"]').length >= 2) out.add(child);
        }
      });
      return [...out];
    },
  },

  // YouTube. The Shorts shelf on the home grid and the Shorts entries in the
  // guide: a box holding three or more `/shorts/` links whose tiles are all
  // Shorts (the grid of ordinary videos holds none).
  {
    id: 'youtube:shorts-shelf', feature: 'block-reels', platform: 'youtube', allowPosts: true,
    find(root) {
      const out = new Set<Element>();
      for (const a of links(root, isShort, SHORT_LINKS)) {
        let cur: Element | null = a;
        while (cur && links(cur, isShort, SHORT_LINKS).length < 3) cur = cur.parentElement;
        if (!cur) continue;
        const box = sectionOf(cur) ?? cur;
        const tiles = box.querySelectorAll('ytd-rich-item-renderer');
        if (tiles.length > 0 && Array.from(tiles).some(t => links(t, isShort, SHORT_LINKS).length === 0)) continue;
        // This rule may take a box holding several items, so a box with any ordinary video in it is
        // not a Shorts shelf: single Shorts listed among ordinary results would otherwise climb to
        // the whole page.
        if (links(box, p => p === '/watch').length > 0) continue;
        out.add(box);
      }
      return [...out];
    },
  },
  {
    id: 'youtube:shorts-nav', feature: 'block-reels', platform: 'youtube',
    find(root) {
      const out = new Set<Element>();
      for (const a of links(root, p => p === '/shorts' || p === '/shorts/', SHORT_LINKS)) {
        const entry = a.closest('ytd-guide-entry-renderer, ytd-mini-guide-entry-renderer');
        if (entry) out.add(entry);
      }
      return [...out];
    },
  },
];

const PAGES: PageRule[] = [
  { id: 'facebook:marketplace-page', feature: 'hide-marketplace', platform: 'facebook', path: /^\/marketplace(\/|$)/ },
  { id: 'facebook:groups-page', feature: 'hide-groups', platform: 'facebook', path: /^\/groups\/(feed\/?)?$/ },
];

export function surfaceRulesFor(platform: Platform, settings: FWSettings): { rules: SurfaceRule[]; pages: PageRule[] } {
  const on = (f: SurfaceFeature): boolean => isFeatureEnabled(settings, f, platform);
  return {
    rules: RULES.filter(r => r.platform === platform && on(r.feature)),
    pages: PAGES.filter(p => p.platform === platform && on(p.feature)),
  };
}

// ─── The hide ───

function hide(el: Element, id: string, feature: SurfaceFeature, platform: Platform): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const opts = { marker: SURFACE_HIDDEN_MARKER, value: id, reason: `${feature}:${id.split(':')[1]}`, feature } as const;
  if (platform === 'instagram' && el.closest('main, [role="main"]')) {
    // Instagram keeps the box inside its main column (Q87, injector.ts,
    // measured live 2026-08-11 and again 2026-09-03): the windowed feed
    // positions and loads from its own height bookkeeping, and a removed box
    // parks the reader in a feed of grey placeholders that never fill. The
    // ad hide and the AI-content blocker already hide by visibility there;
    // these switches did not until 2026-09-05 (known-issues M135). A box
    // outside main, the Reels entry in the navigation, still closes its gap.
    el.setAttribute('data-fw-hide-mode', 'visibility');
    return hideElement(el, { ...opts, mode: 'visibility' });
  }
  return hideElement(el, opts);
}

function unhide(el: HTMLElement): void {
  el.removeAttribute(SURFACE_HIDDEN_MARKER);
  el.removeAttribute('data-fw-block-reason');
  el.removeAttribute('data-fw-hide-mode');
  el.style.removeProperty('display');
  el.style.removeProperty('visibility');
  el.style.removeProperty('pointer-events');
}

/** Apply `rules` under `root`; returns how many boxes were newly hidden. */
export function scanSurfaces(root: ParentNode, rules: readonly SurfaceRule[]): number {
  let hidden = 0;
  for (const rule of rules) {
    let boxes: Element[];
    try { boxes = rule.find(root); } catch { continue; }
    for (const box of boxes) {
      if (box.getAttribute(SURFACE_HIDDEN_MARKER) === rule.id || !guard(box, rule)) continue;
      if (hide(box, rule.id, rule.feature, rule.platform)) hidden++;
    }
  }
  return hidden;
}

/** The page rules against the current pathname: hide the main column on a match, free it after. */
export function applyPageRules(pages: readonly PageRule[]): void {
  for (const page of pages) {
    const on = page.path.test(location.pathname);
    const main = document.querySelector<HTMLElement>('[role="main"], main');
    if (on && main) hide(main, page.id, page.feature, page.platform);
    if (!on) {
      document.querySelectorAll<HTMLElement>(`[${SURFACE_HIDDEN_MARKER}="${page.id}"]`).forEach(unhide);
    }
  }
}

export function resetSurfaceDOM(): void {
  document.querySelectorAll<HTMLElement>(`[${SURFACE_HIDDEN_MARKER}]`).forEach(unhide);
}

export function startSurfaceSwitches(platform: Platform, settings: FWSettings): () => void {
  const { rules, pages } = surfaceRulesFor(platform, settings);
  if (rules.length === 0 && pages.length === 0) return () => {};
  const full = (): void => {
    if (rules.length > 0) scanSurfaces(document, rules);
    if (pages.length > 0) applyPageRules(pages);
  };
  full();
  const stopAdded = rules.length > 0
    // The inserted subtree only (its parent is the whole feed on a scroll); a
    // box that is itself the anchor, such as a right column arriving whole,
    // is taken by the full pass within two seconds.
    ? observeAddedRoots((roots) => { for (const root of roots) scanSurfaces(root, rules); })
    : () => {};
  const onPopState = (): void => { if (pages.length > 0) applyPageRules(pages); };
  window.addEventListener('popstate', onPopState);
  const interval = setInterval(full, FULL_PASS_MS);
  return () => {
    stopAdded();
    window.removeEventListener('popstate', onPopState);
    clearInterval(interval);
    resetSurfaceDOM();
  };
}
