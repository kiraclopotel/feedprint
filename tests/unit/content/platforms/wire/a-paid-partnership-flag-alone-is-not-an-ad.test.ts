// F47 site A: TikTok's `adAuthorization` is the creator's own paid-partnership declaration on an ordinary creator video, not
// TikTok's flag for an ad placement (`isAd`). The wire parser treated either as sponsored, so a creator video that merely
// declared a partnership was read as an ad: collapsed when Block Ads is on, and the feed moved under the person. Measured live
// on 35 guest rows (team/VERIFY.md, Thu 1 Oct 04:02, fact a): isAd true on 2, adAuthorization true on 3, of which 1 with
// adAuthorization alone. Now only isAd marks the item sponsored; a row with both, and a row with isAd alone, stay sponsored.

import { describe, expect, it } from 'vitest';

import { parseTiktokPayload } from '../../../../../src/content/platforms/wire/tiktok';

const url = 'https://www.tiktok.com/api/recommend/item_list/?count=16';

function item(id: string, flags: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    desc: 'Synthetic caption.',
    createTime: 1_700_000_000,
    author: { uniqueId: 'example_creator', nickname: 'Example' },
    video: { id, cover: 'https://www.tiktok.com/static/synthetic-cover.jpeg' },
    stats: { diggCount: 0, commentCount: 0, shareCount: 0 },
    ...flags,
  };
}

function sponsoredOf(flags: Record<string, unknown>): boolean | undefined {
  const posts = parseTiktokPayload(url, { itemList: [item('7000000000000000100', flags)] }, { pathname: '/' });
  expect(posts, 'the item is read').toHaveLength(1);
  return posts[0].is_sponsored;
}

describe('F47 site A: only TikTok\'s ad flag makes a video sponsored', () => {
  it('control: isAd true is sponsored', () => {
    expect(sponsoredOf({ isAd: true })).toBe(true);
  });

  it('control: isAd true with adAuthorization is sponsored', () => {
    expect(sponsoredOf({ isAd: true, adAuthorization: true })).toBe(true);
  });

  it('a creator video with isAd false and adAuthorization true is not sponsored', () => {
    expect(sponsoredOf({ isAd: false, adAuthorization: true })).toBeUndefined();
  });

  it('a creator video with adAuthorization alone, no isAd at all, is not sponsored', () => {
    expect(sponsoredOf({ adAuthorization: true })).toBeUndefined();
  });

  it('control: an ordinary video with neither flag is not sponsored', () => {
    expect(sponsoredOf({})).toBeUndefined();
  });
});
