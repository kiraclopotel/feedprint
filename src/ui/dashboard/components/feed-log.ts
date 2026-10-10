// ─── Feed log: what the feed showed and what Feedprint did with each item ───
// The dashboard's first tab (the owner's report, 10 Oct 2026): one row per item of the feed, newest first, saying
// when, where, what Feedprint did, how severe, and why in one line. Pure: the window, the action, the counts and the
// one-line why are computed here so they can be tested without a page, and the large-record bound is measured here.

import type { ForensicRecord } from '../../../types/forensic';
import { isItem } from '../record-sets';
import { isPaidPlacement } from '../../../forensics/paid-placement';
import { localDayKey } from '../../shared/format-time';
import { isRepeatMarkOnly } from '../../../forensics/export-numbers';
import { feedActionKeyFor, type FeedActionKey } from '../../../forensics/feed-action';
import { BLOCKED_CATEGORY_LABELS } from './color-maps';

/** What Feedprint did with an item, in the page's words (one word per thing). */
export type FeedAction = 'passed' | 'hidden' | 'masked' | 'flagged' | 'manual' | 'seenALot' | 'rewritten' | 'notChecked';
export const FEED_ACTIONS: readonly FeedAction[] = ['hidden', 'flagged', 'manual', 'seenALot', 'masked', 'rewritten', 'passed', 'notChecked'];

/** The page's word for each key of the one mapper the dashboard chip and the CSV export share (feed-action.ts). */
export const FEED_ACTION_OF_KEY: Record<FeedActionKey, FeedAction> = {
  manual: 'manual', blocked: 'hidden', hidden: 'hidden', masked: 'masked', passed: 'passed', skipped: 'notChecked',
  rewritten: 'rewritten', flagged: 'flagged', seenALot: 'seenALot',
};

/** The page's three windows. Every panel that states a window states one of these (the Head, 10 Oct 2026). */
export type FeedWindow = 'today' | 'last7' | 'last28' | 'all';
// The page's one set of windows (the Head, 10 Oct 2026): the dashboard's 7 days, 28 days and since the record began, with Today first.
export const FEED_WINDOWS: readonly FeedWindow[] = ['today', 'last7', 'last28', 'all'];

/** What a click-through on another tab asks the Feed log to show. */
export interface FeedLogFilter {
  window?: FeedWindow;
  action?: FeedAction;
  platform?: string;
  /** A local calendar day, YYYY-MM-DD, for a panel whose number is one day's. */
  day?: string;
}

/**
 * The action, from the one mapper the dashboard chip and the CSV export share (feedActionKeyFor), so the three cannot
 * name an item differently. A repeat-exposure mark alone is "seen a lot", never "flagged": it is written at a fixed
 * severity from how often a post or source came back, with no reading of the content (the Head, 10 Oct 2026). An item
 * the mapper does not name (a cancelled check) is "not checked".
 */
export function feedAction(r: ForensicRecord): FeedAction {
  const key = feedActionKeyFor(r);
  return key ? FEED_ACTION_OF_KEY[key] : 'notChecked';
}

/** The record's worst technique (present ones only), as the ledger names it. */
export function worstTechnique(r: ForensicRecord): { name: string; severity: number } | undefined {
  let best: { name: string; severity: number } | undefined;
  for (const t of r.techniques ?? []) {
    if ((t as { present?: boolean }).present === false) continue;
    const severity = t.severity ?? 0;
    if (!best || severity > best.severity) best = { name: t.name, severity };
  }
  return best;
}

/** Severity shown on the row: the worst technique's, and none on an ad (an ad's marker score is not a harm) or on a
 *  "seen a lot" mark (its 6 is fixed by the rule, not read from the content). */
export function feedSeverity(r: ForensicRecord): number {
  return isPaidPlacement(r) || isRepeatMarkOnly(r) ? 0 : (worstTechnique(r)?.severity ?? 0);
}

/** Why, as a key the tab turns into words: an ad, swearing, a named technique, or nothing for a pass. */
export type FeedWhy = { kind: 'ad' } | { kind: 'swearing' } | { kind: 'technique'; id: string }
  | { kind: 'blocked'; category: string } | { kind: 'noReason' } | null;
export function feedWhy(r: ForensicRecord, action: FeedAction = feedAction(r)): FeedWhy {
  if (isPaidPlacement(r)) return { kind: 'ad' };
  if (action === 'masked') return { kind: 'swearing' };
  if (action === 'passed' || action === 'notChecked' || action === 'seenALot') return null;
  const top = worstTechnique(r);
  if (top) return { kind: 'technique', id: top.name };
  if (action !== 'hidden') return null;
  // A hidden row never has an empty why: the rule's category its record names ('block:<reason>:<token>'), or that no
  // reason was saved.
  const reason = /^(?:late-after-rotation:)?block:([^:]+)/.exec(r.detectionMode ?? '')?.[1];
  const category = reason ? BLOCKED_CATEGORY_LABELS[reason] : undefined;
  return category ? { kind: 'blocked', category } : { kind: 'noReason' };
}

/** True when the window starts before the first entry given (oldest first): the rest of it is in the archived months. */
export function windowReachesBefore(records: readonly ForensicRecord[], window: FeedWindow, now: Date): boolean {
  if (window === 'all') return true;
  const first = records.length > 0 ? Date.parse(records[0].timestamp) : Number.NaN;
  return !Number.isFinite(first) || first > windowStart(window, now);
}

/** Where a window starts, in ms: local midnight today, six or twenty-seven days before it, or nothing for All. */
export function windowStart(window: FeedWindow, now: Date): number {
  if (window === 'all') return Number.NEGATIVE_INFINITY;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (window === 'last7') d.setDate(d.getDate() - 6);
  if (window === 'last28') d.setDate(d.getDate() - 27);
  return d.getTime();
}

/**
 * How many records older than the window, one after another, end the walk back. The store hands records in the order
 * they were written, which is time order unless the computer's clock was moved; a short run of older records is read
 * past so a clock moved back by a little does not cut the day, and a long run means the window is behind us.
 */
export const OLDER_RUN_STOP = 64;

export interface FeedLogSlice {
  /** The feed items in the window and the filter, newest first. */
  rows: ForensicRecord[];
  /** Feed items in the window, per action, before the action filter: the chips' counts. */
  counts: Record<FeedAction, number>;
  /** Feed items in the window, before the action filter. */
  inWindow: number;
  /** Feed items in the window before any chosen button (site, day, action): says whether turning one off can show more. */
  windowTotal: number;
  /** Records the walk read: the bound the large-record test measures. */
  read: number;
}

/**
 * The window's feed items, newest first, read from the end of the record and stopped once the window is behind:
 * Today on a 13,700-entry record reads today's entries and a short run more, never the whole record (the Head's
 * bound, 10 Oct 2026). Record events (resets, rotations, heartbeats) and comment-section summaries are not items of
 * the feed and are left out (isItem, the set every other tab counts).
 */
export function feedLogSlice(records: readonly ForensicRecord[], filter: FeedLogFilter, now: Date): FeedLogSlice {
  const window = filter.window ?? 'today';
  const start = windowStart(window, now);
  const counts: Record<FeedAction, number> = { passed: 0, hidden: 0, masked: 0, flagged: 0, manual: 0, seenALot: 0, rewritten: 0, notChecked: 0 };
  const rows: ForensicRecord[] = [];
  let inWindow = 0;
  let windowTotal = 0;
  let read = 0;
  let olderRun = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    read++;
    const ms = Date.parse(r.timestamp);
    // An entry whose time cannot be read belongs to no day: it is listed under All only.
    if (!Number.isFinite(ms) && start !== Number.NEGATIVE_INFINITY) continue;
    if (Number.isFinite(ms) && ms < start) {
      olderRun++;
      if (olderRun >= OLDER_RUN_STOP) break;
      continue;
    }
    olderRun = 0;
    if (!isItem(r)) continue;
    windowTotal++;
    if (filter.platform && r.platform !== filter.platform) continue;
    if (filter.day && localDayKey(r.timestamp) !== filter.day) continue;
    const action = feedAction(r);
    counts[action]++;
    inWindow++;
    if (filter.action && action !== filter.action) continue;
    rows.push(r);
  }
  return { rows, counts, inWindow, windowTotal, read };
}
