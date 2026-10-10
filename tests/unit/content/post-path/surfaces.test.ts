// The inventory of the ways content arrives (src/content/post-path/surfaces.ts): a
// two-sided corpus per platform. Paths the adapters handle today MUST read
// as modeled (standing down there would remove protection silently); live
// and streaming chats, notifications, marketplaces, dating, shops and
// account pages MUST read as stand-down; private messages as excluded; a
// path no rule names as unmodeled, so it is counted and not silently
// treated. Every rule carries a note that names its source.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  classifySurface, listSurfaces, noteSurfaceSighting, shouldStandDown, SURFACE_RULES, _resetSurfaceSightingsForTesting,
} from '../../../../src/content/post-path/surfaces';
import { _getDiagnosticCountersForTesting, _resetDiagnosticsForTesting } from '../../../../src/diagnostics/diagnostics';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Platform } from '../../../../src/types/post';

beforeEach(() => { _resetSurfaceSightingsForTesting(); _resetDiagnosticsForTesting(); });

const MODELED: Array<[Platform, string, string]> = [
  ['facebook', '/', 'facebook-home-feed'],
  ['facebook', '/reel/123', 'facebook-reel'],
  ['facebook', '/groups/some.group/', 'facebook-groups'],
  ['facebook', '/groups/some.group/permalink/1/', 'facebook-groups'],
  ['facebook', '/watch/?v=1', 'facebook-watch'],
  ['facebook', '/watch', 'facebook-watch'],
  ['facebook', '/search/posts/?q=x', 'facebook-search'],
  ['facebook', '/photo/?fbid=1', 'facebook-permalink'],
  ['facebook', '/some.user/posts/1', 'facebook-permalink'],
  ['facebook', '/events/1/', 'facebook-events'],
  ['facebook', '/profile.php?id=1', 'facebook-profile'],
  ['facebook', '/some.page', 'facebook-profile'],
  ['instagram', '/', 'instagram-home-feed'],
  ['instagram', '/explore/', 'instagram-explore'],
  ['instagram', '/reels/abc/', 'instagram-reels'],
  ['instagram', '/reel/abc/', 'instagram-reels'],
  ['instagram', '/p/abc/', 'instagram-post'],
  ['instagram', '/someone/', 'instagram-profile'],
  ['instagram', '/someone/reels/', 'instagram-profile'],
  ['tiktok', '/', 'tiktok-for-you'],
  ['tiktok', '/foryou', 'tiktok-for-you'],
  ['tiktok', '/following', 'tiktok-following'],
  ['tiktok', '/friends', 'tiktok-following'],
  ['tiktok', '/explore', 'tiktok-explore'],
  ['tiktok', '/search?q=x', 'tiktok-search'],
  ['tiktok', '/tag/x', 'tiktok-search'],
  ['tiktok', '/@someone/video/1', 'tiktok-permalink'],
  ['tiktok', '/@someone', 'tiktok-profile'],
  ['twitter', '/home', 'twitter-home-feed'],
  ['twitter', '/', 'twitter-home-feed'],
  ['twitter', '/explore', 'twitter-explore'],
  ['twitter', '/search?q=x', 'twitter-search'],
  ['twitter', '/i/communities/1', 'twitter-communities'],
  ['twitter', '/i/lists/1', 'twitter-lists'],
  ['twitter', '/someone/status/1', 'twitter-permalink'],
  ['twitter', '/someone', 'twitter-profile'],
  ['twitter', '/someone/with_replies', 'twitter-profile'],
  ['youtube', '/', 'youtube-home'],
  ['youtube', '/feed/subscriptions', 'youtube-home'],
  ['youtube', '/watch', 'youtube-watch'],
  ['youtube', '/shorts/abc', 'youtube-shorts'],
  ['youtube', '/results', 'youtube-search'],
  ['youtube', '/@someone/community', 'youtube-community'],
  ['youtube', '/post/abc', 'youtube-community'],
  ['youtube', '/@someone', 'youtube-channel'],
  ['youtube', '/channel/UC1', 'youtube-channel'],
];

const STAND_DOWN: Array<[Platform, string, string]> = [
  ['facebook', '/live/', 'facebook-live'],
  ['facebook', '/live/producer', 'facebook-live'],
  ['facebook', '/gaming/', 'facebook-live'],
  ['facebook', '/stories/1/', 'facebook-stories'],
  ['facebook', '/notifications', 'facebook-notifications'],
  ['facebook', '/marketplace/item/1', 'facebook-marketplace'],
  ['facebook', '/dating', 'facebook-dating'],
  ['facebook', '/settings/', 'facebook-account'],
  ['facebook', '/saved/', 'facebook-account'],
  ['instagram', '/someone/live/', 'instagram-live'],
  ['instagram', '/stories/someone/1/', 'instagram-stories'],
  ['instagram', '/accounts/activity/', 'instagram-notifications'],
  ['instagram', '/accounts/edit/', 'instagram-account'],
  ['tiktok', '/live', 'tiktok-live'],
  ['tiktok', '/@someone/live', 'tiktok-live'],
  ['tiktok', '/shop', 'tiktok-shop'],
  ['tiktok', '/notifications', 'tiktok-notifications'],
  ['tiktok', '/setting', 'tiktok-account'],
  ['tiktok', '/upload', 'tiktok-account'],
  ['twitter', '/i/spaces/1', 'twitter-spaces'],
  ['twitter', '/i/broadcasts/1', 'twitter-broadcasts'],
  ['twitter', '/notifications', 'twitter-notifications'],
  ['twitter', '/settings/account', 'twitter-account'],
  ['twitter', '/i/grok', 'twitter-account'],
  ['youtube', '/live_chat?v=1', 'youtube-live-chat'],
  ['youtube', '/live_chat_replay?v=1', 'youtube-live-chat'],
  ['youtube', '/live', 'youtube-live'],
  ['youtube', '/@someone/streams', 'youtube-live'],
  ['youtube', '/feed/history', 'youtube-account'],
  ['youtube', '/playlist?list=1', 'youtube-account'],
  ['youtube', '/embed/abc', 'youtube-embed'],
];

const EXCLUDED: Array<[Platform, string]> = [
  ['facebook', '/messages/t/1'], ['facebook', '/messenger'],
  ['instagram', '/direct/inbox/'],
  ['tiktok', '/messages'], ['tiktok', '/inbox'],
  ['twitter', '/messages'], ['twitter', '/i/chat'],
];

describe('the surface inventory', () => {
  it.each(MODELED)('%s %s is modeled as %s', (platform, path, surface) => {
    expect(classifySurface(platform, path)).toEqual({ surface, treatment: 'modeled' });
    expect(shouldStandDown(platform, path)).toBe(false);
  });

  it.each(STAND_DOWN)('%s %s stands down as %s', (platform, path, surface) => {
    expect(classifySurface(platform, path)).toEqual({ surface, treatment: 'stand-down' });
    expect(shouldStandDown(platform, path)).toBe(true);
  });

  it.each(EXCLUDED)('%s %s is excluded', (platform, path) => {
    expect(classifySurface(platform, path).treatment).toBe('excluded');
    expect(shouldStandDown(platform, path)).toBe(true);
  });

  it('a path no rule names is unmodeled, and unmodeled does not stand down', () => {
    for (const [platform, path] of [['facebook', '/some/unknown/thing/'], ['youtube', '/some_new_surface'], ['tiktok', '/@someone/collection/1']] as Array<[Platform, string]>) {
      expect(classifySurface(platform, path)).toEqual({ surface: `${platform}-unmodeled`, treatment: 'unmodeled' });
      expect(shouldStandDown(platform, path)).toBe(false);
    }
  });

  it('every rule names its source, every surface name is unique and carries its platform, and the live surfaces of every platform stand down', () => {
    const all = listSurfaces();
    expect(all.length).toBeGreaterThan(50);
    const names = new Set<string>();
    for (const r of all) {
      expect(r.note.length, r.surface).toBeGreaterThan(10);
      expect(r.surface.startsWith(`${r.platform}-`), r.surface).toBe(true);
      expect(names.has(r.surface), `duplicate ${r.surface}`).toBe(false);
      names.add(r.surface);
    }
    for (const platform of Object.keys(SURFACE_RULES) as Platform[]) {
      const live = SURFACE_RULES[platform].filter((r) => /live|spaces|broadcasts/.test(r.surface));
      expect(live.length, `${platform} names no live surface`).toBeGreaterThan(0);
      for (const r of live) expect(r.treatment, r.surface).toBe('stand-down');
    }
  });

  it('a stand-down is counted once per page life under its surface name; an unmodeled path under its first segment; a modeled page not at all', () => {
    noteSurfaceSighting('youtube', '/live_chat?v=1', classifySurface('youtube', '/live_chat?v=1'));
    noteSurfaceSighting('youtube', '/live_chat?v=2', classifySurface('youtube', '/live_chat?v=2'));
    noteSurfaceSighting('facebook', '/brand_new/thing/', classifySurface('facebook', '/brand_new/thing/'));
    noteSurfaceSighting('twitter', '/home', classifySurface('twitter', '/home'));
    const c = _getDiagnosticCountersForTesting();
    expect(c['surface.standDown:youtube-live-chat']).toBe(1);
    const unmodeled = Object.keys(c).filter((k) => k.startsWith('surface.unmodeled:facebook:'));
    expect(unmodeled).toHaveLength(1);
    // The segment is often an account handle and the counters are pasted to
    // support: the key carries an 8-character hash of it, never the word.
    expect(unmodeled[0]).toMatch(/^surface\.unmodeled:facebook:[0-9a-f]{8}$/);
    expect(unmodeled[0]).not.toContain('brand_new');
    expect(Object.keys(c).filter((k) => k.startsWith('surface.'))).toHaveLength(2);
  });

  it('the interceptor consults the gate after the DM gate and before any extraction (source lock)', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../src/content/post-path/dom-interceptor.ts'), 'utf8');
    const body = src.slice(src.indexOf('private _processNodes('));
    const dm = body.indexOf('isPrivateMessageSurface()');
    const gate = body.indexOf('classifySurface(this.adapter.platform, location.pathname)');
    const extract = body.indexOf('this.adapter.extractPosts(nodes)');
    expect(dm).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(dm);
    expect(extract).toBeGreaterThan(gate);
    expect(body.slice(gate, extract)).toContain("surface.treatment === 'stand-down' || surface.treatment === 'excluded') return;");
  });

  it('classification is cached by platform and path, and the cache never grows past its cap', () => {
    for (let i = 0; i < 600; i++) classifySurface('twitter', `/user${i}/status/${i}`);
    expect(classifySurface('twitter', '/user1/status/1')).toEqual({ surface: 'twitter-permalink', treatment: 'modeled' });
  });
});
