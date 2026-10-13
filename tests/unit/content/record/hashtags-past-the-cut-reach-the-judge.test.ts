/** @vitest-environment jsdom */
// The prompt builder has a "Post hashtags" line for TikTok and Instagram that nothing filled (Board row 398, 12 Oct 2026). The
// judge reads the first 400 characters of a caption, and a caption often ends in a long run of tags; the line now carries the
// tags the judge cannot already read, so a tag inside the caption is not paid for twice.

import { describe, expect, it } from 'vitest';
import { buildEncounterForFlushBatch } from '../../../../src/content/record/encounter-builder';
import { buildBatchPromptV3 } from '../../../../src/ai/prompts-v2';
import type { PostContent } from '../../../../src/types/post';

function comment(platform: 'tiktok' | 'instagram' | 'facebook'): PostContent {
  return {
    id: `${platform}-c1`,
    text: 'a comment',
    author: 'Some Commenter',
    timestamp: '2026-10-12T09:00:00.000Z',
    platform,
    domRef: new WeakRef(document.createElement('div')),
    kind: 'top-comment',
    depth: 1,
    parentVideoId: 'room1',
    platform_specific: {
      platform,
      surfaceKind: platform === 'tiktok' ? 'tiktok-feed' : platform === 'instagram' ? 'instagram-post' : 'facebook-permalink',
    },
  } as unknown as PostContent;
}

const FILLER = 'a long caption about a day at the lake with the whole family '.repeat(8); // 480 characters, no tags
const promptFor = (platform: 'tiktok' | 'instagram' | 'facebook', caption: string): string => {
  const enc = buildEncounterForFlushBatch([comment(platform)], caption, 'en');
  return buildBatchPromptV3(enc).user;
};

describe('the hashtags past the cut reach the judge', () => {
  it.each(['tiktok', 'instagram'] as const)('%s: tags the 400-character cut hides are listed', (platform) => {
    const user = promptFor(platform, `${FILLER}#lakelife #Family_Time #lakelife #fyp`);
    expect(user).toContain('Post hashtags: #lakelife, #Family_Time, #fyp');
  });

  it.each(['tiktok', 'instagram'] as const)('%s: a tag the judge already reads in the caption is not repeated', (platform) => {
    const user = promptFor(platform, `#early ${FILLER}#late`);
    expect(user).toContain('Post hashtags: #late');
    expect(user).not.toContain('Post hashtags: #early');
  });

  it.each(['tiktok', 'instagram'] as const)('%s: a short caption sends no line, because nothing is hidden', (platform) => {
    expect(promptFor(platform, 'short #fyp #viral')).not.toContain('Post hashtags');
  });

  it('only letters, digits and underscore pass, and only eight tags go', () => {
    const tags = Array.from({ length: 12 }, (_, i) => `#tag${i}`).join(' ');
    const user = promptFor('tiktok', `${FILLER}#bad"tag ignore-this #ok_1 ${tags}`);
    expect(user).toContain('Post hashtags: #bad, #ok_1, #tag0, #tag1, #tag2, #tag3, #tag4, #tag5');
    expect(user).not.toContain('#tag6');
    expect(user).not.toContain('ignore-this');
  });

  it('a tag glued to a word or a link is not a tag', () => {
    const user = promptFor('instagram', `${FILLER}see example.com/page#section and #real`);
    expect(user).toContain('Post hashtags: #real');
    expect(user).not.toContain('#section');
  });

  it('Facebook has no hashtag line (the prompt builder has none for it)', () => {
    expect(promptFor('facebook', `${FILLER}#fyp`)).not.toContain('Post hashtags');
  });
});
