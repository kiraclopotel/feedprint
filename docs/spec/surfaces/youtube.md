# Surface: YouTube

`src/content/platforms/youtube.ts` — `YoutubeAdapter` (`extractPosts`),
plus `src/content/platforms/yt-watch-comments.ts` — flag-gated `/watch` comment capture
(docs/history/2026-08/YOUTUBE-E1-BRIEF.md). The most restricted surface, deliberately.

## Captured

- `extractPosts` (`youtube.ts`) **returns `[]` on `/watch` entirely** — `/watch` adapter
  extraction stays OFF as the renderer-OOM mitigation (the rAF-drained queue + full-document
  observers OOM'd the ~4 GB-per-tab renderer; see `docs/history/brain-2026-05-to-08/lessons/2026-06-05-youtube-renderer-oom-background-raf.md`).
  `shouldSkipNodeAccumulation` (interceptor.ts) and the `_processNodes` /watch short-circuit
  are likewise unchanged.
- Only **community posts** are extracted by the adapter (`ytd-backstage-post-renderer`).
- **Since 2026-09-17 (PLAN-2026-09-17 item 6): the grid tiles** (`ytd-rich-item-renderer`) on the
  surfaces the classifier calls `youtube-home` (Home, Subscriptions, Trending, Explore), one
  `kind:'video'` record per tile shown, in the /watch session's shape (`yt-vid-<v>`, title, channel,
  watch link, `surfaceKind: 'youtube-home'`). Both tile layouts are read: the older `#video-title`
  and `ytd-channel-name`, and the 2026 `yt-lockup-view-model` (title on the `h3`, text or `title`
  attribute while hydrating; channel in the first `yt-content-metadata-view-model` row; the wire's
  browse response fills a channel the DOM did not carry). Refused: Shorts tiles and shelves, a tile
  with no watch link (left unstamped for the next pass), and a channel's own video grid (sought,
  not served). Bound: `HOME_TILES_PER_PAGE` (400) records per page life, counted in diagnostics
  (`youtube.homeTileCapHit`) when hit; the interceptor no longer skips node accumulation on `/`
  (its pending cap, visibility drop, churn breaker and heap valve did not exist when the skip was
  written in June). Test: `tests/unit/content/platforms/youtube-home.test.ts`. Unverified live
  until the next store update.
- **`/watch` capture** (`yt-watch-comments.ts`), behind feature flag
  **`ytWatchComments`, DEFAULT ON since 2026-08-02** (`feature-flags.ts`, after the
  memory A/B returned clean; an explicit stored `false` is the kill switch, and when off the
  module is inert: no observer, no listeners, no DOM reads). When on: ONE scoped
  MutationObserver on `ytd-comments#comments` only, trailing debounce 500 ms
  (`YT_WATCH_SCAN_DEBOUNCE_MS`), disconnected + state cleared while `document.hidden`,
  re-armed on `visibilitychange`/`yt-navigate-finish`. Selectors per thread
  (`ytd-comment-thread-renderer`): `[id="content-text"]` body, `[id="author-text"]` author
  (attribute-equality form — YT duplicates these ids per thread), `a[href*="lc="]` comment id.
  Caps: 20 emits/scan (`YT_WATCH_MAX_COMMENTS_PER_SCAN`, window slides), seen-key Set ≤ 500
  (`YT_WATCH_MAX_SEEN_KEYS`, FIFO evict), emitted-video Set ≤ 100. Emits into
  `onPostDetected` → the comment-batch pipeline (caps/dedup/mode gates inherited);
  `isCommentRewriteEnabled` stays false for YouTube — records + marks only, no rewrite.
- **No engagement metrics** on any YouTube surface.
- Media Safety Signals (video frames, in-video audio, post images) were REMOVED from the
  build in 2.5.0. YouTube had been excluded from them since 2026-06-12 anyway; the exclusion
  and the shared `mayUsePaidMediaUnderstanding` predicate went with the features.

## id + grouping

- **Watch session = the existing video room, zero schema change** (brief §1): one
  `kind:'video'` record per video, `id = parentVideoId = yt-vid-<v>`, `text` = video title,
  `author` = channel name, `sourceUrl` = canonical `https://www.youtube.com/watch?v=<v>`;
  comments are `kind:'comment'`, `id = yt-c-<lc-id>` (fallback deterministic author+text
  hash — never a random UUID), nested under the same `parentVideoId`. Dashboard grouping
  (`group-records.ts`) and PlatformTabs need no change. The watch-session record is emitted
  **independently of the comments** (owner decision 2026-08-02), at most once per video id,
  as soon as the watch header's own title element is readable — deliberately diverging from
  TikTok's no-orphan-video rule, because on YouTube the watch session IS the exposure unit
  and the canonical link stays resolvable afterwards, so link + title + channel is worth
  keeping even when no comment ever rendered or comments are disabled on the video. Title is
  read from the header element and never from `document.title`: through a Polymer SPA
  transition the document still carries the previous video's title, and emission defers a
  tick rather than attribute one video's title to another. The pre-LLM pass carve-out in
  `index.ts` (`post.platform === 'tiktok' || 'youtube'` on `kind:'video'`) is what lets a
  short or non-substantive title reach the chain at all, including on free tier.
- Community post id from the `/post/<id>` link href; **else `crypto.randomUUID()`**
  (`youtube.ts`) with no dedup set → chain-id instability (theme A, LOW here since
  community posts are low-volume).

## Lazy-render / timing

- Per-element dedup via `fwProcessed` (`youtube.ts`).

## Verified extraction issues → `known-issues.md` (private)

- YouTube community-post random-UUID id (LOW — low volume).
- The big YouTube risk is the *engagement-hider* observer lifecycle, not extraction — see the
  OOM lessons and the `engagement-hider` subsystem doc. `/watch` capture is flag-ON since
  2026-08-02; the memory A/B that cleared the gate measured flag-on heap at or below flag-off
  over 5-minute real `/watch` arms. `youtube-engagement.ts`'s rAF body observer remains
  active on `/watch` (throttled to ≤1 per 750 ms) and is untouched by the capture path, so it
  stays the first suspect for any renewed heap climb.
