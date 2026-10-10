# surfaces — per-platform DOM extraction contracts

How each platform's feed becomes `PostContent[]`: what is captured, the **id + grouping
scheme**, comment depth, and lazy-render timing. Code-derived from `src/content/platforms/`; re-read against the code in the 2026-08-23
objective audit (spec-drift.md items 36 to 38). Selector-level historical detail lives in the
[platform-adapters subsystem doc](../subsystems/platform-adapters.md); this folder is the
current *contract*, not a selector dump. An older selector dump of 2026-05-23 was archived into
the repository's history folder, which is not part of the public copy, and the link that pointed
at its pre-move path led nowhere in either copy from the day it moved. Re-verify cites before relying (see
[update-protocol.md](../update-protocol.md)).

## Cross-platform invariants (all adapters uphold)

- **Chain-mirror:** extraction reads only the rendered DOM at call time — no API resolution,
  no pre-fetch of un-expanded replies (`twitter.ts`, `tiktok.ts`; the chain-mirror comments in each adapter).
- **Per-element dedup:** each seen node is stamped (`fwProcessed` / `fwCaptionEmitted` /
  `fwCommentSeen` / `fwReelProcessed` / `fwTileSeen`) before any downstream push; lazy-load
  re-entries skip stamped nodes.
- **`parentVideoId` cohesion:** every comment from one post shares `parentVideoId` = the bare
  platform id the post record also carries as its own `parentVideoId` (the post record's `id`
  itself is prefixed on Facebook and TikTok), so the encounter-builder + dashboard can group
  them (`facebook.ts`, `instagram.ts`, `tiktok.ts`, `youtube.ts` parentVideoId stamps).
- **0 is not a lie:** engagement counts return `undefined`, never `0`, when the DOM element is
  absent (a `0` would corrupt amplification-ratio math) (`twitter.ts` metrics extractor).
- **Sponsor flag is post-only:** `is_sponsored` is set at `depth=0` only, never on a comment.
- **DM exclusion:** `isPrivateMessageSurface()` + `findChatOverlayAncestor()` block extraction
  before any DOM read, and `isInPrivateChatSubtree()` drops any candidate inside a dialog or
  `role=log` subtree (`adapter.ts:findChatOverlayAncestor`, `isInPrivateChatSubtree`).

## The id + grouping scheme (the seed-bug surface)

A post and its comments must share one stable id or the dashboard splits/duplicates them. The
fallback to a non-deterministic id is the root of the chain-id-instability theme — see
`known-issues.md` (private).

| Platform | Post id source | Fallback when not found | Comment id | parentVideoId |
|---|---|---|---|---|
| X | `/status/<id>` link parsed atomically with the author (`_extractStatusIdentity` / `_coherentIdentityForArticle` over `resolveTwitterStatusIdentity`) | **`crypto.randomUUID()`** (`twitter.ts`); `sourceUrl` is omitted for a synthetic id, so no dead "View original" link | walked permalink tree | focused tweet id |
| Facebook | `/posts/`, `/permalink/`, `story_fbid`, `/reel/`, `/share/[pv]/` href, then `_extractPostIdFromPath` from the page URL | **`crypto.randomUUID()`** (`facebook.ts`); stashed in `dataset.fwPostId` (session-stable; re-minted after a rescan, known-issues M118) | `fb-cmt-<postId>-c<N>` (persistent counter) | post id |
| Instagram | `/p/<id>/`, reel id | per-surface (reel/permalink/tile) | dom-master rows | post id |
| TikTok | in-card `/video/<digits>` href, then the strict `xgwrapper-<idx>-<19 digits>` id, then the permalink URL (`tiktok.ts:getSyntheticVideoId` chain) | **`tk-music-<ts>-<rand>`** for music/empty-caption feed, cached per DOM container; in the bundle, a non-empty caption with no href, no wrapper and no permalink gets `tk-vid-<uuid>` via `synthId()` | `tk-cmt-<videoId>-<c.id>` | bare digits across adapter and video-pipeline |
| YouTube | `/post/<id>` (community only) | **`crypto.randomUUID()`** (`youtube.ts`) | `yt-c-<lc>` from `yt-watch-comments.ts` on `/watch` (flag `ytWatchComments`, default on); none from the adapter | post id / watch video id |

## Per-platform contracts

- [x.md](x.md) — strongest surface; permalink tree walk; aria-label metrics.
- [facebook.md](facebook.md) — `[aria-posinset]` wrappers; `story_message` text; depth via ancestor walk.
- [instagram.md](instagram.md): three surface fallbacks (reel / permalink / tile); expanded L2 replies captured on the article path (depth 2), permalink path depth 1 only.
- [tiktok.md](tiktok.md): bundle extractor; tile surfaces skipped; metrics read once at caption emission inside the seal guard (seed #2 fixed in 62fd8e3; a card whose rail hydrates after the seal records blanks, low).
- [youtube.md](youtube.md): community posts from the adapter; `/watch` comments from `yt-watch-comments.ts` (flag-gated, default on).
