# FeelingWise changelog

Plain-language record of what changed in each published version, newest first.
This is the single source for the landing "Updates" page and the Chrome Web
Store "What's new" blurb.

---

## Feedprint 2.5.19, not yet packaged (on master since 13 October 2026)

Kept as the work lands, so the Updates page and the store blurb are written from it when the package is frozen.
Three of the changes make a request the 2.5.18 store build never makes, and the Help, Home and Privacy pages are
updated for them before 2.5.19 ships.

Version 2.5.19 needs Chrome 137 or newer.

### New outside requests

1. **A signed repair file.** Every six hours, at the Calm and Open levels, with or without a key, Feedprint asks
   `api.feelingwise.org/v1/repairs` for a small file that can add or remove the page selectors and words its finders
   use, or switch a finder off. It carries no code, is signed (Ed25519) under keys in the package, and is refused when
   older than the copy already held.
2. **Describe this page.** When the person asks, it sends a map of the page's structure to `/v1/dom-report` that
   includes label words and address shapes from closed lists, with no free text, ids or classes. The person can open
   the map before sending.
3. **A second reader at the Open level.** Flagged items also go to Anthropic through `/v1/claude/verdict`. This
   happens only after its own consent screen.

### Fixes from the cold audit of 13 October 2026

1. **Stricter time stamp check.** Every certificate above the signing one must be a certificate authority, allowed to
   sign certificates, and valid at the stamp's time.
2. **Live Rephrase now asks first.** No post text leaves the computer until the person's go ahead is stored, whereas
   before only the relay enforced this.
3. **Export names the independent checker.** It lists feelingwise.org/check and the open checker repository and calls
   its built-in verdict a convenience.
4. **Diagnostics omit page address trace.** A page with no rule is counted under its site alone, not under a short
   hash of the address's first part, which is often an account name.

---

## Receipts 2.5.18 and Off 1.0.13, packaged 7 October 2026

Written on 7 October 2026 from the commits since the two packages of 6 October, Receipts 2.5.17
(built from `1c63de04`) and Off 1.0.12 (built from `433feb2f`). Neither was uploaded, so the store
still serves Receipts 2.5.16 and Off 1.0.11, and the What's new blurbs below cover everything since
those. The 2.5.17 and 1.0.12 Updates bands are not used; the bands below replace them. Receipts goes
to 2.5.18 and Off to 1.0.13.

### Receipts 2.5.18

1. **Settings hold what a clean record needs, on one card.** Block ads, Strict language, Mask
   swearing, Show reframe markers and your own rules. The page-part switches now live in Off; a
   Receipts user who had them on sees those parts again. Off runs them beside Receipts. So do Block
   this, the breaks and quiet hours, the hashtag and AI-label hide, comment posting and emoji. What
   you stored for them stays stored and is not used; old records that name them still print.
2. **It says what runs.** The built-in filter is named wherever it runs, and the AI reading only
   where a key you already hold turned it on. Without a key, Settings show no AI card at all. The
   swear mask has no BETA label, since it uses no model. The record's clock says UTC once.
3. **The popup looks right again.** The small buttons have their styles back.
4. **The comparison with a platform's own data export is gone from the dashboard.** Measured on a
   real export, it matched too little to be useful. A comparison you already saved still prints in
   your export.
5. **Your own rules say where they work:** any language written with spaces between words.
6. **Home counts what Receipts read today, on your device.** The record's search finds every word in any
   order, with or without accents.
7. **A new PIN is asked the next time Settings open, and takes force once you say you wrote down the
   recovery phrase.** The right PIN typed straight after a wrong one is no longer lost.

### Off 1.0.13

1. **The page switches run beside Receipts.** The page-part switches now live in Off; a Receipts user
   who had them on sees those parts again. Off runs them beside Receipts. With both installed, Off
   leaves the ads to Receipts where Receipts' Block ads is on and keeps running everything else: the
   page parts, the breaks and quiet hours, Block this, the hashtag and AI-label hide, comment posting,
   emoji, swearing, slurs and your word list. A post is starred or hidden once. Before, it stood
   aside whole. Beside Receipts 2.5.17 or older it still does.
2. **The popup looks right again.** The Block this list and the small buttons have their styles back.
3. **Plainer words.** Your own rules say they work in any language written with spaces between
   words, and Block this says "it stays hidden".

Also on the site, not in either package: an example export, one invented week of Receipts with real
time stamps from two public services, that any checker shows as VERIFIED.

### Store what's new blurb (Receipts 2.5.18)

Time stamps land again every six hours, and page one of the export says how many entries fall under
a checked stamp. Nothing is sold inside Receipts. Settings hold what a clean record needs on one card:
ads, swearing, the reframe markers and your own rules. The page-part switches now live in Off; a
Receipts user who had them on sees those parts again. Off runs them beside Receipts. Home counts what
Receipts read today, on your device. The record's search finds every word in any order, with or without
accents. A new PIN is asked the next time Settings open and takes force once you say you wrote down the
recovery phrase. After updating, reload your feed tabs.

### Store what's new blurb (Off 1.0.13)

On YouTube, two new switches hide the home feed and the recommended videos, and the counts switch
now hides view counts on video tiles. A "Tell us" line opens an email you write yourself when
something still shows. Picked boxes have names and a search, and the PIN is masked and safer to set.
The popup's Block this list and small buttons look right again. With Receipts installed too, Off now
keeps its page switches running beside it. After updating, reload your feed tabs.

### The Updates page bands, added when the store publishes

Into `landing/updates.html` and `landing/updates-ro.html` with each upload's row in
`docs/spec/RELEASES.tsv`: the Receipts band above `id="v2-5-16"`, the Off band above `id="v1-0-11"`,
the date set to the publish day.

English:

```html
    <div class="release" id="v2-5-18">
      <p class="section-label">Receipts 2.5.18 &middot; DATE &middot; not Off</p>
      <p class="section-intro">Time stamps land again every six hours, and page one of the export says how many entries fall under a checked stamp. Nothing is sold inside Receipts. Settings hold what a clean record needs on one card: ads, swearing, the reframe markers and your own rules. The page-part switches now live in Off; a Receipts user who had them on sees those parts again. Off runs them beside Receipts. So do Block this, the breaks and quiet hours. Without a key no AI card shows. The dashboard no longer offers the comparison with a platform's data export; a saved one still prints. Home counts what Receipts read today, on your device. The record's search finds every word in any order, with or without accents. A new PIN is asked the next time Settings open and takes force once you say you wrote down the recovery phrase.</p>
    </div>
```

```html
    <div class="release" id="v1-0-13">
      <p class="section-label">Off 1.0.13 &middot; DATE</p>
      <p class="section-intro">On YouTube, two new switches, off until you turn them on, hide the home feed and the recommended videos beside a video, and the counts switch now hides view counts on video tiles. A "Tell us" line opens an email you write and send yourself when something still shows. Picked boxes have names and a search, the PIN is masked and takes force only when you say you wrote it down, and the popup's small buttons look right again. The page-part switches now live in Off; a Receipts user who had them on sees those parts again. Off runs them beside Receipts: with both installed it leaves ads and the language to Receipts and keeps the rest running.</p>
    </div>
```

Romanian:

```html
    <div class="release" id="v2-5-18">
      <p class="section-label">Receipts 2.5.18 &middot; DATA &middot; doar Receipts</p>
      <p class="section-intro">Mărcile de timp ajung din nou la fiecare șase ore, iar prima pagină a exportului spune câte intrări sunt sub o marcă verificată. În Receipts nu se mai vinde nimic. Setările țin pe un singur card ce îi trebuie unui registru curat: reclame, înjurături, semnele de reformulare și regulile tale. Comutatoarele pentru părți ale paginii stau acum în Off; cine le avea pornite în Receipts vede din nou acele părți. Off le aplică lângă Receipts. La fel Blochează asta, pauzele și orele de liniște. Fără cheie nu apare niciun card AI. Panoul nu mai oferă comparația cu exportul de date al unei platforme; una salvată se tipărește în continuare. Acasă numără ce a citit Receipts azi, pe dispozitivul tău. Căutarea din registru găsește fiecare cuvânt în orice ordine, cu sau fără diacritice. Un PIN nou se cere data viitoare când deschizi setările și intră în vigoare când spui că ai notat fraza de recuperare.</p>
    </div>
```

```html
    <div class="release" id="v1-0-13">
      <p class="section-label">Off 1.0.13 &middot; DATA</p>
      <p class="section-intro">Pe YouTube, două comutatoare noi, oprite până le pornești tu, ascund pagina principală și videoclipurile recomandate de lângă un videoclip, iar comutatorul pentru numere ascunde acum și numărul de vizualizări de pe miniaturi. Un rând „Spune-ne” deschide un e-mail pe care îl scrii și îl trimiți tu, când ceva încă se vede. Casetele alese au nume și căutare, PIN-ul e ascuns și intră în vigoare doar după ce spui că l-ai notat, iar butoanele mici din fereastră arată din nou cum trebuie. Comutatoarele pentru părți ale paginii stau acum în Off; cine le avea pornite în Receipts vede din nou acele părți. Off le aplică lângă Receipts: cu amândouă instalate, lasă reclamele și limbajul în seama lui Receipts și le ține pe celelalte pornite.</p>
    </div>
```

---

## Receipts 2.5.17, packaged 6 October 2026

Written on 6 October 2026 from the changes made since the package the store serves: Receipts 2.5.16,
built from `ac0cabcb` and uploaded 3 October. Receipts goes from 2.5.16 to 2.5.17. Off is not in
this package.

### Receipts 2.5.17

1. **Time stamps land again, every six hours.** A heartbeat entry written during each stamp round
   made the round give up, so stamps had stopped; and a round that came a few seconds short of six
   hours waited for the next one, so light readers were stamped every twelve. Both are fixed.
2. **Page one counts the stamped entries.** The export's first page, and both checkers, say for each
   run how many entries fall under a time stamp, and the time of the newest. Only a stamp whose
   token checked out under a known service counts.
3. **Nothing is sold inside Receipts.** No price, no plans link and no "upgrade" in the popup or the
   dashboard, in any language, and the dashboard no longer shows "FREE" when no key is held. A key
   you already hold still turns on the AI reading.
4. **Settings open on the essentials.** The page parts fold away, and your own rules and picks have
   names and a search.
5. **Block this.** Missed something on the page? Press Block this in Settings, click it, and it stays
   hidden, as in Off. A post inside a picked box is still recorded.
6. **Tell us.** Home has a link to tell us what Receipts missed.

### Store what's new blurb (Receipts 2.5.17)

Time stamps land again every six hours, and page one of the export says how many entries fall under
a checked stamp. Nothing is sold inside Receipts any more: no price, no plans, no upgrade. Settings
open on the essentials, your rules and picks can be searched, and Block this hides anything you
click on the page. After updating, reload your feed tabs.

### The Updates page band, added when the store publishes

Into `landing/updates.html` and `landing/updates-ro.html` with the upload row in
`docs/spec/RELEASES.tsv`, above `id="v2-5-16"`, the date set to the publish day.

English:

```html
    <div class="release" id="v2-5-17">
      <p class="section-label">Receipts 2.5.17 &middot; DATE &middot; not Off</p>
      <p class="section-intro">Time stamps land again every six hours, and page one of the export says how many entries fall under a checked stamp. Nothing is sold inside Receipts: no price, no plans, no upgrade. Settings open on the essentials, your rules and picks can be searched, and Block this hides anything you click on the page.</p>
    </div>
```

Romanian:

```html
    <div class="release" id="v2-5-17">
      <p class="section-label">Receipts 2.5.17 &middot; DATA &middot; doar Receipts</p>
      <p class="section-intro">Mărcile de timp ajung din nou la fiecare șase ore, iar prima pagină a exportului spune câte intrări sunt sub o marcă verificată. În Receipts nu se mai vinde nimic: niciun preț, niciun plan, nicio ofertă. Setările se deschid pe ce contează, regulile și selecțiile tale se pot căuta, iar Blochează asta ascunde orice dai clic pe pagină.</p>
    </div>
```

---

## Off 1.0.12, packaged 6 October 2026

Written on 6 October 2026 from the commits since `1c6472d8`, the commit Off 1.0.11 was built from
(build id `fwbid-1c6472d88c8c-r1011`), kept to what Off's popup and its page script carry. Off goes
from 1.0.11 to 1.0.12. Receipts is not in this package.

### Off 1.0.12

1. **YouTube.** Two new switches, both off until you turn them on: one hides the home feed (a short
   note stands in its place, with "Show it this time"), the other hides the recommended videos beside
   a video and the suggestions on its end screen. The counts switch now hides the view counts on video
   tiles too: on the home page, beside a video, in search, on a channel's Videos tab and on playlists.
   Titles, channels and dates stay.
2. **"Something still showing? Tell us."** A line on the first screen opens an email to support that
   you write and send yourself. It names the site, the kind of page, Off's version and the switches
   you have on, never the page's address. Off sends nothing by itself.
3. **"Block this" is easier to manage.** Every picked box has a name (a box with no name of its own
   is named by the day you picked it), and a search box finds a pick on any site.
4. **The PIN.** The boxes are masked, with Hold to show. A first PIN takes force only when you press
   "I wrote it down", and a newly set PIN is asked for at the next open. Digits typed right after a
   wrong PIN are kept. If Off cannot read its settings, it says so with Retry instead of "Incorrect
   PIN", and it no longer asks for a PIN nobody set.
5. **Plainer words.** Off says exactly what it hides (posts and comments with slurs, not every
   insult) in all four languages, the first line names the sites on a break first, and a site on a
   break stays closed at any hour.
6. **Steadier.** A filter that fails to start is skipped on its own and every other filter keeps
   working, and a settings change that fails part way starts the filters again.
7. **Easier to see.** The switches can be read in both themes, and on is teal.

### Store what's new blurb (Off 1.0.12)

On YouTube, two new switches hide the home feed and the recommended videos, and the counts switch
now hides view counts on video tiles. A "Tell us" line opens an email you write yourself when
something still shows. Picked boxes have names and a search, and the PIN is masked and safer to set.
After updating, reload your feed tabs.

### The updates page

The band check allows no band newer than an upload in `docs/spec/RELEASES.tsv`, so this goes into
`landing/updates.html` and `landing/updates-ro.html` with the upload row, above `id="v1-0-11"`, the
date set to the publish day.

English:

```html
    <div class="release" id="v1-0-12">
      <p class="section-label">Off 1.0.12 &middot; DATE</p>
      <p class="section-intro">On YouTube, two new switches, off until you turn them on, hide the home feed and the recommended videos beside a video, and the counts switch now hides view counts on video tiles. A "Tell us" line opens an email you write and send yourself when something still shows. Picked boxes have names and a search, and the PIN is masked and takes force only when you say you wrote it down.</p>
    </div>
```

Romanian:

```html
    <div class="release" id="v1-0-12">
      <p class="section-label">Off 1.0.12 &middot; DATA</p>
      <p class="section-intro">Pe YouTube, două comutatoare noi, oprite până le pornești tu, ascund pagina principală și videoclipurile recomandate de lângă un videoclip, iar comutatorul pentru numere ascunde acum și numărul de vizualizări de pe miniaturi. Un rând „Spune-ne” deschide un e-mail pe care îl scrii și îl trimiți tu, când ceva încă se vede. Casetele alese au nume și căutare, iar PIN-ul e ascuns și intră în vigoare doar după ce spui că l-ai notat.</p>
    </div>
```

---

## Receipts 2.5.16 and Off 1.0.11, packaged 29 September 2026

Written on 29 September 2026 from the changes made since the packages the store serves: Receipts
2.5.15, built from `39bb88d5` and published 27 September, and Off 1.0.10, published 26 September
(its listing read 29 September). Receipts goes from 2.5.15 to 2.5.16 and Off from 1.0.10 to 1.0.11.

### Receipts 2.5.16

1. **Three levels: Strict, Moderate and Relaxed.** Setup asks how much Receipts should filter, and
   the popup, the notes on the page, the dashboard and the export use the level names. A level you
   already chose stays as it was.
2. **Strict sends nothing out.** At Strict there is no AI reading, no license check and no time
   stamp from outside. With a paid key at Strict, the popup says readings are off and that Moderate
   turns them back on. A new install sends nothing until you choose a level. If you were already at Strict, AI readings and outside time stamps stop with this update.
3. **The first ten minutes.** The welcome says Receipts misses things and makes mistakes. Relaxed
   setup says where to find Receipts and pin it. An empty record shows no backup warning, the card
   for the AI reading says it is optional, the free license label is grey, and the license sentence
   says every place the key goes.
4. **The export and dashboard captions say what the record shows:** the order and the counts, not
   why something happened.
5. **The CSV has an action column,** saying what was done to each item (hidden, flagged, rewritten,
   masked, skipped), the same words the dashboard uses.
6. **The reset dialog is exact.** It says the earlier entries stay in the export of the whole record and
   in backups you save yourself, not in every export.
7. **The record is cleaner.** A post is written once even when the site changes its id, account
   names are read right on each site, a card no longer repeats its reading, two posts that open with
   the same words keep their own text, and a change that came too late to apply says so.

### Store what's new blurb (Receipts 2.5.16)

The levels are now called Strict, Moderate and Relaxed. At Strict nothing leaves your computer: no
AI reading, no license check, no outside time stamp, and a new install sends nothing until you
choose a level. If you were already at Strict, AI readings and outside time stamps stop with this update. The first screens are plainer, the export and dashboard captions say what the record
shows rather than why, the CSV says what was done to each item, and the reset dialog says which
exports keep the earlier entries. After updating, reload your feed tabs.

### Off 1.0.11

1. **A new install starts with what the store listing promises:** swearing starred, and slurs, like
   counts, Reels, Shorts and ads hidden. Settings you already chose do not change.
2. **A new first screen.** A short line in plain words says what Off is doing on each site, with a link to the setup
   guide; the switches, your own rules and the PIN are folded below it. Off no longer asks who uses
   the browser.
3. **The PIN reset text fits Off.** The PIN and recovery phrase sentences no longer mention a record,
   which Off does not keep.

### Store what's new blurb (Off 1.0.11)

A new install starts with swearing starred and slurs, like counts, Reels, Shorts and ads hidden. The
first screen says in plain words what Off is doing on each site, and the PIN reset text no longer
mentions a record. After updating, reload your feed tabs.

### The Updates page bands, added when the store publishes

The band check (`tests/private/site/updates-anchor-format.test.ts`) allows no band newer than an
upload in `docs/spec/RELEASES.tsv`, so these go into `landing/updates.html` and
`landing/updates-ro.html` with the upload rows, above `id="v2-5-15"`, dates set to the publish days.

English:

```html
    <div class="release" id="v2-5-16">
      <p class="section-label">Receipts 2.5.16 &middot; DATE &middot; not Off</p>
      <p class="section-intro">The levels are now called Strict, Moderate and Relaxed, and at Strict nothing leaves your computer: no AI reading, no license check, no outside time stamp. A new install sends nothing until you choose a level. If you were already at Strict, AI readings and outside time stamps stop with this update. The export and dashboard say what the record shows, the CSV says what was done to each item, and the reset dialog says which exports keep the earlier entries.</p>
    </div>

    <div class="release" id="v1-0-11">
      <p class="section-label">Off 1.0.11 &middot; DATE</p>
      <p class="section-intro">A new install starts with swearing starred and slurs, like counts, Reels, Shorts and ads hidden, as the store listing says. The first screen says in plain words what Off is doing on each site, and the PIN reset text no longer mentions a record.</p>
    </div>
```

Romanian:

```html
    <div class="release" id="v2-5-16">
      <p class="section-label">Receipts 2.5.16 &middot; DATA &middot; doar Receipts</p>
      <p class="section-intro">Nivelurile se numesc acum Strict, Moderat și Relaxat, iar la Strict nimic nu pleacă de pe calculatorul tău: nicio analiză AI, nicio verificare a licenței, nicio marcă de timp din afară. O instalare nouă nu trimite nimic până nu alegi un nivel. Dacă erai deja la Strict, analiza AI și marca de timp din afară se opresc odată cu această actualizare. Exportul și tabloul de bord spun ce arată registrul, fișierul CSV spune ce s-a făcut cu fiecare element, iar fereastra de resetare spune ce exporturi păstrează intrările anterioare.</p>
    </div>

    <div class="release" id="v1-0-11">
      <p class="section-label">Off 1.0.11 &middot; DATA</p>
      <p class="section-intro">O instalare nouă pornește cu înjurăturile marcate cu steluțe și cu cuvintele jignitoare, numărul de aprecieri, Reels, Shorts și reclamele ascunse, cum spune pagina din magazin. Primul ecran spune pe înțeles ce face Off pe fiecare site, iar textul de resetare a PIN-ului nu mai pomenește de un registru.</p>
    </div>
```

---

## Receipts 2.5.15 and Off 1.0.10, packaged 24 September 2026

Written on 23 September 2026 from the numbered list of changes kept since the last packages, and
read again against that list on 24 September, when the changes made that night were added.
Receipts goes from 2.5.14 to 2.5.15. Off's package keeps the number 1.0.10, which the store has never
had, and is rebuilt to carry the Off changes below: the 1.0.10 built on 22 September, in the next
section, was never uploaded, and the store still served Off 1.0.9 when both listings were read on
23 September.

### Receipts 2.5.15

1. **The Adult reading is checked by a second model before a post is changed.**
   Until now one model decided. Measured on 1,000 posts it had never seen, that model was right
   about eight times in ten when it acted, which means roughly one post in five was rewritten
   when it should have been left alone. Now two different models read the post and it is only
   rewritten if both say the same thing. On those same 1,000 posts, every single post the two
   agreed on was genuinely charged.

   The cost is that it now acts on fewer posts: about five of the charged ones in ten rather
   than six. What it stops catching is the mildest material, the kind sitting right on the line.
   Of the most severe posts in that measurement it still caught 73 of 83, and nothing rated at
   the very top was missed at all. A post it does not act on is not a post it cleared: it is in
   the record like everything else and the dashboard shows what was marked and what was not.

   Both readings are named in the record, so an export says which models read each post.

2. **Inference moved from Groq to Deep Infra on 21 September 2026.** Same open-weight models,
   a different company running them. The privacy policy and terms name the new one, in both
   languages, and say what its terms commit to: a written zero-retention clause and a ban on
   training with customer data. Nothing about what leaves your computer changed. A record keeps
   the company name it was signed with, so records 2.5.14 wrote after 21 September still say Groq.

3. **A record names who really read it.** It names the model that judged the post rather than
   whichever AI call ran last, both judges when both read it, and no company when no reply came.
   Text a model wrote into the page now carries a mark that software can read, naming the model,
   which the law asks for by 2 December 2026.

4. **Fewer ways for the record to get stuck.** After a reset in the middle of a month, the record
   is still filed away at the month's end and Verify no longer calls it broken. One damaged entry
   no longer stops the record from being trimmed, filed, reset or restored, and no longer hides the
   rest of its month. A reset that could not clear everything says which part it left, and no
   longer hangs. A failed write gives up instead of blocking whatever opens the record next. An
   outage is written as one gap, where waking on the browser's timer wrote it twice. Verify also
   reports entries cut from the end of a record just before a reset, as the offline checker already
   did.

5. **The dashboard agrees with itself.** After a restore or a reset, the header count and the
   all-time figures match what a page reload shows. A reset's warning, a restore's details and a
   withhold's confirmation stay on screen. The Issues tab's record card fills in, and the tab says
   "the AI provider" where it named Groq. A gap between platforms reads 2h, not 1h 60m.

6. **The parent's settings hold.** Settings can add a first parent PIN to an install that was set
   up without one, with a recovery phrase shown once. A popup that cannot read its settings stays
   locked instead of opening setup. With rewrites turned off, a rewrite saved earlier in the tab is
   not shown either: the post is marked, folded in Child, or hidden when the reading says so.

7. **What the page shows.** A comment the page lists again in another order keeps its own verdict.
   A rewrite that turns a lethal threat into a calm opinion is not shown, and one that calls a woman
   "idioată" is refused, as one that says "idiot" already was. A post with contractions such as
   "don't" is no longer read as quoted speech. Romanian, Spanish and Portuguese are told apart
   better. When the extension is reloaded under an open tab, a Child cover stops saying it is
   checking. After a video is hidden, the feed also skips the videos the hashtag and Reels switches
   hid. A tab close to its memory limit stops adding work of its own.

8. **Less leaves your computer.** Without a licence, the record's fingerprint no longer goes to
   FeelingWise's server when the time-stamp services fail. The extension no longer asks the Czech
   research network's time-stamp service, which is meant for research and education, and it asks
   for one site address fewer.

9. **The hashtag switch says what it does.** It was called "Block AI-generated content", but most
   of its list is tags for posts made to upset you, to make you angry or about starving yourself,
   and it catches an AI post only by a listed tag or by a label saying it was made with AI. It is
   now called "Hide posts by hashtag or AI label", in all four languages. Its description says it
   also hides a post when its text, or a label the site puts on it, says it was made with AI, and
   the Child mode line says the same.

10. **"Don't kill yourself" is not read as an attack.** A post telling someone not to kill
    themselves, with a word such as "don't", "never" or "you shouldn't" right before the words, as
    in "Don't kill yourself, seek help", no longer counts as self-harm in the extension's own
    pattern check, in English and Portuguese. "Why don't you just kill yourself" still counts.

11. **A restore says where the old entries go.** The dashboard said a restore replaces the entries
    in the record. They are not deleted: they move into the record's monthly archive and stay in
    every export of the whole record. The question before a restore, the backup card and the
    message after it now say so, and say that if some of them were not in the backup, those
    exports will read "PARTIALLY VERIFIED" once anything new is recorded. A restore into an empty
    record, or from a backup with no entries, says only how many entries came back, where it spoke
    of "the 0 entries that were there before".

12. **The checks say what they found.** Verify no longer reads verified when entries were cut from
    a chain that a reset, made in a new month before anything was recorded in it, filed into the
    month before; rows there that will not open are read as partly checked, not as a cut. In a
    whole-record export, the check that runs when the file is opened counts each record a restore
    set aside once, and says that a restore, or records replaced and signed with the same key, does
    this. Where a reset followed a restore, it used to count seams and a missing record instead,
    and where a reset had also come before the restore, it could read VERIFIED. The export also
    says how many archived records the install could not read; its check names them as the cause
    of the gap instead of calling it a filtered extract or a removal, and its first page says the
    gap may be those records rather than stating that records were removed. An edited file that
    used to stop the check with no verdict now reads BROKEN. A file exported before this update
    keeps the check it was made with.

13. **The rules say what a word catches.** The rules section said a blocked word is never caught
    in the middle of an ordinary word, but some ordinary words are split into halves: blocking
    "book" hides a post with "Facebook" in it, while blocking "diet" leaves "dietary" alone. It
    also said a word catches its English and Romanian endings, which only a word of four letters
    or more does, so blocking "gun" leaves "guns" showing. The text now says both, in all four
    languages. What the rules hide has not changed.

14. **A record keeps no searches.** A post or comment with no link of its own is recorded with
    the address of the page it was seen on, and on a search page, or a video opened from one, that
    address could hold the words typed into the search box. Those words are now left out: only the
    page itself stays, and the few parts of the address that name a post, a photo, a video or a
    playlist. Records written before this update keep the address they were signed with.

15. **The AI reading sends labels, not account names.** When the AI reads a comment section, an X
    reply thread, the comments under a TikTok caption, or a post in Teen or Child mode, each account
    name is replaced in the browser by a label such as @user_A before anything leaves the computer,
    the same label for the same person throughout one reading, and the real names are put back into
    the reason and the rewrite before you see them. Names written inside the text itself still go as
    written, because whether a named person is a public figure or a private one is part of what is
    judged. Adult mode and "Read this for me" are unchanged. Measured before release on 372 real
    comment sections and 179 posts: the verdicts changed no more often with labels than when the same
    items were simply read twice (`15a5a3a2` to `739c559a`; docs/research/2026-09-24-labels/RESULTS.md).

16. **The AI request carries no page address.** The request that asks the AI to read runs inside the
    social site's page, so the browser could attach that page's address to it under the site's own
    rules. It now sends none (`15a5a3a2`).

17. **The activity list is no longer flooded by the recorder's own notes.** While a feed is open the
    recorder writes a heartbeat up to every fifteen minutes, and each one showed in the activity list as
    a card of its own, labelled "old entries pruned", with a false "switched platform" line around it.
    A run of them is now one small line, for example "12 record heartbeats · Sep 24, 2026, 03:00 to
    05:45"; the Record tab still lists each one, and the count of entries shown does not change. A stop
    in recording keeps a line of its own, "recording was off", where it happened (`f7478fd2`).

18. **The diagnostics page tells the truth about the AI and about today.** The AI step showed "100% ok"
    while a quarter of its calls were being refused; it now counts a call that brought back no reading
    as failed, with the reason. A call the extension tried twice after a "too many requests" answer
    counted as two calls; it now counts once, by how it ended, and the page says how many needed another
    try. The page-reading rows said "no visit observed today" for a tab left open across midnight UTC;
    they now see it, and say "since 00:00 UTC", when their counters start again (`4704358f`).

### Store what's new blurb (Receipts 2.5.15)

In Adult mode, before the AI reading changes a post, a second model has to agree, and the record
names the models and the company that really read each post. Text a model wrote on the page
carries a mark software can read. Settings can add a parent PIN to an install set up without one.
A reset in the middle of a month, or one damaged entry, no longer leaves the record stuck or Verify
calling it broken. After a restore or a reset the dashboard's counts agree, a restore says where the
old entries go, and an exported file's check counts them right. With rewrites off, no saved rewrite
is shown. The hashtag switch is now "Hide posts by hashtag or AI label", and the built-in check no
longer counts "don't kill yourself" as self-harm. Romanian, Spanish and Portuguese are told apart
better. Without a licence, the record's fingerprint no longer goes to our server when the
time-stamp services fail. A record no longer keeps the words typed into a site's search box, and
the rules section says which words a blocked word catches. The AI reading now sends labels such as
@user_A in place of account names, and no page address. After updating, reload your feed tabs.

### Off 1.0.10

1. **Off comes back after a conversation.** If you opened a conversation while Off was still
   starting, it stayed off in that tab until the page was reloaded. It now starts again when you
   go back to the feed.

2. **The hashtag switch says what it does.** It was called "Block AI-generated content", but most
   of its list is tags for posts made to upset you, to make you angry or about starving yourself,
   and it catches an AI post only by a listed tag or by a label saying it was made with AI. It is
   now called "Hide posts by hashtag or AI label", in all four languages, and its description says
   it also hides a post when its text, or a label the site puts on it, says it was made with AI.

3. **The rules say what a word catches.** The rules section said a blocked word is never caught
   in the middle of an ordinary word, but some ordinary words are split into halves: blocking
   "book" hides a post with "Facebook" in it, while blocking "diet" leaves "dietary" alone. It
   also said a word catches its English and Romanian endings, which only a word of four letters
   or more does, so blocking "gun" leaves "guns" showing. The text now says both, in all four
   languages. What the rules hide has not changed.

### Store what's new blurb (Off 1.0.10)

Off comes back on the feed when you leave a conversation that opened while it was starting. The
hashtag switch is now called "Hide posts by hashtag or AI label", which is what it does, and the
rules section says which words a blocked word catches. After updating, reload your feed tabs.

## Off 1.0.10, packaged 20 September 2026, rebuilt 22 September

Rebuilt on 22 September from the commit that rewords two comment lines in the source (the public
copy's scan refused them), so that the upload's commit is one the source can be published from.
No switch behaves differently. Off's name and its one-line summary in the store changed, in all
four languages, so that people looking for what it does can find it.

The code moved by about a kilobyte, and only in one way: Off shares its filter code with Receipts,
and the reason a hide writes into Receipts' record was corrected in several places today. Off keeps
no record, so nothing you see changes. One unused style name also went out of the popup.

The old name, "Off - Social Feed Filter by FeelingWise", was a brand and a category word. Measured
on 20 September, the listing came up in Chrome Web Store search for no phrase an ordinary person
would type, including phrases taken from its own description. The new name says what the switches
do, and the summary names the five sites.

## Receipts 2.5.14, packaged 20 September 2026, in the store 21 September

Off is unchanged and stays at 1.0.9: nothing in this update touches the filters. Everything here is
about the file Receipts writes for you to hand to someone else.

**An export with a held-back record now opens.** Keep a record out of the file and the CSV and the
PDF used to come out broken. They now build, and the JSON marks the place where the record was held
back.

**A flagged-only file says it is a flagged-only file.** Ask for the flagged items alone and the
summary used to read as though it described your whole feed. Page one now says what it holds, in
every count and on every card.

**Page one counts what the recorder signed.** The gaps the recorder wrote down, and any reset made
inside the time the file covers, are now on the first page instead of only in the detail.

**A month change no longer costs a file its verdict.** Passing midnight on the first of a month used
to leave a whole-record export unable to say whether it verified. The chain now follows the rotation
across the join, and the file says so in one line.

**An ad that stayed on the page is recorded as staying.** It used to be written down as blocked. A
reading you asked for is no longer written down as the feed serving you the post again. A marker is
no longer written down as a record with its settings missing. A file of three sittings says three
sittings. Records signed before this version keep the sentence they were signed with, because a
signed record cannot be edited afterwards, so a file exported today still shows the old wording on
those.

**One file, one answer.** Which techniques were flagged, and at what rate, now have a single answer
per file. Two places in the same export used to give two.

**The AI reading says what it was asked.** An export now states what the model was asked for, and
names the people and accounts it names rather than printing internal keys.

**Every number on a page agrees with the record under it.** The confidence figure, the flag rate,
the blocked tile and the column headings each now have one meaning and one source. Several read one
way on page one and another way in the detail.

Twenty-five problems in all, across twenty-four changes, found by reading the exported files
themselves rather than by running the tests.

## 2.5.13 and Off 1.0.9, packaged 20 September 2026, in the store the same day

Your private conversations are out of reach of every filter, and the file you send says exactly what
was checked. The filter changes are in both extensions; everything about the record and the file is
in Receipts. 2.5.12 and Off 1.0.7 and 1.0.8 were packaged on 19 September and never uploaded:
everything they held is here. This section is the text of the 2.5.13 band on the Updates page, which
was written first; it was added here on 20 September so the two do not drift.

**No filter reaches a private conversation.** Every hide asks one question before it acts, from one
place in the code rather than five that could drift apart: is this a private conversation. Until
now five of the on-page filters each answered it on their own, and could reach inside Messenger and
direct messages.

**YouTube comments are protected like any others.** A YouTube comment can be marked, hidden or
softened like a comment anywhere else, and the record says what happened to it. Until now none of
the three ever landed there: each one failed the check that decides whether a marker can be placed,
and was written down with a reason that had not happened.

**The file says exactly what was checked.** The page that travels with the file counts each record
by what was actually done to it, and names the reason. It used to tell a reader that a signature had
been checked over a record that carried none, and a green headline could say every hash was
recomputed when some were not.

**What you read is always somebody's words.** When the provider answered "I can't help with that"
instead of softening a comment, that sentence was put on the page in place of what the person had
written. A refusal is recognised now, and the comment is hidden or marked instead, never replaced by
the model talking about itself.

**The parent PIN holds.** A brief failure to read stored settings told every parent-PIN gate that no
PIN had been set: the settings panel opened with no prompt, Child to Adult became two clicks, and a
record reset would have run unauthenticated. Quiet hours with the weekend unticked left Sunday night
open and closed Friday instead. When the extension failed to start, a child's page lost its cover
until the page was loaded again. All three are closed.

**Child mode softens swearing whatever the switch says.** Both panels said Child mode always softens
swearing, and a per-platform override, or a settings grid saved before that rule existed, could
leave it off. The mode decides now, not the switch.

**"Back up now" means a file was written.** The button waits for the file, and the warning about
having no copy stays up until one is really on your disk. It used to count the moment it asked your
browser to save, so pressing Escape on that dialog was recorded as a backup taken.

**The panel says whether the server took your key.** The panel could show an active licence and
unlimited calls on the same screen as a red card saying the server had refused the key. The plan you
hold is read from the key itself, which is how the extension knows it offline; whether the server
accepts it is a separate answer. The screen shows the second one now.

## 2.5.11, packaged 18 September 2026

Four faults in how the record defends itself, all found in one night by reading the code the way
somebody attacking it would. Nothing a user asked for changes. Everything below is the record
keeping a promise it was already making.

**A stranger could take the signature off your evidence by writing six characters under a post.**
An export carries a signature over the whole file, not only over each entry: the entries, the keys,
the labels, the wording and the summary rows as they are shown. Writing that signature meant reading
the file's own data back, and one step of that reading broke on a record whose text contained the
characters `\u003c`. When it broke, the file was written **without the signature at all**, with no
error and nothing on any screen to say so. Anyone you sent it to would have seen a file whose
envelope is covered by nothing, which reads much like a file somebody edited. It has been this way
since the whole-file signature shipped on 6 September. Every export from this version on is signed
whatever a post contains, and five cases in the suite hold it there.

**Turning the extension off and on again stopped your daily backup.** Every scheduled job was set up
once, at install, and Chrome does not run that step again when an extension is disabled and enabled,
or reloaded. On an install where that happened, the daily encrypted copy into your Downloads folder
stopped for good, and so did the independent time stamps, the tidy-up of the oldest entries and the
heartbeat. Nothing told you. The jobs are now checked and put back whenever the extension wakes and
whenever the browser starts.

**Chrome could delete the whole record, and the dashboard would have shown an empty one.** The
record lives in the browser's own database, and without asking for permanent storage that database
is the kind Chrome may clear when the disk fills. It would have come back empty and working, so a
new record would have started at entry one and nothing would have said the old one was ever there.
The extension now asks Chrome to keep the record, which is a permission Chrome grants without
asking you anything.

**A file could hang the checker.** The part of the checker that reads a file's summary rows could be
made to scan the whole file once for every row in it, so a file built to do that took twenty-two
seconds instead of three milliseconds, with the tab frozen. That is a file somebody hands you, and
it happened before anything about the file had been established. It reads in a few milliseconds now,
whatever it contains, and the checker on feelingwise.org has the same fix.

**Your record can now tell you when it is gone.** A browser can throw away a site's stored data, and
when it does, the database comes back empty and every read of it succeeds. There was no way to tell
that from a record that was simply new, so the dashboard would have shown you nothing at all, with no
error anywhere. The extension now remembers how high your record has ever been, in a place the same
event does not reach, and if the record comes back shorter with nothing to explain it, the loss is
written onto the new chain under your own signature and the dashboard says so in red, with the date
and how much was there. It also watches the archived months, not only the live chain, because the
months hold everything older. What this cannot catch is written in plain words on the screen that
shows it: if the whole extension goes, so does the note, and then nothing knows.

**A restore that did not fully land no longer tells you it did.** The check that runs after a restore
read the record with a call that answers an unreadable store with an empty list, and an empty list
has nothing wrong with it, so a restore whose result could not be read reported every entry back and
the chain verified, while the screen showed zero. It reads the honest way now, and the number you are
shown is what the store actually holds rather than what it was handed.

**A second comment saying the same thing as the first is hidden too.** A check meant to stop a
duplicate row being written was also deciding whether the comment was hidden at all, so if two people
wrote the same words under a post, the second one stayed on the page. In Child mode that is the
protection failing on exactly the content it had already judged. The hiding no longer waits on
anything, and two people writing the same words are now two comments, not one.

**Comments no longer disappear between the reading and the record.** If you changed page or changed
mode while a batch of comments was being read, the whole batch was dropped and nothing was written
anywhere. Those comments are now written down as given up, one line each, saying which stage they
were at. The same is true for comments still waiting when you navigate away or close the tab. And a
comment re-read after a page change keeps the identity it had, so it is not written twice.

**The export says what its archive fingerprint actually is.** When you compare your record against a
platform's own data download, the export printed a number and told you anyone with the same download
could work it out and compare. They could not: it is taken over the files you opened, in the order
you opened them. It now says that, and says what it is good for. Two counts in the same comparison
were also inflated, one by counting the extension's own housekeeping entries against you, the other
by counting the platform's whole history against a recorder that may have been installed last week.

**The dashboard works in a narrow window, and reads properly out loud.** Anything wider than the
window used to be cut off with no way to scroll to it, on every tab. Colours were corrected against
the contrast standard in both themes, thirty controls were too small to hit reliably, and results
like a rejected licence key were shown on screen while being announced to nobody. The setup and
settings screens can be used from a keyboard throughout, and the interface now tells a screen reader
which of the four languages it is in.

Off moves to 1.0.7 with the same interface corrections. It still keeps no record, so none of the
record work above reaches it.

## 2.5.10, packaged 17 September 2026, uploaded and withdrawn

Uploaded on 17 September and pulled out of review on 18 September, before Google published it,
once the four faults above were found: two of them were in this build as well. Nobody ever ran it.
Everything listed under it shipped in 2.5.11 instead, which is the version that follows 2.5.9 on
a real install.

The biggest release since the recorder existed, and most of it is the record telling the truth about
itself. YouTube's home feed leaves a record for the first time. TikTok videos whose caption the page
hides are recorded with their words. The export counts flagged items one way everywhere in the file,
instead of three. Off moves to 1.0.6 with it.

**What the record now sees.**

- **YouTube's home feed, subscriptions, trending and explore.** Until now Receipts recorded YouTube's
  community posts and the watch page, and nothing of the grids you are actually served. Each video
  tile the page showed is one record: its title, its channel, its link, and "paid" where YouTube
  marked the tile as an ad. At most 400 tiles per page.
- **TikTok captions the page does not carry.** A For You video whose caption TikTok sends as data
  rather than as text on the page used to be recorded with nothing written on it and judged by its
  comments alone. It is recorded with the caption now, and the record says where the text came from:
  "the page carried no text for this item".
- **The recorder looks once when it comes back.** It stops watching a page in three situations, each
  on purpose and each already written into your record as a gap: a page firing changes faster than
  anything can read, a tab left in the background, and the memory valve. On YouTube nothing ever
  looked again afterwards, because the every-three-seconds safety pass is off there on purpose. One
  pass now runs when it comes back, so a recorded gap becomes a recovered one.
- **Two people writing the same word under a Facebook post are two comments.** The recorder told
  comments apart by their text alone, so short replies like "same" collided all day and only one was
  kept. It uses the comment's own link now, or the name beside the words. A comment the page happens
  to draw twice is still recorded once.
- **A Facebook comment is read as a comment in every language.** Facebook writes that label in the
  reader's own language and the product knew eight of them, so in Turkish, Polish, Dutch, Greek,
  Japanese, Arabic and the rest a comment was either missed or written into the record as a post of
  its own, with no thread and no parent. The comment's own link decides now. The comment block switch
  uses the same reading, and a rule that could in one page shape have hidden a whole post along with
  its comment now cannot. Off carries this too.

**What the file says about itself.**

- **The export counts flagged items one way, everywhere.** Page one counted "content records" one way
  in one row and another way in the row above it; the reading part of the file counted a third way,
  including image records where page one left them out. One file could print 129, 108 and 1,325 under
  labels that read the same. Every row now counts the same way, image records are named on their own
  line instead of being dropped in silence, and the bars, the per-account rows and the filter above
  them share one cut of high, medium and low.
- **A post hidden by one of the product's own lists no longer prints a severity.** It named a number
  as though a model had read the post. It names the list now: the swearing list, the slur list, the
  words you blocked.
- **The record says when it refused to name an author.** On X the feed reuses one slot for a new item
  while the recorder is reading it, so the name at the top can belong to a different post than the
  words underneath. When the recorder cannot show they belong together it throws the name away, which
  is right; until now the row simply had no author and read like an ordinary post by somebody called
  "unknown". About 179 rows a day in a full day's record. The row carries the reason now, the
  dashboard and the export both say "author not established" with one sentence saying why, and the
  reason is inside the signature, so it cannot be added to a stored row or stripped from one. No
  count and no share moves.
- **When a check fails, the file says whether the record carries fields the checker does not know,
  and names them.** A checker older than the file cannot recompute a hash over a field added later,
  so a sound file fails in an old checker and the only thing it could say was "this record was
  modified after the hash was stored". The verdict does not change: a record that does not hash to
  its stored hash has failed. Naming a field is information for a person, never a lighter result.
- **A failed check names the entry by the number the record carries.** The title said "Entry #0
  failed verification" over "Integrity hash mismatch at position 100". Both say 100 now.
- **The reason a check failed is readable.** It sat in a row beside a label and three buttons, with
  about 120 pixels left for the most important sentence the product prints. It gets its own line now.

**Time stamps.**

- **A new install's record is anchored in its first quarter of an hour, not its seventh.** The first
  ring of the timer was its whole period, so the first six hours of every new record were unstamped.
  It rings fifteen minutes after the install now.
- **A record that is read a little still gets stamped.** A new stamp was only taken once fifty more
  items had been recorded, so a household that reads slowly could go days without one while the site
  promised every few hours. A stamp is also taken when the last one is over six hours old and
  something has been recorded since. An install that is not being used asks for nothing.

**Screens that said more, or less, than the truth.**

- **Opening the Issues tab no longer blanks the dashboard.** As soon as that tab's numbers arrived
  the page went black and the only way back was a reload.
- **There is now a way from the product to the plans page.** The License tab said "paste a key to
  upgrade" and nothing in the popup said where a key comes from. On a free install it carries one
  quiet line under the key box: what the AI reading costs a family, monthly or yearly, and a link to
  the plans page in your own language. It links a page, never a checkout. A household that has paid
  does not see it.
- **The licence stops being sold as the thing that time stamps your record.** The setup screen, its
  key card and the License tab all said a key "anchors your record". Anchoring stopped being a paid
  feature on 4 September and every install gets it free. All three now say the key turns on the AI
  reading, and the setup screen says the time stamps run without it.
- **The last button of setup says what it does:** save the key and finish. It said "Activate
  protection" on the screen that has just explained everything runs without a key.
- **The sentence an adult install ends on names the right places.** It sent you to Settings for a
  licence key; the key lives in the License tab and only the PIN is in Settings.
- **On a free install the "Read this for me" card stops describing a button that is not drawn.**
- **A brand new install is no longer told its automatic backup "is not working".** The daily copy had
  simply not run yet. It says that now, and that the copy runs once a day. A copy that was attempted
  and failed still says so, in the old words.
- **Child mode: a post the check said to hide, whose hiding could not be carried out on the page,
  stays covered.** Its cover used to come off a minute later with the post there to read. The cover
  also stops saying "FeelingWise is checking this content" once the answer is in.
- **The dashboard always says how many comments a reading of a comment section was made from.** It
  printed that number only when the platform's own comment count could be read as well, and that
  count is often missing: of 286 such readings in a full export, 154 were made from fewer than four
  comments.
- **The Exposure tab tells an empty record from an empty week.** It said "FeelingWise hasn't
  witnessed enough yet" whenever the week you were looking at was empty, whatever the rest of your
  record held. It now says nothing was recorded in that window, gives the date of the newest item you
  do have, and points at the wider windows.
- **The seven day line only draws the days the recorder was there for.** A day with nothing recorded
  was drawn as a value of zero, so a new install showed a line on the floor for six days and then
  climbing. One day on record is a dot now.
- **The caption under "Flagged items over time" says where the count is:** on the bar, not at the
  right of the chart.
- **The card for the file you send to a lawyer or a researcher** said it holds "the items flagged in
  the window chosen above". There is no window chooser on that tab and the file was never windowed:
  it holds everything flagged in the record the install is keeping.
- **In Off, the interface language row was cut off in Spanish and Brazilian Portuguese.** The dropdown
  takes the width of its longest option and left the row's own name 39 pixels of 322. The picker sits
  under the name now, the way it already did in Receipts.

**After an update, one line.**

- The next open of the popup shows "Updated to 2.5.10: what changed", linking to the Updates page at
  this version, until it is opened or dismissed once. Nothing opens on its own: no tab, no window, no
  system notification. A fresh install sees no line for the version it was installed with. Off shows
  the same line for 1.0.6.

**Inside the exported file, for the people who read it.**

- Every export carries the qrcode-generator notice in front of the library it embeds, which is what
  that licence asks of every copy.
- Three comments in the export's own scripts named internal planning documents by item number. The
  reasons stayed; the names went.

**A correction to 2.5.5.** That release said the hash of the uploaded zip would be published beside
the store listing from then on. It never was. Since 16 September 2026 the hash of every uploaded zip,
and the commit it was built from, is in `docs/spec/RELEASES.tsv`, and the build can be repeated from
that commit to the same bytes.

## 2.5.9, packaged 16 September 2026, uploaded 16 September 2026

Quiet hours can be set. The rest of this release is four places where a switch, a panel or a number
said more than the extension actually did. Off moves to 1.0.5 with it and carries quiet hours and
the emoji wording.

**Quiet hours, on both extensions.**

- **From a time to a time, on the days you pick.** Under the pause switches, turn on Quiet hours
  and every feed site (X, Facebook, Instagram, TikTok, YouTube) closes during those hours. It
  starts at 22:00 to 07:00, every day. A pause switch that is on still closes its site at any
  hour. The part that closes the page existed since August; nothing could set it until now, while
  the site already said it could.

**Words, panels and numbers that said more than the extensions do.**

- **Emoji are removed, not turned into text.** The emoji switch said it replaced emoji with plain
  text; it takes them out. The switch now says so in all four languages. Off carries this too.
- **A page is only called protected when it is.** The popup's coverage panel asked whether the
  address you were on contained "x.com", so netflix.com, vox.com and xbox.com were all read as X
  and the panel said FeelingWise was protecting that page. It now matches whole names, so only
  x.com and its subdomains count. The five real sites behave exactly as before.
- **The AI usage the popup shows matches what the server counts.** Calls answered by the larger
  judge cost twice as much, and the extension counted them at half while the server counted them in
  full. The popup could show room that was already spent, and a call could then be refused with the
  popup still saying there was headroom. Both sides count the same now. Nothing about what is
  analysed changes; only the number the popup shows.
- **The Statistics tab loses the "Quality: reviewer agreement" card.** It could only ever say
  "Calibrating...". The number it promised comes from verdicts counted on the device, and there are
  none: calibration happens on our side between versions, never on your machine. The per-technique
  agreement rows under it were fed by the same empty result. The rest of the tab is untouched.

## 2.5.8, packaged 15 September 2026, uploaded 15 September 2026

A flagged post now says what it does, and picture posts with no caption on Facebook and Instagram are judged by their comments. Packaged over 2.5.7, which was never uploaded; a store install goes straight to this one and carries everything listed under 2.5.7 as well.

Off moves to 1.0.4 with this release: its word filter is the one described below and under 2.5.7, so a word you block in Off also catches its English and Romanian endings and the same word run together with your other words or with swear words, while longer ordinary words stay visible. (Not all of them, and not every ending: see the note of 24 September 2026 under 2.5.7.)

**A flagged post says what it does.**

- **The harm named.** When the adult judge flags a post, a second short reading names what the
  post does to a person: hostility toward a group or a person, alarm, sexual content, self-harm,
  violence, drugs, selling pressure, a false claim. The exported record shows it on the post. It
  never changes what happens to the post and never slows a hide; only the record waits for it, and
  for four seconds at most. The reading also names which group, and the record keeps that, but the
  export does not show it yet: checked on 284 fresh posts about Israel and Jews, it was right only
  57 times in 100 and called a third of the news about Israel hostility.
- **One extra call per flagged post.** The adult judge flags a small share of what it reads, so
  the reading adds about that share again to the day's calls, never more.

**Picture posts with no caption are judged by their comments on more sites.**

- **Facebook, Instagram, and a post's own page on X.** A post with no words of its own waits
  briefly for the first comments under it, as TikTok and YouTube videos already did, and the
  verdict on those comments becomes the post's, marked in the record as read from the comments.

**Smaller fixes, each one a number or a button that said something untrue.**

- **On X in any language, For You and Following are recorded.** The tab was read from its English
  label, so a Romanian interface recorded neither. The export's surface filter now also offers
  Following and not captured.
- **The dashboard's storage figure is measured.** It was 4 KB times the number of entries; it is
  now what the browser reports FeelingWise keeps.
- **Verify and Export stay off when the record could not be read**, and Open original post in
  Forensics opens the post without protection hiding it.
- **A technique bar in Statistics opens exactly the entries it counts.**
- **The attention banner says Done only when something was fixed**, and a dismissal lasts the
  rest of the day instead of one visit.
- **A monthly archive that is stuck, or needs a person, now says so on the dashboard** instead
  of only in the extension's console.
- **The exported record names a fixed rule as a rule**, with no severity score, and a chain reset
  shows the hash of the chain it replaced.
- **Patterns no longer waits forever** on a blocked browser database, the Activity feed's date
  dividers no longer shift the scroll, and the platform-export comparison speaks all four
  languages.
- **Confirm and Dispute can be taken back** by pressing the lit button again.
- **Patterns keeps its themes and drills inside the range you picked**, the safety panel's
  "show only these" sits on its row, and a cleared issue stays cleared until something new
  happens.
- **The whole-record export says which step it is on** while it builds a large file, and the
  language setting says open pages switch after a reload.

---

## 2.5.7, packaged 15 September 2026, never uploaded (carried in 2.5.8)

Your own blocked words catch the forms people type to get around them, videos with no caption are judged by their comments, and the exported record is quicker to read and to narrow. Packaged over 2.5.6, which was never uploaded; a store install goes straight to this one.

Off stays at 1.0.3; nothing in this release touches it.

**Your blocked words reach further, without hiding ordinary words.**

- **Endings and glued-together words.** Blocking "fuck" now also hides "fucking" and "fucked";
  blocking "motherfucker" hides "dickheadmotherfucker". A word only matches when the whole
  longer word is made of listed words, so blocking "diet" still leaves "dietary" alone, and
  blocking "ass" leaves "class" and "assistant" alone. The endings are English and Romanian
  ones only: Spanish and Portuguese endings once turned "futu" into "futuro". The rules screen
  says so in all four languages (corrected in 2.5.8, where it had promised Spanish and Portuguese
  readers their own endings).

  **Corrected on 24 September 2026:** the longer word can also be made with one of a few English
  word halves such as "face", "head" and "boy", so blocking "book" also hides "Facebook" and
  blocking "friend" hides "boyfriends". And only a word of four letters or more catches its
  endings: blocking "gun" leaves "guns" showing.

**Videos with no caption are judged by the comments under them.**

- **The first comments decide.** A TikTok or YouTube video with no words of its own used to
  pass with nothing to read. Now it waits briefly for its first batch of comments, and the
  verdict on those comments becomes the video's, marked in the record as read from the
  comments. Short real captions are still read on their own words.
- **The platforms' own data is read on all five sites, never in private messages.** It is how
  ad markers and captions the page never shows reach FeelingWise. Chats and Facebook messaging
  are refused before anything is read.

**The exported record is quicker to read and to narrow.**

- **One line per record in the verification list.** The list under the feed used to repeat
  every record in full. Now each record is one line that opens to its detail. On a
  10,000-record file the page is ready and checked in under two seconds.
- **Numbers you can press.** Press any number in the reading table and the list shows only
  what that number counts. Press "High" in the summary, or pick a level, and the list shows
  only high-severity items. The High count now counts exactly what the press lists.

---

## 2.5.6, packaged 14 September 2026, never uploaded (carried in 2.5.8)

The backup folder restores on its own, the restore asks for nothing a fresh install cannot have, and the dashboard opens fast however large the record grows. Packaged the same day as 2.5.5, which was never uploaded; a store install goes straight to this one.

Off stays at 1.0.3; nothing in this release touches it.

**The backup folder restores on its own.**

- **Two files with fixed names, in the folder you named.** Every time FeelingWise mirrors a
  backup into your folder it also writes `feelingwise-latest.json`, the newest whole record
  under one name that is always the same, and `feelingwise-restore.key`, the key that opens
  every automatic copy in that folder. The dated copies stay beside them, never overwritten.
  Before this, the automatic copies were locked to the install that wrote them, and an
  uninstall took the key with it; the product's own text said so, as if it were a limit rather
  than a choice. Copies written before this version by an install that is gone cannot be
  reopened by any version, unless a recovery passphrase was set before they were written.
- **One button: Restore from my backup folder.** Pick the folder. The newest copy and its key
  are read together and the record comes back. No passphrase. It works on a fresh install
  after a reinstall and on another computer, and the folder you picked becomes the folder
  FeelingWise backs up into from then on.
- **The PIN is asked only where a PIN exists.** A restore used to refuse any install with no
  parent PIN and tell you to set one first, which a fresh install cannot do and an adult
  install never does. Now the PIN gate holds only when a PIN is configured, and the PIN box
  appears only then.
- **Downloads has a newest copy under a fixed name too.** The daily automatic copy is still
  written to a dated folder, and the same bytes are also written to
  `FeelingWise/feelingwise-latest.json`, overwritten each day. It stays locked to the install,
  with no key beside it, because Downloads is not a folder you chose.

**The dashboard opens fast however large the record grows.**

- **The tabs walk the last 90 days; the rest is counted.** Overview, Exposure, Patterns,
  Statistics and the Forensics counts read the archived months of the last 90 days and no
  older month, which covers the widest view any of them draws (eight weeks). Every older month
  is counted from a small summary it carries, so every all-time figure stays whole. Proven on a
  record of 200,000 entries over two years: at most four months are read, and every total is
  equal to counting all 200,000. Verify still walks every month.
- **The usage panel's year view stays whole.** The month summaries now carry the four usage
  bands per hour, so the twelve-month view is built from the loaded months plus the summaries
  of the rest, equal to the view over every record.

**First run for an adult: nothing to type.**

- The setup screen used to require a 4-digit PIN and a recovery phrase on every install, so
  an adult, and anyone reinstalling, had to invent a PIN before the popup would open. Adult
  now finishes on the mode step with one button and sets no PIN and no phrase; a licence key or
  a PIN can be added later in Settings. Child and Teen keep the PIN and the phrase, because a
  control a child can undo is not one.
- The Activity list says how many older records lie beyond the last 90 days, counted in every
  total, kept in the monthly archive and included in the complete export.

**Under the hood.** The source tree that goes public is written by one script from an
allowlist and refused on any key-shaped string; nothing is public yet, that is the owner's
word. The reproducible build is unchanged: two builds of one commit, one zip hash.

## 2.5.5, packaged 14 September 2026, never uploaded (carried in 2.5.8)

The file says whose it is, the export opens on its numbers, the dashboard counts the whole record, and every record says what actually happened to the post.

Off stays at 1.0.3; nothing in this release touches it.

**The file says whose it is.**

- **A name on the file, chosen by you.** The owner read his own export on 14 September and it
  read as if nobody owned it: page one said the file carried no name, and the page said "this
  device". The Export tab gains one field, your name on the file: any name, a pseudonym
  included, stored beside the settings (no schema migration). Page one prints it as "Made by",
  marked as a name the maker chose rather than a checked identity, and the file name carries it.
  The disclosure paragraph says "this file names you as <name>, a name you chose" instead of
  "carries no name". Four languages.
- **The machine, as the browser reports it.** A second row, "Machine": operating system,
  browser and major version, interface language, time zone, read from what Chrome exposes to an
  extension. What Chrome does not expose is not claimed: there is no API for the account name on
  the computer, the computer's name or the address, so none is printed. When the browser reports
  nothing the row says so rather than inventing a machine.
- **Both rows are signed.** They carry the same provenance marker as every other page-one row,
  so the manifest's digest of rendered sentences covers them. They are outside the envelope
  canonical on purpose, so the public checker's byte-synced copy of that function stays valid
  and a file made today verifies in the checker published on 13 September.

**The export opens on a reading mode.**

- **One row of numbers per platform, over everything in the file.** The exported page now opens
  on a table: for X, Facebook, YouTube, TikTok, Instagram and all of them together, the
  impressions, the unique posts, the ones seen before, the paid placements, the ones hidden by
  your own rules, and the ones the model named. Under it, a chronological list. Filters for
  surface, sitting and seen-before recompute the rows and the list together; a blur-authors box
  hides names for a screenshot. Everything runs in the reader's browser from a script inside the
  file; nothing is stored and nothing is sent.
- **A rule of yours is not a finding.** A record hidden by one of your own words or accounts reads
  "your rule: <name>" with no severity number, so a blocked record's placeholder score never
  reads as a judge's verdict. The engine that computes the rows is the same one the dashboard
  runs, and a test runs both over the same fixtures so they cannot drift apart.

**The export opens on the answer, and the words fit an adult.**

- **One sentence first.** The export file used to open with a paragraph about hashes and keys. It
  now opens on "What the feed showed" and, under it, one sentence computed in the reader's browser
  for the current selection: which platform and surface, how many impressions of how many posts,
  how many paid placements, between which days. Pick X, or For You, and the sentence follows. The
  checker's own paragraph moved under the Verify button, shortened to what it does and what it
  cannot establish. Four languages; the public demo export is rebuilt.
- **Written for the person whose feed it is.** "Parent", "the other parent", "your child's data",
  "parent PIN" and "manipulation over time" are gone from the dashboard and the export reader;
  the lens is "Plain reading"; the report is "the file to send to whoever has to check it". The
  two English-only blocks on the Export tab (recover records, check against the platform's own
  export) now speak all four languages.
- **The popup's first screen says what the product is:** it writes down what your feed shows you,
  on this computer only, and lets you export that record with its own checker inside. Adult is
  the default choice; Child and Teen stay one click away.

**The dashboard opens without reading the archive.**

- Each month archive now keeps a small summary of itself: how many records, how many flagged,
  blocked and unsigned, by platform, by technique and by hour. Counts only, never text. The
  dashboard reads those summaries when it opens, so the header and the statistics describe the
  whole record at once, and the archived records themselves are read only when a tab that walks
  them is opened. The summary is derived from the archive and carries the record count it was
  computed from; if the archive ever holds a different count, the summary is rebuilt from the
  records before it is used. It can never disagree with them for long.

**The zip can be rebuilt by anyone and compared.**

- The build id that every record carries used to be minted from the clock, so no two builds of
  the same code matched. It is now derived from the commit when the store zip is built, and
  `node scripts/reproducible-build.mjs --verify <zip>` rebuilds from source and says whether
  the bytes match. The hash of the zip is published beside the listing from this version on.

**The daily tidy-up stops rereading the archive.**

- Every day the app moves the oldest records past the 10,000 cap into that month's archive. To
  avoid writing one twice it used to read and unpack the whole month archive, twice, to answer
  "is this record already there". The archive now carries an index on the record id and the
  question is one lookup per record. A month archived by an earlier version gains the index the
  first time it is opened; nothing in it changes.

**The dashboard counts the whole record.**

- **The month rotation no longer zeroes the tabs.** Overview, Exposure, Patterns and Statistics,
  the header, and the usage panel read one list: the archived months plus the active chain. A
  rotation at the turn of the month, or eviction at the cap, used to drop the counts to what was
  left in the active chain.
- **Verify across months stays green.** A verify that walked archived months now carries every
  record it checked, so the banner and the anchor row print the same total. A refused
  incremental verify falls back to a full walk instead of leaving "checking" on screen.
- **One fewer file to choose from.** The folded "other formats" row offered a third HTML file, the
  current chain on its own. It was a strict subset of the whole record (the active chain caps at
  10,000 records; the archives hold the rest) and read as a third answer to a two-answer
  question. Removed in all four languages; the report and the whole record are the two files.
- **Every button on the Export tab leaves a receipt** in the card it sits in. Restore errors stay
  in the backup card. The Everything card says what it holds. The report's numbers note says it
  counted a selection when it did.
- **The Activity tab's filter rail** gained blocked as an option, and surface, sitting,
  seen-before and author as axes, with a date window on the drill. The number on a filter is the
  number of cards a click on it shows.

**Records say what happened, not what was tried.**

- A swear mask is its own verdict, "masked", neither a pass nor a flag. A hide that did not land
  on the page is recorded as flagged, not as hidden. A blocked record carries no technique, no
  score, and no invented surface or kind; it names the rail that decided it when one did. An ad
  served with Block Ads switched off writes a pass record under the sponsored row, with the
  switch named. Two items with the same words are two records, because the record's identity is
  the platform, the item id and the text together.
- **Private conversations are out of every filter.** The Messenger dock on Facebook lives on the
  feed's own address, so the address gate never saw it, and the emoji stripper, the empty-comment
  hide and the AI-label block reached into it. Each now skips a private conversation element by
  element. Diagnostics no longer write an account handle when they count an unknown path; they
  write a short hash of it. And an error from the reading service is called a licence refusal
  only when the service says so; everything else says what it was.

**Feeds with one player (TikTok, Reels, Shorts).**

- After a marked video is hidden, the feed moves to the next one FeelingWise did not hide. A run
  of hidden videos is walked up to five, then a notice says so; never a loop.
- The silence is scoped to the marked video. It is paused and kept paused while it is marked, and
  the mute goes back to your own state at once; a video you muted yourself stays muted. The
  Reels backstop used to silence every reel on the page; it silences the folded one only.
- The comment panel is put back if the hide closed it, and never touched if it was not open.
- The reset dialog: an unknown outcome offers a reload of the record, the lock countdown ticks
  and disables the inputs, and the no-PIN dialog offers to open the popup.

**What the update asks of the person taking it.** Reload the feed tabs. Chrome unloads the old
extension from every tab that was already open, so the filter stops working there until the page
is loaded again. Nothing else. Do not reset the record: the chain, the key and every export
already made stay as they are.

**The update gate.** 2.5.4 to 2.5.5 on a fresh profile, 20 of 20: settings migrated with mode,
swearing, interface language and all 19 switches kept; 25 records written under the old build
byte-identical on position, hash and link; the first record written after the update linking to
the last one written before it; the whole 50-record chain walking clean; popup and dashboard
opening on the migrated profile with no error. Suite at the package: 6,260 passing.

### Store what's new blurb (2.5.5)

The file now says whose it is: a name you choose on the Export tab goes on page one and into the file name, with the machine as the browser reports it, both signed. The export opens on its numbers: one row per platform over everything in the file, with
filters and a blur for screenshots, all computed in the reader's browser. The dashboard counts
archived months with the active chain, so the turn of the month no longer zeroes the tabs, and
Verify across months stays green. Every record says what actually happened: a mask is a mask, a
hide that did not land is not a hide, and a rule of your own is never a finding. On TikTok,
Reels and Shorts a hidden video is skipped, the sound stays yours and the comment panel comes
back. Private conversations are out of every filter. After updating, reload your feed tabs.

---


## 2.5.4, packaged 8 September 2026, never uploaded (carried in 2.5.8)

The report says how it got its numbers, and the parts every claim rests on were taken apart and put back.

Off stays at 1.0.3; nothing in this release touches it.

**Page one of an export, four new statements.**

- **What decided a flag.** A single "flagged" count merged three unlike things: the platform's
  own advertising marker matched by a rule, the other fixed rules, and a verdict from the AI
  reading. They are printed apart now, each with its own count and share, split on the record's
  own `aiSource` and `overrideOrigin` rather than on a display label. Four locales; small shares
  print one decimal.
- **How much of the file nobody was there for.** A run is counted as unattended only when it is
  long enough to judge, its gaps fall at an even interval the way a timer's do, and no burst of
  activity interrupts it. Records that arrived in a tab left open overnight are counted and
  named as such instead of standing in the total as exposure. Derived on the page, never stored.
- **What the file tells a reader about the person who made it.** Counted from structured fields
  only: authors, the accounts the reader chose to follow, advertisers, named groups, the links
  back to the reader's own view, the span of the clock the file covers. A file with no name
  field in it still identifies its maker, and page one now says so, with the reader's own
  numbers, naming only the items that are not zero.
- **Which build wrote each record.** One build id per build run, baked into the worker and the
  content script and stamped on the record from the content side, because an extension reload
  leaves the old content script running in every tab already open. Page one names the builds
  that wrote the file when more than one did, and is silent when one did. A tab running a stale
  build warns once and names the fix that is not the one people try: reload the tab, not the
  extension. Appending the field leaves every earlier record hashing byte for byte the same,
  and a build id injected after signing is caught as tampering.

**Redaction, delivery and the checker: a review of the foundation.**

- **Redaction did not redact.** A redacted record kept the exact words in two places the export
  prints on the card: the harm floor's evidence line ("1 profanity tokens (...)") and a
  technique's reason. Both are stripped now; the technique keeps its finding and loses its
  quote.
- **A Refresh un-redacted the whole session.** One of four places the dashboard writes records
  into state did not wrap the read, so a single card Refresh put the raw records into every
  JSON, CSV and PDF taken afterwards.
- **A withheld record earned its tick without its signature.** A marker naming the id and a
  string comparison were the whole test, and the hash of a withheld record cannot be
  recomputed, so that signature is the only thing that says the install made it. Checked now,
  and the number of withheld records is printed, which it never was.
- **A sound file in the plain JSON form read BROKEN**, the worst word the checker has, on the
  input the usage line and the format document both advertise. It reads not-made now, capped at
  partially verified. Removing a record from one still fails.
- **The checker asserted a completeness it had not checked**, opening with "everything the
  install still had" on any file carrying no selection field. Measured with the manifest
  stripped: dropping the newest record, the oldest, or swapping two adjacent ones each read
  chain-ok with zero failures. The claim is attributed to the file now unless a manifest backs
  it, and the checker consults the coverage arithmetic it was already computing, which
  immediately caught the public demo export on the site numbering its chain from 1.
- **"No signature failed" was printed over signatures that were checked and failed.** A record
  naming no key and a record whose signature did not verify were counted under one word. Counted
  and worded apart.
- **Three card shapes returned before the verdict stamp**, so a chain marker or a room summary
  that failed its signature rendered as an ordinary grey line in a feed whose own description
  says it stamps every card. A chain marker is exactly the record someone would want to edit.
- **Redacting one record inside a filtered report discarded the report's own signed selection**,
  because a marker is an extra record and the count stopped matching. Measured, that dropped a
  sound file from verified to partial for doing the thing the product tells people to do.
- **An import marker named the signing keys of what it verified** rather than what it imported,
  so re-opening the same salvage file signed a line naming keys nothing was imported under.
- **A closing tab reported only its first loss** (the flush awaited a round trip a dying page
  never receives) and **a gap marker swallowed the losses that arrived after it was sent**
  (an unacknowledged entry kept its delivery id while its count grew, and the outbox deduped on
  that id). Entries are sealed on send.
- **A heartbeat signed "canary clear" for silence it had never read**: one empty snapshot stood
  for no warnings, unreadable storage, no storage, and a snapshot from a previous UTC day. A
  platform blind since the evening before was signed clear from midnight onward.
- **An extension update left no mark at all.** An update orphans the content script in every tab
  already open, so anything those tabs had observed and not delivered never arrives. Eight other
  loss routes each had a signed marker; the most ordinary event in an extension's life had none.
  It writes one now, and says the amount is not knowable rather than printing a zero.

**What was being lost or mis-recorded.**

- **YouTube /watch comments had no protection at all.** The kind those comments are stamped with
  is documented as valid and was dropped by all four encounter assemblers, so every /watch
  comment was lost before judging; the harm-floor fallback walks the same list, so it never ran
  either. A severity-8 slur in a /watch comment section was neither hidden, marked nor judged,
  and each comment was written as a cancelled record naming a Groq model for a call nobody made.
  Comments on the other platforms were unaffected, because those paths score from a different
  list.
- **Every English Facebook reply was dropped or misfiled.** Two copies of the comment-label list
  in one file carried only two presumed English forms while the live diagnostic had "Reply by"
  and "Reply from". An unmatched reply is not dropped, it is written as a top-level post. The two
  copies are one exported constant now.
- **Month rotation of the signing key stopped for good on any install that reached its record
  cap.** The month came from the rotation marker at position 0 and otherwise from the newest
  record; the cap prune deletes oldest first, so the marker is the first thing to go, and the
  test then becomes "is the newest record from this month", always yes on a live install. The
  fallback is the oldest active record now, which is the question rotation actually asks.
- **A restore remembered the key it was taking on, never the one it was dropping**, so anything
  still on the device signed under the outgoing key read as an unverifiable prior key, the
  reading reserved for a signature whose key is genuinely unknown.
- **A partial archive made the cap prune delete a non-contiguous set**, punching a hole in the
  middle of the chain and signing a prune marker whose range covered a record still present. It
  takes the contiguous oldest run now.
- **A backup file could name any number of password-stretching iterations**, and the number
  travelled straight into key derivation with no bound, so a file naming 10^12 iterations hangs
  the extension of whoever opens it. Bounded, 10,000 to 5,000,000, in all three places.

**Dashboard and export readings.**

- The amplification card read its label off records that never carry one, so it said "no data"
  forever and hid the repeat-push list nested inside it.
- The export divided high-amplification rooms by all rooms including unread ones, and counted an
  environment record per batch flush as a room. Both corrected; on a real file that moved the
  printed share from a quarter to nearly two thirds.
- The disclosure block counts addresses, not the rows that repeat them.
- The feed's cycle guard was dead code: two `var`s of one name in one function scope, so the
  guard object was overwritten by the paging counter and a looping parent chain would have
  recursed until the stack gave out.
- A card body capped at 500 characters said nothing about being capped. The paging control
  counted threads while the header counts records. A group name went into a replace call as the
  replacement argument, so "Sale $& Swap" printed with a placeholder in the middle. Two rows
  printed different percentages for the same numerator and denominator. A rule family was
  labelled with the pipeline it travelled through rather than the gate that decided. A record
  that says a model judged it now names which model, including on a cache hit.
- `npm run dev` produced an extension Chrome would not load: the main watcher emptied `dist` and
  no watcher rebuilt the MAIN-world content script the manifest declares. Development only.

**What the update asks of the person taking it.** Reload the feed tabs. Chrome unloads the old
extension from every tab that was already open, so the filter stops working there until the page
is loaded again. Nothing else. Do not reset the record: the chain, the key and every export
already made stay as they are. A share that falls after this update did not lose days, it stopped
counting the platform's own advertising label as a finding.

**The update gate.** 2.5.3 to 2.5.4 on a fresh profile, 20 of 20: settings migrated with mode,
swearing, interface language and all 19 switches kept; 25 records written under the old build
byte-identical on position, hash and link; the first record written after the update linking to
the last one written before it; the whole 50-record chain walking clean. That group is the one
that had to pass, because this release adds a field to the signed canonical payload.

### Store what's new blurb (2.5.4)

Page one of an export now separates what a fixed rule flagged from what the AI reading judged,
says how much of the file arrived while nobody was at the screen, says what the file tells a
reader about the person who made it, and names the build that wrote each record. Redaction now
strips the flagged words from every field the card prints, a Refresh no longer un-redacts the
session, and YouTube /watch comments are protected and judged for the first time. The checker
stops calling a sound file broken and stops claiming a completeness it has not checked.

---

## 2.5.3 and Off 1.0.3, uploaded 6 September 2026

The record keeps its own account of what it lost, and a stranger can check the file without the file.

- The signed manifest: every export is signed as a whole, records, keys, labels, wording and
  the summary rows as rendered, and the checker reads the manifest before it prints any
  verdict. An export made by an earlier version reads "partially verified", never "verified".
- The record says where it has holes: a signed marker for a record lost between capture and the
  chain, a signed heartbeat every fifteen minutes while the recorder runs, and a marker when a
  tick finds the last one stale; a prune writes its marker before it deletes, or deletes
  nothing; recovered records enter under a signed import marker; a repair leaves its own.
- Withhold one record without a hole: a parent can withhold a record from every export and
  view; a signed marker takes its place, and the checker accepts the withheld record on the
  marker's word.
- Media addresses as read, inside the signature, on every retained record; a key that
  travelled in the file is told apart from the file's own key.
- The record checked against the platform's own export: open Meta's or TikTok's data download
  in the Export tab and the record is joined to it, with a signed marker carrying the archive's
  digest. X's archive is recognised and reports that it holds nothing to compare.
- The export runs its checker on opening and stamps every card with its record's verdict; the
  model's reading is set apart on every card under a heading that names the signature's limit.
- Accounts the recorder skips: a parent's list, consulted at the one point every record passes,
  counted without a name.
- The Export tab asks one question: the report to show someone, or the whole record; the rest
  is folded. The HTML card names feelingwise.org/check, where a recipient can check the file
  apart from the file. Every export returns a receipt: file, bytes, digest.
- Patterns and the export page one: every printed share carries its interval; mode and model
  as filter axes; near-duplicate re-serves beside the exact ones; platform switches as an
  event; "why this key" per epoch from the signing key's origin ledger.
- Copy Diagnostics no longer carries a platform id in the room summary.
- Off 1.0.3: no visible change; the version moves with the shared code.

### Store what's new blurb (2.5.3)

Every export is signed as a whole and runs its checker on opening; a recipient can also check it
at feelingwise.org/check, apart from the file. The record now marks its own gaps, heartbeats
and repairs, lets a parent withhold one record under a signed marker, and can be checked
against Meta's or TikTok's own data download. Media addresses are inside the signature.

---

## 2.5.2 and Off 1.0.2, uploaded 6 September 2026

The store speaks four languages, and the record says what happened, not what was tried.

- The store name and short description of both extensions follow the reader's Chrome
  language: English, Spanish, Brazilian Portuguese and Romanian, the same four the interface
  offers. The English text is unchanged. (Chrome's `_locales`, one folder for both products.)
- One marker line, one language: the dot beside a rewritten comment explains itself in the
  language of the explanation instead of mixing the interface language with the AI's.
- A rewrite is recorded once it has landed: in Child mode a rewrite that could not be placed
  safely is hidden, and the record now says hide, not rewrite.
- A blocked ad is recorded as a post, not as a video.
- An Instagram post that embeds a Facebook page link no longer takes that page's code as its
  id; a TikTok video that rehydrates into a reused feed slot gets its own record.
- A passphrase that seals a backup or the signing key must be at least eight characters; the
  Export tab says so before it refuses.

### Store what's new blurb (2.5.2)

Store name and description in English, Spanish, Portuguese (Brazil) and Romanian. The record
now says what happened to a rewritten comment, records a blocked ad as a post, and keeps
Instagram and TikTok identities straight when the feed reuses a slot. Backup passphrases need
eight characters.

---

## 2.5.1 and Off 1.0.1 – September 2026

Ask about one post, and the record gets seven things right.

- Read this for me (Adult mode): point at a post or a comment and the AI reads that one item,
  four lines beside it; the reading is kept in the record like any other check.
- The popup no longer says the AI is on and off on one screen; the blocked-category panel is
  named for what it lists; an account's history no longer raises the judge's confidence on its
  next post.
- The record says whether an item's text was whole, folded or cut on the page (`textCapture`).
- X replies read on a post's page carry their parent; an opened post is a `permalink`, not a
  profile visit.
- The "Person" chip is off on X posts; a Facebook author's name is the link, without the
  header's badge and narration.
- Instagram keeps a hidden item's box in place (word filter and switches), because removing it
  stopped the feed from loading.
- A batch the provider did not answer is recorded as no verdict (`aiSource: 'none'`), naming
  the model that was asked.

### Store what's new blurb (2.5.1)

Adult mode can read one post on request. The record now says whether the text was whole, cut
or folded on the page, files X replies under their post, and names a failed AI call as no
verdict. Off keeps an Instagram item's box in place when it hides it.

---

## 2.5.0 – September 2026

Four languages, filters that speak them, and one experiment taken out.

Until this release both extensions were English and Romanian, and so was every list of words
they matched. That was already a problem for people using them: the matcher runs every language
against every post and reacts to the worst available reading of each word, and measured against
real Spanish and Portuguese it was starring ordinary ones.

### The interface speaks four languages
- English, Spanish, Brazilian Portuguese and Romanian, in both products, from one roster
  (`UI_LANGUAGES` in `src/i18n/index.ts`), so the two pickers can never drift apart. About 1,300
  interface keys per language, plus 340 export keys and 55 PDF keys.
- Auto follows the browser and matches on the hyphen, never on a bare prefix: `es-PE` and
  `es-419` are Spanish, `ru-RU` is not Romanian. European Portuguese resolves to the Brazilian
  table deliberately, and the table says so.
- Every language was rendered in a real browser and measured for overflow
  (`scripts/verify/ui-overflow.mjs`), because a correct translation can still ship a broken
  400px panel. The first version of that probe reported a clean bill while measuring the setup
  wizard; it now fails a view that renders fewer than 12 text nodes.
- Three latent bugs fell out of the widening: `Intl` formatting was `ro` or `en-US` and nothing
  else, the export locale was typed `'en' | 'ro'` so a Spanish court-facing export would have
  come out in English, and the embedded verifier picked its locale the same way.

### The word filter speaks them too
- Spanish and Brazilian Portuguese words and phrases on top of English and Romanian. Terms that
  are ordinary in one country and obscene in another fire only for readers in the regions where
  they are heard that way, read from `navigator.language`. Nothing about the reader's region is
  recorded or leaves the device.
- Nothing shipped from a downloaded list. The LDNOOBW lists were used as a recall checklist only;
  their Spanish file contains "martillo" and "fiesta". Every entry was checked against Tatoeba
  Spanish and Portuguese (441,690 and 444,028 sentences) and Don Quijote.
- `tests/calibration/multilang-filters-v1.json` is the two-sided corpus: 69 ACCEPT cases that
  must match, 49 REJECT cases that must not.

### Words that only looked rude
Measured against those corpora, entries we had already shipped were firing on ordinary words for
users we already have: `fute` on **futebol** (638 sentences), `molest` on **molestar** (614),
`futu` on **futuro** (515), `caca` on **caçar** (307), `pula` on **pular** (105), `curva` on a
bend in the road (96), `retard` on **retardar** (17, and that is the tier that hides the post),
`porn` on the Romanian **a porni**, and the leet fold turned the number **455** into "ass" in
every language. Each is fixed per term, with a test that fails if it returns.

### The cascade got faster while it got wider
218 microseconds a post, from 396, over 8,000 real posts, median of five runs.

### Video and image reading removed, because it did not work
Three optional, switched-off, paid-tier BETA capabilities are gone from the extension: reading
still frames from short videos, transcribing up to twenty seconds of the audio already inside a
video, and reading the pictures attached to a post. The image path returned nothing usable in
twenty of twenty-two attempts and about a third of the audio transcriptions failed. They were
never part of the paid plan and earned nothing. In exchange they forced the privacy policy and
the terms to name two additional United States processors, to explain that video frames and post
pictures could leave the device, and to carry a sentence about the device microphone that existed
only because the feature existed.

The order mattered and was followed: removed from the build first, then from the documents. A
privacy policy describes what the software CAN do, not what it does by default, and a
switched-off feature is still a capability.

Reading pictures and video is worth having and may come back. The owner's own reason for taking
it out now is in `STATE.md` in his words: the method worked in moments, it caught real issues,
and what failed was the architecture rather than the models, on a surface that had grown too
large to wire precisely across every layer.

**Removed**
- `src/content/video-context/` and `src/content/image-context/` in full, with the wiring, the
  vision violence floor, the media-understanding health summary and the eyes-exam grading
  harness.
- The `videoUnderstanding` and `imageUnderstanding` settings, their two popup toggles and their
  storage keys (settings schema v13 to v14 deletes them on first read).
- The dashboard's video-AI spend panel, the caption probe, the media Issues cards and the media
  budget markers.
- The Gemini and Whisper deadlines, usage weights and performance stages, and the Child
  media-capture consent fence, which had nothing left to fence.
- The proxy's `/v1/gemini` and `/v1/whisper` routes. `GEMINI_API_KEY` is no longer read.

**Kept, deliberately**
- The text path through Groq. That is the paid product and it is measured.
- `videoContext` and `imageContext` on records already written. They are signed history: an old
  export still opens, still displays them, and still verifies, and a legacy record hashes to
  exactly the value it did before this release
  (`tests/unit/legacy-media-record-verifies.test.ts`).
- The privacy policy's general statement that on the paid tier selected content passes through
  the proxy to a provider. That stays true for text.

### A softened post keeps the colour it had
On Facebook a rewritten or marked post could come back black on black, readable only by selecting
it: the platform keeps the readable colour on an inner span and the swap fell back to the card's
near-black. The post's own computed colour is now copied before the first swap. Found by the
owner on a real Page and live-verified by him the same evening.

### Documents
- Privacy policy and terms, English and Romanian: the Media Safety Signals and Image Safety
  Signals blocks, Google LLC and Groq Whisper as processors, and the microphone sentence.
- Pricing, how it works and the Receipts page, English and Romanian; the store listing copy, the
  CWS privacy-form answers, the data-flow map and the DPIA. Compliance gate 128 and M81 in the
  packaging checklist are closed by the removal rather than by an argument.
- What the removal does to cost and to the cap:
  `docs/marketing/COST-AFTER-MEDIA-REMOVAL-2026-09-04.md`.

---

## 2.4.0 – September 2026

The release where FeelingWise became two extensions. Off, the filter, is its own listing on
the Chrome Web Store now: the free switches and nothing else, no record, no AI, no service
worker. This one, the recorder, is named Receipts from this version: it keeps everything,
the switches included, and where both are installed it runs the page and Off stands down,
so no post is ever hidden twice or fought over.

Before this version went out, an update gate opened a real 2.3.0 profile on the new build
(`scripts/verify/update-gate.mjs`): every setting kept, every record identical, the chain
linking straight through the update, popup and dashboard opening clean. That is the one
promise an update to six installs has to keep, and it is now a script rather than a hope.

### The record
- No path deletes a record before it is archived. Until 2026-09-02 a rotation could lose
  the records it was meant to move.
- Recovery takes a whole folder at a time: every chain file on the disk is swept into one
  folder and read back, biggest first, including sealed backups.
- The export opens at a hundred thousand records: the feed is rendered in pages.
- The export's verifier no longer calls a seam a failure. A modified record fails its hash,
  a forged one its signature, per record; a restart under a key the file does not carry is
  named as such. One key per generation, every signing key described, and a per-key table.
- The update keeps the chain whole: the first record written after it links to the last
  record written before it.

### The feed
- Feed ads are hidden by the platform's own label on every platform, at the moment the
  post lands, including Facebook's drawn labels and its right-column sponsored panel.
  Instagram keeps the ad's box (the feed stops loading without it) with a one-line note.
- Hides land before the first paint: an inserted post is judged inside the mutation that
  inserts it.
- New switches, off by default: Hide Stories, Hide suggestions ("Suggested for you",
  "People you may know", "Who to follow"), Hide the right column, Hide Marketplace, Hide
  Groups. Block reels also takes the Reels tray and the Shorts shelf. Every one of them is
  found from something the platform cannot rename (its own routes, its landmark roles),
  never from a class name, and refuses to take the feed, two posts, or a place to type.
- The counts and action rows are found by shape, with the count chips hidden beside them.

### The judge
- The adult text judge was rebuilt against the providers' current guidance and measured
  before it shipped, on held-out items against a fixed key; the measurement, with its
  method, is on feelingwise.org/research. Child and Teen keep the previous judge.
- The judge is a measured instrument from now on: a change to its prompt, model, schema or
  cut ships only behind a new measurement of the same kind.

### The popup and the dashboard
- Your word, phrase and account rules are chips, saved as you type; each chip shows how
  many posts its rule hid.
- Every switch shows how many times it fired on this profile.
- An interface-language row: automatic, English, Romanian.
- The dashboard's Issues chart cuts its hour buckets on clock hours; an Instagram post no
  longer jumps when a modal scrolls.

### The service
- A full refund revokes the licence at once.
- The five beta keys, never activated, were revoked; the AI layer is not marketed as the
  product any more and its price is unchanged.

## Store "What's new" blurb (paste into the Chrome Web Store description)

What's new in 2.4.0

- FeelingWise is two extensions now. Off, the filter, is its own listing: the free switches
  and nothing else. This one is Receipts, the recorder: it keeps everything, and where both
  are installed it runs the page and Off stands down.
- No path deletes a record before it is archived, recovery reads a whole folder of old
  exports and backups at once, and an export opens at a hundred thousand records.
- The export's verifier names what it finds per record and per key instead of failing a
  whole file at a seam.
- Feed ads are hidden by the platform's own label on every platform, at the moment the post
  lands; hides now land before the first paint.
- New switches: Hide Stories, Hide suggestions, Hide the right column, Hide Marketplace,
  Hide Groups; Block reels also takes the Reels tray and the Shorts shelf.
- The adult text judge was rebuilt and measured before it shipped; the measurement is on
  feelingwise.org/research.
- Your rules are chips with a count each; every switch shows how many times it fired.
- Updating keeps every setting and every record, checked on a real 2.3.0 profile.

---

## 2.3.0 – August 2026

The release where the product started asking how often, and not only how bad. A severity
score reads one post at a time, and on the 2026-08-25 judged sample 95.8% of commercial
items sit below severity 4, so no severity line can see a campaign at all. The same record
holds one source that reached the reader on 33 separate days through the recommended feed,
recycling nine pieces of copy. That is only visible by counting, so the product counts now.

The rest of this release came from two things a test suite cannot do: reading a real export
column by column, and taking a screenshot of the dashboard on an ordinary day and asking
whether each panel had the data it was claiming. Most of what follows is a screen or a
record that said more than it knew.

**One thing this entry will not say.** Four of these campaigns landed in code with the test
suite green and nothing yet watched working in a real browser against a real feed. Where
that is true it is written on the item. A passing test proves the code does what the test
asked, in a world the code itself defines; it does not prove the platform still looks the
way we think it does.

### The picture on a post now reaches the reader that judges its words
- Text burned into an image had the swearing filter as its whole verdict authority. The
  same kind of text on a video already went to the AI judge. A shame attack or a scarcity
  hook written into a picture was scored on the vision severity alone unless it happened to
  contain a swear word. It now goes to the same judge the video path uses.
- The description of what is in a picture reached no judge at all. It went to the record and
  to a separate severity check, so a mild caption over a violent scene had no reader holding
  both. It is now given to the text judge as its own labelled section, kept apart from the
  surrounding conversation because the two mean opposite things: the heat around a post must
  not transfer to it, the post's own picture must.
- Both landed in code with tests. Neither has been watched working on a live feed. On images
  the judge still runs only when the image also carries text of its own; widening that costs
  a call per image post and has not been bought.

### Counting how often a source reaches you
- A source seen on 7 separate days, or one exact piece of copy seen 5 times, is now marked as
  repeat exposure. Both thresholds sit above the 95th percentile measured on every platform.
- It only ever marks. It never rewrites, never hides, never raises an existing flag, and only
  ever fires on a post that would otherwise have passed. At most one notice per source per
  day, which is the difference between firing on 10.2% of posts and 3.7%.
- Landed in code, not watched working live. Two known gaps are written down rather than
  hidden: a post answered from the cache is announced on its next fresh sighting instead, and
  two tabs open on the same site can each announce the same source once on the same day.

### Two defects a real browse found that no test could have
- The counter that measures whether a post's comments are present could never match TikTok,
  the one platform that demonstrably has them. The first live read showed 330 root posts
  across 9 surfaces on 4 platforms and not one match, which is the shape of a broken
  instrument rather than a fact about the platforms. Fixed by matching the second pointer a
  comment can carry.
- An image hidden because of the words written on it recorded that the pixels had decided.
  Found by reading that column in a real export. The record now names the gate that actually
  made the call.

### Screens that claimed more than the data behind them
- Selector health showed a green "OK" dot for Facebook, Instagram and TikTok on a day when
  those three had no counters at all, under a summary line saying no drift had been detected.
  Only Twitter had real counters. A platform confirmed only by the weaker heartbeat now says
  so in its own status instead of borrowing the strong one's colour.
- The memory panel announced "CLIMBING (+234 MB): whole-page memory keeps growing" from
  exactly two samples taken 30 seconds apart, the first of them a cold-start artifact. It now
  needs four samples before it will call anything a climb, and says there are too few
  otherwise.
- The performance panel told you to switch on a setting that was already on, on a build where
  every one of its writes was failing. It now tells those three cases apart, and the writes
  themselves were fixed: they were being attempted from the page's side of the wall, where
  the extension's own storage is correctly refused.
- A verdict called "combined" was described everywhere as two or more patterns found
  together. It is the opposite: it is what the judge returns when the concern it named
  matches no pattern we have. Five of the eight rows in "what follows what" were built on
  that bucket, and a hand-off is only readable between two named things. It is now labelled
  "no named pattern", kept out of those rows with its share disclosed, and can no longer
  raise the strongest chain caution on its own.
- 240 records whose real content was that the comments ignore the post's claim were being
  counted as failed topic classifications. Those verdicts now have their own axis and their
  own section, instead of being scored against a question they were not answering.

### Records that say who, where, and under what settings
- 23 of 200 recent records, 11.5%, carried no note of which protections were on at the moment
  they were written. Blocked items had that field hard-coded absent since it was introduced.
  They carry a real one now.
- A video or image that could not be judged was recorded with a blank author and no address,
  the one emission path that skipped the convention every other one follows.
- Where a post's address is genuinely not known, the record now leaves it blank rather than
  filling it in from whatever page was open at the time. On the video path that page can be a
  different post by then, and a confidently wrong address is worse than an empty one.
- New counters measure how often a post's own comments are actually present in the page when
  the post is read. Nothing you see changes; it is a floor, and it is documented as one,
  because a low number proves nothing on its own.

### Instagram identity
- A link inside a comment could sign the post with the commenter's name, and a card whose
  identity changed underneath the read could be recorded against the wrong post. Such a card
  is still protected, now under a local id with the author left unknown.
- Any single-segment address was treated as a username, so a page like /saved/ signed
  "saved" as a person. A name now has to be corroborated by the profile's own header, and an
  address we do not recognise resolves to unknown rather than to a name.
- Landed in code, not watched working live.

### Settings, PIN and what you are charged for
- The parent PIN is now stored as a salted, slow hash rather than a plain one, and an
  existing PIN is upgraded the next time it is entered correctly. If the record of failed
  attempts cannot be read, the PIN is refused instead of the delay being skipped.
- Setup shows a recovery phrase once, and there is a Change PIN row that asks for the current
  one. An install that predates phrases is given one after its next change.
- The usage figure in the popup counted text calls only, while the service also charges for
  pictures and for audio by the second. It showed room while calls were already being
  refused. Both sides now count the same thing.
- Changing the mode, or a language setting, or moving to another page mid-scroll left the
  work already queued running: it was still paid for, its answers thrown away unrecorded, and
  in child mode the new page's covers waited behind it. That work is now cancelled and
  recorded as cancelled, and a covered post still on screen is re-checked first.
- The score that weights a repeat offender was always zero. The lookup ran on the page's side
  of the wall, where the extension's own store is not visible, so it always found nothing and
  every site visited was left holding an empty database carrying the extension's name. The
  lookup moved, and every private store is now refused from that side.

### Licences
- A revoked key could come back to life, because the record's status was the only authority
  and an ordinary usage write could put the old one back. A revocation is now recorded
  separately and refuses the key whatever the record says.
- A subscription that lapsed after a failed payment kept working indefinitely, and a
  cancellation cut access off immediately although it was paid to the end of the period.
  Both follow one table now: cancelled keeps access until the paid period ends, lapsed and
  paused stop at once, and resuming restores.

---

## Store "What's new" blurb (paste into the Chrome Web Store description)

What's new in 2.3.0

- A post's picture now reaches the reader that judges its words. Text written into an image
  goes to the same judge that already read it on video, and what is in the picture is given
  to the text judge instead of being kept aside.
- The extension now counts how often one source reaches you, not only how bad a single post
  is. 95.8% of advertising sits below the severity line, so counting is the only way a
  campaign is visible at all. A source seen on 7 separate days, or one advert seen 5 times,
  is marked as repeat exposure. Marked only: never rewritten, never hidden.
- Dashboard panels stopped claiming more than their data. A green "no drift" light on three
  platforms whose counters were empty, a "memory keeps growing" alarm read off two samples,
  and a "combined" bucket that five of the eight narrative rows were built on.
- Records say who wrote a post and which protections were on. 23 of 200 recent records
  carried no settings note, and blocked or unjudged items went in blank.
- On Instagram, a name taken from a comment could be signed to the post. A name now has to be
  corroborated, or it stays unknown.
- The parent PIN is stored salted, with a recovery phrase and a Change PIN row, and the usage
  figure in the popup counts what the service actually charges for, pictures and audio
  included.

---

## 2.2.0 – August 2026

The release where the product stopped calling advertisements harmful. A reader outside
the project went through a real 5,365-record export line by line and found that a third
of the "high severity" bar was ads. That was true, and it was true in more places than
the export. The rest of this release is the dashboard reviewer's complaints, answered.

### Advertisements are no longer counted, ranked or shown as harm
- A blocked ad carries the top severity score. That number records that a fixed rule
  matched exactly, not that anything was harmful, and three separate screens were reading
  it as a severity.
- The export counted them in the flagged total. On the 2026-08-22 chain it read 307
  flagged and 202 high-severity, where the safety numbers were 243 and 138. Ads now have
  their own count, alongside the flags rather than inside them.
- Sorting the activity feed by "worst first" put a wall of advertisements on top. Twenty
  five of them sat above the first real finding. Ads no longer rank as harm.
- A blocked row printed "10/10" beside the ad. It now names the rule that caught it: the
  platform's ad marker, a blocklist hashtag, an AI-generated-content label, the reels
  surface, or a media timeout.

### The export says what it actually measures
- It advertised a single flag gate of "severity 6 or higher". That is the comment path.
  Posts are judged against a floor that changes per pattern and per mode, from 4 to 8,
  which is why 37 of 206 flags sat below 6 and looked like a contradiction. Both gates
  are now stated, with the whole table printed.
- A flag that reads as a combination of patterns now carries the model's own reason for
  it. That verdict is the most common one in the product and it named nothing until now.
- Blocked ads are recorded with the account label and their real position in the scroll,
  like every other item. Without those they were the only records the export had to place
  by when they finished writing rather than when they were seen.

### Screens that repeated themselves or moved
- The popup gave equal weight to the number a parent opens it for and to a count of API
  requests, which reads 0 on most days. It leads with one figure now.
- The dashboard overview opened with a sentence carrying six numbers and then six tiles,
  five of which repeated a number from that sentence.
- The header and the tab bar sat in a different place on the activity tab than on every
  other tab, so the logo and the buttons jumped as you clicked between them.

### Health reporting that cried wolf
- Three alarms on a day when nothing was wrong, each an instrument fault rather than a
  fault in the product. A permanent authentication failure was being described as
  something that resolves on its own, among others.

### Licences
- A licence can now carry a real end date, so a two-week key stops working on its own
  instead of relying on someone remembering to revoke it.

---

## Store "What's new" blurb (paste into the Chrome Web Store description)

**What's new in 2.2.0**
- Advertisements stop being counted as harm. A blocked ad carried the top severity score,
  which really recorded that a rule matched exactly. Ads now have their own count, they no
  longer sit at the top of "worst first", and they say which rule caught them.
- Flags say more. A flag that reads as a combination of patterns now carries the model's
  own reason for it.
- The export states the gate it actually runs, per pattern and per mode, instead of one
  number that was true of only half the product.
- The popup and the dashboard lead with one figure instead of repeating the same numbers
  in two places, and the header stops moving when you change tabs.
- Health reporting stops raising alarms on days when nothing is wrong.
- Trial licences can expire on their own.

---

## 2.1.0 – August 2026

The update to the 2.0.0 that has been on the store since 2 August. It started when I
turned a protection off and watched it keep working anyway. The modes had been written as
live rules that overruled your switches, instead of as starting points you are free to
change. Fixing that opened a long sweep through every screen, asking one question of each
sentence: does this say what the product actually just did. Most of this release is that
answer, and there is a lot of it.

### Fewer things hidden that should not have been
- The filter that catches dehumanizing language was hiding ordinary talk about pest
  control, and everyday insults between friends. It stops doing both.
- One harm category was quietly adding a fixed score to every post it touched, which
  pushed borderline posts over the line. That is gone.
- A post can no longer talk the rewriter into doing something else. The text of a post is
  fenced off from the instructions.

### Your switches decide, the mode is only a starting point
- Child, teen and adult are presets. They set your switches when you pick one, and after
  that your switches decide.
- Turning a protection off turns it off, including the protections that cost money to run.
- The popup is one line per setting with a fold for the detail, and the paid rows stay out
  of the way until a license is active.
- Leaving child mode always asks for the PIN, and the popup says whether protection is
  standard or something you changed, with a way back.
- Quiet hours and the media timeout can follow a schedule, and your own switch still wins
  over the schedule.
- You can choose to hide a flagged post outright when a rewrite is not possible, and
  choose whether a hidden post can be revealed.

### Screens that say what actually happened
- Counters, banners and tooltips were rewritten wherever they described something the
  product had not done. The popup tile that counted actions was labeled as rewrites. A
  tooltip promised a dashboard filter that did not exist. Statistics showed totals over a
  base that did not match them.
- Ten overlapping hides on one post were being counted as one, so the number you were
  shown was smaller than the work actually done.
- The day figure, the masking of slurs in the record, and the window used to compare one
  period against another all had errors, including one that appeared only around a clock
  change.
- The feed view no longer states a total it has not finished loading.
- An empty result now says whether nothing was found or nothing could be checked.
- Every record states which protections were on at the moment it was made, and the Issues
  tab names the build its numbers came from.
- A post or a video that could not be judged says so in the record instead of passing
  quietly.
- A locked switch looks held rather than faded, so you can tell locked from unavailable.

### Your records, and getting them back
- Backups are sealed where they sit, and old ones are cleared on a schedule instead of
  piling up.
- Clearing the record now asks for the parent PIN, and asks for it at the point where the
  clearing actually happens.
- The backup page stops calling every copy a copy you keep. It names the one that survives
  the extension being removed or reinstalled, and steers you to it.
- A backup is saved when the copy finishes, not when it starts.
- When a restore fails, the message says what failed in your own language, and points at
  your other install when the records are still sitting there.
- Backup health stops showing green when the automatic copy is the only one.
- You can export everything, not only a single month, and the export carries a signed
  marker where older records were pruned, so a gap is visible rather than silent.
- Search across your records, and quicker clicking and scrolling in the dashboard.
- The feed band stays centered on very wide screens.

### Cost and license control
- One master switch stops every AI call at once.
- The paid rewriting is owned by the switches that ask for it, so nothing spends in the
  background.
- When a monthly cap or a service fault stops a request, the reason is shown rather than
  the request just failing.
- A license change reaches the screens you already have open, and the License tab tells the
  truth about revoked and invalid keys.
- The price is 6 EUR per family per month, or 60 for a year.

### Platforms
- X: ads that are only an image or a video are hidden and recorded. A post that was hidden
  stays hidden instead of being detached and put back forever. The notice sits where the
  hidden post was, and a reveal belongs to that post rather than to a slot the page reuses.
- Facebook: every reel produces its own record, not just the first. A comment carries a
  working link back to itself, and a block of comments that fails to load says so instead
  of going quiet.
- Instagram: a hidden ad keeps its place in the feed instead of collapsing it, the plain Ad
  badge and the AI creator label are matched, and comments keep their identity while the
  page loads more of them.
- TikTok: comments keep their identity while the page loads more of them.
- YouTube: the subscriber count on a video page is hidden.
- Blocking ads works on the adult setting too.
- Hidden items stay hidden while the feed reloads itself.
- Pictures keep their verdict when the page redraws them, which stops the same picture
  being recorded twice and paid for twice.
- When a batch of comments was checked and the reply came back cut off, all of them used to
  be thrown away. The ones that came back complete are now kept, and only the cut one is
  left unchecked.

### Reaching it without a mouse
- The PIN boxes are labeled for a screen reader, and the record list can be worked through
  with the keyboard.

### Romanian
- Correct diacritics through the checking cover, the records, the export and the verifier,
  and counts that follow the Romanian rule for numbers.

### What it is called now
- The extension is listed as "FeelingWise - Social Feed Filter for Families", so a parent
  searching the store for what this does can find it. The old name said what the records
  were, which only helps someone who already knew about it.

---

## Store "What's new" blurb (paste into the Chrome Web Store description)

**What's new in 2.1.0**
- Fewer wrong hides: the dehumanizing-language filter stops catching pest control and
  everyday insults, and one category that inflated every score it touched is fixed.
- Modes are starting points now. Turning a protection off turns it off, and your switches
  decide from there.
- A sweep through every screen so counters, banners and tooltips say what the product
  actually did, including a count that was ten times too low.
- Backups are sealed and rotate on a schedule, clearing the record asks for the PIN, and a
  failed restore says what failed in plain words.
- Export everything, search across your records, and a signed marker where older records
  were pruned.
- One master switch stops every AI call, and the paid rewriting only runs from the switches
  that ask for it.
- Steadier hiding on X, Facebook, Instagram, TikTok and YouTube while the feed reloads
  itself.
- Correct Romanian throughout, and the PIN boxes and record list now work with a keyboard.
- New name: FeelingWise - Social Feed Filter for Families.

---

## 2.0.0 – August 2026 (published 2 August 2026)

This is the version that has been live on the store. Recorded here after the fact: the
changelog skipped it at the time, and a release nobody wrote down is a release nobody can
check.

### A dashboard you can steer
- Activity leads, and it opens on the flagged posts.
- A visible control switches the feed between the order you saw it in and worst first.
- A filter rail with grouped chips, a line telling you what you are looking at, and a short
  explanation behind each control.
- Issues can be cleared and acknowledged.
- The forensics view shows where each record came from and names the platform that came up
  worst.

### Steadier, and lighter
- Two confirmed memory leaks are bounded, and the memory readout stops calling something a
  leak when it cannot tell what caused it.
- A stuck checking cover can no longer leave the feed looking empty.
- Facebook and Instagram posts carry a verified page author, so filtering by page works.
- A paid license no longer reads as free when a storage read comes back empty.

### Child mode
- Child mode turns image and video capture off and keeps it off.

---

## 1.6.0 — July 2026

The first update since the 1.5.1 store release (published 3 July 2026). The
headline is a rebuilt records dashboard, more exact and more honest protection,
a stronger evidence export, and a full Romanian pass.

### A clearer records dashboard
- New Overview home tab that sums up the day at a glance.
- A Feed behavior view with five levels of what the feed was doing, now inside
  the Patterns tab.
- Refreshed charts on the Statistics and Exposure tabs, easier to read in light
  and dark.
- The Forensics tab can verify records from earlier months, and shows which
  accounts came up most often and whether they grew harsher over time.
- Counts are stated more honestly: clear totals, no extra content stored to
  produce them, and repeat-offender counts kept per platform.
- Dashboard copy reads for any reader, not only for children.

### More exact, more honest protection
- Coded slurs and harmful wording on posts are now caught by a fixed rule, with
  no AI call needed.
- A post or comment that was hidden is always recorded as hidden, never
  mislabeled as allowed.
- Verdicts stay put when you scroll away and back, so the same item does not
  flip or get re-checked for no reason.
- When you tighten the language setting, earlier allowed items are checked
  again.

### Steadier coverage across platforms
- TikTok: sponsored posts are matched by exact markers, ads stay hidden through
  the feed's reloads, and For You videos keep a stable identity.
- X (Twitter): fixed rare cases where a reused post could be mislabeled, and
  thread links are more reliable.
- Facebook and Instagram: in-feed videos and images stay tied to their post, and
  sponsored posts are matched by their exact badge.
- YouTube: smoother hiding of engagement counts.

### Private messages stay private
- Direct messages and inboxes are now skipped on every scan path, across X,
  Facebook, Instagram, and TikTok. FeelingWise only ever looks at public feed
  surfaces.

### A stronger evidence export
- The exported HTML report now includes the Feed behavior section (five levels,
  with the same reader views as the dashboard).
- Records are written with signed, checkable links, delivered reliably, and
  rotate cleanly at month boundaries.
- Real Romanian text throughout the export for Romanian installs.
- Removed a leftover payment prompt that could still appear in the export.

### Full Romanian
- Romanian installs now see Romanian everywhere, including the on-feed checking
  cover and the exported report. Diacritics are correct throughout.

### Faster and safer under the hood
- Lighter background work while you scroll, quicker settings reads, and a safe
  start that keeps the feed covered even if a storage read fails.
- On the paid layer, stricter limits and cost checks run before any AI request,
  so usage stays predictable.

### Clearer license status
- The License tab now tells the truth about revoked or invalid keys, and asks
  before a mode change clears your toggles.

---

## Store "What's new" blurb (paste into the Chrome Web Store description)

**What's new in 1.6.0**
- Rebuilt records dashboard with a new Overview tab and a five-level Feed
  behavior view.
- More exact protection: coded harmful wording is caught deterministically, and
  hidden items are always recorded honestly.
- Steadier coverage on TikTok, X, Facebook, Instagram, and YouTube.
- Private messages are skipped on every path.
- The evidence export now includes the Feed behavior section.
- Full Romanian, including the on-feed cover and the export.

---

## 1.5.1 — July 2026 (previous store release)

Baseline for this changelog. Published 3 July 2026.
