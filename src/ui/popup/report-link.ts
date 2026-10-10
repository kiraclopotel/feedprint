// "Something still showing? Tell us": the email a person can choose to send when Off or Receipts missed
// something.
//
// Neither product sends anything by itself, so a report is an email the person writes and sends from their own mail
// program. It is prefilled with what a support reply needs and nothing more: the site's name, the kind
// of page, the product's version and the switch ids that are on. The page's address is read only to name those
// two things and is never put in the mail: a path can carry a video id, an account name or a search.

import { platformOfHost } from '../../core/host-platform';
import type { Platform } from '../../types/post';
import type { PopupStrings } from '../../i18n/popup/types';
import { type FWSettings, type FeatureId, isFeatureEnabled } from '../../storage/settings';

export const REPORT_ADDRESS = 'support@feelingwise.org';

export type PageKind = 'home' | 'watch' | 'feed' | 'reels' | 'other';

export const SITE_NAMES: Readonly<Record<Platform, string>> = {
  youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', twitter: 'X', tiktok: 'TikTok',
};

function kindOn(site: Platform, path: string): PageKind {
  switch (site) {
    case 'youtube':
      if (path === '/') return 'home';
      if (path === '/watch') return 'watch';
      if (path.startsWith('/shorts/')) return 'reels';
      return 'other';
    case 'facebook':
      if (path === '/') return 'feed';
      if (/^\/reels?\//.test(path)) return 'reels';
      if (path.startsWith('/watch')) return 'watch';
      return 'other';
    case 'instagram':
      if (path === '/') return 'feed';
      if (/^\/reels?\//.test(path)) return 'reels';
      return 'other';
    case 'twitter':
      return path === '/home' ? 'feed' : 'other';
    case 'tiktok':
      if (path === '/' || path === '/foryou') return 'feed';
      if (/^\/@[^/]+\/video\//.test(path)) return 'watch';
      return 'other';
  }
}

/** The site and the kind of page an address is; both null off Off's sites or without an address. */
export function pageOf(url: string | undefined): { site: Platform | null; kind: PageKind | null } {
  let parsed: URL;
  try { parsed = new URL(url ?? ''); } catch { return { site: null, kind: null }; }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { site: null, kind: null };
  const site = platformOfHost(parsed.hostname);
  if (!site) return { site: null, kind: null };
  return { site, kind: kindOn(site, parsed.pathname) };
}

/** The five sites in the order the store listing names them. */
export const OFF_SITES: readonly Platform[] = ['facebook', 'instagram', 'twitter', 'tiktok', 'youtube'];

/**
 * The sites a switch acts on, where that is fewer than five. Read from the content code: the
 * surface switches and the Reels and Shorts trays from content/engagement/surface-switches.ts, the
 * Reels and Shorts pages from reels-blocker.ts, the YouTube feeds from youtube-feeds.ts. The counts, buttons, comment box, emoji, hashtag
 * and ad switches and the word filter run on all five, through each site's engagement file, the ad
 * rules and the text scopes. A test holds this table to surface-switches.ts, so a site added there
 * shows here or fails.
 */
export const SWITCH_REACH: Partial<Record<FeatureId, readonly Platform[]>> = {
  'block-reels': ['facebook', 'instagram', 'youtube'],
  'hide-stories': ['facebook', 'instagram'],
  'hide-suggestions': ['facebook', 'instagram', 'twitter'],
  'hide-right-column': ['facebook', 'instagram', 'twitter'],
  'hide-marketplace': ['facebook'],
  'hide-groups': ['facebook'],
  'hide-home-feed': ['youtube'],
  'hide-recommended-videos': ['youtube'],
};

/**
 * Of `ids`, those that act on `site` and are on there, for the report email; with no site, those on
 * anywhere they reach. "no-swearing" stands for the swearing row, which is a setting, not a switch id.
 */
export function switchesOnFor(settings: FWSettings, site: Platform | null, ids: readonly FeatureId[]): string[] {
  const on: string[] = settings.mode === 'child' || settings.strictLanguage === true ? ['no-swearing'] : [];
  for (const id of ids) {
    const reach = SWITCH_REACH[id] ?? OFF_SITES;
    const sites = site ? reach.filter(p => p === site) : reach;
    if (sites.some(p => isFeatureEnabled(settings, id, p))) on.push(id);
  }
  return on;
}

export interface ReportFacts {
  /** Which product the email is from; Off when not given. */
  product?: 'off' | 'receipts';
  site: Platform | null;
  kind: PageKind | null;
  version: string;
  switchesOn: readonly string[];
}

export function reportMailto(facts: ReportFacts, t: PopupStrings): string {
  const siteName = facts.site ? SITE_NAMES[facts.site] : '';
  const receipts = facts.product === 'receipts';
  const lines = [
    t.offReportAsk,
    '',
    '',
    '',
    `${t.offReportSite}: ${siteName || (receipts ? t.receiptsReportNoSite : t.offReportNoSite)}`,
    ...(facts.site && facts.kind ? [`${t.offReportPage}: ${facts.kind}`] : []),
    `${receipts ? t.receiptsReportVersion : t.offReportVersion}: ${facts.version}`,
    `${t.offReportSwitches}: ${facts.switchesOn.length > 0 ? facts.switchesOn.join(', ') : t.offReportNone}`,
  ];
  const subject = receipts ? t.receiptsReportSubject(siteName || null) : t.offReportSubject(siteName);
  return `mailto:${REPORT_ADDRESS}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`;
}
