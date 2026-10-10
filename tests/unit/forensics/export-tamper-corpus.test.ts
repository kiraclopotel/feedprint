// @vitest-environment node
//
// The corpus behind one sentence: "A file that reads VERIFIED has not changed since the key that
// signed it signed it." It is on landing/check.html:192 and it is the whole claim the product rests
// on. It sat in scripts/verify/promises.registry.mjs with nothing checking it, and its own
// whyNotChecked named the check that would decide it: a corpus of exports altered one byte at a
// time, in each field that matters, every one of which the checker must refuse.
//
// The mutations, why each field matters, and the readings measured from them live in
// tests/helpers/export-tamper-corpus.mjs, so that this test and the promise check in
// scripts/verify/product-copy-claims.mjs drive one corpus rather than two.
//
// BOTH SIDES ARE ASSERTED HERE. A checker that refuses everything passes a tampering corpus and is
// useless to the person holding a sound file, so the unmutated export is run down the same path in
// the same run and must still read VERIFIED. All twenty four mutants must be refused. An edit measured
// to SURVIVE a verified reading is kept in the corpus with that reading recorded, so the gap is a red
// test the day somebody closes it rather than a belief nobody revisits; there is no such edge today.
//
// Five were recorded as surviving on 2026-09-18 and all five were closed the same day. Three were
// rendered page text under no digest, and the builder now marks every row that states something about
// the file or the records; the fourth was the envelope's profile block, which the checker holds
// against the signed rows rendered from it; the fifth was the label beside a signed value, which took
// the format's coverage rule widened from two tags to three and all three implementations of that
// rule changed together.
//
// It drives the checker the way tests/unit/forensics/standalone-verifier.test.ts does: the built
// verifier/verify-export.mjs as a child process with --json, which is what a recipient runs.

import { describe, expect, it, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { SPAWN_TIMEOUT_MS } from '../../helpers/spawn-timeout';
import {
  BASE_EXPORT_PATH,
  BASE_EXPORT_REL,
  CHECKER_PATH,
  MUTATIONS,
  type CorpusRun,
  runCorpus,
} from '../../helpers/export-tamper-corpus.mjs';

// One child process per file in the corpus, so this does not fit vitest's 5s default under a
// parallel run. Same reason and same constant as the standalone verifier test.
vi.setConfig({ testTimeout: SPAWN_TIMEOUT_MS, hookTimeout: SPAWN_TIMEOUT_MS });

let run: CorpusRun;

beforeAll(() => {
  run = runCorpus({ checkerPath: CHECKER_PATH, baseHtml: readFileSync(BASE_EXPORT_PATH, 'utf8') });
});

/** The reading for one mutation, by name, so a failure names the mutation rather than an index. */
function whole(name: string) {
  const row = run.whole.find((r) => r.name === name);
  if (!row) throw new Error(`no mutation called ${name}`);
  return row;
}

function bare(name: string) {
  const row = run.bare.find((r) => r.name === name);
  if (!row) throw new Error(`no bare mutation called ${name}`);
  return row;
}

const MUST_REFUSE = MUTATIONS.filter((m) => m.whole !== 'verified').map((m) => [m.name, m.why] as const);
const SURVIVES = MUTATIONS.filter((m) => m.whole === 'verified').map((m) => [m.name, m.why] as const);
const BARE = MUTATIONS.filter((m) => m.bare !== null).map((m) => [m.name, m.bare, m.why] as const);

describe('the checker over a sound export', () => {
  // THE HALF THAT MATTERS AS MUCH. Everything below is a refusal, and a checker that refuses every
  // file would pass all of it while being worth nothing to the person whose file is sound. This is
  // the same base file, through the same child process, in the same run.
  it(`reads VERIFIED on ${BASE_EXPORT_REL}, unmutated, exit 0`, () => {
    expect(run.original).toMatchObject({ state: 'verified', manifest: 'ok', code: 0 });
  });

  // A corpus that quietly stopped covering a field would report a refusal it never obtained. The
  // names are asserted rather than counted so that dropping one is a failure with a name in it.
  // Until 2026-09-19 this list held twelve of the twenty five and nothing counted
  // the rest, so thirteen cases could be deleted with the suite staying green:
  // among them manifest-signature, record-chain-anchor, public-key-coordinate,
  // and page-does-not-measure-paragraph, which M221 names as a lock. The sibling
  // gate over the verifier vectors pins its own length and this did not. The
  // whole set is named here now, so a deletion fails with the name in it, the way
  // the paragraph above says it should, and an addition fails too: a new tamper
  // vector is a thing somebody should have to write down before it counts.
  it('covers every field the registry entry names, and nothing has been dropped', () => {
    const names = MUTATIONS.map((m) => m.name);
    const expected = [
      // The record and the chain.
      'record-text-one-character',
      'record-author',
      'record-timestamp',
      'record-chain-position',
      'record-prev-record-hash',
      'record-integrity-hash',
      'record-signature-byte',
      'record-removed',
      'record-inserted',
      'records-swapped',
      'record-field-appended',
      'record-chain-anchor',
      // The manifest and the key.
      'manifest-digest',
      'manifest-signature',
      'public-key-coordinate',
      // The envelope around them.
      'envelope-fw-version',
      'envelope-i18n-wording',
      'envelope-tech-label',
      'envelope-profile',
      // The sentences on the page a recipient reads, which the file signs too.
      'page-attributed-provenance-row',
      'page-coverage-sentence',
      'page-key-fingerprint-row',
      'page-limits-sentence',
      'page-does-not-measure-paragraph',
      'page-row-label',
    ];
    for (const required of expected) {
      expect(names, `${required} is no longer in the corpus`).toContain(required);
    }
    expect(
      names.filter((n) => !expected.includes(n)),
      'a tamper case was added without being named here; add it to the list above',
    ).toEqual([]);
    expect(MUTATIONS, 'the corpus is the size this file says it is').toHaveLength(expected.length);
  });
});

describe('an export altered in exactly one place, manifest and all', () => {
  it.each(MUST_REFUSE)('refuses %s (%s)', (name) => {
    const row = whole(name);
    expect(row.observed.state, `${name}: the checker said ${row.observed.state}`).toBe('failed');
    // Exit 2 is the code the checker gives a file it has decided against, and it is what a script
    // on the receiving end branches on. A refusal nobody can act on is half a refusal.
    expect(row.observed.code, `${name}: exit code`).toBe(2);
  });

  // WHICH LINE OF DEFENCE CAUGHT IT. Every mutation above fails at the manifest, because the
  // manifest's recordsDigest is taken over the whole record array and is checked before any record
  // is. That alone would leave the per-record hash and signature machinery untested, so the same
  // edits are made again with the manifest deleted and the reading is recorded per mutation.
  //
  // 'failed' means the record refused the edit by itself. 'partial' means nothing but the manifest
  // ever saw it, which is why FORMAT.md section 4 caps a file without a manifest at PARTIALLY
  // VERIFIED and why this promise is about files that read VERIFIED.
  it.each(BARE)('with the manifest deleted, %s reads %s (%s)', (name, expected) => {
    const row = bare(name);
    expect(row.observed.state, `${name}: the checker said ${row.observed.state}`).toBe(expected);
  });

  it('the per-record check names what it found, not just that it found something', () => {
    // A recipient acts on the reason. "tampered" sends them back to the sender; "key-mismatch"
    // says a signature was run against the key the record names and did not verify.
    expect(bare('record-text-one-character').observed.reason).toBe('tampered');
    expect(bare('record-integrity-hash').observed.reason).toBe('tampered');
    expect(bare('record-signature-byte').observed.reason).toBe('key-mismatch');
  });

  it('names which digest refused the file, so the reason is actionable', () => {
    expect(whole('record-text-one-character').observed.manifest).toBe('records');
    expect(whole('envelope-i18n-wording').observed.manifest).toBe('wording');
    expect(whole('envelope-tech-label').observed.manifest).toBe('labels');
    expect(whole('envelope-fw-version').observed.manifest).toBe('envelope');
    expect(whole('page-attributed-provenance-row').observed.manifest).toBe('page-rows');
    expect(whole('page-coverage-sentence').observed.manifest).toBe('page-rows');
    expect(whole('page-key-fingerprint-row').observed.manifest).toBe('page-rows');
    expect(whole('page-limits-sentence').observed.manifest).toBe('page-rows');
    // Not 'page-rows': the profile block is in the envelope and no digest covers it, so the
    // refusal is the checker finding it disagreeing with the signed rows rendered from it. A
    // recipient reading 'profile' is being told which copy to distrust.
    expect(whole('envelope-profile').observed.manifest).toBe('profile');
    expect(whole('manifest-digest').observed.manifest).toBe('digest');
    expect(whole('manifest-signature').observed.manifest).toBe('signature');
  });
});

// ─── what a VERIFIED reading still does not refuse ───
//
// Measured on 2026-09-18 against verifier/vectors/01-verified.html and verifier/verify-export.mjs.
// One edit, made by somebody with no key, coming back state verified, manifest ok, exit 0. It is
// asserted here as it was measured, which is the only way this file can tell the day somebody closes
// it: the test goes red and asks for the record to be corrected.
//
// Not to be deleted to make a list look finished, and not to be softened. The promise check in
// scripts/verify/product-copy-claims.mjs prints it on every run of `npm run promises`, and the
// registry entry says in its own words what it costs.
describe('edits a VERIFIED reading does not currently refuse', () => {
  it.each(SURVIVES)('%s is not refused: %s', (name) => {
    const row = whole(name);
    expect(
      row.observed.state,
      `${name} now reads ${row.observed.state}. If the checker has been made to refuse it, that is `
      + 'good news and this recorded gap is stale: correct the entry in tests/helpers/'
      + 'export-tamper-corpus.mjs and the still-open text on the promise registry entry.',
    ).toBe('verified');
  });

  // WHAT IS COVERED AND WHAT IS NOT. provenanceDigest is taken over every dd[data-fw-prov] and
  // p[data-fw-prov] in the page (readProvenanceRows in src/forensics/verifier-core-source.ts, built
  // into verifier/verify-export.mjs, with byte-synced twins in extractProvenanceRows in
  // src/forensics/html-export.ts and provenanceDocument in scripts/build-standalone-verifier.ts).
  // Until 2026-09-18 the builder attributed seven of roughly eighteen rendered rows; it now attributes
  // every row that states something about the file or the records, sixteen on a single-key export.
  // The <dt> label beside each value came under the digest later the same day, as its own row named
  // `<value>.label`. It was the last edit in the corpus that a VERIFIED reading did not refuse, and
  // closing it took all three implementations of the reading rule at once.
  it('the value of a signed row is covered, and so is the label introducing it', () => {
    expect(whole('page-attributed-provenance-row').observed.state).toBe('failed');
    expect(whole('page-coverage-sentence').observed.state).toBe('failed');
    expect(whole('page-key-fingerprint-row').observed.state).toBe('failed');
    expect(whole('page-row-label').observed.state).toBe('failed');
  });

  // OLD FILES ARE WHY THE WIDENING IS IN THE BUILDER AND NOT IN THE CHECKER. The digest is taken
  // over the rows a file itself marks, so a file exported before the widening carries its own seven
  // and the same checker recomputes the same seven. Measured on 2026-09-18 against the ten vectors as
  // they stood before this change: all ten still read as EXPECTED.json says. Widening the CHECKER to
  // read unattributed <dd> elements instead would have refused every file already in somebody's
  // hands, which would be worse than the defect it closed.
  it('reads the rows the file marks, not a list of its own', () => {
    // The base file's own marked rows, counted through the same reader the digest uses.
    const marked = readFileSync(BASE_EXPORT_PATH, 'utf8').match(/<(?:dt|dd|p)\b[^>]*?\sdata-fw-prov="[a-zA-Z.]+"/g) ?? [];
    expect(marked.length).toBeGreaterThan(7);
    expect(run.original).toMatchObject({ state: 'verified', manifest: 'ok', code: 0 });
  });
});
