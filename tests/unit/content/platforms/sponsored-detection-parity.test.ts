// @vitest-environment jsdom
//
// Q53 (wiring W56): sponsored-detection parity across surfaces.
//
// The article/permalink paths ran the proven per-platform sponsored
// extractors while the surfaces where ads actually live skipped them: the
// IG reels feed and tile grid, the TikTok music-only fallback record, and
// the FB /reel/ caption. A sponsored post recorded organic bypasses the
// sponsored-ad verdict path and deriveAccountType's advertiser branch.
// The YouTube community arm needs a NEW detector and stays queued for
// live DOM data (instrument-first).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';

const INSTAGRAM_PATH = 'src/content/platforms/instagram.ts';
const TIKTOK_PATH = 'src/content/platforms/tiktok.ts';
const FACEBOOK_PATH = 'src/content/platforms/facebook.ts';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

describe('Q53 — IG reels feed detects sponsored (functional)', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  function mountReel(sponsored: boolean): void {
    document.body.innerHTML = `
      <main>
        <div>
          <video></video>
          ${sponsored ? '<span>Sponsored</span>' : ''}
          <a href="/somecreator/">somecreator</a>
          <span dir="auto">a caption long enough to extract</span>
        </div>
      </main>
    `;
  }

  it('sponsored reel carries is_sponsored=true', () => {
    setLocation('https://www.instagram.com/reels/ABC123/');
    mountReel(true);
    const posts = new InstagramAdapter().extractPosts(document.body.childNodes);
    const reel = posts.find((p) => p.id === 'ABC123');
    expect(reel).toBeDefined();
    expect(reel?.is_sponsored).toBe(true);
  });

  it('organic reel stays undefined (no invention)', () => {
    setLocation('https://www.instagram.com/reels/DEF456/');
    mountReel(false);
    const posts = new InstagramAdapter().extractPosts(document.body.childNodes);
    const reel = posts.find((p) => p.id === 'DEF456');
    expect(reel).toBeDefined();
    expect(reel?.is_sponsored).toBeUndefined();
  });
});

describe('Q53 — remaining arms (source-lock)', () => {
  const instagram = readFileSync(join(process.cwd(), INSTAGRAM_PATH), 'utf8');
  const tiktok = readFileSync(join(process.cwd(), TIKTOK_PATH), 'utf8');
  const facebook = readFileSync(join(process.cwd(), FACEBOOK_PATH), 'utf8');

  it('IG tile grid runs the extractor', () => {
    expect(instagram).toContain('is_sponsored: extractIsInstagramSponsored(tile) || undefined');
  });

  it('TikTok fallback record runs the extractor and carries recovery scope + metrics', () => {
    const block = tiktok.match(/id: `tk-vid-\$\{fallbackVideoId\}`[\s\S]{0,1200}?\}\);/)?.[0] ?? '';
    expect(block).toContain('is_sponsored: extractIsTikTokSponsored(container) || undefined');
    expect(block).toContain('recoveryScopeRef: container.parentElement');
    expect(block).toContain('fallbackMetrics ? { metrics: fallbackMetrics }');
  });

  it('FB reel caption runs the extractor on the side panel', () => {
    const block = facebook.match(/id: `fb-vid-\$\{postId\}`[\s\S]{0,1200}?\}\);/)?.[0] ?? '';
    expect(block).toContain('is_sponsored: extractIsFacebookSponsored(comp) || undefined');
  });
});
