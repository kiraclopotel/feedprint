# Surface: TikTok

`src/content/platforms/tiktok.ts` + `src/content/platforms/tiktok-bundle.ts` —
`TiktokAdapter` (`extractPosts`). The most fragile surface (auto-advance /
OOM history — fixes need live-verify).

## Captured

- `extractPosts` (`tiktok.ts`) returns `[]` immediately for **tile surfaces**
  (explore / profile / search / hashtag). For feed / permalink it calls `_buildSplitPosts`.
- `_buildSplitPosts` (`tiktok.ts`) → `extractTikTokBundle` (with `skipRow=isCommentRowSeen`)
  → on a non-null snapshot emits **1 caption record (`kind=video`) + N comment records**
  (`kind=top-comment`, `depth=1` only).
- **Metrics:** `extractTikTokVideoMetrics` reads `[data-e2e=like-count/comment-count/share-count]`
  once, at caption emission, inside the seal guard.
- Empty-caption fallback: `extractCommentsFlat('tiktok', root)` (comment-extractors) → empty-text
  video record + comment records. Feed reads are scoped to the element
  `resolvePublicTikTokCommentSearchScope(container)` returns so a virtualized neighbour's
  comments cannot inherit this video's parent id; permalink reads remain document-scoped
  because the focused video's comment panel is a sibling. Both the bundle and the fallback take
  at most `DEFAULT_BUNDLE_COMMENT_CAP` (15) unseen comments per pass. The fallback record
  stamps `is_sponsored` from `extractIsTikTokSponsored(container)` (M99 closed in 4774518).

## id + grouping

- Comment ids are synthetic inside the bundle (`crypto.randomUUID`), wrapped as outer record
  id `tk-cmt-<videoId>-<c.id>` (`tiktok.ts`).
- **Video id order:** the in-card `/video/<digits>` href first, then the card's verified
  xgplayer wrapper id (the strict `^xgwrapper-\d+-(\d{19})$` reader), then on a permalink
  page the URL's `/video/<digits>`. Only a card with none of those gets
  `tk-music-<Date.now()>-<rand>` from `getSyntheticVideoId(container)`, cached in a WeakMap
  for the DOM container; inside the bundle a non-empty caption with no id at all gets
  `tk-vid-<uuid>` from `synthId()`.
- Caption / comment records use **bare digits** for real TikTok video ids.
  `video-pipeline.ts` `derivePlatformVideoId` matches this format; the old `tk-vid-<digits>`
  parentVideoId split is resolved.
- `emittedVideoIds` (module-level Set, `tiktok.ts`) dedups real-id caption emission within a
  visit. `resetTikTokVideoDedup()` clears it on SPA navigation from `video-pipeline.ts:onNavigate`,
  so back-nav can record a new visit.

## FYP card anatomy (logged-out desktop web; live-mapped, confirmed by the M69 gate)

- Card root: `[data-e2e="recommend-list-item-container"]` with `id=one-column-item-<n>` and
  `data-scroll-index=<n>`; empty virtualizer shells share the same data-e2e with zero children.
- **Stable identity carrier: the xgplayer wrapper — `div[id^="xgwrapper-"]`, id shape
  `xgwrapper-<playerIdx>-<19-digit videoId>`.** Present on 12/12 organic video cards at mount.
  PROVEN to be the real TikTok video id: `/oembed?url=.../@x/video/<xgId>` resolves the correct
  video title with a deliberately wrong author handle (id alone is authoritative).
- **Organic FYP cards carry NO permalink anchor**: zero `a[href*="/video/"]` /
  `a[href*="/photo/"]` in any observed card. The anchors that DO exist carry OTHER long
  numeric ids (music/sound links, e.g. `7900000000000000011` beside video
  `7900000000000000012`), so arbitrary href digits bind the wrong item and are never accepted.
- **The current code reads the wrapper through one strict shared helper:** only
  `^xgwrapper-\d+-(\d{19})$` is accepted, every matching wrapper must conform, and multiple
  wrappers must agree on one id. Caption extraction, the empty-caption fallback and
  bounded same-area recovery use it.
  Arbitrary numeric hrefs remain excluded because music/sound links carry different ids.
- **LIVE stream cards** interleave the feed and have NO xgwrapper and no video id
  (observed at scroll-index 3); any xgwrapper-based identity read must skip them (they must
  not enter the video PASS/act verdict stores).
- Scroll mechanics: programmatic `scrollBy`/ArrowDown on `#column-list-container` are
  swallowed (re-snap); a real wheel gesture over the feed advances exactly one card.
- Hidden-tab caveat: when `document.visibilityState` is `hidden`, TikTok never loads media
  data (`readyState 0`, `paused false`), so no evidence window can progress on a background tab.

## Sponsored FYP card anatomy (logged-in desktop web; live-mapped)

- One current ad used the same card root and strict identity contract as organic content:
  `[data-e2e="recommend-list-item-container"][data-scroll-index="6"]` plus
  `xgwrapper-0-7900000000000000013`.
- The authoritative sponsored marker was `[data-e2e="ad-tag"]` with visible text `Ad`.
  The outbound CTA was `[data-e2e="ttam-ads-cta"]` (`Contact us`), and the advertiser
  profile link had the ordinary profile shape, `/@` followed by the account's own slug. The sound link ended in a different numeric id, so
  arbitrary href digits remain unsafe for identity.
- First exposure matched `extractIsTikTokSponsored` and `injectAdHide`: the video was muted,
  the root received `data-fw-ad-hidden="true"`, `display:none !important` removed the whole
  slot, and TikTok advanced past it.
- Remount (M70) and late-marker (M94) lifecycle: TikTok can retain a hidden ad's root as an empty shell and rehydrate the ad-tag, caption and wrapper in any order, which once left an ad visible because the caption dedup stamps survived; the drive logs are in git history and known-issues M70 / M94. Current code records a successful TikTok ad hide in card-scoped runtime state under the strict
  wrapper id. A wrapperless, malformed, or mixed-wrapper sponsored snapshot now refuses to emit
  and retains that state; only one later same-root exact wrapper may claim replay. A different
  authoritative strict id consumes the old state and processes fresh. Another root, an organic
  card, or a never-hidden card remains ineligible. The four observed partial-hydration orderings
  pass locally; the rebuilt logged-in same-ad return remains the live gate.

## Lazy-render / timing

- **Metrics lazy-render:** the action rail hydrates a beat after the container mounts.
  **Seed #2 (blank metrics) was FIXED** in commit `62fd8e3` (2026-06-15):
  `extractTikTokVideoMetrics(container)` runs inside the seal guard at caption emission,
  live-verified with real counts. The metrics are read once and never re-read after
  `fwCaptionEmitted`, so a card whose rail hydrates after the seal records blanks: the
  theoretical partial-render race, rated low. This is the one status `surfaces/README.md`,
  `platform-adapters.md` and `known-issues.md` share.

## Verified extraction issues → `known-issues.md` (private)

Resolved in current code: H8 (engagement observer rAF-throttled), M2 format split, M5 SPA dedup
leak, M99 fallback sponsored flag. Xgplayer-backed FYP identity is live-verified for M69. M67
late-action recovery failed on the rebuilt logged-in TikTok drive and is unchanged since; M70's
hydration-order correction (one remount claim per hidden ad root, `tiktok-ad-remount.ts`) and its
sibling M94 (one late-marker claim per organic caption whose `ad-tag` hydrated late:
`rememberTikTokOrganicCaption` at emission, `claimTikTokLateAdMarker` at the caption gate, same
real id only, fired by the 3 s periodic rescan) are landed in code and await their rebuilt live
gates. See
`known-issues.md` (private).

## Wire path

There is no TikTok wire parser: the stub was deleted (M31 closed). The CDN subtitle track
is machine-translation garbage — rejected as a semantic source (presence signal only).
