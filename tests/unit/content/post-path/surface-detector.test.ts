// @vitest-environment jsdom
//
// SurfaceDetector — descriptor-matcher abstraction shared across the
// engagement-tier consumers (ai-content-blocker, reels-blocker, interceptor).
// Locks: registry semantics, URL-only vs URL+DOM matching, descriptor
// id-uniqueness invariant, scoped-root walks, empty-selector behavior.

import { describe, it, expect } from 'vitest';
import {
  createSurfaceDetector,
  type SurfaceDescriptor,
} from '../../../../src/content/post-path/surface-detector';

const mkDescriptor = (over: Partial<SurfaceDescriptor> & { id: string }): SurfaceDescriptor => ({
  id: over.id,
  platform: over.platform ?? 'youtube',
  surfaceKind: over.surfaceKind ?? 'generic',
  pathnamePattern: over.pathnamePattern ?? null,
  containerSelectors: over.containerSelectors ?? [],
  dynamicContentRescan: over.dynamicContentRescan ?? false,
});

describe('createSurfaceDetector — registry semantics', () => {
  it('returns an empty list before any registrations', () => {
    const d = createSurfaceDetector();
    expect(d.list()).toEqual([]);
  });

  it('register() adds a descriptor visible from list()', () => {
    const d = createSurfaceDetector();
    const desc = mkDescriptor({ id: 'test:yt:shorts' });
    d.register(desc);
    expect(d.list()).toHaveLength(1);
    expect(d.list()[0].id).toBe('test:yt:shorts');
  });

  it('register() throws on duplicate id (catches consumer mistakes)', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({ id: 'dup' }));
    expect(() => d.register(mkDescriptor({ id: 'dup' }))).toThrow(/collision/i);
  });

  it('list() reflects registration order', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({ id: 'a' }));
    d.register(mkDescriptor({ id: 'b' }));
    d.register(mkDescriptor({ id: 'c' }));
    expect(d.list().map(x => x.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('matchUrl — pathname filtering', () => {
  it('returns descriptors whose pathnamePattern matches the given pathname', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'yt:shorts',
      platform: 'youtube',
      pathnamePattern: /^\/shorts\//,
    }));
    d.register(mkDescriptor({
      id: 'yt:watch',
      platform: 'youtube',
      pathnamePattern: /^\/watch/,
    }));

    const onShorts = d.matchUrl('youtube', '/shorts/abc123');
    expect(onShorts.map(x => x.id)).toEqual(['yt:shorts']);

    const onWatch = d.matchUrl('youtube', '/watch?v=xyz');
    expect(onWatch.map(x => x.id)).toEqual(['yt:watch']);
  });

  it('null pathnamePattern matches any pathname on the platform', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'yt:any',
      platform: 'youtube',
      pathnamePattern: null,
    }));
    expect(d.matchUrl('youtube', '/').map(x => x.id)).toEqual(['yt:any']);
    expect(d.matchUrl('youtube', '/shorts/xyz').map(x => x.id)).toEqual(['yt:any']);
    expect(d.matchUrl('youtube', '/watch?v=q').map(x => x.id)).toEqual(['yt:any']);
  });

  it('does not return descriptors registered for a different platform', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({ id: 'fb:any', platform: 'facebook', pathnamePattern: null }));
    d.register(mkDescriptor({ id: 'tt:any', platform: 'tiktok', pathnamePattern: null }));
    expect(d.matchUrl('youtube', '/shorts/abc')).toEqual([]);
  });

  it('returns multiple descriptors when several match', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({ id: 'yt:any', platform: 'youtube', pathnamePattern: null }));
    d.register(mkDescriptor({
      id: 'yt:shorts',
      platform: 'youtube',
      pathnamePattern: /^\/shorts\//,
    }));
    const matches = d.matchUrl('youtube', '/shorts/abc').map(x => x.id);
    expect(matches).toContain('yt:any');
    expect(matches).toContain('yt:shorts');
    expect(matches).toHaveLength(2);
  });
});

describe('matchAndWalk — DOM container resolution', () => {
  it('returns SurfaceMatch with containers found via querySelectorAll', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'yt:shorts',
      platform: 'youtube',
      pathnamePattern: /^\/shorts\//,
      containerSelectors: ['ytd-reel-video-renderer'],
    }));

    document.body.innerHTML = '';
    const reelA = document.createElement('ytd-reel-video-renderer');
    const reelB = document.createElement('ytd-reel-video-renderer');
    document.body.appendChild(reelA);
    document.body.appendChild(reelB);

    const matches = d.matchAndWalk('youtube', '/shorts/abc');
    expect(matches).toHaveLength(1);
    expect(matches[0].descriptor.id).toBe('yt:shorts');
    expect(matches[0].containers).toHaveLength(2);
    expect(matches[0].containers[0]).toBe(reelA);
    expect(matches[0].containers[1]).toBe(reelB);
  });

  it('honors the optional `root` parameter — only walks within that subtree', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'fb:search',
      platform: 'facebook',
      pathnamePattern: /^\/search\//,
      containerSelectors: ['div[role="article"]'],
    }));

    document.body.innerHTML = '';
    const inside = document.createElement('div');
    const a = document.createElement('div');
    a.setAttribute('role', 'article');
    inside.appendChild(a);
    document.body.appendChild(inside);

    const outside = document.createElement('div');
    outside.setAttribute('role', 'article');
    document.body.appendChild(outside);

    const scoped = d.matchAndWalk('facebook', '/search/posts', inside);
    expect(scoped[0].containers).toHaveLength(1);
    expect(scoped[0].containers[0]).toBe(a);

    const docWide = d.matchAndWalk('facebook', '/search/posts');
    expect(docWide[0].containers).toHaveLength(2);
  });

  it('returns SurfaceMatch with empty containers when descriptor matches URL but selectors find nothing', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'ig:explore',
      platform: 'instagram',
      pathnamePattern: /^\/explore\//,
      containerSelectors: ['article'],
    }));

    document.body.innerHTML = '';
    const matches = d.matchAndWalk('instagram', '/explore/people');
    expect(matches).toHaveLength(1);
    expect(matches[0].containers).toEqual([]);
  });

  it('returns SurfaceMatch with empty containers when containerSelectors is empty (consumer uses URL-gate only)', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'yt:shorts-gate',
      platform: 'youtube',
      pathnamePattern: /^\/shorts\//,
      containerSelectors: [],
    }));

    const matches = d.matchAndWalk('youtube', '/shorts/abc');
    expect(matches).toHaveLength(1);
    expect(matches[0].containers).toEqual([]);
  });

  it('skips descriptors whose URL pattern does not match', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'yt:shorts',
      platform: 'youtube',
      pathnamePattern: /^\/shorts\//,
      containerSelectors: ['ytd-reel-video-renderer'],
    }));

    document.body.innerHTML = '';
    const reel = document.createElement('ytd-reel-video-renderer');
    document.body.appendChild(reel);

    const matches = d.matchAndWalk('youtube', '/watch?v=abc');
    expect(matches).toEqual([]);
  });

  it('multiple descriptors on the same URL each yield their own SurfaceMatch', () => {
    const d = createSurfaceDetector();
    d.register(mkDescriptor({
      id: 'yt:any',
      platform: 'youtube',
      pathnamePattern: null,
      containerSelectors: ['ytd-rich-item-renderer'],
    }));
    d.register(mkDescriptor({
      id: 'yt:shorts',
      platform: 'youtube',
      pathnamePattern: /^\/shorts\//,
      containerSelectors: ['ytd-reel-video-renderer'],
    }));

    document.body.innerHTML = '';
    document.body.appendChild(document.createElement('ytd-rich-item-renderer'));
    document.body.appendChild(document.createElement('ytd-reel-video-renderer'));

    const matches = d.matchAndWalk('youtube', '/shorts/abc');
    expect(matches).toHaveLength(2);
    expect(matches.find(m => m.descriptor.id === 'yt:any')!.containers).toHaveLength(1);
    expect(matches.find(m => m.descriptor.id === 'yt:shorts')!.containers).toHaveLength(1);
  });
});

describe('isolation — separate detectors do not share state', () => {
  it('createSurfaceDetector() yields independent registries', () => {
    const a = createSurfaceDetector();
    const b = createSurfaceDetector();
    a.register(mkDescriptor({ id: 'only-in-a' }));
    expect(a.list()).toHaveLength(1);
    expect(b.list()).toHaveLength(0);
  });
});
