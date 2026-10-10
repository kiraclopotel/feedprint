// verifier/observations.mjs writes out what a feed served, with every model
// reading left out, so somebody doing measurement can cite the observations
// without citing a model whose behaviour changes between releases.
//
// The whole value of the file is an absence, and an absence is the hardest
// thing to keep. These cases hold it from the side that survives the format
// growing: rather than listing the reading fields we know about today, they
// take the canonical payload's OWN field list, fill every field the projection
// does not claim with a unique sentinel, and assert that no sentinel reaches
// the output. A field added to the record next year is covered on the day it is
// added, without anybody remembering this file exists.
//
// The second gate is the one that already earned itself. The tool's list of
// chain-marker kinds was first written from memory and got five of the nine
// names wrong, which would have put rotation, prune, heartbeat, repair and
// reconcile markers into a table of what a feed served, silently.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SYSTEM_MARKER_KINDS } from '../../src/forensics/system-records';
import { contentIdentity as treeIdentity } from '../../src/forensics/content-identity';
import {
  OBSERVATION_FIELDS,
  SYSTEM_KINDS,
  comparability,
  contentIdentity as shippedIdentity,
  csvField,
  hasControlCharacter,
  hasUnpairedSurrogate,
  isObservation,
  parseExport,
  project,
  // @ts-expect-error - the shipped tool is plain JavaScript with no types
} from '../../verifier/observations.mjs';

/**
 * The canonical payload's field list, read out of the published checker where
 * it is drift-locked against the production hasher. Read rather than retyped:
 * a copy here would be one more list to forget.
 */
function payloadKeys(): string[] {
  const src = readFileSync(resolve(__dirname, '../../verifier/verify-export.mjs'), 'utf8');
  const m = /var PAYLOAD_KEYS=\[([^\]]*)\]/.exec(src);
  if (!m) throw new Error('PAYLOAD_KEYS not found in verify-export.mjs');
  return m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);
}

const KEPT = new Set<string>(OBSERVATION_FIELDS.map(([f]: [string, string]) => f));

/**
 * What a row is allowed to hold, written HERE and not derived from the tool.
 *
 * The sentinel case below was circular on its first attempt and read as a pass
 * while a reading field was being projected: it skipped any field the tool
 * claimed, so adding `topic` to the tool's list also removed `topic`'s
 * sentinel and nothing was left to detect. Proved by adding that field on
 * purpose and watching all cases stay green.
 *
 * An independent list is the only thing that catches a field being ADDED. This
 * one changes only when a person decides a new column describes what was
 * served rather than what was concluded, and changing it is the moment to think
 * about that, which is the whole point of making it a separate edit.
 */
const ALLOWED_COLUMNS = [
  'chainPosition', 'timestamp', 'platform', 'kind', 'feedSource', 'surfaceOrigin',
  'author', 'authorCapture', 'postUrl', 'textCapture', 'originalLength',
  'originalText', 'integrityHash', 'publicKeyFingerprint',
  // derived, not read off the record
  'contentIdentity', 'comparable',
];

describe('no model reading reaches the projection', () => {
  it('projects these columns and no others', async () => {
    const { rows } = await project({
      records: [{ kind: 'post', originalText: 'a served post', textCapture: 'whole' }],
    });
    expect(Object.keys(rows[0]).sort()).toEqual([...ALLOWED_COLUMNS].sort());
  });

  it('claims exactly the fields this test allows, so the tool cannot widen quietly', () => {
    const derived = ['contentIdentity', 'comparable'];
    expect([...KEPT].sort()).toEqual(ALLOWED_COLUMNS.filter((c) => !derived.includes(c)).sort());
  });

  it('leaves out every canonical field the projection does not claim', async () => {
    const keys = payloadKeys();
    expect(keys.length).toBeGreaterThan(40);

    // Every field the projection does not name gets a value nothing else could
    // produce. If any of them appears in the output, the projection is carrying
    // something it says it does not.
    const record: Record<string, unknown> = {
      kind: 'post',
      originalText: 'a served post',
      textCapture: 'whole',
    };
    const sentinels: string[] = [];
    for (const key of keys) {
      if (KEPT.has(key) || key === 'kind' || key === 'originalText' || key === 'textCapture') continue;
      const sentinel = `SENTINEL-${key}-do-not-project`;
      record[key] = sentinel;
      sentinels.push(sentinel);
    }
    expect(sentinels.length).toBeGreaterThan(20);

    const { rows } = await project({ records: [record] });
    expect(rows).toHaveLength(1);

    const printed = JSON.stringify(rows);
    const leaked = sentinels.filter((s) => printed.includes(s));
    expect(leaked, 'these fields reached the projection and should not have').toEqual([]);
  });

  it('names the reading fields that matter as absent, so a reader can check', async () => {
    // Belt and braces with the case above, in the words somebody would search
    // for. These five are the ones a person would look for first.
    for (const field of ['neutralizedText', 'techniques', 'overallScore', 'aiModel', 'verdict']) {
      expect(KEPT.has(field), `${field} must not be an observation field`).toBe(false);
    }
  });

  it('keeps the pointer back into the signed file, or a row proves nothing', async () => {
    expect(KEPT.has('integrityHash')).toBe(true);
    expect(KEPT.has('chainPosition')).toBe(true);
    expect(KEPT.has('publicKeyFingerprint')).toBe(true);
  });
});

describe('what is not an observation of a served item', () => {
  it('excludes every chain marker the product writes, by the product list', () => {
    // The gate that would have caught the five wrong names.
    for (const kind of SYSTEM_MARKER_KINDS) {
      expect(SYSTEM_KINDS.has(kind), `${kind} is a chain marker and must not be projected`).toBe(true);
    }
  });

  it('excludes the two that are not markers and are still not served items', () => {
    // src/forensics/export-numbers.ts: 'image' is an analysis record rather
    // than a node the person saw, and 'environment' is about the chain.
    expect(SYSTEM_KINDS.has('image')).toBe(true);
    expect(SYSTEM_KINDS.has('environment')).toBe(true);
  });

  it('holds no kind the product does not write, so the list cannot rot quietly', () => {
    const extra = [...SYSTEM_KINDS].filter((k) => !SYSTEM_MARKER_KINDS.has(k as string));
    expect(extra.sort()).toEqual(['environment', 'image']);
  });

  it('leaves out a withheld record rather than printing an empty row', async () => {
    // A row with no text would read as "nothing was served", which is the
    // opposite of what a redaction means.
    const { rows, counts } = await project({
      records: [{ kind: 'post', redacted: { markerId: 'm1' }, integrityHash: 'x' }],
    });
    expect(rows).toHaveLength(0);
    expect(counts.withheld).toBe(1);
  });

  it('counts what it left out, so the header can say so', async () => {
    const { counts } = await project({
      records: [
        { kind: 'post', originalText: 'served', textCapture: 'whole' },
        { kind: 'month-rotation-marker', originalText: 'rotation' },
        { kind: 'image', originalText: 'analysis' },
        { kind: 'post', redacted: { markerId: 'm' } },
        { kind: 'post', originalText: '' },
      ],
    });
    expect(counts).toEqual({
      records: 5, projected: 1, systemMarkers: 2, withheld: 1, empty: 1,
      withControlCharacter: 0, withUnpairedSurrogate: 0,
    });
  });

  it('reads a record with no served text as nothing to project', () => {
    expect(isObservation({ kind: 'post', originalText: '' })).toBe(false);
    expect(isObservation({ kind: 'post' })).toBe(false);
    expect(isObservation({ kind: 'post', originalText: 'x' })).toBe(true);
  });
});

describe('the identity and the comparability travel with the row', () => {
  it('computes the same identity as the tree', async () => {
    const text = 'Guvernul ascunde adevărul';
    expect(await shippedIdentity(text)).toBe(await treeIdentity(text));
  });

  it.each([
    ['whole', 'comparable'],
    ['folded', 'comparable'],
    ['cut', 'incomparable'],
    ['platform', 'incomparable'],
    [undefined, 'unknown'],
  ])('marks capture %s as %s', (textCapture, expected) => {
    expect(comparability({ textCapture })).toBe(expected);
  });
});

describe('text a utf-8 file cannot carry cleanly', () => {
  // Found 2026-09-21 by running the tool over verifier/vectors/11-text-escaping,
  // the vector written after an independent implementer's checker was tripped by
  // this class. Zero of the 1,325 rows in the published demo are affected, so it
  // is pathological; the vectors exist because pathological is where two
  // implementations quietly disagree.
  const CH = (n: number) => String.fromCharCode(n);

  it.each([
    ['a backspace', CH(0x08)],
    ['a form feed', CH(0x0C)],
    ['a unit separator', CH(0x1F)],
    ['a start of heading', CH(0x01)],
    ['a delete', CH(0x7F)],
  ])('counts %s as a control character', (_label, ch) => {
    expect(hasControlCharacter(`before${ch}after`)).toBe(true);
  });

  it.each([
    ['a tab, which csv quoting handles', CH(0x09)],
    ['a newline, which csv quoting handles', CH(0x0A)],
    ['a carriage return, which normalisation folds to a newline', CH(0x0D)],
    ['ordinary text', 'nothing unusual here'],
    ['an emoji, which is a PAIRED surrogate and not a control character', '👨'],
  ])('does not count %s', (_label, text) => {
    expect(hasControlCharacter(text)).toBe(false);
  });

  it('finds a lone high surrogate and leaves a real emoji alone', () => {
    expect(hasUnpairedSurrogate(`lone half ${CH(0xD83D)}`)).toBe(true);
    expect(hasUnpairedSurrogate(`lone tail ${CH(0xDC68)}`)).toBe(true);
    expect(hasUnpairedSurrogate('a family \u{1F468}\u200D\u{1F469}')).toBe(false);
    expect(hasUnpairedSurrogate('plain text')).toBe(false);
  });

  it('counts both on the projection, so the header can name a number', async () => {
    const { counts } = await project({
      records: [
        { kind: 'post', textCapture: 'whole', originalText: `a${CH(0x08)}b` },
        { kind: 'post', textCapture: 'whole', originalText: `c ${CH(0xD83D)}` },
        { kind: 'post', textCapture: 'whole', originalText: 'ordinary' },
      ],
    });
    expect(counts.withControlCharacter).toBe(1);
    expect(counts.withUnpairedSurrogate).toBe(1);
    expect(counts.projected).toBe(3);
  });

  it('keeps the property that matters: the printed text still hashes to its identity', async () => {
    // An unpaired surrogate is written as U+FFFD because UTF-8 cannot hold it.
    // That is a loss of the CHARACTER and not of the agreement, because the
    // identity rule encodes to UTF-8 too, so both sides land on U+FFFD.
    const withSurrogate = `lone half ${CH(0xD83D)}`;
    const asWritten = 'lone half \uFFFD';
    expect(await shippedIdentity(withSurrogate)).toBe(await shippedIdentity(asWritten));
  });

  it('does not escape a control character, because escaping would break that property', () => {
    // Deliberate. RFC 4180 does not allow a raw control character and some
    // readers will mangle it; escaping it would mean the text in the file no
    // longer hashes to the identity beside it, which is worth more.
    expect(csvField(`a${CH(0x1F)}b`)).toBe(`a${CH(0x1F)}b`);
  });
});

describe('the file it writes', () => {
  it.each([
    ['plain', 'no quoting needed', 'no quoting needed'],
    ['a comma', 'one, two', '"one, two"'],
    ['a quote', 'he said "no"', '"he said ""no"""'],
    ['a newline', 'one\ntwo', '"one\ntwo"'],
    ['a carriage return', 'one\r\ntwo', '"one\r\ntwo"'],
  ])('quotes %s the way RFC 4180 asks', (_label, value, expected) => {
    expect(csvField(value)).toBe(expected);
  });

  // A spreadsheet runs a cell that starts with one of these as a formula, and a served post can start with any.
  it.each([
    ['an equals sign', '=HYPERLINK("http://x","click")', `"'=HYPERLINK(""http://x"",""click"")"`],
    ['a plus sign', '+1 for this', "'+1 for this"],
    ['a minus sign', '-2 points', "'-2 points"],
    ['an at sign', '@someone thanks', "'@someone thanks"],
    ['a tab', '\tindented', "'\tindented"],
    ['a carriage return', '\rline', `"'\rline"`],
    ['an apostrophe, so the rule reads back', "'quoted", "''quoted"],
  ])('puts an apostrophe in front of a field that starts with %s', (_label, value, expected) => {
    expect(csvField(value)).toBe(expected);
  });

  it('reads back to the exact value by dropping one leading apostrophe', () => {
    for (const value of ['=1+1', '+x', '-x', '@x', '\tx', '\rx', "'x", "''=x", 'plain', 'a=b', '']) {
      const cell = csvField(value);
      const unquoted = cell.startsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
      expect(unquoted.startsWith("'") ? unquoted.slice(1) : unquoted).toBe(value);
    }
  });

  it('leaves the apostrophe out for a file a program imports', () => {
    expect(csvField('@someone thanks', { forSpreadsheet: false })).toBe('@someone thanks');
    expect(csvField('=1+1', { forSpreadsheet: false })).toBe('=1+1');
  });

  it('reads a payload out of an HTML export and refuses what is not one', () => {
    const inner = JSON.stringify({ publicKeyJwk: {}, records: [] });
    expect(parseExport(`<script id="fw-export-data" type="application/json">${inner}</script>`).records).toEqual([]);
    expect(() => parseExport('[]')).toThrow(/not an object/);
    expect(() => parseExport('<html>nothing</html>')).toThrow(/no fw-export-data payload/);
  });
});
