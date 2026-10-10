// In core because the content script and the popup's coverage map both read it, and neither may
// import the other. Matching is on whole labels (the domain, or a dot and the domain), so
// mobile.x.com is X and netflix.com and x.com.evil.example are not. A substring match read
// netflix.com as X, and the coverage panel, which runs on any open tab, told a parent that
// FeelingWise protected a page it never touches.

import type { Platform } from '../types/post';

/** The domains each platform is served from, in the manifests' order. */
const DOMAIN_PLATFORM: ReadonlyArray<readonly [string, Platform]> = [
  ['twitter.com', 'twitter'],
  ['x.com', 'twitter'],
  ['instagram.com', 'instagram'],
  ['tiktok.com', 'tiktok'],
  ['facebook.com', 'facebook'],
  ['youtube.com', 'youtube'],
];

/**
 * The platform of a hostname, or null when the host is not one of the five sites. A trailing dot
 * (the absolute-root form a browser may hand over) and any letter case are accepted.
 */
export function platformOfHost(hostname: string | undefined | null): Platform | null {
  if (!hostname) return null;
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  for (const [domain, platform] of DOMAIN_PLATFORM) {
    if (host === domain || host.endsWith(`.${domain}`)) return platform;
  }
  return null;
}
