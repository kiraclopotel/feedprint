// FeelingWise: a corpus of exports altered in exactly one place, and what the checker said.
//
// The sentence this exists for is on landing/check.html:192 and in the promises registry as
// `verified-means-unchanged`: "A file that reads VERIFIED has not changed since the key that signed
// it signed it." It sat in the registry with nothing checking it, and its own `whyNotChecked` named
// the check that would decide it: a corpus of exports altered one byte at a time, in each field that
// matters, every one of which the checker must refuse.
//
// This is that corpus. It is plain ESM rather than TypeScript because two callers need it and only
// one of them runs under vitest: the test in tests/unit/forensics/export-tamper-corpus.test.ts, and
// the promise check in scripts/verify/product-copy-claims.mjs, which is a node script.
//
// THE BASE FILE IS A REAL EXPORT, NOT A FIXTURE BUILT HERE. verifier/vectors/01-verified.html is
// written by scripts/build-verifier-vectors.ts from the same exporter a person's own file comes out
// of, and verifier/vectors/EXPECTED.json records that it reads verified with manifest ok, 3 records,
// 1 key, no failures. Building a second export here would test this file's idea of the format
// against the checker's, which is the one comparison that cannot fail usefully.
//
// NO PRIVATE KEY IS INVOLVED, AND THAT IS THE POINT. Every entry below is an edit made by somebody
// who does not hold the signing key, which is the only interesting adversary: a person who holds the
// key can write whatever they like and sign it, and FORMAT.md section 7 says outright that the
// format does not establish who holds the key.
//
// THE SECOND HALF MATTERS AS MUCH AS THE FIRST. A checker that refuses everything passes a tampering
// corpus and is useless, so the unmutated base file is run through the same path and must still read
// VERIFIED. That assertion is in the same run, not in a different file.
//
// An entry carrying `whole: 'verified'` is not a failure of this corpus and is not to be removed: it
// is an edit that was MEASURED to survive a VERIFIED reading, recorded here so that the next person
// reads a number rather than a belief. If the checker later refuses one, this corpus goes red and
// asks for the record to be corrected, which is the direction a lock is supposed to work in.
//
// Four such entries were recorded on 2026-09-18 and all four were closed the same day: the coverage
// sentence, the signing key fingerprint, the page-one paragraph naming the limits of the check, and
// the envelope's profile block. The first three were page text carrying no data-fw-prov, so
// provenanceDigest never read them; the builder now attributes every row that states something about
// the file or the records (src/forensics/html-export.ts, extractProvenanceRows). The fourth is an
// envelope key that no digest can take without refusing files signed under the released canonical
// order, so the checker holds it down against the signed rows rendered from it instead.
//
// The fifth, the <dt> LABEL beside a signed value, was closed later the same day. It needed the
// format's coverage rule widened (FORMAT.md section 5) and all three implementations of that rule
// changed together, which is why it was recorded first and fixed second. No entry in this corpus
// carries `whole: 'verified'` as of 2026-09-18, and the day one does again, it is because somebody
// measured a new edit surviving and wrote the number down, which is what this file is for.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The signed export every mutant is derived from. */
export const BASE_EXPORT_REL = 'verifier/vectors/01-verified.html';
/** The checker a recipient runs, built from src/forensics/verifier-core-source.ts. */
export const CHECKER_REL = 'verifier/verify-export.mjs';

export const BASE_EXPORT_PATH = join(REPO_ROOT, ...BASE_EXPORT_REL.split('/'));
export const CHECKER_PATH = join(REPO_ROOT, ...CHECKER_REL.split('/'));

// ─── editing a file that was signed ───

const PAYLOAD_RE = /(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/;

/**
 * Read the envelope out of an export, hand it to `edit`, and put it back.
 *
 * The same shape the existing checker test uses (tests/unit/forensics/standalone-verifier.test.ts),
 * on purpose: two ways of driving the checker would be two things to keep true. Re-serialising is
 * safe for the digests because every one of them is taken over `JSON.stringify` of a parsed value,
 * never over the file's own bytes, so whitespace in the file does not reach a digest.
 */
export function editPayload(html, edit) {
  let touched = false;
  const out = html.replace(PAYLOAD_RE, (_m, open, body, close) => {
    touched = true;
    const data = JSON.parse(body);
    edit(data);
    return open + JSON.stringify(data).replace(/</g, '\\u003c') + close;
  });
  if (!touched) throw new Error('the export carries no fw-export-data payload, so nothing was mutated');
  return out;
}

/**
 * Replace one occurrence of `from`, and refuse to carry on if it is not there.
 *
 * A needle that stopped matching is a mutation that silently stopped being made, which would leave a
 * check reporting a refusal it never obtained. Found while writing this file: the fingerprint row in
 * the rendered page carries a `<code>` wrapper, so the obvious needle missed and the mutation was a
 * no-op that the checker duly read as VERIFIED.
 */
export function replaceOnce(html, from, to) {
  const at = html.indexOf(from);
  if (at === -1) throw new Error(`the export no longer carries the text this mutation edits: ${from.slice(0, 60)}`);
  if (html.indexOf(from, at + from.length) !== -1) {
    throw new Error(`the text this mutation edits appears more than once, so "one place" is not what would be changed: ${from.slice(0, 60)}`);
  }
  return html.slice(0, at) + to + html.slice(at + from.length);
}

/**
 * The same, but starting the search after `anchor`, for text that appears in the rendered page AND
 * in the envelope's own i18n table.
 *
 * Several of the page's sentences are stored twice: once in `i18n`, which is under i18nDigest, and
 * once rendered into the HTML, which is not. Found here on 2026-09-18 by replaceOnce refusing to run
 * because the page-one limits sentence matched in both places. Editing only the rendered copy is the
 * mutation worth making: it is the copy a person reads.
 */
export function replaceOnceAfter(html, anchor, from, to) {
  const start = html.indexOf(anchor);
  if (start === -1) throw new Error(`the export no longer carries the anchor this mutation edits: ${anchor.slice(0, 60)}`);
  if (html.indexOf(anchor, start + anchor.length) !== -1) {
    throw new Error(`the anchor this mutation edits appears more than once: ${anchor.slice(0, 60)}`);
  }
  const at = html.indexOf(from, start);
  if (at === -1) throw new Error(`the export no longer carries the text this mutation edits: ${from.slice(0, 60)}`);
  return html.slice(0, at) + to + html.slice(at + from.length);
}

/**
 * Rewrite the inside of one rendered row, found by the provenance name it carries.
 *
 * Needled by name rather than by the sentence it holds because the vectors are rebuilt whenever the
 * exporter changes what a file carries, and two of these rows print a value that is different in
 * every rebuild: the signing key fingerprint is drawn from a throwaway key per run. A literal needle
 * over that row was a mutation that would silently stop applying the next time the vectors were
 * built, which is the failure replaceOnce exists to refuse.
 */
export function replaceRowText(html, prov, to) {
  const open = `<dd data-fw-prov="${prov}">`;
  const at = html.indexOf(open);
  if (at === -1) throw new Error(`the export no longer renders a row marked ${prov}`);
  if (html.indexOf(open, at + open.length) !== -1) throw new Error(`more than one row is marked ${prov}`);
  const from = at + open.length;
  const end = html.indexOf('</dd>', from);
  if (end === -1) throw new Error(`the row marked ${prov} never closes`);
  return html.slice(0, from) + to + html.slice(end);
}

/** One character of `s` at `index`, changed to a different one. Nothing else moves. */
export function flipChar(s, index) {
  if (typeof s !== 'string' || s.length <= index) throw new Error('nothing to flip');
  const c = s[index];
  const next = c === '0' ? '1' : c === 'a' ? 'b' : c === 'A' ? 'B' : c === '1' ? '2' : 'z';
  return s.slice(0, index) + (next === c ? 'y' : next) + s.slice(index + 1);
}

// ─── the corpus ───

// `whole` is the reading expected from the file as it stands, manifest and all. `bare` is the
// reading expected from the same edit with the manifest deleted, which is how a mutation is asked
// WHICH line of defence caught it: 'failed' means the record's own hash or signature refused it,
// 'partial' means only the manifest ever saw it and a file without one would carry the edit
// unremarked. A `bare` of null means the mutation is about the manifest or the page and deleting
// the manifest would not be the same experiment.
export const MUTATIONS = [
  {
    name: 'record-text-one-character',
    // The text of a record is the thing the record is about. If one character of it can move, the
    // file is a record of nothing: a post that said one thing is shown to a lawyer saying another.
    why: 'one character of the second record\'s originalText',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.records[1].originalText = 'second past'; }),
  },
  {
    name: 'record-author',
    // Who said it. The whole use of the file outside the household is attributing something to
    // somebody, and an author that can be edited attributes it to whoever holds the file last.
    why: 'the second record\'s author',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.records[1].author = '@somebody-else'; }),
  },
  {
    name: 'record-timestamp',
    // When. A record moved in time is how a thing that happened after an event is made to look like
    // a thing that happened before it, which is the ordinary shape of a doctored record.
    why: 'one digit of the second record\'s timestamp',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.records[1].timestamp = flipChar(d.records[1].timestamp, 18); }),
  },
  {
    name: 'record-chain-position',
    // Position is what says where in the run of the chain a record sat, and a signed selection is
    // read against it (FORMAT.md section 4). Moving one is how a gap is made to look accounted for.
    why: 'the third record\'s chainPosition',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.records[2].chainPosition = 7; }),
  },
  {
    name: 'record-prev-record-hash',
    // The link itself. prevRecordHash is the only thing that makes the records a chain rather than a
    // pile, so an edit here is an attempt to re-parent a record onto a different history.
    why: 'one character of the third record\'s prevRecordHash',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.records[2].prevRecordHash = flipChar(d.records[2].prevRecordHash, 0); }),
  },
  {
    name: 'record-integrity-hash',
    // The stored digest. Editing content and its hash together is the obvious next move after the
    // first mutation above fails, and it is refused by the signature, which is taken over the UTF-8
    // text of this hash string (FORMAT.md section 2).
    why: 'one character of the second record\'s integrityHash',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.records[1].integrityHash = flipChar(d.records[1].integrityHash, 0); }),
  },
  {
    name: 'record-signature-byte',
    // The signature. A record that names its key and whose signature does not verify under it fails
    // with key-mismatch; FORMAT.md section 4 makes that one of the few outright failures.
    why: 'one character of the second record\'s signature',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.records[1].signature = flipChar(d.records[1].signature, 0); }),
  },
  {
    name: 'record-removed',
    // Taking a record out is the edit that costs an attacker nothing: no forgery, no key, just a
    // deletion. Nothing inside a record can see it, which is why the manifest exists.
    why: 'the second record deleted from the file',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.records = [d.records[0], d.records[2]]; }),
  },
  {
    name: 'record-inserted',
    // A record put in that the signer never placed there. Replaying one the signer DID write is the
    // strongest version an attacker has, because the copy carries a signature that verifies.
    why: 'the second record copied and appended, a replay carrying its own good signature',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.records = [...d.records, JSON.parse(JSON.stringify(d.records[1]))]; }),
  },
  {
    name: 'records-swapped',
    // Order. Two records exchanged say a thing was seen before another thing, and every record in
    // the pair still hashes and verifies, so only a digest over the set can refuse it.
    why: 'the first two records exchanged',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.records = [d.records[1], d.records[0], ...d.records.slice(2)]; }),
  },
  {
    name: 'manifest-digest',
    // The manifest's own digest, over the fixed-order array of every other digest in it
    // (FORMAT.md section 5). It is the value the manifest signature is taken over, so an attacker
    // who edits a record and recomputes recordsDigest has to reach this next.
    why: 'one character of manifest.digest',
    whole: 'failed',
    bare: null,
    apply: (html) => editPayload(html, (d) => { d.manifest.digest = flipChar(d.manifest.digest, 0); }),
  },
  {
    name: 'manifest-signature',
    // And the signature over that digest, which is the last thing standing between an attacker who
    // can recompute every digest in the file and a VERIFIED reading.
    why: 'one character of manifest.signature',
    whole: 'failed',
    bare: null,
    apply: (html) => editPayload(html, (d) => { d.manifest.signature = flipChar(d.manifest.signature, 0); }),
  },
  {
    name: 'record-field-appended',
    // A field the signer never saw. canonicalPayload reads the keys on its own list and no others
    // (FORMAT.md section 3), so an added key cannot move a record's integrityHash and the per-record
    // check cannot see it at all. `bare: 'partial'` below is that fact, measured: with the manifest
    // deleted this file carries an invented field and no record complains. Only recordsDigest, which
    // is taken over JSON.stringify of the whole record array, refuses it.
    why: 'an invented field added to the second record',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.records[1].somethingTheSignerNeverSaw = 'added after signing'; }),
  },
  {
    name: 'record-chain-anchor',
    // chainAnchor is named by FORMAT.md section 2 as an advisory label the checker ignores, and it
    // sits outside the canonical payload beside integrityHash and signature. Same shape as the entry
    // above and a documented field rather than an invented one: the record cannot defend it and the
    // manifest is the whole defence.
    why: 'the second record\'s advisory chainAnchor label rewritten',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.records[1].chainAnchor = 'anchored by an authority that never saw it'; }),
  },
  {
    name: 'public-key-coordinate',
    // The key in the file. Swapping in a key whose private half the editor holds is the way to make
    // every signature in a rewritten file verify, so the checker recomputes publicKeyFingerprint
    // from the coordinates and refuses a file where the two disagree (FORMAT.md section 1).
    why: 'one character of publicKeyJwk.x',
    whole: 'failed',
    bare: 'failed',
    apply: (html) => editPayload(html, (d) => { d.publicKeyJwk.x = flipChar(d.publicKeyJwk.x, 0); }),
  },
  {
    name: 'envelope-fw-version',
    // Which build made the file. It is in envelopeCanonical, and it is the line the rendered page
    // prints as "Recorded by", so a reader attributing a file to a version is relying on it.
    why: 'one character of fwVersion',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.fwVersion = flipChar(d.fwVersion, 0); }),
  },
  {
    name: 'envelope-i18n-wording',
    // The wording the page renders its verdict in. FORMAT.md section 5 requires the manifest to be
    // checked before any verdict wording is printed, precisely because the wording is under it: a
    // file whose i18n could be edited could print BROKEN as a compliment.
    why: 'one character of the i18n string describing what the check does',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.i18n.whatThisDoes = flipChar(d.i18n.whatThisDoes, 0); }),
  },
  {
    name: 'envelope-tech-label',
    // The display label a technique enum is shown under. Under techLabelsDigest. A relabelled
    // technique is a record that reads differently to a person without a record changing.
    why: 'one character of a techLabels value',
    whole: 'failed',
    bare: 'partial',
    apply: (html) => editPayload(html, (d) => { d.techLabels['fear-appeal'] = flipChar(d.techLabels['fear-appeal'], 0); }),
  },
  {
    name: 'page-attributed-provenance-row',
    // A summary row that was already attributed before the widening on 2026-09-18. provenanceDigest
    // is taken over every `dd[data-fw-prov]` and `p[data-fw-prov]` in the page (FORMAT.md section 5),
    // so this one has always been signed and refused. It is the control that says the mechanism was
    // working and only its coverage was short.
    why: 'the rendered "Held back from this export" row, which carries data-fw-prov',
    whole: 'failed',
    bare: null,
    apply: (html) => replaceOnce(
      html,
      '<dd data-fw-prov="heldBack">Nothing was removed by an export filter.</dd>',
      '<dd data-fw-prov="heldBack">Three records were removed by an export filter.</dd>',
    ),
  },

  // ─── the four that were measured surviving on 2026-09-18, and are refused since ───
  //
  // Each was applied to verifier/vectors/01-verified.html and run through verifier/verify-export.mjs
  // and came back state verified, manifest ok, exit 0. They are kept, with the edit unchanged, so the
  // run says every time that these particular edits are now refused rather than untried.

  {
    name: 'page-coverage-sentence',
    // A completeness claim in the rendered summary: a reader is told the file begins at the start of
    // the chain and has no gaps in it. The numbers behind it are in the records and under
    // recordsDigest; the sentence was under nothing, because only seven of roughly eighteen rendered
    // rows carried data-fw-prov and this was not one of them.
    why: 'the rendered "Earlier records NOT in this file" row, a completeness claim',
    whole: 'failed',
    bare: null,
    apply: (html) => replaceRowText(
      html,
      'missingBefore',
      'None. Nothing was ever removed and this is the whole history.',
    ),
  },
  {
    name: 'page-key-fingerprint-row',
    // The same class of row, on the value a recipient is most likely to compare by hand. A file could
    // show one signing key on its page and be signed by another, and the page's own verifier and the
    // command line both printed VERIFIED beside it: the envelope's copy is checked against the key's
    // coordinates, the rendered digits were compared with nothing. Worst of the four, because the
    // comparison it defeats is the one a person does without a computer.
    why: 'the rendered "Public key fingerprint" row, the digits a recipient compares by eye',
    whole: 'failed',
    bare: null,
    apply: (html) => replaceRowText(html, 'fingerprint', '<code>0000deadbeef0000</code>'),
  },
  {
    name: 'page-limits-sentence',
    // The sentence on page one that tells the reader what the check does NOT establish. Removing one
    // word turns "It does not establish who made the file" into its opposite. The same sentence is
    // also in the envelope's i18n table, which IS signed, so this edit makes the rendered copy
    // disagree with the signed copy: until the paragraph was attributed, nothing compared the two.
    why: 'the page-one sentence naming the limits of the check, inverted in the rendered copy only',
    whole: 'failed',
    bare: null,
    apply: (html) => replaceOnceAfter(
      html,
      '<p data-fw-prov="whatThisDoes"',
      'It does not establish who made the file',
      'It establishes who made the file',
    ),
  },
  {
    name: 'page-does-not-measure-paragraph',
    // The disclaimer that tells the reader what the product does NOT do: it does not measure the
    // person's emotional state, it does not observe their relationships or their history. Turned
    // into its opposite, it becomes a boast in the product's own mouth, on a file whose numbers are
    // untouched and whose verdict, until 2026-09-18, was VERIFIED.
    //
    // Found by a journalist reading the check page with nothing but a text editor and the demo, who
    // broke four things and got away with exactly this one. That is a better way to find it than
    // reading the code, and it is why the reading was asked for: a page that survives three attacks
    // and quietly loses the fourth is a page whose green badge means something narrower than the
    // reader thinks. The paragraph carries data-fw-prov now and the edit is refused.
    why: 'the "what FeelingWise does not measure" paragraph inverted into a boast',
    whole: 'failed',
    bare: null,
    apply: (html) => replaceOnceAfter(
      html,
      '<p data-fw-prov="notMeasure"',
      'does NOT measure',
      'measures',
    ),
  },
  {
    name: 'envelope-profile',
    // The envelope's `profile` block: the maker's chosen name and the machine facts. It sits outside
    // envelopeCanonical, which was fixed in a released format before the block existed and cannot
    // take it now without refusing every file signed under the old order. So the checker holds it
    // down the other way: the page's "made by" and "machine" rows are under provenanceDigest, and
    // checkManifest refuses a file whose profile block disagrees with them. Here the page names no
    // maker at all and the envelope names one, which is the disagreement.
    why: 'a maker fabricated in the envelope profile block',
    whole: 'failed',
    bare: null,
    apply: (html) => editPayload(html, (d) => {
      d.profile = { name: 'Somebody Else', platform: 'Windows', browser: 'Chrome 130', language: 'en', timeZone: 'UTC' };
    }),
  },

  // ─── measured on 2026-09-18: the edit a VERIFIED reading still survives ───
  //
  // Not an aspiration and not to be quietly made to pass. Applied to verifier/vectors/01-verified.html
  // and run through verifier/verify-export.mjs: state verified, manifest ok, exit 0. It is recorded so
  // the gap is a number in the output of every run rather than a thing somebody once noticed.

  {
    name: 'page-row-label',
    // The label, not the value. This was the last edit in the corpus that survived a VERIFIED
    // reading, and it survived because the digest read <dd> and <p> elements and a label is neither:
    // the signed digits of the signing key fingerprint could be presented under the words "Archive
    // fingerprint" and the file still read VERIFIED. Closed on 2026-09-18 by marking the label as its
    // own row, `<name>.label`, so the pair sorts together and neither can be taken for the other.
    //
    // Closing it took all three implementations of the reading rule, which is why it was left for a
    // session that could do all three at once: the builder's regex in src/forensics/html-export.ts,
    // the browser checker's querySelectorAll, and the node checker's own HTML shim in
    // scripts/build-standalone-verifier.ts. The shim was the one that would have shipped a lie
    // quietly: it closed each row on whichever of </dd> and </p> came first, which was harmless while
    // only those two carried the attribute and wrong the moment a <dt> did, because a label is
    // immediately followed by the value it introduces. It would have signed the label as the value.
    //
    // Old files are unaffected and this was measured, not assumed: the ten vectors as they stood
    // before the widening were run through the widened checker and every one read exactly what
    // EXPECTED.json says. A file carries its own marked rows and the checker recomputes those.
    why: 'the "Public key fingerprint" LABEL rewritten, leaving the signed digits under a different name',
    whole: 'failed',
    bare: null,
    apply: (html) => replaceOnce(
      html,
      '<dt data-fw-prov="fingerprint.label">Public key fingerprint:</dt>',
      '<dt data-fw-prov="fingerprint.label">Archive fingerprint:</dt>',
    ),
  },
];

// ─── running them ───

/** Every mutant, as `{ name, why, whole, bare, html }`. Throws if a mutation no longer applies. */
export function mutantsOf(baseHtml) {
  return MUTATIONS.map((m) => ({ ...m, html: m.apply(baseHtml) }));
}

/** The same edit with the manifest deleted, for the mutations that declare a `bare` reading. */
export function bareMutantsOf(baseHtml) {
  return MUTATIONS.filter((m) => m.bare !== null).map((m) => ({
    ...m,
    html: editPayload(m.apply(baseHtml), (d) => { delete d.manifest; }),
  }));
}

/**
 * Run the checker over one file the way a recipient runs it: a child process, the built .mjs, and
 * the JSON report it prints on every exit code.
 */
export function checkFile(checkerPath, filePath) {
  let stdout = '';
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [checkerPath, filePath, '--json'], { encoding: 'utf8' });
  } catch (err) {
    code = err.status;
    stdout = err.stdout ?? '';
  }
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return { code, state: 'unreadable', manifest: null, reason: null, raw: stdout.slice(0, 400) };
  }
  const first = (report.failures ?? [])[0] ?? null;
  return {
    code,
    state: report.state,
    manifest: report.manifest,
    reason: first ? first.reason : null,
    detail: first ? first.detail ?? null : null,
  };
}

/**
 * The whole corpus against one checker: the unmutated base file first, then every mutant, then every
 * mutant again with the manifest deleted.
 *
 * `checkerPath` is a parameter rather than a constant so the promise check in
 * product-copy-claims.mjs can hand it a deliberately weakened copy of the checker and require this
 * corpus to notice. A check that cannot be made to fail has not been shown to be a check.
 */
export function runCorpus({ checkerPath = CHECKER_PATH, baseHtml = readFileSync(BASE_EXPORT_PATH, 'utf8') } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fw-tamper-corpus-'));
  const write = (name, html) => {
    const file = join(dir, `${name}.html`);
    writeFileSync(file, html, 'utf8');
    return file;
  };

  const original = checkFile(checkerPath, write('00-unmutated', baseHtml));
  const whole = mutantsOf(baseHtml).map((m) => ({
    name: m.name, why: m.why, expected: m.whole, observed: checkFile(checkerPath, write(m.name, m.html)),
  }));
  const bare = bareMutantsOf(baseHtml).map((m) => ({
    name: m.name, why: m.why, expected: m.bare, observed: checkFile(checkerPath, write(`${m.name}--no-manifest`, m.html)),
  }));
  return { dir, original, whole, bare };
}
