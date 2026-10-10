# How a Receipts record is made, and what it can and cannot show

Written 14 September 2026 for a reader who has an export in front of them and wants to know
how much weight it bears: a researcher, a lawyer, a journalist, a second implementer. Method
only. No number from any one person's record is in this document; the measurements the project
has published carry their own method where they are published. Every claim here is either
visible in an export or checkable in the code (`src/forensics/`, `verifier/`).

## 1. What is recorded

Receipts is a Chrome extension. When a feed on X, Facebook, Instagram, TikTok or YouTube shows
an item on a desktop screen, the extension reads that item from the page and writes one record.
A record holds:

- the text as it was displayed, verbatim, and its length;
- who posted it, as the page shows the name or handle;
- which platform and which surface: the main feed, a profile opened, a permalink, a search;
- when the recorder saw it, by the computer's clock, and when it entered the viewport;
- what kind of item it is: a post, a comment, a reply, a video's caption, the top comment shown
  under a video;
- whether the platform marked it as paid;
- what, if anything, the extension did about it, and why (section 5).

What is not recorded: images and video themselves (the caption is), anything on a private
message surface (those pages are excluded in the extension's manifest), and anything the person
typed. The record is of what was shown, not of what was done.

Two things a reader should know about the reading itself. The text is what the page rendered,
which on some platforms is a truncated view with a "more" control; the record says which
(`textCapture`: whole, or truncated). And the order of records is the order the recorder saw
items, which is close to but not the same as the order the platform served them; the record
carries its own sequence numbers and does not claim the platform's.

## 2. How a record is protected

Each record is turned into a fixed text form (the canonical payload: the evidence fields in a
fixed order, nothing else) and hashed with SHA-256. The hash is written on the record as its
`integrityHash`. Change one character of the text, the author, the time or the position and the
hash no longer matches.

Each record also carries the hash of the record before it (`prevRecordHash`) and its position
in the chain (`chainPosition`, counting from zero). Both are inside the hash. So the records
form a chain: removing one, inserting one or reordering two breaks the link on the next record,
and the checker reports which position broke.

Each hash is signed with ECDSA on the P-256 curve, with a key pair the extension generated on
the person's computer the first time it ran. The private half never leaves the computer's
browser storage; the public half is embedded in every export, with a fingerprint (the first 16
hex characters of SHA-256 over the key's two coordinates). A signature ties a record to that key
and to nothing else.

The chain can change shape in ordinary use: a new month's store, a reset, records deleted
under a size cap, a hole where capture failed, an import from an older export, a repair, a
record withheld at the person's request, a comparison against the platform's own export (saved
before the dashboard stopped offering one; see section 7). Each
of these is written to the chain as a marker record, signed like any other, saying in plain
words what happened and pointing at the record it concerns. A gap is therefore a stated gap; a
silent one is what the checker would report as a break.

## 3. Independent time

The computer's clock is the person's own and proves nothing. Every six hours while Chrome is
running, the extension sends the hash of the chain head to two of three public time-stamping
authorities (FreeTSA, DigiCert, Sectigo; RFC 3161; FreeTSA names no operator or country), keeps whatever
answered, and stores each signed token beside the chain; a head already covered is not sent
again. Where a paid install's direct route is blocked, the request goes through the project's own
relay, which then sees the hash and the sender's address (the privacy page says so). The token says: this hash
existed at this time, on a clock that is not the person's. A token over a later head also covers
every earlier record, because each head hashes the one before. The signing key itself is
time-stamped once, on the first of those runs after it was created. An export carries every token it has; page one lists them
with the authority's name and the position each one covers. A record made with version 2.5.14 or
earlier can also carry a token from CESNET (Czech Republic), a fourth authority the extension
stopped asking because CESNET says its service is meant for research and education institutions;
the checker still recognises its certificate.

What a token establishes: the records up to that position existed no later than that time. What
it does not establish: that they existed no earlier, or who made them.

## 4. What the export is, and what the check does

An export is one HTML file. Inside it is one JSON element holding the records, the public key,
the time-stamp tokens and the file's own statements about itself, and a manifest signed over all
of it. The page around it is a reader: it opens on what the feed showed, then the numbers per
platform, then the list, then the checker's own rows.

The check runs in the reader's browser, with no server, and recomputes: the fingerprint of the
embedded key; every record's hash from its own fields; every link to the record before; every
signature under the embedded key; the manifest over the envelope, including a digest of the
sentences the page renders, so the wording cannot be edited without notice. It reports VERIFIED
when everything recomputes and the signed manifest matches, and VERIFIED as a report of N of M
records when the file is a selection that states, under its signature, how many records it left
out. It reports PARTIALLY VERIFIED when a record is unsigned or signed by a key the file does not
carry, when the file has no signed manifest (older files), when a time stamp names a record the
file does not hold, or when records were set aside or the chain restarted; and a named failure
otherwise, at the position it found it (tests/gates/the-report-word.test.ts). A report the product writes carries only the time stamps over records it holds, so a selection that accounts for what it left out reads VERIFIED as a report (src/forensics/exporter.ts; tests/unit/forensics/a-report-carries-only-the-stamps-over-its-records.test.ts).

The same check exists apart from the file: a public checker
(`github.com/kiraclopotel/receipts-verifier`, Apache-2.0) with test vectors, and the record
format written for a second implementer in its `FORMAT.md`. A reader who does not trust the
page can run the checker over the file's JSON.

What the check establishes: these records were signed by the key in this file, in this order,
and none was changed after signing; the time-stamp tokens cover the heads they name. What it
does not establish, and page one of every export says so: who holds the key, that the file is
complete, that the content came from the platform it names, or that a person was looking at the
screen when an item was recorded (section 6).

## 5. Why the extension acted, when it did

Most records are passes: an item was shown and nothing was done. Some carry a decision. A
decision comes from one of three sources, and the record names which:

- **A rule.** A fixed pattern with no model behind it: the platform's own paid label, a word
  or account on the person's own list, a slur list, a small dehumanisation grammar, a
  self-harm phrase list. A rule reads no meaning. Being an advertisement is a category, not a
  judgement; a word on the person's list is the person's rule, not a finding. The export counts
  these apart from everything else and says so.
- **A model.** With the paid reading on, the text is sent through the relay to a language model
  with a fixed instruction, and the model returns a structured reading: whether the item is
  charged, of what family, at what severity, with what likely effect and intent. The
  instruction, the model identifier and the thresholds are printed in the export's methodology
  block, and every record carries the model that actually read it.
- **A person.** The person marked the item by hand in the dashboard. No detector ran.

A model's reading is an interpretation, not a fact about the item. Its accuracy is measured per
model, per instruction and per corpus, and published with the method and the sample; an export
does not stamp a number on itself, because the number belongs to the instrument that produced
it, and the record shows which instrument that was. A reader who wants the number goes to the
published measurement for that model and reads its method first.

## 6. What the numbers on page one mean

The export computes, in the reader's browser, from the records in the file:

- impressions (records), unique posts, and items seen before within the file;
- paid placements by the platform's own label, items hidden by the person's own rules, items
  the model named;
- the share flagged, split by source (rule, model, person), with a confidence interval that
  describes the sample in the file and nothing beyond it;
- stretches served with nobody scrolling: runs of records arriving at even intervals with no
  burst between them, which is what a tab left open produces and a person reading does not.
  Those are counted as served, never as seen.

Every one of these is a count over what the file holds. A report is a selection and says so.
The whole-record file carries the counts over everything the install still holds.

## 7. What can be compared against the platform's own copy

Nothing, today. The dashboard used to take the platform's own export of the account (the
"download your information" archive), read it on the computer, keep nothing from it, and write a
marker with a fingerprint and how many of the record's entries the platform's copy supported.

On 6 October 2026 that comparison was measured on one real Facebook export against the whole
record of the same account, by a counts-only measurement kept with the private research scripts
(reconcile-on-archive). 186 of 24,437 feed entries matched. 162 files outside the export's viewing
log passed the shape test and added the account's own activity as sightings, back to 2015, so the
comparison would have signed 1,238 things the platform listed and the record did not hold, about
half of them from files that are not a feed list. The viewing log itself named a few hundred items
over months in which the record held tens of thousands, so its "not mentioned" count described the
platform's partial list and not the record. The dashboard stopped offering the comparison. A record that already carries one
keeps it, and every export prints it as before.

## 8. Limits, in one place

- The record is of what was displayed on one computer, in one browser, to one account. It is
  not the feed as the platform holds it, and it is not what a different account would see.
- The extension can miss items: a page that renders differently than expected, a video card
  with no caption, an item that scrolled away before it was read. Misses leave no record and are
  not counted; the record does not claim completeness, and its heartbeat markers only say the
  recorder was running.
- A model's reading can be wrong in both directions, and is, at rates that are measured and
  published per model. A rule can match a word used innocently.
- In Adult mode, the automatic reading of comments asks the model to judge them for a
  13-17-year-old, as Teen mode does (`src/ai/prompts-v2.ts`), and flags a comment at the same
  severity line as every other mode (`src/core/severity-floor.ts`). An adult post, and any post
  or comment picked with the Read this for me button, goes instead to Adult mode's own reader,
  whose instruction is written for an adult (`src/ai/prompts.ts`).
- The signing key proves continuity, not identity. The name on page one is a name the person
  chose, marked as such. The machine row is what the browser reports about itself.
- Time inside a record is the computer's clock. Only the time-stamp tokens are independent, and
  they bound the time from one side only.
- The reader script is part of the file and is covered by the manifest, but a reader who
  distrusts it should run the public checker instead. That is what it is for.

## 9. Where the parts are

| Part | Where |
|---|---|
| Record shape and canonical payload | `verifier/FORMAT.md`; `src/forensics/canonical-payload.ts` |
| Chain, signing, markers | `src/forensics/logger.ts`, `signing.ts`, `chain-integrity.ts` |
| Time-stamp tokens | `src/forensics/chain-anchor*.ts` |
| Export and reader | `src/forensics/exporter.ts`, `html-export.ts`, `export-numbers.ts` |
| The public checker | `verifier/`, generated from `src/forensics/verifier-core-source.ts` |
| Rules | `src/core/profanity-filter.ts`, `dehumanization-filter.ts`, `coded-harm-catcher.ts`, `parent-blocklist.ts` |
| The model's instruction and thresholds | `src/forensics/methodology.ts`, printed in every export |
| Comparison against the platform's export (withdrawn; saved ones still print) | `src/forensics/reconcile*.ts` |
