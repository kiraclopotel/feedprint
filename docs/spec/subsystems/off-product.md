# Off (the filter product)

**Purpose.** The second extension built from this tree: the free switches with nothing else.
No pipeline, no AI, no record, no dashboard, no service worker, no network beyond the pages it
runs on. It exists so the calm-feed layer can be installed by a stranger in one click, be
reviewed by the store in days, and carry no child-data processing.

**Since.** 2026-09-02, the handoff assessment (`docs/history/2026-09/HANDOFF-ASSESSMENT-2026-09-02.md`,
section 7). The recorder product keeps everything and is unchanged by the split except where
this file says so.

## Key files

| File | Role |
|---|---|
| `src/product.ts` | `currentProduct()` / `isOffProduct()`, read from the Vite `define` `__FW_PRODUCT__`; tests override with `_setProductForTesting` |
| `src/products/off/content.ts` | Content entry: platform detection, private-surface refusal, `initEngagementControl` |
| `src/products/off/popup/OffPopup.tsx` | One-screen popup: mode presets, switches (each with its all-time tally from `settings.hiddenByFeature`), the word list with its own tally line, per-platform pause, optional PIN, interface language (`uiLanguage`: auto, EN, RO). `OffBody` is exported for the test; the module mounts only when the page has `#root` |
| `src/content/engagement/word-filter.ts` | The three text rules on the page: the user's list, slurs, swearing (Off only) |
| `src/content/engagement/feed-ad-blocker.ts` | Feed ads on every platform by the platform's own ad signal or label, hidden at the DOM tier (Off only; the recorder hides and records them in the pipeline) |
| `src/content/hide-primitives.ts` | `muteAndPauseMedia`, `noteAdSlot`, `removeAdSlotNote`: what the ad blockers do to a hidden item, kept out of `injector.ts` because its imports reach the AI client. Lock: `tests/unit/products/off-product.test.ts` walks every runtime import from `products/off/content.ts` and finds nothing under `src/ai` or `src/analysis` |
| `src/content/engagement/ad-labels.ts` | The platforms' paid-placement labels in many languages, matched as whole text only, zero-width characters stripped; `labelTexts(el)` reads every channel a word can be drawn in (leaf text, aria-label, title, alt, an SVG `<use>` chain resolved by `svgUseText`), `LABEL_BEARERS` is the selector for those elements; shared with the sidebar ad blocker and the recorder's Facebook detector. CSS generated content is deliberately not read (computed style per element cost 80 ms on the first scan) |
| `src/ui/popup/PickCard.tsx` `groupPicks` | Shared with Receipts' settings (same card, same storage, behind the PIN in both). The "Block this" list folded by platform (popup order), rows merged by name and sorted most-picked first, four rows per platform then "Show N more", Clear per platform (every pick there, whatever the search shows), × per row (removes every pick under that name); a search box narrows the rows across platforms and shows every match; `picker.ts` refuses an identical shape twice and labels a role="none" box '', which the list names by the day it was picked (offPickDated), so no row reads "unnamed". Lock: the card case in `tests/unit/storage/off-popup.test.tsx`, the dedupe case in `tests/unit/content/engagement/picker.test.ts` |
| `src/content/engagement/surface-switches.ts` | The surface switches (2026-09-03, owner idea 2): `hide-stories`, `hide-suggestions`, `hide-right-column`, `hide-marketplace`, `hide-groups`, and the trays under `block-reels`; every box found from an anchor the platform cannot drop and computed by relationship (`sectionOf`, `navEntryOf`, `stackUnder`), guarded (never the main column, two or more posts, or a place to type), hidden with `data-fw-surface="<platform>:<surface>"` and reason `<feature>:<surface>`, tallied under the switch; Marketplace and Groups pages by route. Shared code, so the recorder carries the rules too; only Off's popup exposes the switches. Lock: `tests/unit/content/engagement/surface-switches.test.ts` |
| `src/ui/popup/report-link.ts` | "Something still showing? Tell us": the quiet line on the popup's first screen, and on Receipts' Home (subject and version line name Receipts there; its switch list is `receiptsSwitchIds` from SettingsPanel.tsx). It also holds `OFF_SITES` and `SWITCH_REACH`, the sites each switch acts on, which OffPopup.tsx re-exports. It opens an email to support@feelingwise.org that the person writes and sends from their own mail program, prefilled with the site's name, the kind of page (home, watch, feed, reels, other), Off's version and the switch ids on there. The page's address is read through the tab query (Off's host permissions, no new permission) only to name the site and kind, and is never put in the mail. Off itself sends nothing. Lock: `tests/unit/products/off/the-report-link-says-only-the-site-and-the-page-kind.test.tsx` |
| `src/content/engagement/youtube-feeds.ts` | The two YouTube feed switches: `hide-home-feed` (the grid on youtube.com/, with its chips and Shorts shelf) and `hide-recommended-videos` (the list beside or under a video, the player's end screen, end cards, Up next countdown and full-screen grid). They hide a feed on purpose, so the guard is inverted: only the named components are hidden, by one stylesheet keyed on `data-fw-yt-home` / `data-fw-yt-recs` on `<html>`, with no observer and no walk. The home page gets a note with a button that shows the feed for one visit and changes no setting. Off in every preset until the listing names them; additive, so no schema bump (seeded on read). Lock: `tests/unit/content/engagement/youtube-feeds.test.ts` |
| `src/ui/popup/popup-design.css`, block `.fw-off` | Off's own look on the shared sheet (the owner asked for a softer surface that does not end abruptly): no frame border, a faint top light, 14px card corners, faded separators, grey off / teal on switches, shorter rule fields, air before a footer with no rule; scoped so the recorder popup is untouched |
| `src/ui/popup/controls.tsx` | `Toggle`, `FeatRow`, `PinDigits`, `PinOverlay`, `ChangePinPanel`, `RecoveryPhraseCard`, shared by both popups |
| `src/ui/popup/BlocklistEditor.tsx` | The word / phrase / account editor, shared by both popups. Since 2026-09-03 chips: one pill per rule with a remove button (`.chip`, `.chip-account`, `.chip-x` in `popup-design.css`), one input per group (Enter or comma keeps, Backspace on empty removes the last), every change written at once through `updateFeature`, no Save button. Lock: `tests/unit/ui/popup/blocklist-editor.test.tsx` |
| `manifest.off.json` | `storage` only; no proxy host; no background; same DM `exclude_matches` as the recorder |
| `vite.config.ts` | `BUILD_TARGET=off` (popup + manifest) and `off-content` into `dist-off/` |
| `scripts/check-off-bundle.mjs` | Gates: scripts present; no worker, no proxy host, storage only; no AI route or record store name in `content.js`; `content.js` under 300 KB |

Build: `npm run build:off`. Package: `npm run package:off` writes `release/off-<version>.zip` (ignored by git); the
reproducible build with its hash list is `node scripts/reproducible-build.mjs --product off`.
Store: `store/OFF-LISTING-2026-09-03.md` holds the listing text, form answers and submit
order; `scripts/store/off-screenshots.mjs` renders the five 1280x800 screenshots from the
built popup with a storage stub (no feed, no person).
Popup chrome (2026-09-03, second look): sticky header with a backdrop blur, centred tagline,
6px track-less scrollbar, 560px minimum height against Chrome's squashed first frame.

## One extension per page

Both products carry the same engagement code with the same style-tag ids and markers, so
two copies on one page undo each other's hides in turn: X's compose box flickered on the
owner's profile with both installed and was steady with either alone (2026-09-03). The
recorder stamps `data-fw-recorder` on the root element when it starts (`content/index.ts`);
Off (`products/off/stand-down.ts`, called from `products/off/content.ts`) does not start when
the stamp is there and stops its engagement control if the stamp appears later, logging
"[Off] standing down". The recorder wins because it carries everything Off does, the picker
and the word filter's Off-only paths excepted, and writes the record. Lock:
`tests/unit/products/off/off-stand-down.test.ts`.

## What the product constant switches

- `content/engagement/controller.ts`: `shouldControlEngagement` is always true in Off (the slur
  rule never idles); `startWordFilter` runs in Off only; the reset pass restores its hides.
- `content/engagement/feed-ad-blocker.ts`: `startFeedAdBlocker` is a no-op in the recorder and
  runs in Off under `block-ads`, so no feed ad is ever hidden without its record where records
  exist.
- `content/forensic-retry.ts`: `sendHighStakesForensicLog` returns `'accepted'` without sending.
  The Reels, ads and quiet-hours modules keep their on-page action and lose their record.
- `storage/settings.ts`: usage counters are written in the calling realm, since there is no
  service worker to route to.

Everything else the Off bundle contains is shared code that behaves identically in both
products. The bundle gate exists because a wrong import in a shared module would pull the
recorder into the filter silently.

## The word filter

Runs on the same per-platform text scopes as the emoji stripper (`TEXT_SCOPE_SELECTORS`). Per
scope, in order: the user's account rule, then word and phrase rules (`core/parent-blocklist`),
then slurs (`core/profanity-filter`, tier `slurs`, every mode). A hit hides the nearest post or
comment boundary (`CONTAINER_SELECTORS`, never anything page-sized) with inline `display:none`,
a `data-fw-word-filter="hidden"` marker and a `data-fw-block-reason="word-filter:<kind>"`,
and mutes media inside it. When the mode is Child or `strictLanguage` is on, swearing in the
remaining text nodes is replaced with asterisks (`filterProfanity`, tier `profanity`). Chat
logs (`role="log"`) and the private-chat subtrees are skipped.

Invariants: settings are read once per start; the controller restarts the module on any
settings change; starred text does not come back without a reload, hides do.

Tally (2026-09-03, owner item 2 of the second live test): every hide site tallies under the
switch that made it. `markHidden` derives the key from the reason's `<feature>` prefix or
takes `feature` (the word filter passes `slurs` for the slur rule, `word-filter` for the
list rules); `countHiddenFor(feature, n, hides)` serves the reels, AI-content, media-only ad
and pause blockers, the starred words (`no-swearing`, hides=false) and the emoji stripper
(`strip-emojis`, one per text node cleaned, hides=false). The batch flushes once a second
into `incrementMetricsHidden(n, byFeature)`, which merges into `hiddenByFeature` beside the
totals; `resetUsageStats` clears it. The popup reads it on open, one line per switch, EN
and RO. Since 2026-09-03 evening (owner idea 3, the per-rule count) the word filter also
tallies the user's rule that fired under `rule:<word|phrase|account>:<rule>`
(`ruleTallyKey` in `core/parent-blocklist`, `decideHideRule`), no hide of its own, and each chip in the rules editor
shows `×N` with the count in its title. Tests: `tests/unit/content/engagement/mark-hidden.test.ts`,
`tests/unit/storage/off-popup.test.tsx`, `tests/unit/content/engagement/word-filter-rule-count.test.ts`,
`tests/unit/ui/popup/blocklist-editor.test.tsx`.

## Should vs. actual

- **Ads.** In the recorder, feed ads are hidden by the pipeline's sponsored gate. Off has no
  pipeline, so until 2026-09-03 its switch hid only X's sidebar modules and textless promos and
  the owner's first live test showed a Facebook feed ad and the sponsored right-column panel
  surviving. Since 2026-09-03 `feed-ad-blocker.ts` judges every feed container on every
  platform (the adapter's own detector first, then a whole-text label from `ad-labels.ts`
  outside the body and the comments, YouTube's ad renderers by name), hides with
  `data-fw-feed-ad="true"` and reason `block-ads:feed-ad` (display:none, visibility:hidden on
  Instagram), and the sidebar blocker also scans Facebook's `[role="complementary"]` with the
  multilingual labels. The seed label list is replaced by the deep-research answer when it
  lands. Owner's live tab, 2026-09-03 (two retail ads of his survived in both products): the
  home feed's units are `[aria-posinset]`, the role=article inside is an empty shell, and the
  "Ad" label is an SVG `<use>` chain ending in a `<text>` outside the post; the rule now
  judges `[aria-posinset]` units and reads SVG words, and the sidebar blocker reads the
  "Sponsored" heading with its zero-width space. Checked on the live page before shipping
  (one ad flagged, eight organic units not); not yet seen by him after the reload. Tests:
  `tests/unit/storage/feed-ad-blocker.test.ts`, `tests/unit/content/platforms/facebook-sponsored-svg-word.test.ts`.
  Instagram keeps the hidden ad's box (Q87: shrinking it to 0 or to 60px stopped the feed
  loading, measured live 2026-08-11 and 2026-09-03) and since 2026-09-03 leaves one visible,
  absolutely positioned line in it (`hide-primitives.ts noteAdSlot`, string `adSlotNote`, every interface language),
  because the owner read the regular blank slots as a defect; `resetFeedAdDOM` removes it.
  Lock: `tests/unit/content/ad-slot-note.test.ts`.
- **"Block this" (2026-09-03, owner idea 1).** The popup card `offPick*` writes a timestamp to
  `chrome.storage.local` (`fwPickerArmedAt`, no new permission) and closes; the visible tab's
  `engagement/picker.ts` (`startPicker` and `arm`, Off only; since 2026-09-05 `arm` is a caller
  of the product-neutral `armPick`, which the recorder's "read this for me" also uses, see
  `read-this.md`) arms: crosshair, a teal outline on what a click would take,
  Esc to stop, one toast per outcome (`marker-strings` `pick*`, every interface language). A click inside a
  post (the word filter's `CONTAINER_SELECTORS`) hides the post and adds its author to the
  `parent-blocklist` accounts, which the word filter enforces from then on and the rules
  editor shows. A click on anything else is remembered in `settings.pickedBlocks` as a shape:
  the selectors from the box up to the first anchor (a role, aria-label, data-testid, data-e2e
  or data-pagelet value, or a custom-element tag; six levels at most), the box's child tags,
  and, when the box has no anchor but a heading of its own, that heading's text (platform UI
  copy, the one text a shape carries). Never a class name, never post text. `startPickedBlocks`
  hides every match (`data-fw-picked`, reason `picker:shape`, tally `picker`) on start, on
  inserted subtrees and every 2 s, follows `pickedBlocks` changes and frees the boxes of a
  removed pick. Guards on pick and on apply: never html, body, main, `[role=main]`, `[role=feed]`,
  a dialog, a form, a header or footer; never a box holding two or more posts; never a box
  under 24px. A nameless box is refused with a message. Known gap: Instagram's "Suggested for
  you" column carries no anchor and no heading element, so it is refused there; the surface
  switches (idea 2) are the answer for it. Live-verified by the owner on X the same day (an
  account, a nav item). "Pick several (Esc when done)" arms with `{ at, many: true }` and the
  picker stays armed after each pick. A hidden post on X takes its `cellInnerDiv` cell
  (`word-filter.ts hideTargetFor`, shared with the word filter), because hiding the article
  alone left the cell's height as an empty stripe on a blocked account's profile. Lock:
  `tests/unit/content/engagement/picker.test.ts`, the card case in `tests/unit/storage/off-popup.test.tsx`.
- **The surface switches (2026-09-03, owner idea 2 of the fourth look).** After the web look
  at the field (`docs/research/SURFACE-SWITCHES-FIELD-2026-09-03.md`: every competitor names
  boxes by class and survives by shipping after each redesign), five switches in Off's popup
  after Block reels, off in every preset (settings v13 backfills them): Hide Stories
  (Facebook's Stories region, Instagram's story tray), Hide suggestions (Instagram's
  "Suggested for you" block by its See all link to `/explore/people/`, Facebook's People you
  may know unit by its `/friends/suggestions` link, X's Who to follow module by two or more
  follow buttons and the timeline's user-cell rows), Hide the right column (Facebook's
  `complementary`, the Instagram column beside the feed, every X sidebar module but the
  search box), Hide Marketplace and Hide Groups (Facebook's nav entries by route, and the
  pages by URL; a group opened by its own link stays). Block reels also takes Facebook's Reels
  tray (a feed unit with three or more `/reel/` links), the Reels nav entries and YouTube's
  Shorts shelf and guide entry. Instagram and Facebook shapes were read live through the
  owner's tabs the same day; Facebook's People you may know did not render during the read,
  so its anchor is unverified. Not yet seen by the owner.
- **YouTube home grid.** The 2026 tiles are `yt-lockup-view-model` with the title at
  `yt-lockup-metadata-view-model h3 > a > span` and no `#video-title` (owner's live tab,
  2026-09-03), so the word filter and the emoji stripper read nothing on the home page until
  that scope was added to `TEXT_SCOPE_SELECTORS.youtube`. The old `#video-title` stays for the
  older grid and the watch page. Lock: the YouTube case in `tests/unit/storage/word-filter.test.ts`.
  The general measure (same day, his ask): the label walk reads every channel through
  `labelTexts`, and `scanFeedAds` tallies `ads-judged:<platform>` (each container once, stamped
  `data-fw-ad-judged`) and `ads-found:<platform>` into `hiddenByFeature`; the popup's Block ads
  line adds "<Platform>: no ad found in N posts" once a platform has 80 judged and none found,
  which is the signal that the label moved to a channel the reader cannot see.
- **Icons and name.** Off ships with the FeelingWise icons. Its store name was
  "Off - Social Feed Filter by FeelingWise" until 1.0.10 on 2026-09-20, when it became
  "Off - Hide Swearing, Likes, Reels, Shorts and Ads on Social Media": the old one was a brand and
  a category word, and the listing was measured that day as unfindable in store search for any
  phrase a stranger would type. The name lives in `_locales/*/messages.json` as `offName` and is
  checked by `tests/unit/i18n/store-locales.test.ts`. Off still has no mark of its own.
- **Recorder popup.** The `BlocklistEditor` was added to the recorder's settings panel in the
  same change, because the list had been matched and advertised with no surface to edit it.
- **Not live-verified.** Nothing in this file has been exercised on a real feed. Tests:
  `tests/unit/storage/word-filter.test.ts`, `tests/unit/products/off-product.test.ts`.
