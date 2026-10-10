/** @vitest-environment jsdom */
// A hidden and a marked item must read differently in the CSV export
// (their neutralized_text and visual_applied are both empty), and a skipped
// record (free tier, no reading) needs a chip on the dashboard and a line on
// the export card. Covers exportCSV, the shared action key and the export card.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { applyExportGate, exportCSV, type ExportFilterResult } from '../../../src/forensics/exporter';
import { feedActionKeyFor } from '../../../src/forensics/feed-action';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-09-27T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'tiktok',
    originalText: 'sample',
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@user',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    kind: 'post',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

function csvRows(csv: string): string[] {
  return csv.split('\n').slice(1); // drop the header row
}

async function captureCsv(records: ForensicRecord[], filter?: ExportFilterResult): Promise<string> {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:stub';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  }
  let captured: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => { captured = b as Blob; return 'blob:t'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  exportCSV(records, filter);
  return captured ? await (captured as Blob).text() : '';
}

describe('the CSV export names the action, not just leftover fields', () => {
  afterEach(() => vi.restoreAllMocks());

  it('has an action column, so a hidden and a marked item read differently', async () => {
    const hidden = rec({ verdict: 'flagged-hidden' });
    const marked = rec({ verdict: 'flagged' });
    const csv = await captureCsv([hidden, marked]);
    const header = csv.split('\n')[0];
    expect(header).toContain('action');
    const [hiddenRow, markedRow] = csvRows(csv);
    const actionCol = header.split(',').indexOf('action');
    expect(hiddenRow.split(',')[actionCol]).not.toBe(markedRow.split(',')[actionCol]);
  });

  it('through the export gate the product uses, hidden, flagged and rewritten records carry their action', async () => {
    const records = [
      rec({ verdict: 'flagged-hidden', overallScore: 7 }),
      rec({ verdict: 'flagged', overallScore: 6 }),
      rec({ verdict: 'flagged', overallScore: 5, neutralizedText: 'calmer words' }),
      rec({ verdict: 'pass' }),
      rec({ verdict: 'skipped' }),
    ];
    const gated = applyExportGate(records, { minOverallScore: 0 });
    const csv = await captureCsv(records, gated);
    const lines = csv.split('\n').filter((l) => !l.startsWith('# '));
    const actionCol = lines[0].split(',').indexOf('action');
    const actions = lines.slice(1).map((row) => row.split(',')[actionCol]);
    expect(actions).toEqual(['hidden', 'flagged', 'rewritten']);
  });

  it('names a skipped record as skipped, not blank', async () => {
    const csv = await captureCsv([rec({ verdict: 'skipped' })]);
    const header = csv.split('\n')[0];
    const actionCol = header.split(',').indexOf('action');
    expect(csvRows(csv)[0].split(',')[actionCol]).toBe('skipped');
  });
});

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function renderFeedCard(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).innerHTML;
}

describe('a masked record reads masked, not blank', () => {
  it('in the CSV, for the masked verdict and for an older mask stored as pass', async () => {
    const mask = { applied: 'mask' } as ForensicRecord['decision'];
    const csv = await captureCsv([
      rec({ verdict: 'masked', decision: mask, neutralizedText: 's***', originalText: 'shit' }),
      rec({ verdict: 'pass', decision: mask, neutralizedText: 's***', originalText: 'shit' }),
      rec({ verdict: 'pass' }),
    ]);
    const actionCol = csv.split('\n')[0].split(',').indexOf('action');
    const [masked, oldMask, plain] = csvRows(csv).map((row) => row.split(',')[actionCol]);
    expect(masked).toBe('masked');
    expect(oldMask).toBe('masked');
    expect(plain).toBe('passed');
  });

  it('on the export card', () => {
    const html = renderFeedCard([rec({
      verdict: 'masked', decision: { applied: 'mask' } as ForensicRecord['decision'],
      neutralizedText: 's***', originalText: 'shit',
    })]);
    expect(html).toContain(I18N.en.feedMasked);
  });
});

describe('the export card says something about a skipped record', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  });

  it('names it, rather than leaving the card silent', () => {
    const html = renderFeedCard([rec({ verdict: 'skipped' })]);
    expect(html).toContain(I18N.en.feedSkipped);
  });
});

describe('feedActionKeyFor names every verdict FeedCard has to show', () => {
  it('gives a skipped record its own key, not null', () => {
    expect(feedActionKeyFor(rec({ verdict: 'skipped' }))).toBe('skipped');
  });

  it('keeps every other key exactly as FeedCard already computed it', () => {
    expect(feedActionKeyFor(rec({ feedSource: 'manual' }))).toBe('manual');
    expect(feedActionKeyFor(rec({ verdict: 'blocked' }))).toBe('blocked');
    expect(feedActionKeyFor(rec({ verdict: 'pass' }))).toBe('passed');
    expect(feedActionKeyFor(rec({ verdict: 'flagged-hidden' }))).toBe('hidden');
    expect(feedActionKeyFor(rec({ verdict: 'flagged' }))).toBe('flagged');
    expect(feedActionKeyFor(rec({ verdict: 'harm-floor-trigger' }))).toBe('flagged');
    expect(feedActionKeyFor(rec({ verdict: 'educational-reframe' }))).toBe('rewritten');
    expect(
      feedActionKeyFor(rec({ neutralizedText: 'softer', originalText: 'sample', verdict: undefined })),
    ).toBe('rewritten');
  });

  it("gives a swear mask its own key, and leaves a plain pass as 'passed'", () => {
    const mask = { applied: 'mask' } as ForensicRecord['decision'];
    expect(feedActionKeyFor(rec({ verdict: 'masked', decision: mask }))).toBe('masked');
    expect(feedActionKeyFor(rec({ verdict: 'pass', decision: mask }))).toBe('masked');
    expect(feedActionKeyFor(rec({ verdict: 'pass' }))).toBe('passed');
    expect(
      feedActionKeyFor(rec({ verdict: 'masked', decision: mask, neutralizedText: 's***', originalText: 'shit' })),
    ).toBe('masked');
  });

  it("reports the rewrite, not 'skipped', if a record were ever both (priority pinned)", () => {
    // Neither current writer of verdict 'skipped' sets neutralizedText, so
    // this combination cannot happen now; this pins the priority anyway,
    // so a future writer that did set both would not silently mislabel a
    // real rewrite as unread.
    expect(
      feedActionKeyFor(rec({ verdict: 'skipped', neutralizedText: 'softer', originalText: 'sample' })),
    ).toBe('rewritten');
  });
});
