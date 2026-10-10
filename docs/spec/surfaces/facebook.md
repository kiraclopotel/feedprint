# Surface: Facebook

`src/content/platforms/facebook.ts` — `FacebookAdapter` (`extractPosts`).

## Captured

- **Post:** `_collectArticles` favors `[aria-posinset]` wrappers over bare `[role=article]`
  (`facebook.ts`). Text from `[data-ad-rendering-role=story_message]` first, then a
  longest-`dir=auto` heuristic (`_extractTextElement`).
- **Author:** `_extractAuthor` (`facebook.ts`). Since 2.5.1 the actor element's name is the
  first link inside `[data-ad-rendering-role=profile_name]`, cut at a no-break space, then at
  " · ": the element's whole text carried the verified badge's accessible text ("Sample
  Person\u00a0Verified account") and the header's narration ("is with Lee", "recommends
  Example Cafe" on a page's reviews tab) into the record as the author (the owner's 2026-09-05
  export). Lock: `tests/unit/content/platforms/facebook-author-byline.test.ts`. **Strategy 0 (group posts):** on a
  post surfaced from a group, `[data-ad-rendering-role=profile_name]` is the GROUP
  name, not the poster — the human author is the text of the `/groups/<gid>/user/<uid>/`
  link (first such link in doc order; the avatar copy carries no text). These `/user/`
  links exist only on group posts, so page/profile posts fall through to the unchanged
  `profile_name` path. Fixes groups rendering as `@GroupName` in the dashboard
  (live DOM 2026-06-23). Pages/ads still surface their own name as `author` — an
  ad/community distinction (separate field + dashboard chip) is not yet built.
- **Metrics:** `extractFacebookPostMetrics` (`facebook.ts`) — wired and populated.
- **Comment anchorUrl (Q58, live-attested 2026-08-11):** FB renders each comment's
  timestamp as an anchor `?comment_id=<id>` plus click-tracking params (`__cft__`,
  `__tn__`). `extractFacebookCommentAnchorUrl` climbs from the comment's text element to
  its `[role=article][aria-label]` row, takes the first `a[href*="comment_id="]`, and keeps
  origin + path + comment_id only (tracking stripped) — parity with X reply URLs and IG
  `/c/` links. Wired on both the feed and the reels side-panel comment sites. Lock:
  facebook-adapter.test.ts Q58 describe.
- **Comments:** `_extractComments` (`facebook.ts`) targets `[role=article][aria-label]`
  with multi-language `COMMENT_LABEL_STEMS`; **depth via ancestor-chain walk**
  (`facebook.ts`) — FB is the one platform that captures reply nesting.
- **Extraction counters (`fbCommentCandidates`, `fbCommentExtracted`,
  `fbCommentDroppedLabel` / `...LabelWithText` / `...NoText` / `...Short` /
  `...Duplicate`, `fbCommentAlreadySeen`) count DISTINCT ELEMENTS since
  2026-09-02**, via `dataset.fwCommentCandidate` and `noteCommentDrop`'s
  `dataset.fwCommentDrop` (keyed on element + reason). Before that they counted
  per pass on the drop side and per element on the extract side, because
  `fwCommentSeen` is stamped only after a successful extraction: rejects were
  re-examined and re-counted on every mutation-driven re-entry while extracted
  comments left the set, so the candidates:extracted ratio compared two
  different units (the 2026-09-01 dump's 2705 / 296 is not an 11% extraction
  rate). Reading is deliberately unchanged — a rejected element is still
  re-evaluated every pass, so a comment body that renders late is still picked
  up; only the counting is deduplicated. `fbCommentAlreadySeen` keeps its
  per-pass meaning (re-visits of settled comments).
  `fbCommentDroppedDuplicate` is new: the same-text drop inside one pass was
  the only exit in the walker with no counter, and the seen-set is keyed on
  exact text, so two people writing the same short reply lose the second.
  Known weakness, documented not fixed: `fbCommentDroppedLabelWithText` uses
  "has a body element with text" as its "this still looks like a comment"
  discriminator, and a shared post inside the article carries one, so correct
  rejections inflate it. Lock: tests/unit/diagnostics/fb-comment-drop-counters.test.ts.
- **Reels (`/reel/<id>`):** the dedicated branch bypasses the normal post-article collector,
  roots at `[role="complementary"]`, emits a reel video root, then calls
  `_extractComments(comp)` for the side-panel rows (`facebook.ts`). One authenticated
  current reel exposed one complementary panel with six rendered comment articles; all six
  were stamped `fwCommentSeen`, with zero FW errors. This verifies the observed layout only.

## id + grouping

- **Feed _text_ posts expose NO static post permalink** (DOM-proven 2026-06-23: no
  `/posts/`,`/permalink/`,`story_fbid` anchor; the timestamp anchor's href stays `/`
  and its fiber props carry no story id; FB scrambles the timestamp text).
- **postUrl capture (M36, `_extractPostUrl`)** — resolved in priority order, ALL read
  AT MOUNT so the value is carried on the record (`dataset.fwPostUrl`) and never
  re-derived at log time: (1) in-article permalink anchor (`/posts/`, `/permalink/`,
  `story_fbid`, `/reel/`, `/videos/`, `/share/[pv]/`, `watch/?v=`); (2) `/photo/?fbid=`;
  (3) **derived permalink** (`_derivePostPermalink`) — `<slug>/posts/<id>` /
  `permalink.php?story_fbid=<id>&id=<pid>` for user/page posts, `/groups/<gid>/posts/<id>`
  for group posts (gated on the group `/user/` link), built from `_extractPostId` + the
  article's own actor anchor; (4) the bare `/groups/<id>/` container; (5) **the surface
  URL captured at mount** (`location.href` read during extraction). The final fallback
  replaces the old `''` return — that empty string is what let `buildPostUrl`
  (`index.ts`) re-read `location.href` at LOG time, after the SPA had reverted to the
  feed root, stamping 148/438 records with the bare homepage. Genuinely anchorless
  feed posts (UUID id) still resolve to the mount-time feed/group surface — honest and
  stable, not a post-nav homepage; the real Share→Copy per-post permalink stays V1.5.
- Post id = `_extractPostId` scanning in-article hrefs for `/posts/`, `/permalink/`,
  `story_fbid`, `/reel/`, `/share/p/` and `/share/v/`, then `_extractPostIdFromPath` deriving a
  deterministic id from the page URL (group `/posts/` and `/permalink/`, user `/posts/`,
  `/share/p|v/`, `?story_fbid`); **else `crypto.randomUUID()`**, stashed in `dataset.fwPostId`
  so it is stable within a session (re-entry reads the stash; a rescan that cleared the
  stamps re-mints it, known-issues M118) but **drifts across reloads** (modern home-feed
  timestamps stay `#`/`/` until hover).
- Comment ids: `fb-cmt-<postId>-c<N>` with a **persistent counter** (`dataset.fwCommentNextIdx`,
  read at entry / written at exit, `facebook.ts`) so ids stay unique across lazy-load
  re-entries.
- Parent DOM scope: normal post articles and the Reel complementary panel carry
  `dataset.fwPostId`. Comment HIDE recovery uses that exact parent scope and accepts a
  replacement body only when full text and depth, plus author when available, produce one unique match. The
  generated `c<N>` value is not treated as stable across a remount.

## Lazy-render / timing

- Re-entry on lazy-loaded comments uses `fwProcessed` to skip the caption push and re-runs
  `_extractComments` with the persistent counter.
- Reel re-entry uses the same per-comment `fwCommentSeen` dedup; the reel root is emitted once
  per distinct reel id via `_emittedReelIds` (SPA nav to a new reel emits its own video record;
  re-scans of the same reel do not duplicate).

## Verified extraction issues → `known-issues.md` (private)

- **M3 / theme A (resolved):** the `/share/[pv]/` probe and `_extractPostIdFromPath` landed;
  the residual is a genuinely anchorless feed post on a feed-root URL, which still gets a UUID.
- **M36:** `postUrl` = bare `facebook.com` homepage on 148/438 (34%) post/video records —
  a capture-timing race where `buildPostUrl` re-read `location.href` at log time after SPA
  nav. Fixed in `_extractPostUrl` (mount-time capture + `_derivePostPermalink` + surface-URL
  fallback); carried to comment records via `dataset.fwPostUrl`. Needs live-verify.
- Reels with the current complementary-panel layout emit their rendered caption/comments
  through the dedicated branch. When Facebook exposes no caption or comment panel, the video
  pipeline remains the sensor; an empty side panel is not evidence of an adapter miss.

## Wire path

`src/content/platforms/wire/facebook.ts` parses Facebook's `/api/graphql/` responses, which the
page-world interceptor copies from page load on. It reads only the first JSON document of a
streamed response. What it returns fills gaps on the record the DOM adapter makes; the wire never
makes a record of its own.

## Reel page extras

On `/reel/` the reel author and caption come from document-level scans outside the side panel
(`[data-ad-rendering-role=profile_name]` and `[role=main]`), and `_isCommentArticle` tolerates a
parenthesized prefix on the comment aria-label.
