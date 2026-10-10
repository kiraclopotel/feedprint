// @vitest-environment node
//
// The test vectors under verifier/vectors/ (built once by
// scripts/build-verifier-vectors.ts and committed): small exports and
// EXPECTED.json, the reading the checker must give each. The count is not
// written here on purpose; it was stale within a day of vectors 21 and 22
// (2026-09-20) and the one assertion below is where it belongs. A second
// implementer of the checker runs their program over these files and
// compares; this lock makes sure the committed readings are what the
// committed checker gives today, and that the readings are the ones the
// format promises (a withheld record verifies on its marker, an edited record
// fails as tampered, a carried key reads partial, a self-minted token names
// no authority, the dated key names FreeTSA).
//
// Vectors 11 to 15 were added on 2026-09-18, after an engineer wrote a checker
// from verifier/FORMAT.md alone and reported what the first ten never
// exercised: across their thirty records there was no non-ASCII character, no
// quote, no backslash and no control character; no signature was ever forged
// (vector 03 edits content, so the hash fails first and the signature is never
// reached); no record was unsigned; no withheld record lacked its marker; and
// no file held a chain seam or a branch. Each of those is a rule in the format
// with its own named outcome, and a rule with no vector behind it is a rule two
// implementers read differently and never discover.
//
// Vectors 16 to 18 followed later the same day, from the same reading of
// FORMAT.md against the set: the soft branch for a record that names no key
// (the one place where deleting a field moves an edited file from BROKEN to
// PARTIALLY VERIFIED), the file's own key failing its own fingerprint (the
// only terminal reading besides a failed manifest, and the shape an attacker
// who substitutes a key produces), and a withheld record pointing at a marker
// other than the one attesting it. Vector 19 followed the `unattributed`
// counter into the published projection: the counter was in EXPECTED.json and
// every file left it at zero, so a checker that attributed every seam, or no
// seam at all, passed the whole set.
//
// Vector 20 came on 2026-09-19 from a reading that turned out to be wrong. It
// said a withheld record with no signature at all was a hole, because deleting
// one field moves a file from partial to VERIFIED. It is not a hole: the marker
// is a signed record naming that record's id and its stored hash, and a file
// whose marker does not verify fails before this. The vector stays, because a
// rule defended only in a comment gets re-argued, and because the reading did
// find something beside it: the note said the signature had been checked.
//
// Note what EXPECTED.json is and is not. It is written by running the
// committed checker over each file, so it locks the behaviour there is, not
// the behaviour there should be. The hand-written block below is the only
// thing here that judges whether a reading is RIGHT, so every vector gets a
// line in it stating the reading intended for that file.

import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { SPAWN_TIMEOUT_MS } from '../helpers/spawn-timeout';
import { exportWording, freshExportScaffolding, freshExportWording, REGENERATE, scriptSignatures } from '../helpers/export-scaffolding';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXPECTED_PATH, VECTORS_DIR, project, type Expected } from '../../scripts/build-verifier-vectors';
import { STANDALONE_VERIFIER_PATH } from '../../scripts/build-standalone-verifier';

// This file starts child processes, so its tests do not fit vitest's 5s
// default under a 546-file parallel run. See tests/helpers/spawn-timeout.ts.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS });

const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, Expected>;
const files = readdirSync(VECTORS_DIR).filter((f) => f.endsWith('.html')).sort();

function run(name: string): Expected {
  let out: string;
  try {
    out = execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, join(VECTORS_DIR, name), '--json'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch (err) {
    out = (err as { stdout: string }).stdout;
  }
  return project(JSON.parse(out) as Record<string, unknown>);
}

describe('verifier/vectors', () => {
  it('EXPECTED.json names every file and nothing else', () => {
    expect(Object.keys(expected).sort()).toEqual(files);
    // 21 and 22 are the two sides of the rule that a month flip is not a seam;
    // 23 is a marker naming a middle record, the shape a restore leaves, and 24
    // a marker nothing signed. 25 and 26 are records that carry a subject.
    expect(files).toHaveLength(26);
  });

  it.each(files)('%s reads as EXPECTED.json says', (name) => {
    expect(run(name)).toEqual(expected[name]);
  });

  it('the readings are the ones the format promises', () => {
    expect(expected['01-verified.html']).toMatchObject({ state: 'verified', manifest: 'ok', records: 3, keys: 1, firstFailure: null });
    expect(expected['02-no-manifest.html']).toMatchObject({ state: 'partial', manifest: 'missing', firstFailure: null });
    expect(expected['03-record-edited.html']).toMatchObject({ state: 'failed', firstFailure: { index: 1, reason: 'tampered' } });
    expect(expected['04-manifest-edited.html']).toMatchObject({ state: 'failed', firstFailure: { index: -1, reason: 'manifest' } });
    expect(expected['05-withheld-record.html']).toMatchObject({ state: 'verified', manifest: 'ok', records: 4, redacted: 1, firstFailure: null });
    expect(expected['06-carried-key.html']).toMatchObject({ state: 'partial', keys: 2, carriedKey: 2, firstFailure: null });
    expect(expected['07-prior-key-missing.html']).toMatchObject({ state: 'partial', keys: 1, unverified: { priorKey: 2, unsigned: 0, signatureUnverified: 0 } });
    expect(expected['08-self-minted-token.html']).toMatchObject({ state: 'partial', anchorsOk: [true], anchorAuthorities: [null] });
    expect(expected['09-key-dated.html']).toMatchObject({ state: 'verified', keyDatedBy: ['FreeTSA (freetsa.org) Root CA'] });
    // A report that states its selection: the missing predecessor is its own doing, so it reads verified, as a report.
    expect(expected['10-report-selection.html']).toMatchObject({ state: 'verified', manifest: 'ok', records: 2, outside: 1, holding: { kind: 'report', included: 2, totalSource: 3, leftOut: 1 } });
    expect(expected['01-verified.html'].holding).toMatchObject({ kind: 'whole-record', included: 3, totalSource: null, leftOut: 0 });
    // Text that is not plain ASCII changes nothing about the reading: the file
    // verifies, which is the point. What it exercises is section 3's canonical
    // form, and the assertion that carries that is the one below over the bytes.
    expect(expected['11-text-escaping.html']).toMatchObject({ state: 'verified', manifest: 'ok', records: 3, keys: 1, firstFailure: null });
    // The hash is right and the signature is wrong: the format's one security property.
    expect(expected['12-forged-signature.html']).toMatchObject({ state: 'failed', manifest: 'ok', records: 3, firstFailure: { index: 1, reason: 'key-mismatch' } });
    expect(expected['13-unsigned-record.html']).toMatchObject({ state: 'partial', manifest: 'ok', firstFailure: null, unverified: { priorKey: 0, unsigned: 1, signatureUnverified: 0, signatureRejected: 0 } });
    // A withheld record with no marker naming it is BROKEN, not a quiet pass.
    expect(expected['14-redaction-unattested.html']).toMatchObject({ state: 'failed', manifest: 'ok', redacted: 0, firstFailure: { index: 1, reason: 'redaction-unattested' } });
    // A seam and a branch fail nothing on their own and keep the file off green.
    expect(expected['15-seam-and-branch.html']).toMatchObject({ state: 'partial', manifest: 'ok', records: 4, firstFailure: null, outside: 0, branches: 1, restarts: 1 });
    // The sharpest edge in the format, and this reading is the intended one: an
    // edited record that names NO key is not called an edit. The file has no
    // manifest, the last record's text was changed, its unkeyed hash recomputed
    // and its old signature kept, and such a record could equally have been
    // signed by a key that has since rotated. So it is counted and said out
    // loud, never failed.
    //
    // The whole content of this vector is the PAIR, measured by hand on
    // 2026-09-18 over this file and a twin of it:
    //   publicKeyFingerprint present on that record: state failed, failures
    //     [{index: 2, id: 'v-2', reason: 'key-mismatch'}], exit 2.
    //   the same field deleted and the hash recomputed: state partial,
    //     failures [], signatureRejected 1, exit 1.
    // Deleting one field moves an edited file from BROKEN to PARTIALLY
    // VERIFIED. The edit is on the LAST record so that nothing else can be the
    // cause: a middle record's recomputed hash orphans the next record's
    // prevRecordHash, and that seam alone caps a file at partial, which would
    // make the file read partial either way and demonstrate nothing. Hence the
    // three zeroes asserted here beside the counter.
    expect(expected['16-edited-unfingerprinted.html']).toMatchObject({
      state: 'partial', manifest: 'missing', records: 3, firstFailure: null,
      restarts: 0, branches: 0, outside: 0,
      unverified: { priorKey: 0, unsigned: 0, signatureUnverified: 0, signatureRejected: 1 },
    });
    // The key is set up before any record is read, so a file whose embedded key
    // does not match its own stated fingerprint stops there and says so: no
    // records checked, no keys, one failure at index -1. Nothing about the
    // records may be reported, because nothing about them was checked.
    expect(expected['17-key-setup-fingerprint-mismatch.html']).toMatchObject({
      state: 'failed', records: 0, keys: 0, holding: null, firstFailure: { index: -1, reason: 'key-setup' },
    });
    // The back-reference, both halves in one file: the first withheld record
    // points at the other one's marker and is unattested even though a marker
    // in the file names it and the hashes match; the second points at its own
    // and reads as withheld, which is what redacted: 1 says here.
    expect(expected['18-redaction-marker-mismatch.html']).toMatchObject({
      state: 'failed', manifest: 'ok', records: 5, redacted: 1, firstFailure: { index: 1, reason: 'redaction-unattested' },
    });
    // A seam whose attribution the file cannot make: the record before the
    // break belongs to a generation whose key the file no longer carries, so it
    // reads prior-key and nothing says the same install signed both sides. The
    // counters are the whole point of this one and were measured on 2026-09-18:
    // restarts 1 AND unattributed 1, with branches and outside at 0, priorKey 1,
    // nothing failed, exit 1. Vector 15 holds the other half of the rule, a seam
    // both of whose sides verify, where unattributed stays 0. The checker also
    // prints "1 seam(s) could not be attributed by signature" for this file,
    // which is the sentence a reader gets for the counter.
    expect(expected['19-unattributed-seam.html']).toMatchObject({
      state: 'partial', manifest: 'ok', records: 3, keys: 1, firstFailure: null,
      restarts: 1, unattributed: 1, branches: 0, outside: 0,
      unverified: { priorKey: 1, unsigned: 0, signatureUnverified: 0, signatureRejected: 0 },
    });
    expect(expected['15-seam-and-branch.html']).toMatchObject({ unattributed: 0 });
    // A withheld record with no signature at all. The intended reading is
    // VERIFIED and NOT unsigned, which is the one place this format treats a
    // missing signature as harmless, and it is harmless for a reason worth
    // stating: the marker is itself a signed record whose hashed text names
    // this record's id and its stored hash, and a file whose marker does not
    // verify fails at `redaction-unattested` a few lines up. So the install has
    // vouched for the hash with or without the record's own signature.
    // A read on 2026-09-19 called this a hole, on the grounds that deleting one
    // field turns partial into VERIFIED; the reading was wrong and the vector
    // exists so the next reader meets the argument instead of the gap. What was
    // actually wrong is the note, pinned by the case below this block: the
    // checker told the reader the signature had been checked.
    expect(expected['20-withheld-unsigned.html']).toMatchObject({
      state: 'verified', manifest: 'ok', records: 4, keys: 1, firstFailure: null, redacted: 1,
      unverified: { priorKey: 0, unsigned: 0, signatureUnverified: 0, signatureRejected: 0 },
    });
    expect(expected['05-withheld-record.html']).toMatchObject({ state: 'verified', redacted: 1 });
    // The linked run, both sides, added 2026-09-20. A month-rotation marker at
    // position 0 whose priorChainHash names a record that is in the file opens
    // a new run, so the positions after it are compared only with each other:
    // six records across two months, nothing counted, VERIFIED. Before this,
    // every whole-record export that crossed a month boundary read PARTIALLY
    // VERIFIED with "7 chain seams" and nothing was lost.
    expect(expected['21-month-rotation-linked.html']).toMatchObject({
      state: 'verified', manifest: 'ok', records: 6, branches: 0, restarts: 0, outside: 0, firstFailure: null,
    });
    // The same file with the marker naming a record that is NOT here, which is
    // what keeps the rule from widening: nothing shows which run the marker
    // follows, so the three reused positions are branches exactly as they were
    // before, and the marker still names a predecessor outside the file.
    expect(expected['22-month-rotation-unlinked.html']).toMatchObject({ state: 'partial', branches: 3, outside: 1, firstFailure: null });
    // 23: the marker names the FIRST record of last month, a record that
    // another record already names as its predecessor, which is the shape a
    // restore leaves. The run links, and the two records after the one named
    // are set aside: counted once each, and the file stays partial, so linking
    // into the middle of a run erases nothing. 24: the marker names the right
    // record and carries no signature, so nothing vouches for the link it
    // claims and the reused positions stay branches; unsigned 1 is what says the
    // marker itself is the unverified record. Neither counts the marker's
    // genesis text as a missing predecessor, because it names no record.
    expect(expected['23-month-rotation-names-a-middle-record.html']).toMatchObject({
      state: 'partial', manifest: 'ok', records: 6, setAside: 2, branches: 0, outside: 0, restarts: 0, firstFailure: null,
    });
    expect(expected['24-month-rotation-marker-unsigned.html']).toMatchObject({
      state: 'partial', manifest: 'ok', records: 6, setAside: 0, branches: 3, outside: 0, restarts: 0, firstFailure: null,
      unverified: { priorKey: 0, unsigned: 1, signatureUnverified: 0, signatureRejected: 0 },
    });
    expect(expected['22-month-rotation-unlinked.html']).toMatchObject({ setAside: 0 });
    expect(expected['21-month-rotation-linked.html']).toMatchObject({ setAside: 0 });
    // A document, a consent string and a note, each hashed with its subject and signed: the checker
    // verifies every one. Changing the consent string after signing fails that record, at index 1.
    expect(expected['25-subject-records.html']).toMatchObject({
      state: 'verified', manifest: 'ok', records: 3, keys: 1, firstFailure: null,
      unverified: { priorKey: 0, unsigned: 0, signatureUnverified: 0, signatureRejected: 0 },
    });
    expect(expected['26-subject-edited.html']).toMatchObject({ state: 'failed', firstFailure: { index: 1, reason: 'tampered' } });
  });

  it('25 and 26 really carry subject records, one of each kind and no feed field', () => {
    for (const name of ['25-subject-records.html', '26-subject-edited.html']) {
      const html = readFileSync(join(VECTORS_DIR, name), 'utf8');
      const body = /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/.exec(html)?.[1] ?? '';
      const records = (JSON.parse(body) as { records: Array<Record<string, unknown>> }).records;
      expect(records.map((r) => r.kind)).toEqual(['document', 'consent', 'note']);
      for (const r of records) {
        expect(r.subject, `${name} ${String(r.id)}`).toBeTypeOf('object');
        for (const feedKey of ['platform', 'originalText', 'author', 'postUrl', 'techniques']) expect(r).not.toHaveProperty(feedKey);
      }
    }
  });

  // FORMAT.md section 4 check 1 ends: "The note a checker prints MUST NOT say
  // the signature of such a record was checked." On 2026-09-19 it did. The
  // count behind that sentence named one reason a signature goes unchecked, a
  // rotated key, and a record carrying no signature at all fell through it into
  // the checked column, so a recipient holding this file was told the strongest
  // thing the checker can say about a withheld record, over a record where it
  // had done nothing. EXPECTED.json is a projection and carries no notes, so
  // the block above cannot see this; only running the checker can.
  it('20 does not tell the reader a signature was checked when there was none', () => {
    const out = execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, join(VECTORS_DIR, '20-withheld-unsigned.html'), '--json'], { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS });
    const report = JSON.parse(out) as { notes: string[]; redacted: number };
    const note = report.notes.find((n) => n.includes('had fields withheld'));
    expect(note, 'the withheld note is printed at all').toBeTruthy();
    expect(note).not.toContain('its signature over that hash was checked');
    expect(note).toContain('no signature at all');
    // The control: vector 05 is the same file with the signature left on, and
    // there the sentence is true and must still be said.
    const ok = execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, join(VECTORS_DIR, '05-withheld-record.html'), '--json'], { encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS });
    const okNote = (JSON.parse(ok) as { notes: string[] }).notes.find((n) => n.includes('had fields withheld'));
    expect(okNote).toContain('its signature over that hash was checked');
  });

  // EXPECTED.json is a projection and carries no `detail`, so the cause of a
  // key-setup failure is invisible to the comparison above: all three causes
  // (no coordinates, fingerprint mismatch, a key Web Crypto refuses) project
  // identically. Vector 17 is the fingerprint-mismatch one and nothing else
  // would notice if it were rebuilt as another cause.
  it('17 fails key setup for the fingerprint, not for one of the other two causes', () => {
    let out: string;
    try {
      out = execFileSync(process.execPath, [STANDALONE_VERIFIER_PATH, join(VECTORS_DIR, '17-key-setup-fingerprint-mismatch.html'), '--json'], { encoding: 'utf8' });
    } catch (err) {
      out = (err as { stdout: string }).stdout;
    }
    const report = JSON.parse(out) as { failures: Array<{ detail?: string }> };
    expect(report.failures[0].detail).toContain('fingerprint mismatch');
  });

  // Without this, an editor could ASCII-ify vector 11 and every test here would
  // stay green over a file that no longer exercises the one rule it exists for.
  // Section 3 says the canonical form is JSON.stringify; these are the cases a
  // second implementer in another language has to reproduce by hand, and on
  // 2026-09-18 a Python re-serialisation of this same payload matched the
  // file's own recordsDigest only once the lone surrogate was escaped and the
  // numbers were printed the way JS prints them.
  it('11-text-escaping.html carries the characters it was built for', () => {
    const html = readFileSync(join(VECTORS_DIR, '11-text-escaping.html'), 'utf8');
    const payload = /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/.exec(html);
    expect(payload, 'the payload element is there').not.toBeNull();
    const raw = payload![1];
    expect(raw).toContain('\u{1F9FF}');          // an astral emoji, left raw
    expect(raw).toContain('\u201C');             // a curly quote, left raw
    expect(raw).toContain('\u00e9');             // an accented letter, left raw
    expect(raw.toLowerCase()).toContain('\\ud83d'); // a lone surrogate, escaped (ES2019)
    expect(raw).toContain('/watch?v=1');         // a solidus, never escaped
    expect(raw).not.toContain('\\/');
    expect(raw).toContain('\\"');                // a quote inside a string
    expect(raw).toContain('C:\\\\Users');        // a backslash inside a string
    for (const short of ['\\n', '\\r', '\\t', '\\b', '\\f']) expect(raw).toContain(short);
    expect(raw).toContain('\\u0001');            // everything else below 0x20
    const records = JSON.stringify((JSON.parse(raw) as { records: unknown[] }).records);
    expect(records).toContain('"tieBreak":1e-7'); // the shortest form of a number is not the same string in every language
    expect(records).toContain('0.6666666666666666');
    expect(records).toContain('"severityFloor":{"1":0.2,"2":0.55,"10":0.9}'); // written 10, 2, 1; a JS object reorders integer-like keys
  });

  it('every vector says it is invented', () => {
    for (const name of files) {
      expect(readFileSync(join(VECTORS_DIR, name), 'utf8')).toContain('TEST VECTOR: every record in this file is invented');
    }
  });

  // The vectors are built once and committed, so nothing rebuilds them when the exporter changes.
  // On 2026-09-16 they carried 12 inline scripts against the exporter's 14: the numbers engine had
  // been inlined into every export and the vectors, which are what a second implementer works from,
  // showed an export without it. Every other test here stayed green, because each vector was still
  // internally consistent and the checker still read it correctly.
  it('every vector carries the scripts the exporter writes today', () => {
    const fresh = freshExportScaffolding();
    expect(fresh.length, 'the exporter writes some inline scripts').toBeGreaterThan(5);
    for (const name of files) {
      expect(scriptSignatures(readFileSync(join(VECTORS_DIR, name), 'utf8')), `${name}: ${REGENERATE}`).toEqual(fresh);
    }
  });

  // The same lag in the wording: two rows added to the report sat in the exporter's table and in no
  // vector, and the check above could not see it, because the table travels in the payload block.
  // No vector edits its wording on purpose, so each must carry today's table whole.
  it('every vector carries the wording the exporter writes today', () => {
    const fresh = freshExportWording('en');
    expect(Object.keys(fresh).length, 'the exporter writes a wording table').toBeGreaterThan(100);
    for (const name of files) {
      expect(exportWording(readFileSync(join(VECTORS_DIR, name), 'utf8')), `${name}: ${REGENERATE}`).toEqual(fresh);
    }
  });
});
