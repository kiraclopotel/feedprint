// The skeleton of a page: its shape without its words (11 Oct 2026).
//
// When a site changes how it draws a page, the finders in Off and Feedprint stop finding things, and the fix is a new
// selector or word that someone has to see the new structure to write. A skeleton is that structure and nothing else:
// for each element its tag, role and the NAMES of its attributes; the shape of its label and of its address
// (vocabulary.ts); a few technical attribute values the site's code chose (grammar.ts); how much text it holds directly,
// in five sizes, and whether any is a picture character; whether it is hidden as drawn; how many identical siblings it
// stands for. No text, no id, no class, no address, no value typed into anything. Whatever sits inside a private chat is
// one marker, and an input, a text area or an editable box has no children.
//
// It is capped (500 elements, 14 levels, 40,000 characters) and built level by level, so the top of the page is always
// there and the depth is what gets cut. A run of identical siblings (the posts of a feed) is described once, by its first.

import {
  ARIA_ROLES, CUSTOM_TAG, ENUM_ATTRS, FREE_VALUE, FREE_VALUE_ATTRS, HTML_TAGS, LAYER_MAX_NODES, MAX_ATTR_NAMES, MAX_DEPTH,
  MAX_NODES, MAX_REPORT_CHARS, OWN_STAMP_NAME, OWN_STAMP_VALUE, isAttrName, type SkeletonNode,
} from './grammar';
import { hrefShape, labelShape } from './vocabulary';

export { MAX_REPORT_CHARS, MAX_NODES, MAX_DEPTH, LAYER_MAX_NODES };
export type { SkeletonNode };

export interface SkeletonOptions {
  /** The page's own host, so an address on the same site is told from one elsewhere. */
  ownHost: string;
  /** True for an element inside a private chat: it becomes a marker and its contents are not looked at. */
  isPrivate?: (el: Element) => boolean;
  maxNodes?: number;
  maxDepth?: number;
}

/** Most siblings looked at under one parent; the rest are counted. */
const MAX_SIBLINGS_LOOKED_AT = 200;

/** Tags whose contents are never part of a structure. */
const SKIPPED = new Set(['script', 'style', 'link', 'meta', 'head', 'title', 'base']);

/** Elements that are shown but whose children are not: nothing typed or drawn inside them is looked at. */
const CLOSED = new Set(['input', 'textarea', 'select', 'svg', 'iframe', 'canvas', 'video', 'audio', 'object', 'embed']);

function textBucket(length: number): number {
  if (length === 0) return 0;
  if (length < 10) return 1;
  if (length < 50) return 2;
  if (length < 200) return 3;
  return 4;
}

function tagOf(el: Element): string {
  const name = el.localName.toLowerCase();
  if (HTML_TAGS.has(name)) return name;
  return CUSTOM_TAG.test(name) && name.length <= 48 ? name : 'x';
}

function freeValue(raw: string): string {
  const value = raw.replace(/\d+/g, '0');
  return value.length <= 40 && FREE_VALUE.test(value) ? value : '*';
}

function valueOf(name: string, raw: string): string | null {
  if (name === 'data-fw-block-reason') {
    // The detail after the colon can be a word the person chose for a filter; only the switch's name is kept.
    const feature = raw.split(':')[0];
    return OWN_STAMP_VALUE.test(feature) ? feature : '*';
  }
  if (OWN_STAMP_NAME.test(name)) return OWN_STAMP_VALUE.test(raw) ? raw : '*';
  const allowed = ENUM_ATTRS.get(name);
  if (allowed) {
    if (name === 'contenteditable' && raw === '') return 'true';
    if (name === 'tabindex') {
      const n = Number(raw);
      return Number.isNaN(n) ? '*' : n < 0 ? '-1' : n === 0 ? '0' : '+';
    }
    return allowed.has(raw) ? raw : '*';
  }
  if (FREE_VALUE_ATTRS.has(name)) return freeValue(raw);
  return null;
}

function describe(el: Element, ownHost: string): SkeletonNode {
  const node: SkeletonNode = { t: tagOf(el) };
  const names: string[] = [];
  let other = 0;
  const values: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (name === 'role') {
      const first = attr.value.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
      node.r = ARIA_ROLES.has(first) ? first : 'other';
    }
    if (name === 'aria-label') node.l = labelShape(attr.value);
    if (name === 'href') node.h = hrefShape(attr.value, ownHost);
    const value = valueOf(name, attr.value);
    if (value !== null) values[name] = value;
    if (isAttrName(name)) names.push(name);
    else other++;
  }
  if (names.length > 0) node.a = names.sort().slice(0, MAX_ATTR_NAMES);
  if (other > 0) node.o = Math.min(other, 999);
  if (Object.keys(values).length > 0) {
    const kept = Object.keys(values).sort().slice(0, MAX_ATTR_NAMES);
    node.v = Object.fromEntries(kept.map((k) => [k, values[k]]));
  }
  let length = 0;
  let picture = false;
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType !== 3) continue;
    const text = (child.textContent ?? '').trim();
    length += text.length;
    if (!picture && text !== '' && /\p{Extended_Pictographic}/u.test(text)) picture = true;
  }
  const bucket = textBucket(length);
  if (bucket > 0) node.n = bucket;
  if (picture) node.e = 1;
  return node;
}

function drawnState(el: Element): 'n' | 'h' | null {
  try {
    const style = getComputedStyle(el);
    if (style.display === 'none') return 'n';
    if (style.visibility === 'hidden') return 'h';
  } catch { /* no style to read */ }
  return null;
}

// Two siblings with the same signature are described once. How either is drawn is read for the one that stands for the run.
function signature(node: SkeletonNode): string {
  return [node.t, node.r ?? '', (node.a ?? []).join(','), node.o ?? '', JSON.stringify(node.v ?? ''), node.l ?? '', node.h ?? '', node.n ?? '', node.e ?? ''].join('|');
}

function skeletonOnce(root: Element, options: SkeletonOptions, maxNodes: number, maxDepth: number): SkeletonNode {
  const { ownHost, isPrivate } = options;
  const first = isPrivate?.(root) ? ({ t: 'private' } as SkeletonNode) : describe(root, ownHost);
  const rootState = first.t === 'private' ? null : drawnState(root);
  if (rootState) first.s = rootState;
  let used = 1;
  type Item = { el: Element; node: SkeletonNode; depth: number };
  const queue: Item[] = first.t === 'private' || CLOSED.has(first.t) ? [] : [{ el: root, node: first, depth: 1 }];
  for (let head = 0; head < queue.length; head++) {
    const { el, node, depth } = queue[head];
    const kids = Array.from(el.children).filter((k) => !SKIPPED.has(k.localName.toLowerCase()));
    if (kids.length === 0) continue;
    if (depth > maxDepth) { node.z = Math.min(kids.length, 9999); continue; }
    const looked = kids.slice(0, MAX_SIBLINGS_LOOKED_AT);
    const children: SkeletonNode[] = [];
    let left = kids.length - looked.length;
    let previous: SkeletonNode | null = null;
    let previousSignature = '';
    for (const kid of looked) {
      const child: SkeletonNode = isPrivate?.(kid) ? { t: 'private' } : describe(kid, ownHost);
      const sig = signature(child);
      if (previous && sig === previousSignature && child.t !== 'private') {
        previous.x = Math.min((previous.x ?? 1) + 1, 9999);
        continue;
      }
      if (used >= maxNodes) { left++; continue; }
      if (child.t !== 'private') {
        const state = drawnState(kid);
        if (state) child.s = state;
      }
      used++;
      children.push(child);
      previous = child;
      previousSignature = sig;
      if (child.t !== 'private' && !CLOSED.has(child.t) && kid.getAttribute('contenteditable') === null) queue.push({ el: kid, node: child, depth: depth + 1 });
    }
    if (children.length > 0) node.c = children;
    if (left > 0) node.z = Math.min(left, 9999);
  }
  return first;
}

/**
 * The skeleton of the subtree at `root`. If it comes out longer than MAX_REPORT_CHARS it is built again with half the
 * elements, until it fits.
 */
export function buildSkeleton(root: Element, options: SkeletonOptions): SkeletonNode {
  let nodes = options.maxNodes ?? MAX_NODES;
  const depth = options.maxDepth ?? MAX_DEPTH;
  let node = skeletonOnce(root, options, nodes, depth);
  while (JSON.stringify(node).length > MAX_REPORT_CHARS / 2 && nodes > 8) {
    nodes = Math.floor(nodes / 2);
    node = skeletonOnce(root, options, nodes, depth);
  }
  return node;
}
