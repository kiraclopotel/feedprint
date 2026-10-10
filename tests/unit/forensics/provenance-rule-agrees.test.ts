// @vitest-environment jsdom
//
// One reading rule, three implementations, and the only test that reads all
// three at once (2026-09-18).
//
// provenanceDigest is taken over the page rows a file marks with data-fw-prov.
// Three separate programs implement "which elements are those, and what is the
// text of each": the builder's regex in src/forensics/html-export.ts, which
// decides what gets SIGNED; the browser checker's querySelectorAll, which runs
// in the page a recipient opens; and the node checker's own HTML shim in
// scripts/build-standalone-verifier.ts, which has no DOM at all. They must
// agree exactly. When they do not, the failure is not a wrong verdict on a bad
// file, it is a WRONG VERDICT ON A GOOD ONE: the builder signs a set the
// checker cannot reproduce, and every file exported that day reads BROKEN in
// the hands of the person it was sent to.
//
// That has now happened twice, in both directions:
//
//   2026-09-16  the shim anchored the attribute to the position straight after
//               the tag name. Two rows carried a class first. The page read 16
//               rows, the shim read 14, every fresh file read BROKEN.
//   2026-09-18  labels were brought under the digest. The shim matched dd and p
//               only, and closed each row on whichever of </dd> and </p> came
//               first. A label is immediately followed by the value it
//               introduces, so a widened shim that kept that rule would have
//               signed the label as though it were the value.
//
// Both were found by building a file and watching it fail, which is late. This
// test asks the question directly and without a build, on every kind of element
// the rule covers, so the third one is found on the diff.
//
// What it does NOT do is compare the three implementations line by line. It
// compares their READINGS of a real signed export, which is the only comparison
// that can fail usefully: three programs that look alike and disagree is the
// defect, and three that look nothing alike and agree is fine.

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';

import { extractProvenanceRows } from '../../../src/forensics/html-export';
import { BROWSER_VERIFIER_PATH, STANDALONE_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { VECTORS_DIR } from '../../../scripts/build-verifier-vectors';
import { REPO_ROOT } from '../../helpers/repo-root';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

interface Reading { state: string; manifest: string }
interface Checker { verifyExportText(text: string): Promise<Reading> }

// A real export from the same exporter a person's own file comes out of, read
// off disk rather than built here, for the reason the tamper corpus gives: a
// file built inside the test would compare this file's idea of the format with
// the checker's, which is the one comparison that cannot fail usefully.
const BASE = readFileSync(join(VECTORS_DIR, '01-verified.html'), 'utf8');

let browser: Checker;
let node: Checker;

beforeAll(async () => {
  const src = readFileSync(BROWSER_VERIFIER_PATH, 'utf8');
  new Function('window', 'crypto', 'atob', 'TextEncoder', src)(window, crypto, atob, TextEncoder);
  browser = (window as unknown as { FWVerifier: Checker }).FWVerifier;
  node = (await import(/* @vite-ignore */ `file://${STANDALONE_VERIFIER_PATH.replace(/\\/g, '/')}`)) as unknown as Checker;
});

/** One character of one row's text, changed where the row lives in the page. */
function editRow(html: string, name: string, find: string, replace: string): string {
  const open = html.indexOf(`data-fw-prov="${name}"`);
  expect(open, `the export still carries a row named ${name}`).toBeGreaterThan(-1);
  const at = html.indexOf(find, open);
  expect(at, `the row named ${name} still reads ${find}`).toBeGreaterThan(-1);
  return html.slice(0, at) + replace + html.slice(at + find.length);
}

describe('the marked rows, as all three implementations read them', () => {
  it('the builder signs every kind of element the rule names, labels included', () => {
    const rows = extractProvenanceRows(BASE);
    const names = rows.map((r) => r[0]);
    expect(names.length).toBeGreaterThan(20);
    expect(new Set(names).size, 'a name is unique in a file, because the rows sort by name alone').toBe(names.length);

    // Every value row has its label beside it and neither is empty. An empty
    // text is what a reader that found the element and missed its content
    // returns, and it would digest identically whatever the page said.
    const labels = names.filter((n) => n.endsWith('.label'));
    expect(labels.length).toBeGreaterThan(10);
    for (const label of labels) {
      expect(names, `${label} introduces a row that is itself signed`).toContain(label.slice(0, -'.label'.length));
    }
    for (const [name, text] of rows) expect(text.length, `${name} has text`).toBeGreaterThan(0);

    // The paragraphs, which are <p> and not in the definition list at all.
    expect(names).toContain('whatThisDoes');
  });

  it('both shipped checkers read the unaltered file as verified, which is the half that is easy to lose', async () => {
    // A checker that refuses everything passes every tampering test. This is
    // also the assertion that catches the two defects above: a builder and a
    // checker that disagree make a GOOD file read broken, and nothing else in
    // the suite notices until a file is built.
    expect(await browser.verifyExportText(BASE)).toMatchObject({ state: 'verified', manifest: 'ok' });
    expect(await node.verifyExportText(BASE)).toMatchObject({ state: 'verified', manifest: 'ok' });
  });

  it('both shipped checkers open a file whose payload tag orders its attributes the other way', async () => {
    // NOT a tampering, which is why it is here and not in the tamper corpus: the
    // same payload bytes under a conforming opening tag. A browser's
    // getElementById does not care about attribute order, and FORMAT.md tells a
    // second recorder in a paragraph of its own that attribute position is not
    // load-bearing. Until 2026-09-18 both checkers matched this one element as a
    // literal string, so such a file came back "not a FeelingWise export", which
    // is the worst answer a checker can give a sound file.
    //
    // Found by an engineer writing an independent checker from the specification
    // alone and probing where the spec ran out. The lesson had been written up
    // for the provenance attribute one section lower and never applied to the
    // element the whole format hangs on.
    const reordered = BASE.replace(
      '<script type="application/json" id="fw-export-data">',
      '<script  id="fw-export-data"   type="application/json">',
    );
    expect(reordered).not.toBe(BASE);
    expect(await browser.verifyExportText(reordered)).toMatchObject({ state: 'verified', manifest: 'ok' });
    expect(await node.verifyExportText(reordered)).toMatchObject({ state: 'verified', manifest: 'ok' });
  });

  it.each([
    // A <dt> label: the signed digits of the key fingerprint under a different
    // name. This is the edit that read VERIFIED until 2026-09-18.
    ['a label', (h: string) => editRow(h, 'fingerprint.label', 'Public key fingerprint', 'Archive fingerprint')],
    // A <dd> value, which has been signed since the digest existed.
    ['a value', (h: string) => editRow(h, 'recordCount', '>', '>0 ')],
    // A <p> paragraph, signed since the widening of 2026-09-18's morning.
    ['a paragraph', (h: string) => editRow(h, 'whatThisDoes', 'does not establish', 'establishes')],
  ])('both shipped checkers refuse %s changed by one hand', async (_what, edit) => {
    const bad = edit(BASE);
    expect(bad).not.toBe(BASE);
    expect((await browser.verifyExportText(bad)).state, 'the browser checker').toBe('failed');
    expect((await node.verifyExportText(bad)).state, 'the node checker').toBe('failed');
  });
});

describe('the rule as the three implementations state it', () => {
  // The readings above are the real test. This one is here because when they
  // disagree, the question is immediately WHICH of the three is wrong, and the
  // three rules are in three files a reader would not think to open together.
  it('names the same three tags in all three, and in the format the second implementer reads', () => {
    const builder = readFileSync(join(REPO_ROOT, 'src/forensics/html-export.ts'), 'utf8');
    const page = readFileSync(join(REPO_ROOT, 'src/forensics/verifier-core-source.ts'), 'utf8');
    const shim = readFileSync(join(REPO_ROOT, 'scripts/build-standalone-verifier.ts'), 'utf8');
    const format = readFileSync(join(REPO_ROOT, 'verifier/FORMAT.md'), 'utf8');

    expect(builder).toContain('/<(dt|dd|p)\\b[^>]*?\\sdata-fw-prov="([a-zA-Z.]+)"[^>]*>([\\s\\S]*?)<\\/\\1>/g');
    expect(page).toContain("querySelectorAll('dt[data-fw-prov],dd[data-fw-prov],p[data-fw-prov]')");
    expect(shim).toContain('/<(dt|dd|p)\\\\b[^>]*?\\\\sdata-fw-prov="([a-zA-Z.]+)"[^>]*>/g');
    // The shim has no DOM, so it has to find each row's end itself, and it must
    // close on that row's OWN tag. See the header of this file.
    expect(shim).toContain("const close = '</' + m[1] + '>';");
    expect(format).toContain('`<dt data-fw-prov="name">`');
  });
});
