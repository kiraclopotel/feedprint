// verifier/corroborate.mjs carries its OWN copy of the content identity rule,
// deliberately: it ships to people who do not have this tree, and a second
// implementer reads it as the worked example of FORMAT.md section 9. A copy is
// a drift risk, so it is checked from both sides here.
//
// The failure this prevents is silent and one-directional. If the rule in
// src/forensics/content-identity.ts is widened or narrowed and the shipped
// tool is not, then two people running our own published tool on their own
// exports get a corroboration count that disagrees with ours, and nothing
// fails anywhere. Nobody would find that by reading either file.
//
// The behaviour cases live beside these, because the point of the tool is not
// that it computes a hash: it is that it refuses to call one recorder two.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  contentIdentity as treeIdentity,
  normaliseForIdentity as treeNormalise,
} from '../../src/forensics/content-identity';
import {
  contentIdentity as shippedIdentity,
  normaliseForIdentity as shippedNormalise,
  comparability,
  recorderOf,
  readFileIdentities,
  buildReport,
  parseExport,
  // @ts-expect-error - the shipped tool is plain JavaScript with no types
} from '../../verifier/corroborate.mjs';

const CH = (cp: number): string => String.fromCharCode(cp);
const NBSP = CH(0x00A0);
const ZWSP = CH(0x200B);
const ZWJ = CH(0x200D);

interface Vector { group: string; name: string; text: string; identity: string }
const vectors: Vector[] = JSON.parse(
  readFileSync(resolve(__dirname, '../../verifier/vectors/CONTENT-IDENTITY.json'), 'utf8'),
).vectors;

describe('the shipped tool computes the same identity as the tree', () => {
  it.each(vectors.map((v) => [`${v.group} / ${v.name}`, v] as const))(
    'agrees with the published vector for %s',
    async (_label, vector) => {
      expect(await shippedIdentity(vector.text)).toBe(vector.identity);
    },
  );

  it.each([
    ['plain text', 'Wake up'],
    ['a non-breaking space', `Wake${NBSP}up`],
    ['a zero-width space', `Wake${ZWSP} up`],
    ['an emoji joiner, which is kept', `family ${CH(0xD83D)}${CH(0xDC68)}${ZWJ}${CH(0xD83D)}${CH(0xDC69)}`],
    ['decomposed accents', 'adevărul'.normalize('NFD')],
    ['ragged whitespace', '  two   lines  \n\n\n\n  here '],
    ['nothing at all', ''],
  ])('agrees with the tree on %s', async (_label, text) => {
    expect(shippedNormalise(text)).toBe(treeNormalise(text));
    expect(await shippedIdentity(text)).toBe(await treeIdentity(text));
  });
});

// The fixtures are envelopes, not real exports: this tool reads the payload and
// nothing else, so a real export would add 90 fields it never looks at.
// `textCapture` is OMITTED, not set to undefined, when the caller asks for the
// legacy shape: JSON.stringify drops an undefined value, so the two are the same
// on the wire, and a default parameter would quietly turn the legacy case back
// into 'whole' and make the test pass for the wrong reason.
const record = (text: string, textCapture: string | null = 'whole') =>
  (textCapture === null ? { originalText: text } : { originalText: text, textCapture });
const envelope = (fingerprint: string | undefined, records: unknown[]) =>
  JSON.stringify({ publicKeyJwk: { kty: 'EC' }, publicKeyFingerprint: fingerprint, records });

const SHARED = 'Guvernul ascunde adevărul. Trezește-te acum!';

describe('what counts as two observers', () => {
  it('refuses to call one recorder two, however many files it exported', async () => {
    // The easiest way to produce a confident number that means nothing.
    const a = await readFileIdentities(envelope('key-one', [record(SHARED), record('only here')]), 'a');
    const b = await readFileIdentities(envelope('key-one', [record(SHARED), record('and here')]), 'b');

    const report = buildReport([a, b]);

    expect(report.recorders).toBe(1);
    expect(report.corroborated).toBe(0);
  });

  it('counts two keys as two recorders, and finds what they share', async () => {
    const a = await readFileIdentities(envelope('key-one', [record(SHARED), record('only in a')]), 'a');
    const b = await readFileIdentities(envelope('key-two', [record(SHARED), record('only in b')]), 'b');

    const report = buildReport([a, b]);

    expect(report.recorders).toBe(2);
    expect(report.distinctItems).toBe(3);
    expect(report.corroborated).toBe(1);
    expect(report.shared[0][1]).toBe(2);
  });

  it('meets across the extraction noise that is the whole reason for the rule', async () => {
    // Two real readings of one post differ like this constantly. Before the
    // rule they filed two different items and agreed about nothing.
    const a = await readFileIdentities(envelope('key-one', [record(SHARED)]), 'a');
    const b = await readFileIdentities(
      envelope('key-two', [record(`  ${SHARED.normalize('NFD').replace(' ', NBSP)}\r\n`)]),
      'b',
    );

    expect(buildReport([a, b]).corroborated).toBe(1);
  });

  it('keeps a file that states no key in a group of its own', async () => {
    // Two files that cannot be SHOWN to come from different recorders must
    // never be counted as different recorders. Unknown is not a licence to
    // assume the useful answer.
    const one = recorderOf({ records: [] }, 'one.json');
    const two = recorderOf({ records: [] }, 'two.json');

    expect(one.known).toBe(false);
    expect(one.key).not.toBe(two.key);
  });

  it('takes the key off a record when the envelope does not carry one', async () => {
    const data = parseExport(JSON.stringify({
      publicKeyJwk: { kty: 'EC' },
      records: [{ originalText: 'x', textCapture: 'whole', publicKeyFingerprint: 'from-the-record' }],
    }));
    expect(recorderOf(data, 'f.json')).toEqual({ key: 'from-the-record', known: true });
  });
});

describe('what may not be compared at all', () => {
  it.each([
    ['whole', 'comparable'],
    ['folded', 'comparable'],
    ['cut', 'incomparable'],
    ['platform', 'incomparable'],
    [undefined, 'unknown'],
  ])('reads capture %s as %s', (textCapture, expected) => {
    expect(comparability({ textCapture })).toBe(expected);
  });

  it('never lets a truncated caption meet another observer', async () => {
    // The cut point moves with the viewport, so two readings of one post hold
    // two different strings and are each right. Merging them would be a false
    // merge, and a systematic one.
    const a = await readFileIdentities(envelope('key-one', [record(SHARED, 'cut')]), 'a');
    const b = await readFileIdentities(envelope('key-two', [record(SHARED, 'cut')]), 'b');

    expect(a.counts.incomparable).toBe(1);
    expect(buildReport([a, b]).corroborated).toBe(0);
  });

  it('does not quietly lean on records written before capture was recorded', async () => {
    const a = await readFileIdentities(envelope('key-one', [record(SHARED, null)]), 'a');
    const b = await readFileIdentities(envelope('key-two', [record(SHARED, null)]), 'b');

    expect(a.counts.unknown).toBe(1);
    expect(buildReport([a, b]).corroborated).toBe(0);
  });

  it('never corroborates a placeholder, which is not content', async () => {
    // The recorder writes "[blocked: <reason>]" where an item had no caption.
    // Letting those meet would agree about the placeholder, not about anything
    // anyone was served, and they are identical across every install.
    const a = await readFileIdentities(envelope('key-one', [record('[blocked: ai-label:en]')]), 'a');
    const b = await readFileIdentities(envelope('key-two', [record('[blocked: ai-label:en]')]), 'b');

    expect(a.counts.empty).toBe(1);
    expect(buildReport([a, b]).corroborated).toBe(0);
  });

  it('never corroborates a record whose text normalises away to nothing', async () => {
    const a = await readFileIdentities(envelope('key-one', [record('   \n\n  ')]), 'a');
    const b = await readFileIdentities(envelope('key-two', [record('\t')]), 'b');

    expect(buildReport([a, b]).corroborated).toBe(0);
  });
});

describe('the file it is handed', () => {
  it('reads a payload out of an HTML export whatever order the attributes are in', () => {
    const inner = JSON.stringify({ publicKeyJwk: {}, records: [] });
    const html = `<html><script id="fw-export-data" type="application/json">${inner}</script></html>`;
    expect(parseExport(html).records).toEqual([]);
  });

  it('says what is wrong rather than throwing something unreadable', () => {
    expect(() => parseExport('<html>nothing here</html>')).toThrow(/no fw-export-data payload/);
    expect(() => parseExport('[]')).toThrow(/not an object|no records array/);
    expect(() => parseExport('{"publicKeyJwk":{}}')).toThrow(/no records array/);
  });
});
