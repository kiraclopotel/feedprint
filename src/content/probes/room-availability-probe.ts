// FeelingWise — is a post's room in the DOM when the post is extracted?
//
// MEASUREMENT ONLY. No control flow, no verdict, no DOM writes.
//
// The question it answers (2026-08-24): `PostContent.context` — the room block
// for the SINGLE-post judge — is filled at exactly one site, `tiktok.ts:793`.
// TikTok can fill it because `snapshot.comments` is already populated when the
// video post is built. Whether X, Facebook, Instagram and YouTube could do the
// same is a DOM-timing fact, not a design opinion, and it differs per SURFACE:
// X walks a full reply tree on a `/status/` permalink and has no replies at all
// on the home feed, where an empty room block is CORRECT rather than a defect.
//
// So this counts, per platform AND per surface, how often a root post arrived
// from `extractPosts` alongside at least one of its own comments.
//
// HONEST BOUND: this is a FLOOR, not the truth. It sees one extraction pass, so
// comments that arrive in a LATER pass are not counted, and the real
// availability is >= what this reports. A high number therefore proves the room
// is reachable; a low number proves nothing on its own and must not be read as
// "the room is not there".

import type { PostContent, Platform } from '../../types/post';
import { bumpCounter } from '../../diagnostics/diagnostics';

/** Root kinds. `undefined` defaults to 'post' per PostContent.kind's contract. */
function isRoot(post: PostContent): boolean {
  return post.kind === undefined || post.kind === 'post' || post.kind === 'video';
}

/** The surface a post was seen on, for the per-surface split that X needs. */
export function surfaceOf(post: PostContent): string {
  const spec = post.platform_specific;
  if (spec && 'surfaceKind' in spec && typeof spec.surfaceKind === 'string') {
    return spec.surfaceKind;
  }
  return post.feedSource ?? 'unknown';
}

export interface RoomTally {
  surface: string;
  roots: number;
  rootsWithRoom: number;
}

/**
 * Pure. Group one extraction pass by surface and, within each surface, count
 * root posts and how many of them had at least one of their OWN comments in
 * the same pass. Parentage is checked against both pointers a comment may
 * carry: `parent_id` (immediate parent) and `parentVideoId` (container).
 */
export function tallyRoomAtExtract(posts: PostContent[]): RoomTally[] {
  const bySurface = new Map<string, PostContent[]>();
  for (const post of posts) {
    const surface = surfaceOf(post);
    const bucket = bySurface.get(surface);
    if (bucket) bucket.push(post);
    else bySurface.set(surface, [post]);
  }

  const out: RoomTally[] = [];
  for (const [surface, group] of bySurface) {
    const roots = group.filter(isRoot);
    if (roots.length === 0) continue;
    const parentIds = new Set<string>();
    for (const post of group) {
      if (isRoot(post)) continue;
      if (post.parent_id) parentIds.add(post.parent_id);
      if (post.parentVideoId) parentIds.add(post.parentVideoId);
    }
    out.push({
      surface,
      roots: roots.length,
      // A root is matched by its own id AND by its own `parentVideoId`.
      // The second is load-bearing, not defensive: tiktok.ts emits the video
      // post with `id: 'tk-vid-<videoId>'` but stamps its comments
      // `parent_id: videoId` / `parentVideoId: videoId` -- the BARE container
      // id, which the root also carries in its own `parentVideoId`. Matching
      // on `id` alone reported 0 room on TikTok, the one platform that
      // demonstrably has the room at extract time (tiktok.ts:766 builds
      // `captionContext` from the same snapshot). Measured 2026-08-24: every
      // surface read 0, which was this bug, not the platforms.
      rootsWithRoom: roots.filter(
        (r) => parentIds.has(r.id) || (r.parentVideoId !== undefined && parentIds.has(r.parentVideoId)),
      ).length,
    });
  }
  return out;
}

/** Bump the per-platform, per-surface counters for one extraction pass. */
export function probeRoomAtExtract(posts: PostContent[], platform: Platform): void {
  if (posts.length === 0) return;
  for (const tally of tallyRoomAtExtract(posts)) {
    const key = `room:${platform}:${tally.surface}`;
    bumpCounter(key, tally.roots);
    if (tally.rootsWithRoom > 0) bumpCounter(`${key}:withRoom`, tally.rootsWithRoom);
  }
}
