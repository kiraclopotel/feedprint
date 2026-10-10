// FeelingWise — room-at-extract probe (measurement only).
//
// Locks the tally, not the platforms: whether X can hand the single-post judge
// a room block is a DOM-timing FACT to be measured, and these tests only make
// sure the instrument counts what it claims to count.

import { describe, it, expect } from 'vitest';
import { tallyRoomAtExtract, surfaceOf } from '../../../../src/content/probes/room-availability-probe';
import type { PostContent, PostKind } from '../../../../src/types/post';

function post(
  id: string,
  kind: PostKind | undefined,
  surfaceKind: string,
  links: { parent_id?: string; parentVideoId?: string } = {},
): PostContent {
  return {
    id,
    text: 't-' + id,
    author: 'a',
    timestamp: '2026-08-24T00:00:00.000Z',
    platform: 'twitter',
    domRef: new WeakRef({} as HTMLElement),
    kind,
    ...links,
    platform_specific: { platform: 'twitter', surfaceKind },
  } as unknown as PostContent;
}

describe('tallyRoomAtExtract', () => {
  it('a root whose own reply arrived in the same pass counts as having its room', () => {
    const tallies = tallyRoomAtExtract([
      post('p1', 'post', 'twitter-permalink'),
      post('c1', 'top-comment', 'twitter-permalink', { parent_id: 'p1' }),
    ]);
    expect(tallies).toEqual([{ surface: 'twitter-permalink', roots: 1, rootsWithRoom: 1 }]);
  });

  it('parentVideoId links a comment to its container just as parent_id does', () => {
    const tallies = tallyRoomAtExtract([
      post('v1', 'video', 'tiktok-feed'),
      post('c1', 'comment', 'tiktok-feed', { parentVideoId: 'v1' }),
    ]);
    expect(tallies[0].rootsWithRoom).toBe(1);
  });

  it('a root extracted alone is counted, with no room', () => {
    const tallies = tallyRoomAtExtract([post('p1', 'post', 'twitter-home-feed')]);
    expect(tallies).toEqual([{ surface: 'twitter-home-feed', roots: 1, rootsWithRoom: 0 }]);
  });

  it('a comment naming a DIFFERENT root never credits the root in hand', () => {
    const tallies = tallyRoomAtExtract([
      post('p1', 'post', 'twitter-permalink'),
      post('c1', 'reply', 'twitter-permalink', { parent_id: 'p-other' }),
    ]);
    expect(tallies[0].rootsWithRoom).toBe(0);
  });

  it('surfaces are tallied separately — X feed and X permalink must not be averaged', () => {
    const tallies = tallyRoomAtExtract([
      post('p1', 'post', 'twitter-permalink'),
      post('c1', 'top-comment', 'twitter-permalink', { parent_id: 'p1' }),
      post('p2', 'post', 'twitter-home-feed'),
    ]);
    const bySurface = Object.fromEntries(tallies.map((t) => [t.surface, t]));
    expect(bySurface['twitter-permalink'].rootsWithRoom).toBe(1);
    expect(bySurface['twitter-home-feed'].rootsWithRoom).toBe(0);
  });

  it("a root is matched by its own parentVideoId, not just its id (the 2026-08-24 bug)", () => {
    // tiktok.ts emits the video as id 'tk-vid-<videoId>' while its comments
    // point at the BARE videoId, which the root carries in parentVideoId.
    // Matching on id alone reported 0 room on every surface.
    const root = post('tk-vid-999', 'video', 'tiktok-feed', { parentVideoId: '999' });
    const comment = post('tk-cmt-999-1', 'top-comment', 'tiktok-feed', {
      parent_id: '999',
      parentVideoId: '999',
    });
    expect(tallyRoomAtExtract([root, comment])[0].rootsWithRoom).toBe(1);
  });

  it('an undefined kind is a root, per PostContent.kind default', () => {
    expect(tallyRoomAtExtract([post('p1', undefined, 's')])[0].roots).toBe(1);
  });

  it('a pass carrying only comments reports nothing (no root to measure)', () => {
    expect(tallyRoomAtExtract([post('c1', 'comment', 's', { parent_id: 'p9' })])).toEqual([]);
  });

  it('surfaceOf falls back to feedSource, then unknown', () => {
    const noSpec = { id: 'x', feedSource: 'for-you' } as unknown as PostContent;
    expect(surfaceOf(noSpec)).toBe('for-you');
    expect(surfaceOf({ id: 'y' } as unknown as PostContent)).toBe('unknown');
  });
});
