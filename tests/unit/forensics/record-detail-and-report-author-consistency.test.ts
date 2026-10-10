// @vitest-environment jsdom
//
// Cold read finding 5 (COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #5): the
// 'unknown' sentinel flag and the "Name @handle" line landed on the feed
// card's authorLine() only. The per-record detail panel
// (VERIFIER_SCRIPT_TEMPLATE's recordDetail) and the printed evidence report
// (exporter.ts) still printed the raw word "unknown" and never showed
// authorName at all. Fix: the same rules everywhere a record's author is
// shown.

import { describe, it, expect } from 'vitest';
import { readSource } from '../../helpers/read-source';
import { buildEvidenceReportHTML } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

const src = readSource('src/forensics/html-export-scripts.ts');
const start = src.indexOf('function recordDetail(');
const end = src.indexOf('function recordLine(');
if (start < 0 || end < 0 || end <= start) {
  throw new Error('recordDetail or recordLine moved; point this scan at its new bounds.');
}
const recordDetailBody = src.slice(start, end);

describe('the record detail panel flags "unknown" and shows the display name', () => {
  it('never prints the raw author field; resolves the same unknown flag and Name @handle line as the feed card', () => {
    expect(recordDetailBody).not.toMatch(/i18n\.perRecordAuthor\+': '\+\(r\.authorCapture==='withheld'\?i18n\.feedAuthorWithheld:r\.author\)/);
    expect(recordDetailBody).toContain("(r.author&&r.author!=='unknown')?r.author:'(unknown)'");
    expect(recordDetailBody).toContain("r.authorName&&r.authorName!==handle");
  });

  it('shows the name alone, not "Name @(unknown)" (finding 6)', () => {
    expect(recordDetailBody).toContain("handle==='(unknown)'?r.authorName:r.authorName+' @'+handle.replace(/^@+/,'')");
  });
});

let seq = 0;
function record(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `p-${seq}`, timestamp: `2026-09-28T01:00:0${seq}.000Z`, platform: 'twitter', originalText: 'a post with enough words',
    originalHash: 'h', originalLength: 24, neutralizedText: '', author: 'unknown', postUrl: '', techniques: [],
    overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih', signature: 's',
    publicKeyFingerprint: 'fp', chainPosition: seq - 1, kind: 'post', verdict: 'pass', ...overrides,
  } as unknown as ForensicRecord;
}

describe('the printed evidence report flags "unknown" and shows the display name', () => {
  it('flags the extractors\' own "unknown" sentinel instead of printing it as a plausible username', async () => {
    const html = await buildEvidenceReportHTML([record({ author: 'unknown' })], 'en');
    expect(html).toContain('(unknown)');
    expect(html).not.toMatch(/meta-label">Author:<\/span> unknown</i);
  });

  it('shows "Name @handle" when the record carries both', async () => {
    const html = await buildEvidenceReportHTML([record({ author: 'sample_channel', authorName: 'Sample Channel Name' })], 'en');
    expect(html).toContain('Sample Channel Name @sample_channel');
  });

  // Cold read finding 6: the name alone, not "Name @(unknown)", when there
  // is no real handle to pair it with.
  it('shows the name alone when the handle resolves to the unknown flag', async () => {
    const html = await buildEvidenceReportHTML([record({ author: 'unknown', authorName: 'Someone Real' })], 'en');
    expect(html).toContain('Author:</span> Someone Real</div>');
    expect(html).not.toContain('Someone Real @(unknown)');
  });
});
