/** @vitest-environment jsdom */
//
// M344, 2026-09-20: the numbers table never said how "unique posts" and "seen
// before" are counted. The rule (export-numbers.ts contentIdentity plus
// seenBeforeIds) is a text is unique on its FIRST impression anywhere in the
// file, whatever the platform: a platform's own row is not the count of
// distinct texts that platform showed.
//
// Two things are locked here, at two different rungs.
//
// (b) the note is actually appended to the page a recipient's browser
//     renders (READING_SCRIPT's #fw-numbers), not just present in the string
//     table. i18n parity (html-export-i18n-parity.test.ts, "no locale value
//     is empty or undefined") already pins that every locale carries a
//     non-empty rdUniqueNote; that is not repeated here.
//
// (c) the sentence is held to the code it describes: three impressions of
//     the SAME text, met on platform A, then B, then A again, called
//     directly against the TypeScript engine (no fixture, no jsdom). If the
//     counting ever becomes per platform, this is the case that says so: a
//     per-platform first-sighting rule gives A a unique post B does not also
//     get one for, which is exactly the sentence rdUniqueNote states.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, READING_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { computePlatformRows } from '../../../src/forensics/export-numbers';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-07-01T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'twitter',
    originalText: 'sample',
    originalHash: `h-${seq}`,
    originalLength: 6,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  seq = 0;
});

describe('the numbers table says how unique and seen-before are counted', () => {
  it('renders the English note as a paragraph under the numbers table', () => {
    const html = buildForensicHtmlExport([rec()], META);
    const payload = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1];
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(payload);
    const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="application/json"'));
    document.body.innerHTML = body;
    // FWN must be a global the two scripts share (window.FWN, the same as
    // html-export-reading-mode.test.ts's mount()): each `new Function` call
    // is its own scope, so a `var` inside one is invisible to the next.
    (window as unknown as { FWN?: unknown }).FWN = new Function(`${EXPORT_NUMBERS_INLINE_SOURCE}; return FWN;`)();
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
    new Function(READING_SCRIPT)();
    const numbersRoot = document.getElementById('fw-reading-numbers');
    expect(numbersRoot, 'no #fw-reading-numbers root in the rendered page').not.toBeNull();
    expect(numbersRoot!.textContent).toContain(I18N.en.rdUniqueNote);
  });

  it('holds the sentence to the code: first sighting anywhere, not per platform', () => {
    seq = 0;
    const records = [
      rec({ platform: 'twitter', originalHash: 'same-text' }), // first anywhere: unique on A
      rec({ platform: 'facebook', originalHash: 'same-text' }), // met before, on another platform: seen before on B
      rec({ platform: 'twitter', originalHash: 'same-text' }), // met again on A: seen before on A
    ];
    const rows = computePlatformRows(records);
    const a = rows.find(r => r.platform === 'twitter')!;
    const b = rows.find(r => r.platform === 'facebook')!;
    const total = rows.find(r => r.platform === 'total')!;
    expect(a).toMatchObject({ uniquePosts: 1, extraCopies: 1 });
    expect(b).toMatchObject({ uniquePosts: 0, extraCopies: 1 });
    expect(total.uniquePosts).toBe(1);
  });
});
