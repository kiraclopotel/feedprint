# The structure map: how the extensions find things on a page that keeps changing

Written because the platforms keep changing their pages, and the extensions need a general way
to find things again: a short map of the structure. This is the map and the
method. It is short because the method is short. No em dashes.

## The idea in one paragraph

A platform can rename every class and move every box, and does, weekly. It cannot remove
the things a reader and the law need: the word "Sponsored" or "Ad" must be visible on a
paid post; a post has an author, a link to itself and a body; a comment is under a post;
the right column's ad has a heading and an outbound link; screen readers must still find
the feed. So the rules anchor on those invariants, in every form the platform can draw
them, and compute the box to act on from the anchor instead of naming the box. When a
box cannot be computed, the rule does nothing (a missed item, never a wrong hide) and a
counter says so, so the miss is seen within a session instead of at the next live test.

Three parts, all in the code today:

1. **Anchors**: what to look for. Words in every channel, roles, links.
2. **Boundaries**: how to get from the anchor to the thing to hide, by relationships
   (contains a link, has one heading, is a stack of sections), not by selectors.
3. **The canary**: the count of things judged versus things found, per platform, shown
   to the user, so a platform change is reported by the app itself.

Selectors remain as hints and fast paths. They are never the only path.

## Part 1: anchors

| Anchor | Why it survives a redesign | Where it is read |
|---|---|---|
| The ad label word (Sponsored, Ad, Promoted, Sponsorizat and 40 more in 12 languages) | Advertising disclosure is required by law and by the platforms' own policies; it must be visible | `ad-labels.ts` `labelTexts(el)`: leaf text, aria-label, title, alt, and the word behind an SVG `<use>` chain. Zero-width and separator characters stripped |
| Outbound link | An ad must lead somewhere; the platforms route clicks through their own redirector (`l.facebook.com`, `t.co`) or straight to the advertiser | `sidebar-ad-blocker.ts` `hasOutboundLink`: any `a[href]` whose host is not the page's host |
| ARIA roles and attributes: `role=article`, `role=complementary`, `role=navigation`, `role=log`, `aria-posinset`, `aria-label` | Accessibility is a legal requirement in the EU and the US; the platforms keep these even while they scramble classes | Every module's container and exclusion selectors, and the DM exclusion (`role=log` is Messenger) |
| The author link and the post's own link | A post that names nobody and links nowhere is not a post the platform can serve | The recorder's adapters (`platforms/*.ts`); the identity health counter in the dashboard |
| The text body | It is what the reader reads | `TEXT_SCOPE_SELECTORS` in `emoji-stripper.ts`, shared by the word filter |
| The fold control ("See more", "Vezi mai mult", "Ver mas", "Ver mais" and the other spellings in `FOLD_LABELS`) | A platform that shortens a long item must give the reader a way to the rest, and the way is a button with a word on it; X and YouTube also mark theirs structurally (`tweet-text-show-more-link`, `[id="more"]`) | `text-fold.ts` `findFoldControl`: label or aria-label, inside the text body first, then the item's own box; a trailing ellipsis in the DOM says the string was cut, its absence says the page holds the whole text |
| The platforms' own ad markers where they still exist (`/ads/about` links, `data-ad-preview`, `data-e2e` on TikTok) | Cheap when present; never relied on alone | `hasFacebookAdMarker`, `extractIsXSponsored`, `extractIsTikTokSponsored` |

What is deliberately not an anchor: class names, DOM depth, sibling counts as a rule
(they remain as a fast path on X where they were live-verified), pixel positions, and
anything read from computed style per element (80 ms on a first scan).

## Part 2: boundaries

The box to act on is computed from the anchor:

- **Feed ad (Off)**: the post container is the outermost feed unit around the label
  (`[aria-posinset]` on Facebook's home feed, `article` elsewhere), and the label must sit
  outside the body and outside every comment. `feed-ad-blocker.ts`.
- **Sidebar ad**: from the label, climb to the first ancestor that holds an outbound link
  (the ad the label labels), then climb while the parent is not a stack of sections (two
  or more children with content, or a second heading). `sidebar-ad-blocker.ts`
  `resolveAdModule`. Read the owner's DevTools capture of 2026-09-03 08:10 for the case
  that taught it: the heading and the ad units in sibling branches under one section.
- **Word filter**: the nearest post or comment boundary above the text scope
  (`CONTAINER_SELECTORS` in `word-filter.ts`), never anything page-sized.
- **Counts and action rows**: the structural finder scores a candidate on cheap signals
  (buttons with reaction names, numbers, the row's shape) and reads computed style only
  when they disagree. `structural-finder.ts`.
- **X post text**: a body candidate inside the Community Note box (`[data-testid="birdwatch-pivot"]`
  or a link into `/i/birdwatch/`) is the platform's own chrome, never the post; the collector
  drops it and counts it (`x.communityNoteChromeSkipped`). Learned from the owner's 2026-09-06
  export: seven records carried the note header as the post's text (twitter.ts
  `isInsideCommunityNote`, 2026-09-07).
- **X card context**: the household blocklist reads the card around the author's words
  (`src/content/record/card-context.ts`, 2026-09-07): the quoted post (`article[role="link"]`, its
  `tweetText` and its `User-Name` link), a link card (`[data-testid^="card."]`), and a media
  attribution line (an `a[href^="/"]` whose label starts "From" or "De la"), with the handles
  those name. Both products use it: Receipts' pipeline through `PostContent.card`, Off's
  word filter from the container. A platform not listed below reads nothing; nothing there
  is "not read", never "no card".
- **Instagram card context** (read live through the owner's Chrome, 2026-09-07 evening, eight
  home-feed articles): the author is the first handle link (`a[href="/handle/"]`, the avatar
  image inside it); the media is the first `video` or non-avatar `img`; every link between
  is the header. A collab post carries a second handle link in the header joined by an "and"
  leaf (seen once); the audio line is `a[href*="/audio/"]` whose text is "Original audio" or
  the sound's name; "Sponsorizat" and "Sugestii pentru tine" are bare leaves in the same
  header; the caption comes after the media, opens with the author's handle link and holds
  `@mention` handle links. `readInstagram` reads the second header author, the audio line,
  and a repost or paid-partnership leaf with the account it names; body mentions are never
  the card. A comment row has no media and no card. Reserved paths (`/explore/`, `/reels/`,
  `/p/`) are never handles.
- **TikTok card context** (read live 2026-09-07 evening, For You page, nine units of which
  two rendered): the unit is `[data-e2e="recommend-list-item-container"]`; inside,
  `section[data-e2e="feed-video"]` holds the author as `a[href^="/@"]` (avatar and name);
  the sound line is `a[data-e2e="video-music"]` linking into `/music/`. `readTiktok` reads
  the sound line as text (an "original sound - Name" names its owner in words) and any
  account it links, and a duet or stitch line at the head of the caption ("Duet with",
  "Stitch with", "Duet cu") with the other account. **Finding, the same read:** neither
  rendered For You unit carried a `video-desc` or `browse-video-desc` element, nor any text
  leaf over twenty characters; the caption is not in the unit on that page tonight, so the
  recorder's caption selector finds nothing there and the fallback path records the video
  with empty text (known-issues M138, Stage 5).
- **Facebook card context**: not read. On 2026-09-07 evening, through the owner's Chrome,
  the home feed and the chronological feed each rendered one unit and two skeleton cards
  that never filled over thirty seconds of scrolling; a public page rendered three units
  with no link card. What one unit showed: two `[data-ad-rendering-role="profile_name"]`
  in one header is a group post (the group and the author), not a share. The stall itself
  is worth one look with the recorder off, which is the owner's hand.

Guards, the same on every boundary: the worst case is a missed item, never a hidden post
that was not the target. A boundary that would take a second heading, the contact list,
the compose box, or a whole column is refused.

## Part 3: the canary

`hiddenByFeature` in settings carries, beside each switch's count, `ads-judged:<platform>`
and `ads-found:<platform>`. The Off popup's Block ads line says "Facebook: no ad found in
132 posts. The platform may have changed its label; tell us." once a platform reaches 80
judged with none found. The recorder's operational panel carries the selector-health and
extraction canaries for its own anchors (authors, links, bodies). These are what turn a
silent regression into a sentence on the screen the same day.

What "tell us" means today: the support address. What it should mean: a one-click report
that sends the anonymised structure of the offending post (tag names, roles, attribute
names, no text, no names) so the anchor list can be updated. Not built; see below.

## What "self-regenerating" can honestly mean

Off promises no network and no remote code, and the store listing says so. A rules file
fetched from our server would keep the promise on code but not on network, and the
promise is the product. So regeneration happens on the device, in three layers:

1. **Reading every channel** (built): a label moved from text to an SVG word or a title
   is still found. This is what closed the 2026-09-03 Facebook case without a rule change.
2. **Computing boundaries from relationships** (built for ads, partly for the rest): a
   section that moves its heading into a sibling branch is still found.
3. **Learning a page's own vocabulary on the device** (built 2026-09-03 with a human in the
   loop, as Off's "block this" picker, `engagement/picker.ts`: the user points, the shape
   around the box is remembered by roles and attribute names, never text, and applied
   under every guard; the automatic half, remembering the shape around an ad the anchors
   found, is still not built): when the
   anchors find an ad, remember the shape around it (the attribute names and roles on the
   path from the label to the boundary, never the text); when the anchors go blind, look for
   that remembered shape and treat a match as a candidate, still subject to every guard.
   This is a per-device memory, stored with the settings, never sent anywhere. It makes the
   extension carry forward what worked yesterday when today's label is drawn in a way the
   reader does not know yet.

And the human loop that no code replaces: a new build, quickly. The canary tells the user
the same day; the fix is a rule change and a store update. The store update is the slow
step (review), which argues for keeping Off small and its permissions minimal so reviews
stay short.

## Per platform, today

| Platform | Feed unit | Ad label channels seen live | Sidebar | Text scopes | Verified |
|---|---|---|---|---|---|
| Facebook | `[aria-posinset]` (home), `div[role=article]` elsewhere; the article inside a unit is an empty shell | Text "Ad · " with separator; letter-split spans with decoys; SVG `<use>` chain to a `<text>` outside the post; "Sponsored" plus U+200B in the right column | `[role=complementary]`: heading and ad units in sibling branches under one section | story body, `[aria-posinset] [dir=auto]`, the right column's spans | Feed ad live-verified by the owner 2026-09-03; sidebar and emoji fixes await his reload |
| X | `article[data-testid=tweet]` | bare "Ad" leaf, no `<time>` in the header | `[data-testid=sidebarColumn]`, stacked modules | `[data-testid=tweetText]` | Sidebar live-verified 2026-06-15 |
| Instagram | `main article` (windowed, 2 to 6 rendered; no `<header>` any more, the author is `a[href^="/"][role=link]`) | a bare span "Sponsorizat" in the actor row, outside `ul/li` (live 2026-09-03, the recorder hid it) | none: the "Suggested for you" column is a plain `span[dir]` eight divs under `main`, no landmark role; the stories tray has no `/stories/` links, it is buttons | `main article span[dir=auto]` (35 on one screen) | Read live 2026-09-03 through the recorder; the box must be kept (Q87, re-measured: 0px and 60px both stop the feed loading). Two hide paths ignored that until 2026-09-05: the word filter and the surface switches removed the box with `display:none`; both keep it now (visibility, inside `main`), known-issues M135, not live-verified |
| TikTok | `[data-e2e=recommend-list-item-container]` (9 on the For You page), `video-desc`, `like-count` and the rest of the `data-e2e` set still present | `data-e2e` ad markers (no ad on the page read 2026-09-03) | none mapped | video-desc, comment text | Read live 2026-09-03: every anchor present, no ad seen |
| YouTube | `ytd-rich-item-renderer` holding `yt-lockup-view-model` (31 on the home grid); title `yt-lockup-metadata-view-model h3 > a > span`; `#video-title` and `#metadata-line` gone from the home grid | ad renderers by element name (none on the page read 2026-09-03) | none mapped | `#content-text`, `yt-lockup-metadata-view-model h3` (added 2026-09-03; the old `#video-title` matched nothing on the home grid) | Read live 2026-09-03: title scope fixed; views ("70K views" in `yt-content-metadata-view-model`) are not read by any count rule on the home grid |

## The surface switches (2026-09-03)

`engagement/surface-switches.ts` applies the same three parts to whole surfaces. Anchors:
a link to the platform's own route (`/stories/`, `/reel/<id>`, `/reels/`, `/explore/people/`,
`/marketplace/`, `/groups/`, `/friends/suggestions`, `/shorts/`), a landmark
(`[role="region"]` for Facebook's Stories, `[role="complementary"]` for its right column,
`[data-testid="sidebarColumn"]` on X), the feed unit's own `[aria-posinset]`, a follow
button's `data-testid` ending in `-follow`, and Instagram's `[data-pagelet="story_tray"]` as a
fast path beside the tray-of-buttons relationship. Boundaries: `sectionOf` (up to the first
ancestor whose parent is a stack of two or more content-bearing children), `navEntryOf` (the
link's `li`, else its single-child wrappers), `stackUnder` (the top-most stack in a column),
and for Instagram's right column the sibling of the branch that holds the posts. Read live
2026-09-03: Instagram's "Suggested for you" block is the middle of a three-section stack
(account row, suggestions, footer) in the column beside the feed, and its header row holds
the label and the See all link as siblings, so the walk first climbs to the box that also
holds the suggested profiles; Facebook's Reels tray is the feed unit with six `/reel/`
links under a "Reels" heading; Marketplace, Groups and Reels are `li` entries in both
navigations. The canary for these is the popup's per-switch tally.

## How to use this map

When a live test shows something surviving: first ask which anchor was missed (a new
channel for the word, a new relationship for the box), add that channel or relationship
to the shared reader or walk, and lock it with a test built from the live DOM. Do not add
a class name. When the canary line appears for a platform, that is the same question
asked by the app. The per-platform row above is updated in the same commit as the fix.
