# Running a panel with this folder

This folder is everything a group needs to run a feed panel with Feedprint and get one dataset out of it, with no
account with Feedprint's makers and nothing sent to them. The two pages and the tools here run on your own computer,
offline.

A panel: several volunteers, each on a new account of their own, let Feedprint record what one feed shows them,
half an hour a day for two weeks, without interacting, and send you the file on day 15. Because each record is
signed where it was made, you can check every one of them yourself, and because several people record at the same
time, you can see which posts were shown to more than one of them.

## What is in the folder

| File | What it is for |
|---|---|
| `protocol-en.html`, `protocol-ro.html` | The page you give each volunteer, in English or Romanian. Print it or send it. |
| `panel.html` | Double-click it. Drop in every file your volunteers sent: it checks each one, puts them together, and saves the dataset and two tables. |
| `index.html` | Double-click it to check one file on its own and read its full report. |
| `FORMAT.md` | The written rules of the file format, the Feed Observation Record, for anyone who wants to read or write it with other tools. |
| `*.mjs` | The same tools for the command line, for whoever on your team uses one (below). |

## Before day 1

1. Decide the numbers and write them down: how many volunteers, which platform, at what time of day. The volunteer
   page is written for 30 minutes a day for 14 days, with the file sent on day 15. Keep those numbers, or, if your
   study needs others, give every volunteer your numbers in writing with the page. The page leaves the platform and
   the time of day to you: give those in writing too.
2. Give each volunteer a code (for example P1, P2, P3, P4). They type it where the export asks for "Your name on the
   file", so the file carries the code and not their name. Keep the list of who has which code apart from the files.
3. Give each volunteer the details for their new account: an email address, and a phone number where the platform
   asks for one, made for the study and not their own. Read the platform's terms on extra accounts before you start.
4. Tell each volunteer, in your own consent form, what your group does with the file: how you keep it, who else sees
   it, whether any of it is published, and how they ask for it to be deleted. The volunteer page says only what
   Feedprint records and sends; it says nothing about your group.
5. Agree how the file reaches you. It holds the full text of a person's feed, so use a way only your group can open,
   not a public link or a folder others can read. Feedprint sends nothing to you or to its makers: the volunteer sends
   the file.

## On day 15

1. Each volunteer sends you their file and the line Feedprint showed them after the export, with the file's name,
   size and SHA-256 (a fingerprint of the file: any change to the file changes it).
2. Open `panel.html`. Drop in all the files together. For each file the page shows the code typed on it, whether it
   checked, how many records went into the dataset, and its SHA-256. Compare that SHA-256 with the one the volunteer
   sent: if they differ, the file you hold is not the file they made.
3. A file that fails its check is left out and named, with the reason. Ask that volunteer to export again; do not
   edit the file.
4. A file marked "Partially verified" is in the dataset: nothing in it failed, but something could not be checked.
   Open it in `index.html`, which names what, and write that reason down with your results.
5. Save the three results:
   - `pool.json`: the dataset. Every record exactly as it was signed, with the keys to check it. Keep this one: it
     is what your numbers can be checked against later.
   - `table.csv`: one row per post, for a spreadsheet. It opens in Excel, LibreOffice or Google Sheets. The
     `nameOnFile` column holds the code the volunteer typed; `recorder` is the fingerprint of the key that signed it.
     If a double-click puts every row in one column, import the file with a comma as the separator (in Excel: Data,
     From Text/CSV). Dacă la dublu clic fiecare rând intră într-o singură coloană, importați fișierul cu virgula ca
     separator (în Excel, din fila Date). A cell that starts with an apostrophe had it put in front so the
     spreadsheet does not run the text as a formula; the text is the cell without it. Open `for-4cat.csv` in 4CAT,
     not in a spreadsheet: it has no such apostrophe.
   - `for-4cat.csv`: the same rows for 4CAT, a research tool for social media data that a university or group runs
     on its own server (4cat.nl). If your group has one: Create dataset, then Custom Dataset Upload, with the format
     "Custom/other". The columns 4CAT asks for are already named.

## What the numbers mean, and what they do not

- **Recorders, not people.** A recorder is one installation of Feedprint. Files signed by the same installation are
  counted as one recorder, even if exported twice. Nothing in a file can say whether two installations belong to
  one person, and the code on a file says what was typed, not who typed it.
- **Three kinds of "the same post".** A record exported twice is kept once ("already in the pool"). A text one
  recorder was shown twice is two sightings by one recorder (`sightingsByThisRecorder`). A text shown to several
  recorders is counted in `recordersWithItem`, and only that number is agreement between volunteers. Only posts
  whose whole text was on the page are compared; a caption cut short at a "more" button is left out of the
  comparison (`FORMAT.md` section 9), so expect fewer shared posts than the feeds held.
- **Time stamps.** Outside time-stamp services date the record; each stamp request carries a fingerprint of the
  record, no post text, and the service sees the volunteer's internet address and the time. Feedprint asks for a
  stamp about every six hours while the browser is open and the feed has added entries since the last one. A stamp says a record existed no
  later than its time; it never says how much earlier. With half an hour a day, expect about one stamp a day, and
  none on a day the browser was not opened. A green "Verified" does not mean a record is stamped: open each file in
  `index.html` to see up to which record its stamps reach.
- **What a check proves and what it does not.** A record that checks has not changed since its key signed it. That
  does not say who held the key, that the volunteer did what the protocol asked, that the file holds every day, or
  that anything a post says is true. `FORMAT.md` section 7 says this in full.

## The files hold personal data

The files hold the full text of what each volunteer was shown, the names and addresses of the accounts that posted
it, the groups the volunteer was in, and, on the first page, the code they typed and their operating system,
browser, language and time zone. `pool.json` keeps every record as the file holds it, so the posts, the accounts and
the groups, and the code; the two tables hold the posts, the accounts and the code. None of
them holds the volunteer's own account or internet address, but they identify a person from what was shown to
them. Store them as your consent form and your ethics process say. 4CAT's "pseudonymise" option replaces the
`author` column only: the account names inside `postUrl` and `body` stay as they were.

## From the command line

Node 20 or later must be installed (nodejs.org); nothing else, and no network. Put the volunteers' files in this
folder, open a terminal in it, and type the commands with the files' own names in place of `P1.html` and the rest.

```
node verify-export.mjs P1.html
node pool.mjs P1.html P2.html P3.html P4.html --out pool.json
node pool.mjs --check pool.json
node to-csv.mjs pool.json --out table.csv
node to-4cat.mjs pool.json --out for-4cat.csv
```

`pool.mjs` ends with 0 when every file verified, 1 when one was partially verified, 2 when a file was left out, and
3 when it could not read a file you named; it replaces a `pool.json` that is already there. Each file's SHA-256 is
in `pool.json` under `sources`. `to-csv.mjs` writes a byte order mark so a spreadsheet reads the letters with marks
correctly; give it `--no-bom` when a program, not a person, reads the file. `pool.mjs --check` re-checks every
record in a dataset from the dataset alone, which is how someone you send `pool.json` to can check your numbers
without your volunteers' files. It counts a record "checked by hash only" when it carries no signature or the key
that signed it is not in the dataset: its content matches its own hash, but no signature could be checked.

Apache License 2.0, like everything in this folder (`LICENSE`).
