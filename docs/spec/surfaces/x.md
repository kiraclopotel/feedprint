# Surface: X (twitter.com / x.com)

`src/content/platforms/twitter.ts` — the strongest, most-mapped surface (the Encounter
architecture is fully wired here). Adapter `TwitterAdapter` (`extractPosts`).

## Captured

- **Post / tweet:** text, author handle (`_extractHandle`), atomic status identity
  (`_extractStatusIdentity` from one same-author `/status/<id>` link), `is_sponsored`
  (`extractIsXSponsored`, depth 0 only).
- **Metrics:** from the tweet's aria-label group first (`parseTweetGroupAriaLabel`,
  `twitter.ts`), per-button spans as fallback. Counts return `undefined`, never `0`.
- **Comments / thread:** on a `/status/` permalink, `walkPermalinkTree` (`twitter.ts`)
  assigns `depth` / `kind` / `parent_id`; `buildPermalinkEncounterContext` (`twitter.ts`,
  exported) re-walks the whole document at flush time to build rendered ancestry plus per-comment
  metrics. X permalink is the only path with rendered ancestry; TikTok, Instagram, YouTube, and
  Facebook still have their own rich Encounter assemblers without that ancestor chain.

## Surfaces / variants

- Home / For-You feed, profile, and `/status/` permalink. Since 2.5.1 (2026-09-05)
  `_detectFeedSource` tags `/status/` as `permalink` (a post or thread the reader opened is
  neither a profile nor a feed), a profile page as `profile`; records written before that
  keep `profile`. `detectTwitterSurface` returns `twitter-permalink`.
- Truncated tweets ("Show more") are filtered with an `fwTruncatedAt` backoff
  (`twitter.ts`) so a half-loaded tweet isn't sealed.

## id + grouping

- Post id = real `/status/<id>` only when that top-level permalink names the same
  author as the article header; relative links and absolute `x.com` / `twitter.com` links
  use the same parser. **Else `crypto.randomUUID()`**. A weak snapshot per virtualized
  feed slot couples that identity to both the body element and its text. When only the
  body side or only the identity side changes, the observation is treated as uncertain
  with author `unknown`, no parent binding, and no external URL. When both change, even
  to identical text, the new coherent identity is accepted.
- Permalink ancestry and children-of-focused grouping use the same atomic same-author
  resolver. A stale first link cannot seed `parent_id` or `parentVideoId`; a coherent
  focused identity gives its visible children `parentVideoId = focusedTweetId`.

## Lazy-render / timing

- Scroll re-trigger detaches + re-inserts un-stamped `article` elements to force the
  MutationObserver to re-fire (`twitter.ts`).

## Verified extraction issues → `known-issues.md` (private)

- **M1 (partial):** random-UUID id → dead "View original" link; duplicate *records* are
  blocked by text-dedup (the loud symptom was refuted). The adapter now omits `sourceUrl`
  for synthetic ids, so only legacy records retain that dead-link defect.
- **H8/M30 (closed):** the *engagement-hider* MutationObserver here goes through
  `createRafBodyObserver` with a 750 ms throttle.

## Wire path

`wire/x.ts:parseXPayload` walks the `tweet_results` tree and maps to `PostContent[]`. The
page-world fetch / XHR interceptor is installed at page load and the relay hands parseXPayload
each matched X payload; what it returns is kept in `page-world/wire-store.ts`, which fills fields on the
record the DOM adapter makes and never makes a record of its own.

## Dedup carve-out

Per-element dedup has one X-specific exception: a stamped `tweetText` whose article has no
`<time>` and now matches `extractIsXSponsored` (the ad label hydrated after the first
extraction) is re-extracted exactly once, marked `fwAdRecheckClaimed`, so a late ad label
still reaches the sponsored gate (lock: `tests/unit/content/platforms/sponsored-detection.test.ts` E1).
