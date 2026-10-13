/** @vitest-environment jsdom */
// The judge is told whether the post's author is verified. The adapters read the badge from the post's header and stamp it on the
// caption record, but the encounter wrote `verified: false` for every post author, so a verified page's post reached the comment
// judge as "(unverified)" (Board row 398, 12 Oct 2026). The flag now travels from the caption record; a platform that extracts no
// badge stays false, never guessed.

import { describe, expect, it } from 'vitest';
import { buildEncounterForFlushBatch } from '../../../../src/content/record/encounter-builder';
import type { PostContent } from '../../../../src/types/post';

type Platform = 'facebook' | 'instagram' | 'youtube' | 'tiktok';

const SURFACE: Record<Platform, string> = {
  facebook: 'facebook-permalink',
  instagram: 'instagram-post',
  youtube: 'youtube-watch',
  tiktok: 'tiktok-feed',
};

function item(platform: Platform, kind: 'post' | 'video' | 'top-comment', isVerified?: boolean): PostContent {
  return {
    id: `${platform}-${kind}`,
    text: kind === 'top-comment' ? 'a comment' : 'the caption',
    author: kind === 'top-comment' ? 'Some Commenter' : 'The Page',
    timestamp: '2026-10-12T09:00:00.000Z',
    platform,
    domRef: new WeakRef(document.createElement('div')),
    kind,
    depth: kind === 'top-comment' ? 1 : undefined,
    parentVideoId: 'room1',
    platform_specific: { platform, surfaceKind: SURFACE[platform], ...(isVerified === undefined ? {} : { isVerified }) },
  } as unknown as PostContent;
}

function postAuthorVerified(platform: Platform, captionVerified: boolean | undefined): boolean {
  const caption = item(platform, platform === 'youtube' || platform === 'tiktok' ? 'video' : 'post', captionVerified);
  const enc = buildEncounterForFlushBatch([item(platform, 'top-comment', false)], 'the caption', 'en', undefined, {
    post: caption,
    author: 'The Page',
  });
  return enc.post.author.verified;
}

describe('the post author\'s verified badge reaches the judge', () => {
  it.each(['facebook', 'instagram', 'youtube'] as const)('%s: a caption stamped verified says verified', (platform) => {
    expect(postAuthorVerified(platform, true)).toBe(true);
  });

  it.each(['facebook', 'instagram', 'youtube'] as const)('%s: no badge, or none extracted, stays unverified', (platform) => {
    expect(postAuthorVerified(platform, false)).toBe(false);
    expect(postAuthorVerified(platform, undefined)).toBe(false);
  });

  it('a page whose caption was never captured is unverified, not guessed', () => {
    const enc = buildEncounterForFlushBatch([item('facebook', 'top-comment')], 'cap', 'en');
    expect(enc.post.author.verified).toBe(false);
  });

  it('the commenter\'s own badge still comes from the comment, not the post', () => {
    const enc = buildEncounterForFlushBatch([item('instagram', 'top-comment', true)], 'cap', 'en', undefined, {
      post: item('instagram', 'post', false),
      author: 'The Page',
    });
    expect(enc.post.author.verified).toBe(false);
    expect(enc.children[0].author.verified).toBe(true);
  });
});
