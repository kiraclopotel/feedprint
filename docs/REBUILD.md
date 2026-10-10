# Which code wrote this export: rebuilding it yourself

Page one of an export names the extension that made it, in the line "Recorded with" (or
"Exported with"):

```
FeelingWise V2.5.17 build fwbid-0e6a9d81aaaa-r2517 source 3c9f...e1
```

- `2.5.17` is the version the store lists.
- `fwbid-0e6a9d81aaaa-r2517` is the build id. A store build's id is made from the first 12
  characters of the commit it was built from and the version's digits. Every record also carries
  the id of the build that judged it, and page one names it ("Build that wrote this file").
- `source 3c9f...e1` is the source digest: one SHA-256 over the source the build was made from.
  The source of an upload is published as a fresh repository taken at the commit it was built
  from (its `SOURCE-COMMIT` file names that commit), and this digest is how you know the source you
  hold, cloned or unpacked, is the one that build was made from.

An ad hoc build (one not made from a recorded commit) names no source; treat it as unverifiable
here. The label is the extension's own report of itself: a copy built from this source and loaded
by hand writes the same words. What ties the words to the store is step 4.

## 1. Check the archive is that source

Unpack the archive you were given into an empty folder and, with Node installed, run in it:

```bash
node scripts/public-snapshot.mjs --check-digest .
```

It hashes every file, prints the source digest, and compares it with the `SOURCE-DIGEST` file the
archive carries. The digest it prints must equal the one on page one. It needs no network and no git.
The install, the build and the tests add folders the digest leaves out by name (`node_modules`,
`dist`, `release`, `coverage`, `test-results`); any other file added to the folder changes the
digest, on purpose, because it could change the build.

## 2. Install exactly what the build used

Install the Node version in `.nvmrc` (24.14.0), then:

```bash
npm ci
```

`npm ci` installs the exact versions in `package-lock.json`; `npm install` would not.

## 3. Rebuild

```bash
node scripts/reproducible-build.mjs --product receipts
```

The build checks the files against `SOURCE-DIGEST` again, pins the build id from `SOURCE-COMMIT`,
and writes `release/receipts-<version>.zip` and a list of the hash of every built file. Its
`manifest.json` carries the same version_name page one prints.

## 4. Compare with what the store serves

The store does not hand out the zip we uploaded, but Chrome keeps, beside the copy it installed, a
list of the hash of every file the store served, signed with the store's key. Find the folder
`Extensions/<extension id>/<version>_0` in your Chrome profile (`chrome://version` shows the profile
path) and run:

```bash
node scripts/reproducible-build.mjs --product receipts --verify-installed "<that folder>"
```

MATCH means every file the store serves is a file this source builds. With step 1, that is the
chain from page one to the code: the export names a build and a source digest, the archive
recomputes to that digest, and that archive builds what the store served.

## What this was measured at

Tried once, on 7 October 2026, on Windows 11 with Node 24.14.0, from commit 5dc626ff, in an empty
folder on the same machine (so `npm ci` read the machine's npm cache; a first install on a new
machine downloads the packages and takes longer). Seconds by the clock of the script that ran it:

| step | seconds | result |
|---|---|---|
| write the public source and pack it into one zip | 2.4 | 1,666 files, source digest `76ccd595...41cd0` |
| the same digest read from the repository (`--digest`) | 0.6 | equal |
| unpack into an empty folder | 0.6 | |
| 1. `--check-digest .` | 0.6 | MATCH over 1,665 files (the release list is left out) |
| 2. `npm ci` | 6.6 | |
| 3. the reproducible build in that folder | 8.1 | |
| the same build in the repository | 6.8 | |

The zip built from the unpacked archive and the zip built in the repository had the same SHA-256
(`cbbc5be3...45d4`), and both manifests carried the same version_name:
`2.5.17 build fwbid-5dc626ff1f3b-r2517 source 76ccd595...41cd0`. Step 4 was not tried: 2.5.17 is not
on the store yet, and an installed copy can only be compared with the source of its own version.

One limit stands as of that day: the public copy is written only when its privacy scan passes, and
it found words shaped like handles and an address in files outside this work; until those are
cleared, the archive in step 1 cannot be made for a reader. The trial wrote the same files without
the scan into a folder that never left the machine.
