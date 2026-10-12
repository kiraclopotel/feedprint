# FeelingWise

Two Chrome extensions, built from one tree, for X, Facebook, Instagram, TikTok and YouTube on a
desktop. Never on private messages.

- **Off** switches things off. Hide counts and action buttons, block Reels and Shorts, strip
  emoji, block feed ads by the platform's own label, a word filter, quiet hours. Fixed rules, no
  AI, no record, free.
- **Feedprint** (called Receipts until October 2026) writes things down. Every item a feed shows
  you is written to a record on your own computer: the text as displayed, who posted it, where,
  when, in the order the recorder saw it. Each record is hashed, linked to the one before it and
  signed with a key made on your computer. The record never leaves the computer unless you export
  it. Free.

The record is the product. The optional AI reading of post and comment text is a paid layer on
top of Feedprint and is not needed for the record.

## What a Feedprint export is

One HTML file. It opens in any browser, offline, and checks itself: every hash, every link in
the chain and every signature, against the public key inside the file. It opens on what the feed
showed, one sentence for the current selection, then a table per platform, then the list. The
same check runs apart from the file at [feelingwise.org/check](https://feelingwise.org/check), and
the checker is public: [kiraclopotel/receipts-verifier](https://github.com/kiraclopotel/receipts-verifier),
with the record format written for a second implementer in `FORMAT.md` there.

What the check establishes: the records in the file are the ones that were signed, in the order
they were made, and none was altered afterwards. What it does not establish: who holds the key,
that the file is complete, or that the content came from the platform it names. Page one of every
export says this in the same words.

The method is in [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).

## What it is, in questions

The questions people ask about Feedprint, with the answers under them, in plain words. The same
answers are on the site at [feelingwise.org/what-it-is](https://feelingwise.org/what-it-is).

### What is it?

A signed record of what social media showed you, that anyone can check later.

### What does that actually mean?

It watches what the feed puts in front of you and writes it down as it appears. Later you can hand
someone one file and they can prove for themselves that nothing in it was changed after the fact.

### Why would anyone need that?

Because right now, if a platform shows you something and you complain about it, you have a
screenshot, and a screenshot proves nothing. Anyone can make one in a text editor.

### What exactly does it write down?

For each item: the text as it was displayed and how long it was, who posted it as the page showed
it, which platform and which part of it (the feed, a profile you opened, a permalink, a search),
when your own computer saw it, what kind of thing it was, and whether the platform labelled it
paid.

### What does it refuse to write down?

Images and video themselves. Private messages. Anything you type.

### Why can it not be faked afterwards?

Three things stacked. Every record is fingerprinted. Every record carries the fingerprint of the
one before it and its place in the line, so removing or reordering one breaks the chain visibly.
And the whole thing is signed with a key made on your own computer, which never leaves it.

### How do you prove when it happened, and not just what?

Every six hours, while Chrome is running, the end of the chain is sent to an independent
timestamping authority, and the receipt is kept beside it. Two are picked from three: FreeTSA,
DigiCert and Sectigo. FreeTSA does not say who runs it or where.

### What does that timestamp actually prove?

That the record existed no later than that moment. **Not** that it existed no earlier, and **not**
who made it.

### What does a stranger do with the file?

Opens it in a browser. No server, no account, no install, nothing to trust. They get one of three
answers: verified, partially verified, or broken.

### Which platforms, honestly?

X, Facebook, Instagram, TikTok and YouTube, on desktop Chrome only. And the honest version: X and Facebook feeds are recorded and have been checked live.
YouTube's home, subscriptions and trending pages, and TikTok's For You with its captions, are
recorded by the code since 17 September 2026 and have not yet been checked live; until then, count
on YouTube's channel posts and watched videos, and on TikTok's videos without their captions.

### Is there AI in it?

There is an optional part that reads text. When it reads an item, its reading goes into that item's
signed record as a model's reading, with the model named. The record itself needs no model at all:
what makes it trustworthy is arithmetic, not a model's opinion.

### How many people use it?

The store pages show the count, and they are the only place worth quoting it from:
[Feedprint](https://chromewebstore.google.com/detail/feelingwise/mcdanhgfcpjpajlmjcdfeaeanlkodifp)
and [Off](https://chromewebstore.google.com/detail/off-social-feed-filter-by/kebfpnjiiiboofdjhomcbgphfnlbahmh)
on the Chrome Web Store.

### What makes it different from the tools that already exist?

Several products sell a signed, timestamped capture of a page someone chose to keep. This records
the feed as it arrives, every item, before anyone knows what will matter, so it can show
proportion, change over time, what stopped appearing, and order. And a stranger checks the file
with no account and no server.

### Who is it for?

Anyone who may one day need to show what they were shown and be believed: someone in a dispute,
someone documenting a pattern, a researcher, a lawyer's client.

### The four sentences, if you only remember four

1. It writes down what the feed showed you, as it showed it.
2. It signs and chains every entry, so a change is visible.
3. An independent authority stamps the time, every six hours.
4. A stranger opens one file in a browser and checks it without trusting you.

## Install

Chrome Web Store: [Feedprint](https://chromewebstore.google.com/detail/feelingwise/mcdanhgfcpjpajlmjcdfeaeanlkodifp)
and [Off](https://feelingwise.org/off). The site is [feelingwise.org](https://feelingwise.org).

## For developers

```bash
npm install
npm run build       # Feedprint, into dist/
npm run build:off   # Off, into dist-off/
npm run test        # vitest
```

Load `dist/` or `dist-off/` in Chrome through `chrome://extensions`, Developer mode, Load unpacked.

Running `npm run build:firefox` makes `dist-firefox/` (Feedprint) and `npm run build:off-firefox`
makes `dist-off-firefox/` (Off). Each folder contains the Chrome build's files with a Firefox
manifest and names, and every other file is copied byte for byte. You can load one of these folders
in Firefox 140 or later. Open `about:debugging`, click This Firefox, click Load Temporary Add-on,
and select any file inside the folder, such as its `manifest.json`, and the add-on stays installed
until you remove it or restart Firefox. The reproducible build takes the flag
`--product receipts-firefox` or `--product off-firefox`.

The store builds are reproducible. Every zip uploaded to the Chrome Web Store is listed in
[`docs/spec/RELEASES.tsv`](docs/spec/RELEASES.tsv) with the commit it was built from, the Node
version and its SHA-256. A public copy of this source is taken at an upload, and its
`SOURCE-COMMIT` file names the commit. With the Node version in `.nvmrc` and `npm ci`:

```bash
node scripts/reproducible-build.mjs --expect-release
```

rebuilds each extension this source was uploaded as and says MATCH or MISMATCH against its row,
for the files and for the zip. The same command runs on every change to the public repository
(`.github/workflows/ci.yml`), on Windows, the one system the match has been checked on so far.

That list is our own record: the store does not hand out the zip we uploaded. The copy Chrome
installed from the store is something you can check without it. Chrome keeps, beside that copy, a
list of the hash of every file the store served, signed with the store's key, which Chromium
publishes. In `chrome://extensions` check the version you have, then find the folder:
`Extensions/<extension id>/<version>_0` inside your Chrome profile (on Windows
`%LOCALAPPDATA%\Google\Chrome\User Data\Default`, on macOS
`~/Library/Application Support/Google/Chrome/Default`, on Linux `~/.config/google-chrome/Default`;
`chrome://version` shows the profile path). The extension id is the last part of the store
address. From the source of that version:

```bash
node scripts/reproducible-build.mjs --product receipts --verify-installed "<that folder>"
```

checks the store's signature, then compares every built file with the hash the store signed. The
store edits `manifest.json` before it signs it, so that one file is compared with the installed
copy as data, allowing only the fields the store adds: the extension's public `key`, which must
give that extension's id, `update_url`, and, on a copy that arrived as a differential update,
`differential_fingerprint`. Installing Feedprint to check it also starts it recording the feeds
you open.

Where things are: `src/forensics/` is the record (chain, signing, archives, export, backup);
`src/content/` reads the five platforms; `src/core/`, `src/ai/` and `src/analysis/` are the
optional reading; `src/ui/` is the popup and the dashboard; `verifier/` is the public checker,
generated from `src/forensics/verifier-core-source.ts`; the relay the paid reading goes through
lives in `worker/`, which stays out of the public copy of this tree. The code map is
[`docs/spec/README.md`](docs/spec/README.md); the open defects are in `known-issues.md` (private).

## Privacy

Off asks for the storage permission and for access to the five sites it works on, nothing else.
Feedprint keeps the record in the browser's own database on your computer. Every few hours it asks
public timestamping services to sign a 64-character fingerprint of the record chain, which cannot
be turned back into the records; no post, name or setting goes with it. With the paid reading on,
the text of posts and comments passes through the relay at `api.feelingwise.org` to the model that
reads it, together with the counts shown beside it and, since 2.5.15, a label such as @user_A in
place of the @handle that wrote each one, the same label for the same account within one reading,
so the reading can tell one speaker from another; the real handles stay in the browser and go back
into the reason and the softened wording shown; names, links and anything written inside a post go
as written; the relay is built not to keep content. Diagnostics you
paste to support carry counts, dates and settings: no post text, and no account handle in any form.
Private-message surfaces are excluded in the manifest.

## Who writes this

The code, the tests, the documentation, the site and the measurements are written by Claude, an AI
model made by Anthropic, under the direction of the copyright holder, who decides what is built,
tests it on his own feeds, uploads it and pays for it. The commit history of the private
repository records the model on each commit as a trailer (`Co-Authored-By: Claude <model>`):
on 17 September 2026, 1,335 of the 1,706 commits since the repository's 10 July 2026 re-root
carried one (Claude Opus 5, Claude Fable 5, Claude Fable 5.1, Claude Opus 4.8), 371 carried none,
and none carried a prompt. This public copy is a fresh repository taken at an upload's commit
(the `SOURCE-COMMIT` file names it), so it carries the source and not that history; the history
before 10 July is in neither. Nothing here asks to be taken on trust: the record format and the
checker are public, and the build is reproducible byte for byte.

## License

The recorder and the filter, everything this tree builds, are GNU Affero General Public License
v3.0 or later (`LICENSE`, the licence text with the copyright line; the notes that go with it,
on the names, the checker's licence and authorship, are `LICENSE-NOTES.md`). The checker and the record format in `verifier/` are Apache License
2.0 (`verifier/LICENSE`), so a second implementer inherits no copyleft from the specification.
The names FeelingWise, Feedprint, Receipts and Off and the marks are not licensed; a fork must use
its own name. The relay at `api.feelingwise.org`, the licence counter behind the paid reading, and the
owner's own records are not in this tree. Contact `support@feelingwise.org`.
