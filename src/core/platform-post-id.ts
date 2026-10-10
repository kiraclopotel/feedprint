// The post id in a post URL, in the form the platform adapters stamp as `parentVideoId` on caption
// and comment records. The dashboard (src/ui/dashboard/components/group-records.ts) groups a post
// with its replies by it, so the two must match: X's status digits, TikTok's video digits,
// Instagram's /p/ or /reel/ id. Facebook's ids are synthetic and cannot be read from the URL.

import type { Platform } from '../types/post';

export function platformPostIdFromUrl(
  platform: Platform,
  url: string | undefined,
): string | undefined {
  if (!url) return undefined;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return undefined;
  }
  if (platform === 'twitter') {
    // Both /<handle>/status/<id> and /i/web/status/<id>.
    const m = pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : undefined;
  }
  if (platform === 'tiktok') {
    const m = pathname.match(/\/video\/(\d+)/);
    return m ? m[1] : undefined;
  }
  if (platform === 'instagram') {
    const m = pathname.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : undefined;
  }
  return undefined;
}
