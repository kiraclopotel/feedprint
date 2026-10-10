/** @vitest-environment jsdom */
/**
 * The CSV export is built to be handed to someone who was not there — a school,
 * a lawyer, another parent. Quoting commas is not enough for that job: author
 * names, post text and URLs are written by whoever posted the content, and a
 * cell starting with `=`, `+`, `-`, `@`, tab or CR is executed as a live formula
 * when the file is opened. An evidence file must not be able to act.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportCSV } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'fr-csv-test',
    timestamp: '2026-08-02T00:00:00.000Z',
    platform: 'facebook',
    originalText: 'ordinary text',
    originalHash: 'hash',
    originalLength: 13,
    neutralizedText: '',
    author: '@example',
    postUrl: 'https://example.test/post',
    techniques: [],
    overallScore: 4,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'feed',
    integrityHash: 'integrity',
    verdict: 'flagged',
    ...overrides,
  } as ForensicRecord;
}

async function captureCsv(records: ForensicRecord[]): Promise<string> {
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
  exportCSV(records);
  return captured ? await (captured as Blob).text() : '';
}

afterEach(() => vi.restoreAllMocks());

describe('CSV export — formula injection', () => {
  const leaders: Array<[string, string]> = [
    ['equals', '=HYPERLINK("https://evil.test","click")'],
    ['plus', '+1+1'],
    ['at', '@SUM(A1:A9)'],
    ['minus expression', '-2+3+cmd|\' /c calc\'!A0'],
    ['tab', '\tleading tab'],
    ['carriage return', '\rleading cr'],
  ];

  for (const [name, payload] of leaders) {
    it(`neutralizes a ${name} leader in the author field`, async () => {
      const csv = await captureCsv([makeRecord({ author: payload })]);
      // The payload survives verbatim, preceded by the neutralizing quote, and
      // never appears at the start of a cell in its raw form.
      expect(csv).toContain(`'${payload.slice(0, 4)}`);
      expect(csv).not.toContain(`,${payload.slice(0, 4)}`);
    });
  }

  it('neutralizes the leader in post text and in the URL', async () => {
    const csv = await captureCsv([makeRecord({
      originalText: '=1+1',
      postUrl: '@evil.test',
      neutralizedText: '+cmd',
    })]);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@evil.test");
    expect(csv).toContain("'+cmd");
  });

  it('leaves a plain negative number alone — a numeric column must stay numeric', async () => {
    const csv = await captureCsv([makeRecord({ overallScore: -3, originalLength: 12 })]);
    const row = csv.trim().split('\n')[1];
    expect(row).toContain(',-3,');
    expect(row).not.toContain(",'-3");
  });

  it('leaves ordinary values untouched', async () => {
    const csv = await captureCsv([makeRecord({ author: '@example' })]);
    // '@example' DOES start with @ and must be guarded; a bare name must not.
    const plain = await captureCsv([makeRecord({ author: 'jane doe' })]);
    expect(csv).toContain("'@example");
    expect(plain).toContain('jane doe');
    expect(plain).not.toContain("'jane doe");
  });

  it('still quotes a guarded value that also contains a comma', async () => {
    const csv = await captureCsv([makeRecord({ author: '=a,b' })]);
    expect(csv).toContain('"\'=a,b"');
  });
});
