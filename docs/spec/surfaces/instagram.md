# Surface: Instagram

`src/content/platforms/instagram.ts` — `InstagramAdapter` (`extractPosts`).
Per-caption gating is on `fwCaptionEmitted` (not article-level `fwProcessed`).

## Captured + surface fallbacks

`extractPosts` (`instagram.ts`) collects articles, then dispatches by surface:

- **Home feed** — article caption + comments.
- **`_extractReelSurface`** (`instagram.ts`) — `/reels/`. Caption + author from the
  reel container, then delegates to `_extractCommentsForReel` for the overlay.
- **`_extractPermalinkSurface`** (`instagram.ts`) — `/p/<id>/`.
- **`_extractTileGridSurface`** (`instagram.ts`) — `/explore/` and profile grids; the page
  owner is the author on a profile grid (explore stays honestly `unknown`).
- **Comments:** `_walkCommentsContainer` (`instagram.ts`) delegates to dom-master
  `extractCommentRows`; the first `li` is dropped as the caption row.
- **Reels comment overlay:** `_extractCommentsForReel` tries two paths: (1) legacy `<ul>/<li>`
  shape via `_walkCommentsContainer`, (2) dialog-based div overlay via
  `_walkReelsDialogComments` — IG dropped `<ul>/<li>` for a pure `<div>` layout inside
  `[role="dialog"]` (observed 2026-06-28). Row anchor = `<time>` element; body = longest
  leaf `span[dir="auto"]` excluding handle/likes/reply chrome.

## Live DOM facts (attested 2026-08-11, MCP inspection of the owner's real feed)

- The CURRENT feed ad unit renders NO `<header>` and NO `<time>`; the badge is a bare
  `<span>Ad</span>` in the actor row (nested divs, no distinguishing attributes). The word
  "Sponsored" no longer appears on this unit. Detector: `IG_SPONSORED_LABEL_RE` plus the
  case-sensitive exact token `IG_AD_SHORT_LABEL = 'Ad'` (W74; lock in
  sponsored-detection.test.ts, incl. a lowercase-"ad" negative).
- AI-persona accounts carry an "AI creator" badge under the username in the actor row; the
  ai-content-blocker token list includes `ai creator` (W74; lock in ai-content-blocker.test.ts).
- Feed articles carry no `role="article"` attribute (bare `<article>`); the home feed is a
  windowed virtualizer: one flex column whose `padding-bottom` (~24k px observed) reserves
  space, articles in normal flow. Removing an article's box (display:none) desyncs IG's
  height bookkeeping and truncates the feed below — the W73 rule (ad hides via
  visibility:hidden, box preserved) exists for this; the ai-content-blocker already hides
  via visibility for the same reason. Re-measured 2026-09-03 (Q87): a box shrunk to 0 or to
  60px stops the feed as surely as a removed one. Since 2026-09-05 the word filter
  (`word-filter.ts`) and the surface switches (`surface-switches.ts`) obey the same rule
  inside `main` (`data-fw-hide-mode="visibility"`, box kept); a switch box outside `main`
  still closes its gap (known-issues M135).

## id + grouping

- `sourceUrl` fallback chain: `/c/` link href → parent post URL → `location.href`.
- Caption records take `sourceUrl` from `_extractPostUrl` (`instagram.ts`): the first
  `a[href]` in the article whose path contains `/p/` or `/reel/`. Relative hrefs are
  prefixed with `https://www.instagram.com`; an **absolute href is accepted only when its
  host is Instagram's** — `/p/` and `/reel/` are not Instagram-exclusive path shapes
  (`facebook.com/p/<Page>-<id>/`, `facebook.com/reel/<id>` match both), and a foreign
  anchor would otherwise become the record's permalink. A refusal bumps
  `postUrlForeignHostRejected` and the scan continues to the next anchor.
- Comments share the post id as `parentVideoId` (`instagram.ts`).

## Lazy-render / timing

- Scroll trigger re-inserts the article to force MO re-fire, saving/restoring `scrollTop`
  (`instagram.ts`).

## Verified extraction issues → `known-issues.md` (private)

- **M29 (resolved):** on the article / modal path `_walkReplyRows` walks each L1 comment's
  expanded reply `ul` (`:scope > ul`) and emits every rendered row as `depth:2, kind:'reply'`
  with `parent_id` = the L1 comment id (chain-mirror: nothing is force-expanded). Only
  `_extractPermalinkSurface` (the `/p/<id>/` path) is still depth-1-only.

## Wire path

There is no Instagram wire parser: the stub was deleted (M31 closed); the DOM adapter is the
only extraction path.
