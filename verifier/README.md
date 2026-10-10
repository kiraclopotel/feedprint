# verify-export: a checker for Feedprint exports

Feedprint (formerly Receipts) is a Chrome extension that keeps, on the user's own computer, a signed
and hash-linked record of the public posts a social feed showed them. It
exports that record as one HTML file that carries its own checker. This folder
holds the same checker as a separate program, so a reader can obtain it from a
place they chose instead of trusting the script inside the file they were
handed.

## Run it

Two ways, the same checks.

**In a browser.** Open `index.html` from this folder (double-click it; it works
from a local file with the network off) and choose or drop the export file. The
page loads `verify-export.browser.js` beside it and nothing else, and makes no
network request.

**From the command line.** Needs Node 20 or later. No installation, no
dependencies, no network.

```
node verify-export.mjs path/to/feelingwise-export.html
node verify-export.mjs path/to/feelingwise-export.html --json
```

Exit codes: 0 verified, 1 partially verified, 2 broken, 3 the file could not
be read as an export.

## What it checks

For every record: the integrity hash is recomputed from the record's canonical
fields and compared with the stored one; the signature over that hash is
checked under the public key whose fingerprint the record names, among the
keys the file carries. Then the chain links between records are walked, records
withheld from the file are checked against their signed redaction markers, the
time stamps from outside services are compared with the records present, and the signed
manifest over the whole envelope (records, keys, labels, wording, the rows on
page one as rendered) is recomputed and its signature checked under the file's
own key. Then every RFC 3161 time-stamp token the file carries is opened
offline, the chain anchors against the record hash each names and the stamp
over the signing key against a digest recomputed from the key in the file: the
imprint, the signature, the certificate chain inside the token, and whether
the root is one of the authorities the extension pins. A token that verifies
under an authority the checker does not recognise is reported as such and
dates nothing on its own, because anyone can run a timestamping service.

The three readings:

- **VERIFIED**: every hash matched, every signature verified, the manifest
  matches and is signed by the file's own key.
- **PARTIALLY VERIFIED**: nothing failed, but something could not be checked.
  The reasons are printed: records whose signing key is not in the file, records
  with no signature, a file made before the manifest existed, a key that
  travelled inside the file, a chain seam, records a restore set aside, a
  timestamped record that is missing.
- **FAILED**: a hash or a signature did not match, or the manifest did not.
  The first failing record and the reason are printed.

## What it cannot establish

The checker compares the file with itself. It does not establish who created
the file, whether the embedded key is the original key, that the file holds
everything the record held, or that anything a record says is true. A file that
reads VERIFIED is a file whose contents have not changed since the key that
signed them signed them. The extension's own methodology, and the measured
accuracy of the optional AI reading, are described inside every export and at
feelingwise.org/research.


## corroborate: what more than one recorder saw

A signed record proves nothing was altered after signing. It proves nothing at
all about whether the thing was ever served, because the signature goes on
after the text is in hand, so a fabricated post signs exactly as cleanly as a
real one. That is the largest gap in the section above, and no amount of
cryptography closes it inside one file.

What does reach it is other people. An observation earns weight in proportion
to how many unrelated observers recorded the same item being served.

```
node corroborate.mjs export-a.html export-b.html
node corroborate.mjs export-a.html export-b.html --json
```

It computes the content identity defined in `FORMAT.md` section 9 for every
record and reports what more than one recorder holds. It contacts nothing.

Three things it will not do, and they are the reason to trust the number:

- **It will not call one recorder two.** Files are grouped by the signing key
  they carry. Two exports from the same install are one person seeing something
  twice, which is not agreement about anything, and the tool says so and stops.
  A file that states no key is kept in a group of its own rather than assumed
  to be somebody new.
- **It will not compare a caption the page only partly carried.** A text cut at
  a "show more" control is less text, not the same text worn differently, and
  the cut point moves with the viewport. Records written before the capture
  state was recorded answer "unknown" and are left out rather than guessed at.
- **It will not verify anything.** Run `verify-export.mjs` on each file first.
  Identities computed from a file that does not verify are identities out of a
  document that says whatever somebody last typed into it.

And what a result does not mean: that two recorders hold one identity means two
files contain the same text. It does not date either sighting, does not say
either person saw it on a platform, and is not by itself evidence that anything
was served. Short text corroborates trivially, because two people posting the
same three words produce one identity by definition.
## observations: what was served, with no reading of it

A record carries two different kinds of thing. "This text was served at this
time, in this surface, by this account" is an observation. "This is a fear
appeal at severity 5" is a reading, by a named model, at a stated confidence.
The first is a fact about the world. The second is the output of a model whose
behaviour changes between releases, so nobody doing measurement can cite it and
expect the number to mean the same thing next year.

```
node observations.mjs export.html > observations.csv
node observations.mjs export.html --json --out observations.json
```

This writes the first kind and nothing else: no rewrite, no technique, no score,
no verdict, no model name. Each row keeps its `integrityHash` and its chain
position, so any row can be found again in the signed file it came from, and
carries the content identity from section 9 of FORMAT.md beside the text.

It is a PROJECTION, not evidence and not a signed artefact. The signed export is
the evidence; this is reproducible from it by anybody running the same tool over
the same file, which is the property that makes it citeable. The header names
the source file and its SHA-256, and those belong beside any table built from
it.

Two more things it will not do. It has not verified anything: run
`verify-export.mjs` on the source file first. And it leaves out the records that
are not observations of a served item, counting them in the header rather than
dropping them silently: the nine kinds of chain marker, analysis records, and
any record withheld at the recorded person's request, where a row with no text
would read as "nothing was served".

It does carry the account names and addresses the sites showed, because those
are part of what was served. Treat the file as personal data.

**Why this is not a signed export with the readings removed.** A record's
signature covers a hash of all its fields together, readings included, so
removing a field makes the hash unrecomputable. The format does have a mechanism
for that, the signed redaction marker, and it does not fit: a marker binds to
one record, so an export of 130,000 records would need 130,000 more records to
say what was withheld. The alternative, a file-wide declaration, would be a
format change that every already-published copy of `verify-export.mjs` would
reject, and handing somebody a file that our own published checker calls broken
is worse than handing them a projection.

## Receiving donated exports

Feedprint carries a "Send this export to <organisation>" button that POSTs the
export, from the person's own computer, to one HTTPS address, with no account
and no identifier of the sender beyond the public key already inside the file.
`receive-export.mjs` is a reference for the other end, for an organisation that
has agreed to receive exports and is the data controller for what it keeps:

```
node receive-export.mjs --dir ./received --port 8788
```

It accepts one POST per file, runs the checker above over it, keeps the file
and its reading under a name that is the file's own digest (the same file sent
twice is kept once), and answers `200` with an `X-Receipt` header. Not an
export: `422`. Over the size limit (`--max-mb`, 64 by default): `413`. It logs
no address, header or cookie. Put it behind a reverse proxy that terminates
HTTPS; the extension refuses to send to an `http` address.

## Test vectors, for a second implementer

`vectors/` holds twenty-six small exports and `EXPECTED.json`, the reading this
checker gives each: valid with its manifest; without the manifest; a record
edited; the manifest's file edited; a withheld record on its signed marker; an
earlier generation's key carried; that key missing; a self-minted time-stamp
token; the signing key dated by FreeTSA; a stated selection; text that is not
plain ASCII; a forged signature; an unsigned record; a withheld record with no
marker; a chain seam beside a branch; an edited record that names no key, which
is read softly and never failed; the file's own key failing its own
fingerprint; a withheld record pointing at a marker other than the one
attesting it; a chain seam the file cannot attribute by signature, because
the record on one side of it was signed by a key the file no longer carries; and a
withheld record carrying no signature at all, which reads VERIFIED. That last
one is not the reading an ordinary unsigned record gets, which is partial: the
marker attesting a withheld record is itself a signed record naming that
record's id and its stored hash, so the install has vouched for the hash
whether or not the record repeats the signature, and a forged marker fails the
whole file. Compare 20 against 05 in EXPECTED.json, not against 13. Vectors 21 to 24 are one family: two months joined by a
rotation marker whose signed link names the last record of the month before, which reads VERIFIED
because positions restart at 0 every month on purpose; and the same file three more times, with the
link naming a record that is not there, naming a record in the middle of the month, and on a marker
that carries no signature. Each of those three reads partial. The first and the last do because
nothing in the file shows which run the marker follows. The middle one links, and the two records
after the one it names are counted as set aside, the shape a restore from a backup leaves, because
the file cannot say whether a restore or a rewrite with the same key made them. Vectors 25 and 26 hold
records that carry a `subject` instead of a feed item, a document, a consent string and a note:
signed and linked, they read VERIFIED, and with the consent string changed after signing the file
fails at that record. Every record in them is invented and the file says so. A program
that implements this checker, or a recorder that produces this format, can run
over these files and compare its readings to `EXPECTED.json`. They are built
once by `scripts/build-verifier-vectors.ts` in the FeelingWise tree and
rebuilt only when what a file carries changes.

## How it is built

`verify-export.mjs` is generated, not written by hand. The functions between
the CORE markers are the exact text every export embeds in its own verifier,
taken from `src/forensics/verifier-core-source.ts` in the FeelingWise tree by
`scripts/build-standalone-verifier.ts`; the RFC 3161 block is the same compiled
copy of `src/forensics/rfc3161.ts` the export embeds. A test in that tree fails whenever the
committed file differs from the builder's output, and runs this file over a
real signed export, a copy without its manifest, and two tampered copies.

The record format, the canonical field order the hash is taken over, the
chain, the marker kinds, the manifest and the time stamps are specified for
a second implementer in `FORMAT.md` beside this file, normative against the
vectors; the tree's own working spec is `docs/spec/subsystems/forensic-chain.md`.
The format is named Feed Observation Record, version 1.0
(`feed-observation-record/1.0`), so another recorder or checker can say which
format it reads without naming this product.

## Running a panel

`PANEL.md` is the guide for a group that collects several people's exports:
`panel.html` checks them and puts them into one dataset with every record still
checkable (`pool.mjs` on the command line), and writes a spreadsheet table
(`to-csv.mjs`) and a 4CAT upload (`to-4cat.mjs`). `kit.browser.js` is those
tools for the page, generated by `scripts/build-kit-browser.mjs` from the
`.mjs` files.

## Licence

Apache License, Version 2.0. See `LICENSE`.
