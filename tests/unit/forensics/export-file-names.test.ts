/** @vitest-environment jsdom */
// The three files a person can save from the Export tab carry the product's name (11 Oct 2026, the night walk): the
// report was "feedprint-report-..." while the CSV and the JSON were still "feelingwise-records-...", so a folder of
// exports read as two products.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyExportGate, exportCSV, exportJSON } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

const record: ForensicRecord = {
  id: 'fr-names-1',
  timestamp: '2026-06-28T00:00:00.000Z',
  platform: 'youtube',
  originalText: 'text',
  originalHash: 'hash1',
  originalLength: 4,
  neutralizedText: '',
  author: '@example',
  postUrl: 'https://example.test/post',
  techniques: [{ name: 'fear-appeal', severity: 6, confidence: 0.9 }],
  overallScore: 6,
  userAgeCategory: 'adult',
  aiSource: 'cloud',
  feedSource: 'video',
  integrityHash: 'integrity1',
  verdict: 'flagged',
};

afterEach(() => vi.restoreAllMocks());

function saveStubs(): void {
  if (typeof URL.createObjectURL !== 'function') (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:stub';
  if (typeof URL.revokeObjectURL !== 'function') (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:names');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
}

describe('the saved files are named for the product', () => {
  it('names the JSON feedprint-records-<time>.json', () => {
    saveStubs();
    const filter = applyExportGate([record], { minOverallScore: 0 });
    expect(exportJSON([record], filter).filename).toMatch(/^feedprint-records-.+\.json$/);
  });

  it('names the CSV feedprint-records-<time>.csv', () => {
    saveStubs();
    const filter = applyExportGate([record], { minOverallScore: 0 });
    expect(exportCSV([record], filter).filename).toMatch(/^feedprint-records-.+\.csv$/);
  });
});
