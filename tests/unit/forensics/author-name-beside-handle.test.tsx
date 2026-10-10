// @vitest-environment jsdom
//
// design D, point 1 (record-feed-study/SYNTHESIS.md): a proper platform-
// native "Name @handle" line, wherever the adapter read the display name and
// the handle separately (ForensicRecord.authorName, currently X only). Every
// other platform, and the withheld/redacted cases, keep the handle-only line
// this export always showed.

import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';

import { buildForensicHtmlExport, FEED_SCRIPT, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

let seq = 0;
function record(over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `card-${seq}`, timestamp: `2026-09-27T01:00:0${seq % 10}.000Z`, platform: 'twitter', originalText: 'a post with enough words',
    originalHash: 'h', originalLength: 24, neutralizedText: '', author: 'sample_channel', postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp',
    chainPosition: seq - 1, prevRecordHash: '', kind: 'post', verdict: 'pass',
    ...over,
  } as unknown as ForensicRecord;
}

const META: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };

function renderFeed(records: ForensicRecord[]): Document {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)!;
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m[1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document;
}

describe('the card author line', () => {
  it('shows "Name @handle" when the record carries both', () => {
    const doc = renderFeed([record({ author: 'sample_channel', authorName: 'Sample Channel Name' })]);
    const line = doc.querySelector('.fw-item-author')!.textContent;
    expect(line).toBe('Sample Channel Name @sample_channel');
  });

  it('shows the handle alone when authorName is absent (every platform this touches nothing)', () => {
    const doc = renderFeed([record({ author: 'plain_handle', authorName: undefined })]);
    const line = doc.querySelector('.fw-item-author')!.textContent;
    expect(line).toBe('plain_handle');
  });

  it('shows the handle alone when authorName equals the handle (nothing gained by repeating it)', () => {
    const doc = renderFeed([record({ author: 'same_name', authorName: 'same_name' })]);
    const line = doc.querySelector('.fw-item-author')!.textContent;
    expect(line).toBe('same_name');
  });

  it('never shows a name beside the withheld-author label', () => {
    const doc = renderFeed([record({ author: 'unknown', authorName: 'Someone', authorCapture: 'withheld' })]);
    const line = doc.querySelector('.fw-item-author')!.textContent;
    expect(line).not.toContain('Someone');
  });

  it('flags the extractor\'s own "unknown" sentinel instead of printing it as a plausible username', () => {
    // record-feed-study/C-NOTES.md, #3806: an Instagram ad with author:
    // 'unknown' and no authorCapture reason attached (not X's withheld case,
    // which already carries its own label above). Read as-is, "unknown"
    // prints no differently from a real account by that name.
    const doc = renderFeed([record({ author: 'unknown', authorCapture: undefined })]);
    const line = doc.querySelector('.fw-item-author')!.textContent;
    expect(line).toBe('(unknown)');
  });

  // Cold read finding 6 (COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #6): when
  // authorName is read but the handle resolves to the flagged '(unknown)'
  // sentinel (finding 5's own fix), the old "Name @handle" combine still
  // ran and produced "Name @(unknown)" -- worse than either alone.
  it('shows the name alone, not "Name @(unknown)", when there is no real handle', () => {
    const doc = renderFeed([record({ author: 'unknown', authorName: 'Someone Real', authorCapture: undefined })]);
    const line = doc.querySelector('.fw-item-author')!.textContent;
    expect(line).toBe('Someone Real');
  });
});

describe('the avatar initial', () => {
  // Cold read finding 4 (COLD-READ-ee35374f-74c9ea6a-2026-09-28.md #4):
  // avatarInitial's regex stripped every leading non-ASCII character as if
  // it were punctuation, not just actual ASCII punctuation and spaces, so a
  // name whose own first letter is not in A-Za-z0-9 lost that letter.
  it.each([
    ['Ștefan', 'Ș'],
    ['Émile', 'É'],
    ['Иван', 'И'],
    ['小明', '小'],
  ])('keeps %s\'s own first letter (%s), not "?"', (name, initial) => {
    const doc = renderFeed([record({ author: name })]);
    const shown = doc.querySelector('.fw-avatar')!.textContent;
    expect(shown).toBe(initial);
  });

  it('still strips leading ASCII punctuation and spaces', () => {
    const doc = renderFeed([record({ author: '  (John)' })]);
    const shown = doc.querySelector('.fw-avatar')!.textContent;
    expect(shown).toBe('J');
  });
});
