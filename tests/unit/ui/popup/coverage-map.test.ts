// FeelingWise — per-page coverage map. Pure URL → coverage logic; locks the
// documented surfaces (especially the honest "zero post-scan" gaps) so drift
// from the platform adapters surfaces as a test failure.

import { describe, it, expect } from 'vitest';
import { describePageCoverage, detectCoveragePlatform } from '../../../../src/ui/popup/coverage-map';

describe('detectCoveragePlatform', () => {
  it('maps known social hostnames', () => {
    expect(detectCoveragePlatform('www.x.com')).toBe('twitter');
    expect(detectCoveragePlatform('twitter.com')).toBe('twitter');
    expect(detectCoveragePlatform('www.instagram.com')).toBe('instagram');
    expect(detectCoveragePlatform('www.tiktok.com')).toBe('tiktok');
    expect(detectCoveragePlatform('web.facebook.com')).toBe('facebook');
    expect(detectCoveragePlatform('www.youtube.com')).toBe('youtube');
  });

  it('returns null for non-platform hosts', () => {
    expect(detectCoveragePlatform('google.com')).toBeNull();
    expect(detectCoveragePlatform('mail.proton.me')).toBeNull();
  });
});

describe('describePageCoverage — null outside platforms', () => {
  it('returns null for an unsupported site', () => {
    expect(describePageCoverage('google.com', '/search')).toBeNull();
  });
});

describe('fully-protected surfaces (posts + comments scanned)', () => {
  const fully: Array<[string, string, string]> = [
    ['x.com', '/home', 'twitter home'],
    ['x.com', '/user/status/123', 'twitter permalink'],
    ['instagram.com', '/', 'instagram home'],
    ['instagram.com', '/p/abc123/', 'instagram permalink'],
    ['instagram.com', '/reel/xyz/', 'instagram reel'],
    ['tiktok.com', '/foryou', 'tiktok feed'],
    ['tiktok.com', '/@creator/video/789', 'tiktok permalink'],
    ['facebook.com', '/', 'facebook feed'],
    ['facebook.com', '/groups/123/posts/456/', 'facebook permalink'],
  ];
  it.each(fully)('%s %s (%s) is fully protected', (host, path) => {
    const c = describePageCoverage(host, path);
    expect(c).not.toBeNull();
    expect(c!.fullyProtected).toBe(true);
    expect(c!.protections.postScan).toBe(true);
    expect(c!.protections.comments).toBe(true);
    expect(c!.gapNote).toBeUndefined();
  });
});

describe('M98: the X photo modal claims its real coverage', () => {
  it('a /status/.../photo/N URL is NOT claimed fully protected — the reply-tree model is off there', () => {
    const c = describePageCoverage('x.com', '/user/status/123/photo/2');
    expect(c).not.toBeNull();
    expect(c!.fullyProtected).toBe(false);
    expect(c!.protections.comments).toBe(false);
  });
});

describe('honest gaps (zero post-scan, counts still hidden)', () => {
  const gaps: Array<[string, string]> = [
    ['instagram.com', '/explore/'],
    ['instagram.com', '/someuser/'],
    ['tiktok.com', '/explore'],
    ['tiktok.com', '/@someuser'],
    ['tiktok.com', '/search?q=x'.replace('?q=x', '')], // '/search'
    ['tiktok.com', '/tag/funny'],
    ['youtube.com', '/watch'],
  ];
  it.each(gaps)('%s %s is a gap with an honest note', (host, path) => {
    const c = describePageCoverage(host, path);
    expect(c).not.toBeNull();
    expect(c!.fullyProtected).toBe(false);
    expect(c!.protections.postScan).toBe(false);
    expect(c!.gapNote).toBeTruthy();
    // Engagement-count hiding still applies on these surfaces.
    expect(c!.protections.metricsHidden).toBe(true);
  });
});

describe('facebook reels: nothing of Receipts applies there', () => {
  it('reports no scanning and no engagement hiding, but reels-blockable', () => {
    const c = describePageCoverage('facebook.com', '/reel/123/');
    expect(c!.protections.postScan).toBe(false);
    expect(c!.protections.comments).toBe(false);
    expect(c!.protections.metricsHidden).toBe(false);
    expect(c!.protections.reelsBlockable).toBe(true);
    // The Reels blocker is Off's; the note names no switch Receipts does not have.
    expect(c!.gapNote).toBe('Reels are not checked here.');
  });
});

describe('youtube shorts — blockable, comments not scanned', () => {
  it('is reels-blockable and not fully protected', () => {
    const c = describePageCoverage('youtube.com', '/shorts/abc');
    expect(c!.protections.reelsBlockable).toBe(true);
    expect(c!.fullyProtected).toBe(false);
    expect(c!.protections.metricsHidden).toBe(true);
  });
});

describe('platform labels are parent-friendly', () => {
  it('uses X for twitter', () => {
    expect(describePageCoverage('x.com', '/home')!.platformLabel).toBe('X');
  });
});
