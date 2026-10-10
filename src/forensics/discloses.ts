// FeelingWise — what a recipient learns about the person who made the file.
//
// THE GAP THIS CLOSES. Page one already says what the file does NOT prove:
// who made it, whether the key is the original, platform origin, completeness.
// It says nothing about what the file DOES reveal, and the export exists to be
// handed to someone — a counsellor, a lawyer, a school, a stranger checking a
// claim.
//
// An export carries no name, no email and no location field, and can identify
// its owner anyway from what was served TO them. Picture one with hundreds of
// items in one language, Facebook groups named for one small town, a
// second-hand market for one hobby, a parenting group, and advertisers who sell
// in one country: country, town, family status, hobbies and shopping profile,
// none of it typed in by anyone.
//
// That is not a defect to fix by removing fields. A record whose group name,
// author and link have been stripped cannot be checked against the platform,
// and a receipt that cannot be checked is not a receipt. The fix is that the
// person handing the file over knows what is in it before they send it, in
// their own numbers rather than in a warning that could be printed on any file.
//
// So this counts, and page one prints the count. Structured fields only — the
// named container, the account type, the feed source, the origin, the link —
// never a guess from text.

import type { ForensicRecord } from '../types/forensic';
import { isSystemMarkerRecord } from './system-records';

export interface DisclosureSummary {
  /** Named places the reader was inside: groups, communities, marketplaces. */
  namedContainers: number;
  /** A few of those names, longest-running first, so the count is concrete. */
  sampleContainers: string[];
  /** Distinct advertisers that paid to reach this reader. */
  advertisers: number;
  /**
   * Distinct accounts served on a following or profile surface.
   *
   * NOT "accounts the reader chose", which is what page one said until
   * 2026-09-08. `feedSource` records the SURFACE an item appeared on, not an
   * intent: the Facebook adapter returns 'following' for any path containing
   * /groups/, so one scroll through a group stamps every stranger in it — and
   * every advertiser in it — as a following-surface account. The reader
   * follows none of them. Naming an inference the field cannot support was the
   * one claim in this block about the person's own conduct rather than about
   * what was served to them, which is the claim least safe to get wrong in a
   * file handed to a school or a court.
   */
  chosenAccounts: number;
  /** Distinct authors of everything served, chosen or not. */
  authors: number;
  /** The sites the reader was on. */
  origins: string[];
  /**
   * DISTINCT addresses in the file that resolve to the reader's own view.
   *
   * Counted once each, not once per record that carries one. Every comment on
   * a post carries that post's URL, so counting occurrences printed 6,300 for a
   * file holding 4,103 distinct addresses — 1.54x. The block exists to tell
   * someone what handing the file over reveals, and what it reveals is the set
   * of addresses, not how many rows repeat one.
   */
  links: number;
  /** Distinct media addresses carried in the file, counted once each. */
  mediaAddresses: number;
  /** Hours between the first and last record. */
  spanHours: number;
  /** Distinct clock hours (UTC) in which the reader's browser was active. */
  activeHoursUtc: number;
}

/**
 * What this file would tell someone who opened it. Counts only; the export
 * prints them, and the person sending the file decides what that is worth.
 */
export function computeDisclosure(records: readonly ForensicRecord[]): DisclosureSummary | null {
  const content = records.filter(r => !isSystemMarkerRecord(r));
  if (content.length === 0) return null;

  const containers = new Map<string, number>();
  const advertisers = new Set<string>();
  const chosen = new Set<string>();
  const authors = new Set<string>();
  const origins = new Set<string>();
  const hours = new Set<number>();
  const links = new Set<string>();
  const media = new Set<string>();
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;

  for (const r of content) {
    if (r.sourceContainer) containers.set(r.sourceContainer, (containers.get(r.sourceContainer) ?? 0) + 1);
    const author = typeof r.author === 'string' ? r.author.trim() : '';
    if (author && author !== 'unknown') {
      authors.add(author);
      if (r.accountType === 'advertiser') advertisers.add(author);
      // The surface an item appeared on, counted as a surface. An advertiser is
      // already counted as an advertiser and is never a following-surface
      // account: it is placed, not followed, and counting it in both put a
      // paid placement inside a sentence about the reader's own accounts.
      if ((r.feedSource === 'following' || r.feedSource === 'profile') && r.accountType !== 'advertiser') {
        chosen.add(author);
      }
    }
    if (r.surfaceOrigin) origins.add(r.surfaceOrigin);
    if (r.postUrl) links.add(r.postUrl);
    if (r.anchorUrl) links.add(r.anchorUrl);
    for (const u of r.mediaUrls ?? []) media.add(u);
    const t = Date.parse(r.timestamp);
    if (!Number.isNaN(t)) {
      first = Math.min(first, t);
      last = Math.max(last, t);
      hours.add(new Date(t).getUTCHours());
    }
  }

  return {
    namedContainers: containers.size,
    sampleContainers: [...containers.entries()]
      .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] < b[0] ? -1 : 1))
      .slice(0, 3)
      .map(([name]) => name),
    advertisers: advertisers.size,
    chosenAccounts: chosen.size,
    authors: authors.size,
    origins: [...origins].sort(),
    links: links.size,
    mediaAddresses: media.size,
    spanHours: Number.isFinite(first) && Number.isFinite(last)
      ? Math.round(((last - first) / 3_600_000) * 10) / 10
      : 0,
    activeHoursUtc: hours.size,
  };
}
