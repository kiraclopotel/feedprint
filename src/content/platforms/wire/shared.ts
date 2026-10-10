// FeelingWise - shared helpers for the page-world wire parsers.
//
// A wire parser turns ONE platform JSON response into PostContent[]. It is a
// pure function: no DOM read, no chrome API, no storage. Every side effect
// (what is done with the parsed items) belongs to the relay,
// src/content/page-world/relay.ts.
//
// Written against response SHAPES, never against a schema. The platforms
// rename fields and re-nest them every few weeks, so each reader tries the
// names it knows in order and yields undefined rather than throwing. A parser
// that recognises nothing returns [] and the DOM adapter is untouched.
//
// The endpoint and field knowledge these parsers rest on is documented in
// docs/research/ZEESCHUIMER-2026-09-14.md section 3. That file records facts
// about the platforms (which responses carry items, which keys carry the ad
// flag); no Zeeschuimer code is copied here, and none may be: their files are
// MPL-2.0 and would have to be published with their source.

import type { FeedSource, PostContent } from '../../../types/post';

/**
 * What the parser knows about the page the response arrived on. The request
 * URL alone cannot say which tab the reader is looking at (TikTok serves the
 * For You and the Following feed from the same endpoint), so the relay reads
 * `window.location` once and hands it in. Tests pass it directly, which keeps
 * every parser a pure function of its inputs.
 */
export interface WireContext {
  /** `window.location.pathname` of the tab the response arrived on. */
  pathname: string;
  /** `window.location.search` of that tab. Empty string when there is none. */
  search?: string;
}

export type WireParser = (url: string, body: unknown, ctx: WireContext) => PostContent[];

/**
 * A wire-captured item has no element of its own. The relay decides whether
 * the item may enter the pipeline at all, and when it may, it replaces this
 * with a WeakRef to the element the page actually rendered for the item. The
 * cast mirrors the one the X parser has carried since the wire path was built.
 */
const NO_DOM_REF = undefined as unknown as WeakRef<HTMLElement>;

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/** Read a dotted path (`a.b.0.c`) without throwing on any missing hop. */
export function at(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const segment of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(segment);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
      continue;
    }
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/** First path that yields a non-empty string. */
export function firstString(root: unknown, paths: readonly string[]): string | undefined {
  for (const p of paths) {
    const v = str(at(root, p));
    if (v !== undefined) return v;
  }
  return undefined;
}

/**
 * YouTube writes almost every human-readable string as either
 * `{ simpleText }` or `{ runs: [{ text }, ...] }`. Both shapes appear in the
 * same response, sometimes for the same field, so both are read.
 */
export function ytText(node: unknown): string | undefined {
  const rec = asRecord(node);
  if (!rec) return undefined;
  const simple = str(rec.simpleText);
  if (simple !== undefined) return simple;
  const runs = rec.runs;
  if (Array.isArray(runs)) {
    const joined = runs
      .map((r) => str(asRecord(r)?.text) ?? '')
      .join('')
      .trim();
    if (joined.length > 0) return joined;
  }
  return undefined;
}

/**
 * Walk every plain object in a response tree, depth first. The platforms move
 * the same node between wrappers release to release (X's `tweet_results`
 * lives under `timeline_v2` on one operation and `timeline` on the next), so
 * every parser recognises its item by the keys the item itself carries and
 * lets this walk find it wherever it sits.
 *
 * Bounded: `maxNodes` caps the visit count so a pathological response cannot
 * hold the page-world thread. The default is generous next to a real feed
 * payload (a YouTube browse response is a few thousand nodes).
 */
export function* walkObjects(
  root: unknown,
  maxNodes = 200_000,
): Generator<Record<string, unknown>> {
  yield* walkObjectsInner(root, { left: maxNodes });
}

/**
 * Depth first in DOCUMENT ORDER, which is feed order: the record keeps the
 * order the platform served, and a stack-based walk would hand the parser its
 * items backwards.
 */
function* walkObjectsInner(
  node: unknown,
  budget: { left: number },
): Generator<Record<string, unknown>> {
  if (!node || typeof node !== 'object') return;
  if (budget.left <= 0) return;
  budget.left--;
  if (Array.isArray(node)) {
    for (const child of node) yield* walkObjectsInner(child, budget);
    return;
  }
  const rec = node as Record<string, unknown>;
  yield rec;
  for (const key of Object.keys(rec)) yield* walkObjectsInner(rec[key], budget);
}

/** Drop empties and duplicates, keep first-seen order, cap the list. */
export function cleanMedia(urls: Array<string | undefined>, cap = 8): string[] | undefined {
  const out: string[] = [];
  for (const u of urls) {
    if (!u) continue;
    if (!u.startsWith('http')) continue;
    if (out.includes(u)) continue;
    out.push(u);
    if (out.length >= cap) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * An ISO timestamp for the item. The platforms give seconds, milliseconds or a
 * formatted date depending on the endpoint; anything unreadable falls back to
 * now, which is when the recorder saw the response, and is the honest answer
 * when the payload did not say.
 */
export function isoTimestamp(value: unknown): string {
  const n = num(value);
  if (n !== undefined && n > 0) {
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const s = str(value);
  if (s !== undefined) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

/**
 * Build the PostContent fields every wire parser shares. Callers add the
 * platform-specific meta.
 */
export function wirePost(fields: {
  id: string;
  text: string;
  author: string;
  platform: PostContent['platform'];
  timestamp: string;
  sourceUrl?: string;
  feedSource: FeedSource;
  isSponsored: boolean;
  mediaUrls?: string[];
}): PostContent {
  return {
    id: fields.id,
    text: fields.text,
    author: fields.author,
    timestamp: fields.timestamp,
    platform: fields.platform,
    domRef: NO_DOM_REF,
    sourceUrl: fields.sourceUrl,
    feedSource: fields.feedSource,
    kind: 'post',
    depth: 0,
    // Omitted when false so the field means what it says on a record: the
    // platform's own flag said paid placement.
    ...(fields.isSponsored ? { is_sponsored: true } : {}),
    ...(fields.mediaUrls ? { mediaUrls: fields.mediaUrls } : {}),
  };
}
