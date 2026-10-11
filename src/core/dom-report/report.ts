// A "this broke" report, and the check that decides whether it may leave (11 Oct 2026).
//
// This file exists twice, byte for byte: src/core/dom-report/report.ts (the extension) and worker/src/dom-report/report.ts
// (the relay; its tsconfig cannot reach src/). A test fails when they differ. Edit both.
//
// The report is what a person sends us, on a press, when a site has changed under a finder: which product and site, which
// build and repair file, what the finders found on the page, the counters the finder ledger kept, and the skeleton of the
// page (skeleton.ts). Nothing in it is typed by the person. Its problem is one of three fixed words they pick.
//
// validateReport is the lock. It accepts a report only when every field is one the grammar names and every string in it
// is a member of a closed set or has a fixed shape (grammar.ts, vocabulary.ts). The sender runs it on its own report
// before showing it; the relay runs the same rules on arrival, from its own copy of this file.

import {
  ARIA_ROLES, CUSTOM_TAG, HTML_TAGS, LAYER_MAX_NODES, MAX_ATTR_NAMES, MAX_DEPTH, MAX_FAMILIES, MAX_LAYERS, MAX_LEDGER_KEYS,
  MAX_NODES, MAX_REPORT_CHARS, PRODUCTS, PROBLEMS, SITES, isAttrName, isLegalValue, type SkeletonNode,
} from './grammar';
import { MAX_PATH_SEGMENTS, SAFE_SCHEMES, isSafeSegment, isUiWord } from './vocabulary';

export { MAX_NODES, MAX_REPORT_CHARS };

export type ReportProduct = 'feedprint' | 'off';
export type ReportProblem = 'hid-too-much' | 'did-not-hide' | 'other';

export interface ReportFamily {
  /** The family's id, always `finder.<site>.<name>`. */
  id: string;
  kind: 'selector' | 'word';
  /** Selectors: elements the default list matches on this page. Words: words in the default list. */
  before: number;
  /** The same for the list in force (the default plus the repair file). */
  now: number;
}

export interface DomReport {
  v: 1;
  product: ReportProduct;
  site: string;
  day: string;
  build: string;
  repair: number;
  chrome: number;
  problem: ReportProblem;
  view: [number, number];
  families: ReportFamily[];
  ledger: Record<string, number>;
  page: SkeletonNode;
  layers: SkeletonNode[];
}

const NODE_KEYS = new Set(['t', 'r', 'a', 'o', 'v', 'l', 'h', 'n', 'e', 's', 'x', 'z', 'c']);
const REPORT_KEYS = ['v', 'product', 'site', 'day', 'build', 'repair', 'chrome', 'problem', 'view', 'families', 'ledger', 'page', 'layers'];

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// A label shape: one to three interface words joined by +, then optionally the count of the rest ("3w"); or only that count.
const LABEL_SHAPE = /^(?:[a-z]+(?:\+[a-z]+){0,2}(?:\+\d{1,3}w)?|\d{1,3}w)$/;

function labelProblem(label: string): string | null {
  if (label === '') return null;
  if (label.length > 80 || !LABEL_SHAPE.test(label)) return 'label shape';
  for (const part of label.split('+')) {
    if (/^\d{1,3}w$/.test(part)) continue;
    if (!isUiWord(part)) return 'label word';
  }
  return null;
}

function hrefProblem(href: string): string | null {
  if (href === '' || href === '#' || href === 'ext' || href === '*') return null;
  if (SAFE_SCHEMES.has(href)) return null;
  if (href.length > 80 || !href.startsWith('/')) return 'address shape';
  const path = href.endsWith('?') ? href.slice(0, -1) : href;
  const segments = path.split('/').filter(Boolean);
  if (segments.length > MAX_PATH_SEGMENTS) return 'address segments';
  for (const segment of segments) if (!isSafeSegment(segment)) return 'address segment';
  return null;
}

function nodeProblems(node: unknown, depth: number, state: { count: number; max: number }, out: string[]): void {
  if (out.length >= 5) return;
  if (!isRecord(node)) { out.push('node is not an object'); return; }
  state.count++;
  if (state.count > state.max) { out.push('too many nodes'); return; }
  if (depth > MAX_DEPTH + 1) { out.push('too deep'); return; }
  for (const key of Object.keys(node)) if (!NODE_KEYS.has(key)) out.push(`node field ${key.slice(0, 12)}`);
  const t = node.t;
  if (typeof t !== 'string' || !(HTML_TAGS.has(t) || (t.length <= 48 && CUSTOM_TAG.test(t)))) out.push('tag');
  if (node.t === 'private' && Object.keys(node).length > 1) out.push('private marker carries more');
  if (node.r !== undefined && !(typeof node.r === 'string' && ARIA_ROLES.has(node.r))) out.push('role');
  if (node.a !== undefined) {
    if (!Array.isArray(node.a) || node.a.length > MAX_ATTR_NAMES) out.push('attribute list');
    else for (const name of node.a) if (typeof name !== 'string' || !isAttrName(name)) out.push('attribute name');
  }
  if (node.o !== undefined && !isInt(node.o, 1, 999)) out.push('other-attribute count');
  if (node.v !== undefined) {
    if (!isRecord(node.v) || Object.keys(node.v).length > MAX_ATTR_NAMES) out.push('value list');
    else for (const [name, value] of Object.entries(node.v)) if (typeof value !== 'string' || !isLegalValue(name, value)) out.push('attribute value');
  }
  if (node.l !== undefined) {
    const problem = typeof node.l === 'string' ? labelProblem(node.l) : 'label type';
    if (problem) out.push(problem);
  }
  if (node.h !== undefined) {
    const problem = typeof node.h === 'string' ? hrefProblem(node.h) : 'address type';
    if (problem) out.push(problem);
  }
  if (node.n !== undefined && !isInt(node.n, 1, 4)) out.push('text size');
  if (node.e !== undefined && node.e !== 1) out.push('picture flag');
  if (node.s !== undefined && node.s !== 'n' && node.s !== 'h') out.push('drawn state');
  if (node.x !== undefined && !isInt(node.x, 2, 9999)) out.push('run count');
  if (node.z !== undefined && !isInt(node.z, 1, 9999)) out.push('left-out count');
  if (node.c !== undefined) {
    if (!Array.isArray(node.c)) { out.push('children'); return; }
    for (const child of node.c) nodeProblems(child, depth + 1, state, out);
  }
}

/** What is wrong with a skeleton, as short phrases; empty when it is clean. */
export function validateSkeleton(node: unknown, maxNodes: number = MAX_NODES): string[] {
  const out: string[] = [];
  nodeProblems(node, 1, { count: 0, max: maxNodes }, out);
  return out;
}

/** What is wrong with a report, as short phrases; empty when it may be sent. */
export function validateReport(value: unknown): string[] {
  if (!isRecord(value)) return ['report is not an object'];
  const out: string[] = [];
  for (const key of Object.keys(value)) if (!REPORT_KEYS.includes(key)) out.push(`report field ${key.slice(0, 12)}`);
  for (const key of REPORT_KEYS) if (!(key in value)) out.push(`missing ${key}`);
  if (out.length > 0) return out;
  const r = value as Record<string, unknown>;
  if (r.v !== 1) out.push('version');
  if (typeof r.product !== 'string' || !PRODUCTS.has(r.product)) out.push('product');
  if (typeof r.site !== 'string' || !SITES.has(r.site)) out.push('site');
  if (typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) out.push('day');
  if (typeof r.build !== 'string' || !/^fwbid-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/.test(r.build)) out.push('build');
  if (!isInt(r.repair, 0, 1_000_000)) out.push('repair');
  if (!isInt(r.chrome, 0, 999)) out.push('chrome');
  if (typeof r.problem !== 'string' || !PROBLEMS.has(r.problem)) out.push('problem');
  if (!Array.isArray(r.view) || r.view.length !== 2 || !r.view.every((n) => isInt(n, 0, 20000))) out.push('view');
  if (!Array.isArray(r.families) || r.families.length > MAX_FAMILIES) out.push('families');
  else {
    for (const f of r.families) {
      if (!isRecord(f) || Object.keys(f).length !== 4 || typeof f.id !== 'string' || !/^finder\.[a-z0-9.-]{1,60}$/.test(f.id)
        || (f.kind !== 'selector' && f.kind !== 'word') || !isInt(f.before, 0, 9999) || !isInt(f.now, 0, 9999)) {
        out.push('family');
        break;
      }
    }
  }
  if (!isRecord(r.ledger) || Object.keys(r.ledger).length > MAX_LEDGER_KEYS) out.push('ledger');
  else {
    for (const [key, count] of Object.entries(r.ledger)) {
      if (!/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(key) || !isInt(count, 0, 1_000_000_000)) { out.push('ledger entry'); break; }
    }
  }
  out.push(...validateSkeleton(r.page));
  if (!Array.isArray(r.layers) || r.layers.length > MAX_LAYERS) out.push('layers');
  else for (const layer of r.layers) out.push(...validateSkeleton(layer, LAYER_MAX_NODES));
  if (out.length === 0 && JSON.stringify(value).length > MAX_REPORT_CHARS) out.push('report too long');
  return out;
}

export interface ReportParts {
  product: ReportProduct;
  site: string;
  now: Date;
  build: string;
  repair: number;
  chrome: number;
  problem: ReportProblem;
  view: [number, number];
  families: ReportFamily[];
  /** The finder ledger as it stands: counter name to count. Entries that are not counters are dropped. */
  ledger: Record<string, number>;
  page: SkeletonNode;
  layers: SkeletonNode[];
}

const hundred = (n: number): number => Math.max(0, Math.round(n / 100) * 100);

/** Put the parts together as a report: the day without the time, the window to the hundred, only real counters. */
export function assembleReport(parts: ReportParts): DomReport {
  const ledger: Record<string, number> = {};
  for (const [key, count] of Object.entries(parts.ledger)) {
    if (/^[a-z0-9][a-z0-9._:-]{0,79}$/.test(key) && isInt(count, 0, 1_000_000_000)) ledger[key] = count;
    if (Object.keys(ledger).length >= MAX_LEDGER_KEYS) break;
  }
  return {
    v: 1,
    product: parts.product,
    site: parts.site,
    day: parts.now.toISOString().slice(0, 10),
    build: parts.build,
    repair: parts.repair,
    chrome: parts.chrome,
    problem: parts.problem,
    view: [hundred(parts.view[0]), hundred(parts.view[1])],
    families: parts.families.slice(0, MAX_FAMILIES),
    ledger,
    page: parts.page,
    layers: parts.layers.slice(0, MAX_LAYERS),
  };
}
