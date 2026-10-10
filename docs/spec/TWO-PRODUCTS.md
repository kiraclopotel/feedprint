# Two products on one page: who does what

Read from the code at master `6384b322` on 8 Oct 2026. Every row names the line that decides it. When the code and this
page disagree, the code wins and this page is corrected in the same commit.

Off and Receipts are built from one tree (`src/product.ts:1-10`). Both carry the same page code, with the same marker
names and the same style tag ids, so two copies of one module on one page undo each other's hides. The split is decided
by a stamp on the page's root element:

- Receipts writes `data-fw-recorder-runs="ads words"` and then `data-fw-recorder="<version>"` once its reader is running
  (`src/content/index.ts:483-484`, the families in `src/content/engagement/recorder-runs.ts:16`).
- Off reads the stamp at start and keeps watching for it (`src/products/off/content.ts:38-41, 60-63, 73-89`;
  `src/products/off/stand-down.ts:19-28`). A stamp that names families: Off leaves exactly those to Receipts and runs
  everything else (`src/content/engagement/controller.ts:397, 410, 413`). A stamp with no families (Receipts 2.5.17 and
  older): Off stands down whole (`recorder-runs.ts:27`, `content.ts:38-41`).
- Receipts reads every Off-only switch as off, whatever its storage holds (`src/storage/switch-scope.ts:14-20, 54-60`;
  `controller.ts:489`), starts only its two ad modules (`controller.ts:398, 402, 406`), never starts the picker
  (`controller.ts:515`) and never runs the page-wide reset (`controller.ts:493`).

Each extension keeps its own settings in its own `chrome.storage.local`. Nothing is shared between them except the page.

## The table (master, the code going out in Receipts 2.5.18 and Off 1.0.13)

"Same element: yes" marks a row where both products can change the same element on the same page. Fights are numbered
F1 to F9 below the table.

| # | Function | Off alone | Receipts alone | Both installed | Same element | Decided at |
|---|---|---|---|---|---|---|
| 1 | Feed ads (Block ads) | Hides by the platform's own detector, by an ad label in many languages outside the post body, and by YouTube's ad renderers (`feed-ad-blocker.ts:12-21, 219-237`). On in Off's start set (`offStartPreset` at `presets.ts:139` takes `adultPreset`, `presets.ts:170`). | The reader flags `is_sponsored` and the pipeline collapses the post (`pipeline.ts:710-727`); the switch decides whether it leaves the page (`result-apply.ts:421`, `injector.ts:660-712`). Off's wider label rule does not run (`feed-ad-blocker.ts:220`, `controller.ts:406`). On in every preset (`presets.ts:54, 98, 170`). | Where Receipts' Block ads is on, Receipts acts and names the ads in its stamp (`recorder-runs.ts:49`); Off's three ad blockers stand down (`controller.ts:406-418`). Where it is off, Off's switch acts. **F4** on YouTube search. | yes, F5 | `recorder-runs.ts:16`, `controller.ts:397, 410` |
| 2 | Sidebar ads (X modules, banners) | `sidebar-ad-blocker.ts:160-161` | Same module (`controller.ts:398`) | As row 1 (`controller.ts:407`) | no | `controller.ts:406` |
| 3 | Picture-only ads (X, no text) | `media-only-ad-blocker.ts:181-182` | Same module (`controller.ts:402`) | As row 1 (`controller.ts:411`) | no | `controller.ts:406` |
| 4 | Your own list (words, phrases, accounts) | Hides the matching post or comment (`word-filter.ts:100, 124`); editor in the popup (`OffPopup.tsx:323`) | Hides in the pipeline, with a record line naming the rule (`pipeline.ts:510-530`); editor in Settings (`SettingsPanel.tsx:97`) | Both lists run, each from its own editor (`controller.ts:422`). A post matching both is hidden once, by whichever reaches it first (rule 4). | yes, F5 fixed | `recorder-runs.ts:49` |
| 5 | Slurs | Always hidden, no switch (`word-filter.ts:128`) | Always hidden, every mode, posts (`pipeline.ts:626-635`) and comments (`comment-batch-scorer.ts:821`) | Both act (`controller.ts:427`): Receipts' YouTube reader skips the search, sidebar and grid tiles Off covers (`youtube.ts:58`). A post both read is hidden once (rule 4). | yes, F5 fixed | `recorder-runs.ts:49` |
| 6 | Swearing starred | When Child or "No swearing" (`word-filter.ts:101, 262`). "No swearing" is ON in Off's start set (`settings.ts:189`). | When Child, "Mask swearing" or "Strict language" (`pipeline.ts:283`, comments `flush.ts:1210-1215`). Strict language is OFF by default (`settings.ts:112`), Mask swearing off in Teen and Adult. | Each product's switch acts (`controller.ts:426`): Receipts' mask runs before its length floor (`pipeline.ts:748-827`) but stars comments only when its paid reading of them succeeds (`flush.ts:724`), Off's covers them. | yes (post text) | `recorder-runs.ts:49` |
| 7 | Child: crude posts hidden | none | `pipeline.ts:735-742` | Receipts | no | |
| 8 | Counts (likes, views) | Platform modules (`controller.ts:434-449`) | never (`switch-scope.ts:16`, `controller.ts:406`) | Off | no | `switch-scope.ts:14-20` |
| 9 | Action buttons | Platform modules | never (`switch-scope.ts:16`) | Off | no | same |
| 10 | Comment posting blocked | Platform modules | never (`switch-scope.ts:18`) | Off | no | same |
| 11 | Emoji stripped, and comments left empty by it hidden | `emoji-stripper.ts:229-235`, `empty-comment-hide.ts:163-167` | never (`switch-scope.ts:18`) | Off. It rewrites the text of posts Receipts reads and signs. **F7.** | yes (post text) | `controller.ts:418-419` |
| 12 | AI-labelled posts and hashtags hidden | `ai-content-blocker.ts:1064-1068` | never (`switch-scope.ts:18`) | Off. It marks the post as already read (`ai-content-blocker.ts:724`), so Receipts' X and Facebook readers skip it (`twitter.ts:901`, `facebook.ts:439`). **F5, F6.** | yes | `controller.ts:420` |
| 13 | Reels and Shorts pages | `reels-blocker.ts:460-464`, trays in `surface-switches.ts` | never (`switch-scope.ts:15`) | Off. Marks the page container as already read (`reels-blocker.ts:314`). **F6.** | yes | `controller.ts:421, 429` |
| 14 | Stories, suggestions, right column, Marketplace, Groups | `surface-switches.ts:402` | never (`switch-scope.ts:15`) | Off | no | `controller.ts:429` |
| 15 | YouTube home feed, recommended videos | `youtube-feeds.ts:108-110` | never (`switch-scope.ts:19`) | Off | no | `controller.ts:431` |
| 16 | Break and quiet hours | Full-page cover with one line saying why (`media-timeout.ts`, `i18n/cover-strings.ts`; work test `controller.ts:141`) | never (`switch-scope.ts:17`) | Off. Receipts keeps reading the page under the cover. | no | `controller.ts:422` |
| 17 | Block this (your picks) | Picker and picks (`picker.ts:229, 403`; `controller.ts:426, 515`) | never: picks read as empty (`switch-scope.ts:31`), picker not started (`controller.ts:515`) | Off | no | `controller.ts:515` |
| 18 | Reframe markers (the dots) | none | `injector.ts:439-460`, switch in Settings (`SettingsPanel.tsx:34`) | Receipts | no | |
| 19 | AI reading, calmer rewrites, comments read per video | none | Pipeline, behind the key | Receipts | yes (post text, when Off also strips emoji: F7) | |
| 20 | Read this for me | none | `index.ts` `startReadThis` | Receipts | no | |
| 21 | The record, the export, the dashboard | none | Receipts only | Receipts | no | `product.ts:5-8` |
| 22 | Page cover while loading | none | `protection/document-start-shield.ts` | Receipts | no | |
| 23 | Private conversations | Off stops, and follows the page in and out (`content.ts:28-34`, `private-surface-watch.ts`) | Receipts stops (`index.ts:382-385`) | Both stop. Both manifests exclude the same paths. | no | `manifest.json`, `manifest.off.json` |
| 24 | Undo on a settings change | Off's full reset (`controller.ts:154-313, 493, 599-605`) | none (`controller.ts:493`) | Only Off resets, and only its own markers. The inline `display` both share is written back on every post Receipts hid (`controller.ts:325`, F5 fixed). | yes | `controller.ts:493` |
| 25 | Settings | Off's own storage, Off's popup | Receipts' own storage, Receipts' popup and Settings | Two stores. Rows 1, 4 and 6 are shown in both popups and only Receipts' copy acts. | | |

## The store today: Receipts 2.5.16 and Off 1.0.11

Read from Chrome's own update service on 8 Oct 2026: it serves Receipts 2.5.16 and Off 1.0.11. Neither carries the split: `src/storage/switch-scope.ts` is not in `ac0cabcb` (2.5.16) and
`recorder-runs.ts` is not in `1c6472d8` (Off 1.0.11). So today, with both installed, Off stands down whole the moment it
sees the stamp (`src/products/off/content.ts:37` at `1c6472d8`) and Receipts runs every switch from Receipts' own
settings. Every switch in Off's popup does nothing on any page while Receipts is installed.

| Pair a person can hold | What happens with both installed |
|---|---|
| Receipts 2.5.16 + Off 1.0.11 (today) | Receipts runs everything from its settings; Off does nothing |
| Receipts 2.5.16 + Off 1.0.13 | Same as today: the stamp names nothing, Off stands down whole (`recorder-runs.ts:27`) |
| Receipts 2.5.18 + Off 1.0.13 | The table above |
| Receipts 2.5.18 + Off 1.0.11 | **Nobody runs rows 8 to 17.** Off 1.0.11 stands down at the stamp; Receipts 2.5.18 no longer runs them. **F1.** |

## Fights found

| # | What | Where it shows | Owner of the fix |
|---|---|---|---|
| F1 | If Receipts 2.5.18 reaches a person before Off 1.0.13, counts, Reels, stories, quiet hours, Block this, emoji and the AI-label hide stop on every page until Off updates. | Every site | Head: upload Off 1.0.13 first, Receipts 2.5.18 after the store serves it (INBOX-head, 8 Oct). |
| F2 | Off's "No swearing" is on from install; beside Receipts it does nothing, and Receipts' Strict language starts off. Installing Receipts brings swearing back while Off's popup says it is hidden. | Every site | Fixed (rule 1 below) |
| F3 | Off's own list is never read beside Receipts. Words typed into Off's popup do nothing. | Every site | Fixed: Off always runs its own list (rule 1) |
| F4 | Off's switch for ads does nothing beside Receipts, and Off's wider ad rule (an ad label in many languages outside the post body, and YouTube's ad renderers, `feed-ad-blocker.ts:109`) does not run in Receipts. An ad Off hides alone stays with both installed. Measured on YouTube search (below). | YouTube measured; Facebook, X, Instagram to read signed in | Products (`controller.ts:406-410`), Page reading (`feed-ad-blocker.ts:220`), Record (one record per ad) |
| F5 | Off's reset clears inline `display` on every element it marked (`controller.ts:251-268`, `word-filter.ts:323-332`, which also strips the shared `data-fw-hide-mode` Receipts uses on Instagram). If Receipts hid the same element (ad hide `injector.ts:701`, hard hide `injector.ts:765`), Receipts' hide is undone. Off resets on every Off settings change, on walking into a conversation, and when the stamp arrives after Off started (`content.ts:80-88`). | Any post both hide (an AI-labelled ad, a listed word in an ad) | Fixed: every Off stop and reset runs inside `keepingRecorderHides` (`controller.ts:325`), which reads Receipts' hide on its posts first and writes it back after (test `off-reset-keeps-receipts-hides`) |
| F6 | Off's AI-label and Reels hides mark the element as already read; Receipts' readers then never read it, so the record holds no line for an item the platform served. Alone, Receipts reads them as ordinary posts. | X, Facebook (`twitter.ts:901`, `facebook.ts:439`) | Decision first: does the record hold what was served or what was seen? Head. |
| F7 | Off rewrites post text (emoji gone) that Receipts reads and signs. Which text lands in the record depends on which script reached the post first; a text that changes under the reader may also be read twice. | Every site with emoji on | Live test measures it, then Products |
| F8 | When Receipts updates or is switched off with a tab open, its stamp stays on the page and Off keeps leaving ads and words to a reader that no longer runs, until the page reloads. | Any open tab | Fixed: the stamp goes when Receipts notices it is gone, on Receipts' next call to the extension or by its own check every 3 seconds, and Receipts' ad filters stop with it; Off then takes the ads back (`keepRecorderStamp` and `stopWhenReceiptsGoes` in `recorder-runs.ts`). The two sides are tested separately: Receipts' in `receipts-names-only-what-it-runs`, Off's in `off-keeps-the-page-parts-beside-receipts` |
| F9 | In a tab the dashboard opens for inspection, Receipts changes nothing (`injector.ts:662`) but still stamps, so nobody hides ads or words there. | Inspection tabs only | Products, low |

## Read on the live page

8 Oct 2026, the two release packages (Receipts 2.5.18, Off 1.0.13) loaded unpacked in a fresh Chromium profile, each
alone and both together, on public pages with nobody signed in. Each page was read after four scrolls; the counts are
marker attributes on the page and ad label leaves still drawn on screen.

| Page | Off alone | Receipts alone | Both installed |
|---|---|---|---|
| YouTube search (two queries; 3, 5 and 6 reads) | ads hidden by Off: 4, 6, 12; ad labels on screen: 0 every time | ads hidden: 0 every time; labels on screen: 0 to 5 | ads hidden: 0 every time; labels on screen: 1 to 5 (F4) |
| YouTube home and a watch page | counts hidden, Shorts trays hidden, word filter running; ad labels on the watch page: 0 | stamp "ads words", nothing hidden; ad labels on the watch page: 2 | counts and Shorts trays hidden by Off; Off's word filter not running (F2, F3); ad labels on the watch page: 2 |
| TikTok explore | count chips hidden (24) | stamp only | count chips hidden by Off (25) |
| Facebook and Instagram public pages | counts hidden; no ad served signed out | stamp, reader running | Off's hides and Receipts' reader side by side; no element marked by both |
| X | the signed-out page refused to load | same | same |

No element carried a mark from both products on any page read. Facebook, Instagram and X feeds, where the 8 Oct ads
were seen, need a signed-in browser; that read is still to do.

## The rule this split keeps

Every switch that is on in either product is acted on, and no switch has to be turned off in one product for the
other to work. Where Receipts' reader does not cover a surface as fully as Off's filter, Off keeps the switch:

1. Done: Receipts names a family only where its own settings act on it and its reader covers every surface Off's
   does (`receiptsRunsOn` in `recorder-runs.ts`, written by `keepRecorderStamp` from `content/index.ts:483`). Today
   that is the ads where its Block ads is on. Swearing stays with Off, because Receipts stars comments only when its
   paid reading of them succeeds (`flush.ts:724`, `:851-852`). Slurs stay with Off, because Receipts'
   YouTube reader does not read the search, sidebar and grid tiles Off's word filter covers (`word-filter.ts:78-80`,
   `content/platforms/youtube.ts:58`). Off runs every family not named, from its own settings (`wordFilterSettings`
   in `controller.ts`, the `slurs` rule of `startWordFilter` in `word-filter.ts`, ready for the day Receipts covers
   them), and always runs its own list, which holds words only Off knows. Fixes F2, F3 and the first half of F4.
   The first Receipts 2.5.18 package wrote "ads words", and beside it Off leaves every word rule, as before; a
   build from this tree, 2.5.18 too, writes "ads" (test `receipts-names-only-what-it-runs`, and read on a live YouTube page on 9 Oct 2026).
   On YouTube search Receipts names the ads; it hides them once the Page reading seat's feed ad rule lands, which
   the controller now starts in Receipts too (`controller.ts:406-418`).
2. Done: Off's resets never clear a `display` or `visibility` on an element that carries a Receipts hide
   (`data-fw-ad-hidden`, `data-fw-hard-hidden`). Fixes F5.
3. Done: `keepRecorderStamp` writes the list again when Receipts' settings change, and Off starts again from the new
   list (`watchRecorderRuns`, `products/off/content.ts`).
4. Done: a post both would hide by their word rules is hidden once. Off's word filter leaves a post Receipts hid or folded, or
   hid and the person showed again (`hiddenByRecorder` in `word-filter.ts`); Receipts records a post Off already
   hid and does not hide or fold it a second time (`leftToOff` in `injector.ts`, for its hard hide, its ad hide and its
   fold). A second hide would keep the post hidden after a click on Receipts' Show. When Off lets the post go (the
   person took the word off Off's list), Receipts hides it then, so a post it recorded as hidden is not left standing.
5. Done: a swear word is starred once. Off's No swearing and Receipts' swear mask both run, with the same filter
   (`maskProfanity` in `core/profanity-filter.ts`), so whichever reaches the post first, the other finds nothing left
   and the person sees the same stars (test `beside-receipts-a-swear-is-starred-once`). Off stars before the page
   paints, so Receipts usually reads the starred text: its record then holds no mask line for that post (F7).

Tests: `off-reset-keeps-receipts-hides`, `receipts-names-only-what-it-runs`, `off-takes-back-what-receipts-does-not-run` (rows 1 to 17 with both installed), `beside-receipts-a-post-is-hidden-once`, `beside-receipts-a-slur-is-hidden-once`, `beside-receipts-a-swear-is-starred-once`, `receipts-filters-stop-when-receipts-goes`, and `off-keeps-the-page-parts-beside-receipts` for the restart.
