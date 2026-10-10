// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSyntheticUuid, buildPostUrl } from '../../../../src/content/record/post-url';
import type { PostContent } from '../../../../src/types/post';

// 2026-05-04 §CT-6 — synthetic-UUID detection + buildPostUrl fallback.
// Triggered by a forensic-export review showing IG records with
// postUrl: 'https://www.instagram.com/p/<UUID>/' — DEAD links in dashboard
// because <UUID> is not a real IG post code (instagram.ts:37 falls back to
// crypto.randomUUID() when _extractPostId returns null).

describe('isSyntheticUuid — UUID v4 dash-pattern detector', () => {
  it('detects standard UUID v4 (8-4-4-4-12 hex)', () => {
    expect(isSyntheticUuid('ecfcf8e9-a192-46d7-9f9e-a16f84bd4cf3')).toBe(true);
    expect(isSyntheticUuid('bb7c14fa-1458-4044-9a3c-734fe1a310dd')).toBe(true);
    expect(isSyntheticUuid('f10278e7-923e-4497-b683-f7ee47ee9519')).toBe(true);
    expect(isSyntheticUuid('11111111-1111-4111-8111-111111111111')).toBe(true);
  });

  it('rejects format-shaped IG post codes (alphanumeric, no dashes, ~11 chars)', () => {
    expect(isSyntheticUuid('SYNTHPOST01')).toBe(false);
    expect(isSyntheticUuid('SYNTHPOST02')).toBe(false);
    expect(isSyntheticUuid('SYNTHPOST03')).toBe(false);
  });

  it('rejects format-shaped TikTok video IDs (19-digit numerics)', () => {
    expect(isSyntheticUuid('7100000000000000001')).toBe(false);
    expect(isSyntheticUuid('7100000000000000002')).toBe(false);
  });

  it('rejects format-shaped Twitter status IDs', () => {
    expect(isSyntheticUuid('8100000000000000001')).toBe(false);
  });

  it('rejects FB pfbid hashes', () => {
    expect(isSyntheticUuid('pfbidSyntheticExample1234567890')).toBe(false);
  });

  it('rejects empty/malformed strings', () => {
    expect(isSyntheticUuid('')).toBe(false);
    expect(isSyntheticUuid('not-a-uuid')).toBe(false);
    expect(isSyntheticUuid('zz-zz-zz')).toBe(false);
  });
});

const ORIGINAL_HREF = window.location.href;

beforeEach(() => {
  // Set a controlled location.href for buildPostUrl fallback tests.
  // jsdom blocks cross-origin replaceState, so set a same-origin path instead.
  window.history.replaceState({}, '', '/test-page');
});

afterEach(() => {
  window.history.replaceState({}, '', ORIGINAL_HREF);
});

function makePost(partial: Partial<PostContent>): PostContent {
  return {
    id: '',
    text: 'sample',
    author: '',
    timestamp: new Date().toISOString(),
    platform: 'instagram',
    domRef: new WeakRef(document.createElement('div')),
    feedSource: 'unknown',
    sourceUrl: '',
    ...partial,
  };
}

describe('buildPostUrl — sourceUrl wins; synthetic-UUID falls back to location.href', () => {
  it('returns sourceUrl verbatim when present', () => {
    const post = makePost({
      platform: 'instagram',
      id: 'SYNTHPOST03',
      sourceUrl: 'https://www.instagram.com/reel/CustomPath/',
    });
    expect(buildPostUrl(post)).toBe('https://www.instagram.com/reel/CustomPath/');
  });

  it('IG: real post code → constructs valid URL', () => {
    const post = makePost({
      platform: 'instagram',
      id: 'SYNTHPOST03',
    });
    expect(buildPostUrl(post)).toBe('https://www.instagram.com/p/SYNTHPOST03/');
  });

  it('IG: synthetic UUID → falls back to location.href (NO dead link)', () => {
    const post = makePost({
      platform: 'instagram',
      id: 'ecfcf8e9-a192-46d7-9f9e-a16f84bd4cf3',
    });
    const url = buildPostUrl(post);
    // location.href in jsdom default is the test runner's URL; just confirm
    // we did NOT construct the dead synthetic URL.
    expect(url).not.toContain('ecfcf8e9-a192-46d7-9f9e-a16f84bd4cf3');
    expect(url.startsWith('http')).toBe(true);
  });

  it('TikTok: real video ID + author → constructs valid URL', () => {
    const post = makePost({
      platform: 'tiktok',
      id: '7100000000000000002',
      author: '@example_builder',
    });
    expect(buildPostUrl(post)).toBe('https://www.tiktok.com/@example_builder/video/7100000000000000002');
  });

  it('TikTok: synthetic UUID id → falls back to location.href (NO dead link)', () => {
    const post = makePost({
      platform: 'tiktok',
      id: '11111111-1111-4111-8111-111111111111',
      author: '@anyhandle',
    });
    const url = buildPostUrl(post);
    expect(url).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(url.startsWith('http')).toBe(true);
  });

  it('FB: synthetic UUID id → falls back to location.href', () => {
    const post = makePost({
      platform: 'facebook',
      id: 'bb7c14fa-1458-4044-9a3c-734fe1a310dd',
    });
    const url = buildPostUrl(post);
    expect(url).not.toContain('bb7c14fa-1458-4044-9a3c-734fe1a310dd');
  });

  it('falls back to location.href when post has no id and no sourceUrl', () => {
    // Post with no extracted URL + no id → buildPostUrl returns the
    // current page URL rather than empty string. The user lands on the
    // surface where FW saw the post, not a dead-end. Empty-string return
    // is reserved for SSR / no-window contexts where `typeof location
    // !== 'undefined'` is false.
    const post = makePost({ platform: 'instagram', id: '' });
    const url = buildPostUrl(post);
    expect(url).not.toBe('');
    expect(url.startsWith('http')).toBe(true);
  });
});
