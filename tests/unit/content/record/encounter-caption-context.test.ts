/** @vitest-environment jsdom */
// Q51 + Q52 (wiring W55): the caption reaches the batch encounter.
//
// bucket.posts holds comments only (enqueueCommentForBatch is its sole
// writer), so the assemblers' in-bucket caption lookup ALWAYS missed:
// is_sponsored never reached the batch prompt (ad copy judged organic),
// the post author blanked, FB caption metrics dropped. The flush site now
// hands the chokepoint-captured caption record plus the bucket author.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildEncounterForFlushBatch } from '../../../../src/content/record/encounter-builder';
import type { PostContent } from '../../../../src/types/post';

const INDEX_PATH = 'src/content/index.ts';
const FLUSH_PATH = 'src/content/comment-batch/flush.ts';
const TIKTOK_PATH = 'src/content/platforms/tiktok.ts';

function tkComment(i: number): PostContent {
  return {
    id: `tk-c-${i}`,
    text: `comment ${i}`,
    author: `@commenter${i}`,
    timestamp: new Date().toISOString(),
    platform: 'tiktok',
    domRef: new WeakRef(document.createElement('div')),
    kind: 'top-comment',
    depth: 1,
    parentVideoId: 'vid123',
    platform_specific: { platform: 'tiktok', surfaceKind: 'tiktok-feed' },
  } as unknown as PostContent;
}

function tkCaption(): PostContent {
  return {
    id: 'tk-vid-vid123',
    text: 'the caption',
    author: '@creator',
    timestamp: new Date().toISOString(),
    platform: 'tiktok',
    domRef: new WeakRef(document.createElement('div')),
    kind: 'video',
    parentVideoId: 'vid123',
    is_sponsored: true,
    platform_specific: { platform: 'tiktok', surfaceKind: 'tiktok-feed' },
  } as unknown as PostContent;
}

function fbComment(): PostContent {
  return {
    id: 'fb-c-1',
    text: 'fb comment',
    author: 'Some User',
    timestamp: new Date().toISOString(),
    platform: 'facebook',
    domRef: new WeakRef(document.createElement('div')),
    kind: 'top-comment',
    depth: 1,
    parentVideoId: 'fbpost1',
    platform_specific: { platform: 'facebook', surfaceKind: 'facebook-permalink' },
  } as unknown as PostContent;
}

describe('Q51 — caption context reaches the encounter', () => {
  it('TikTok: sponsored flag and author come from the chokepoint caption', () => {
    const enc = buildEncounterForFlushBatch(
      [tkComment(1), tkComment(2)],
      'the caption',
      'en',
      undefined,
      { post: tkCaption(), author: '@creator' },
    );
    expect(enc.platform).toBe('tiktok');
    expect(enc.post.is_sponsored).toBe(true);
    expect(enc.post.author.handle).toBe('@creator');
  });

  it('TikTok: bucket author is the fallback when no caption was captured', () => {
    const enc = buildEncounterForFlushBatch(
      [tkComment(1)],
      'the caption',
      'en',
      undefined,
      { author: '@fallback' },
    );
    expect(enc.post.author.handle).toBe('@fallback');
    expect(enc.post.is_sponsored).toBeUndefined();
  });

  it('Facebook: caption metrics thread through platform_specific', () => {
    const caption = {
      id: 'fb-post-fbpost1',
      text: 'fb caption',
      author: 'Page Name',
      timestamp: new Date().toISOString(),
      platform: 'facebook',
      domRef: new WeakRef(document.createElement('div')),
      kind: 'post',
      parentVideoId: 'fbpost1',
      is_sponsored: true,
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-permalink',
        postReactions: 120,
        postCommentsCount: 45,
        postShares: 7,
      },
    } as unknown as PostContent;
    const enc = buildEncounterForFlushBatch(
      [fbComment()],
      'fb caption',
      'en',
      undefined,
      { post: caption, author: 'Page Name' },
    );
    expect(enc.platform).toBe('facebook');
    expect(enc.post.is_sponsored).toBe(true);
    expect(enc.post.author.handle).toBe('Page Name');
    expect(enc.post.metrics.primary_likes).toBe(120);
    expect(enc.post.metrics.comments_count).toBe(45);
    expect(enc.post.metrics.shares).toBe(7);
  });

  it('without caption context the old blank behavior remains (no invention)', () => {
    const enc = buildEncounterForFlushBatch([tkComment(1)], 'cap', 'en');
    expect(enc.post.author.handle).toBe('');
    expect(enc.post.is_sponsored).toBeUndefined();
  });
});

describe('wiring (source-lock)', () => {
  const index = readFileSync(join(process.cwd(), INDEX_PATH), 'utf8');
  const flush = readFileSync(join(process.cwd(), FLUSH_PATH), 'utf8');
  const tiktok = readFileSync(join(process.cwd(), TIKTOK_PATH), 'utf8');

  it('the chokepoint captures caption records and the flush passes them', () => {
    expect(index).toContain('if (!isCommentKind && post.parentVideoId) rememberCaptionPost(post);');
    expect(flush).toContain('post: captionPostByParent.get(roomContextKey(bucket.platform, parentVideoId))');
    expect(flush).toContain('author: bucket.videoAuthor');
  });

  it('Q52: the TikTok caption record stamps surfaceKind like its siblings', () => {
    // The window is a cap on the object literal, not a distance: the block
    // ends at its own `});` (886 characters on 2026-09-06, 1,018 once the
    // card line landed on 2026-09-07).
    const block = tiktok.match(/id: `tk-vid-\$\{videoId\}`[\s\S]{0,1400}?\}\);/)?.[0] ?? '';
    expect(block).toContain('surfaceKind: toPostSurfaceKind(detectTikTokRoutingSurface())');
  });
});
