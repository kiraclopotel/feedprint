// Building a "this broke" report on the page (11 Oct 2026).
//
// The page is the only place the skeleton can be built, so it is built here, checked against the grammar here, and handed
// to the popup as text. Nothing is stored and nothing is sent from this file. A private message surface is refused whole,
// and a chat dialog on an ordinary page is one marker in the skeleton (core/dom-report/skeleton.ts).

import { LAYER_MAX_NODES, MAX_LAYERS } from '../../core/dom-report/grammar';
import type { DomReportAnswer } from '../../core/dom-report/protocol';
import {
  assembleReport, validateReport, type ReportFamily, type ReportProblem, type ReportProduct,
} from '../../core/dom-report/report';
import { buildSkeleton, type SkeletonNode } from '../../core/dom-report/skeleton';
import { getBuildId } from '../../core/build-id';
import { platformOfHost } from '../../core/host-platform';
import { activeRepairVersion, describeFamilies } from '../../core/repairs/families';
import { flushFinderLedger, readFinderLedger } from '../../diagnostics/finder-ledger';
import { isInPrivateChatSubtree, isPrivateMessageSurface } from '../platforms/adapter';

const LAYER_SELECTOR = '[role="dialog"], [role="menu"], [role="tooltip"], [role="listbox"]';

/** A build id the grammar accepts, for a build that has none baked in (a test, a hand-made build). */
const UNKNOWN_BUILD = 'fwbid-dev-0';

function countMatches(selectors: readonly string[]): number {
  if (selectors.length === 0) return 0;
  try {
    return Math.min(document.querySelectorAll(selectors.join(',')).length, 9999);
  } catch {
    // One bad selector spoils the joined list; count each on its own.
    let total = 0;
    for (const selector of selectors) {
      try { total += document.querySelectorAll(selector).length; } catch { /* skip */ }
    }
    return Math.min(total, 9999);
  }
}

function familiesOnThisPage(): ReportFamily[] {
  return describeFamilies()
    .filter((f) => /^finder\.[a-z0-9.-]{1,60}$/.test(f.id))
    .map((f) => f.kind === 'selector'
      ? { id: f.id, kind: f.kind, before: countMatches(f.defaults), now: countMatches(f.active) }
      : { id: f.id, kind: f.kind, before: Math.min(f.defaults.length, 9999), now: Math.min(f.active.length, 9999) });
}

function layersOnThisPage(ownHost: string): SkeletonNode[] {
  const chosen: Element[] = [];
  for (const el of Array.from(document.querySelectorAll(LAYER_SELECTOR))) {
    if (chosen.length >= MAX_LAYERS) break;
    if (isInPrivateChatSubtree(el)) continue;
    if (chosen.some((c) => c.contains(el))) continue;
    try { if (getComputedStyle(el).display === 'none') continue; } catch { /* keep it */ }
    chosen.push(el);
  }
  return chosen.map((el) => buildSkeleton(el, { ownHost, isPrivate: isInPrivateChatSubtree, maxNodes: LAYER_MAX_NODES }));
}

export interface CollectOptions {
  product: ReportProduct;
  problem: ReportProblem;
  /** The page's host; read from the page when not given (tests give it). */
  host?: string;
  now?: Date;
}

/** Build the report for this page, or say why not. */
export async function collectDomReport(options: CollectOptions): Promise<DomReportAnswer> {
  const host = options.host ?? window.location.hostname;
  const site = platformOfHost(host);
  if (!site) return { ok: false, reason: 'not-a-site' };
  if (isPrivateMessageSurface()) return { ok: false, reason: 'private-surface' };
  await flushFinderLedger();
  const ledger = (await readFinderLedger()).counters;
  const root = document.querySelector('[role="main"], main') ?? document.body;
  const page = buildSkeleton(root, { ownHost: host, isPrivate: isInPrivateChatSubtree });
  const report = assembleReport({
    product: options.product,
    site,
    now: options.now ?? new Date(),
    build: getBuildId() || UNKNOWN_BUILD,
    repair: activeRepairVersion(),
    chrome: Number(/Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? 0),
    problem: options.problem,
    view: [window.innerWidth, window.innerHeight],
    families: familiesOnThisPage(),
    ledger,
    page,
    layers: layersOnThisPage(host),
  });
  if (validateReport(report).length > 0) return { ok: false, reason: 'not-clean' };
  return { ok: true, text: JSON.stringify(report) };
}
