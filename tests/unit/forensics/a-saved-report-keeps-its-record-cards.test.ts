/** @vitest-environment jsdom */
// A saved report keeps its record cards (M7, SF15 / SURVEY S26).
//
// Found 30 Sep 2026: the feed script's avatarInitial pattern was written with \x00 and \x7f inside
// the template string that holds the script. The template turned them into a real NUL and a real
// DEL in the saved file. A browser reads a NUL in script text as U+FFFD, the character class then
// runs from U+FFFD down to \x2f, out of order, and the whole feed script fails to parse: the saved
// report showed 0 of its record cards and a SyntaxError, while the separate verification block
// still said VERIFIED.
//
// The scripts in this repository are also run as plain strings (new Function), where a raw NUL
// is legal, so that is not enough to catch it. This builds the file and reads it as a browser does.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(): ForensicRecord {
  seq++;
  return {
    id: `m7-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(), platform: 'twitter',
    originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '', author: `@writer${seq}`, postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`,
    signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: 'pass',
  } as ForensicRecord;
}

const meta: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

/** The bodies of the file's inline scripts that are code, not data (the data blocks carry an id). */
function codeBlocks(html: string): string[] {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/\sid\s*=/.test(m[1] ?? '') && !/type\s*=\s*"application\/json"/.test(m[1] ?? ''))
    .map((m) => m[2]);
}

/** What a browser does to script text before it runs: a NUL becomes U+FFFD (HTML parsing, script data state). */
const asBrowserReads = (text: string): string => text.replace(/\u0000/g, '�');

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('a saved report keeps its record cards', () => {
  it('the file holds no NUL and no DEL character', () => {
    const html = buildForensicHtmlExport([rec(), rec(), rec()], meta);
    expect(html.includes('\u0000')).toBe(false);
    expect(html.includes('\u007f')).toBe(false);
  });

  it('every script block of the file parses as a browser reads it', () => {
    const html = buildForensicHtmlExport([rec(), rec(), rec()], meta);
    const blocks = codeBlocks(html);
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(() => new Function(asBrowserReads(block)), block.slice(0, 60)).not.toThrow();
    }
  });

  it('the feed of the saved file draws 3 cards for 3 records', () => {
    const html = buildForensicHtmlExport([rec(), rec(), rec()], meta);
    const data = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(data![1]);
    document.body.innerHTML = '<div id="fw-feed"></div>';
    const feed = codeBlocks(html).find((b) => b.includes('avatarInitial'));
    expect(feed).toBeTruthy();
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${asBrowserReads(feed!)}`)();
    expect(document.querySelectorAll('#fw-feed .fw-avatar').length).toBe(3);
  });
});
