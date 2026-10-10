/** @vitest-environment jsdom */
// Withholding one record must not break the other exports, and the marker must travel with it.
//
// Found 2026-09-20 by building a chain with the product's own code, withholding one flagged
// comment with the product's own redaction, and pressing each export the way the tab does.
//   - CSV: "TypeError: Cannot read properties of undefined (reading 'includes')". No file.
//   - PDF: "... (reading 'replace')". No file.
//   A withheld record has no text, no author and no address (redaction.ts removes them on the
//   copy that leaves), and both writers assumed strings. The tab printed the raw error in red.
//   - JSON: the file held the blanked record, whose `redacted.markerId` names a marker, and
//   no marker: the report gate drops markers and only the HTML export put them back. The
//   docblock in redaction.ts says every export carries the marker and that a blanked record
//   with no marker fails.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { applyExportGate, exportCSV, exportJSON, buildEvidenceReportHTML } from '../../../src/forensics/exporter';
import { applyRedactions } from '../../../src/forensics/redaction';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(id: string, pos: number, overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id, timestamp: `2026-09-15T10:0${pos}:00.000Z`, platform: 'youtube', originalText: `text of ${id}`, originalHash: `oh-${id}`,
    originalLength: 10, neutralizedText: '', author: `@author-${id}`, postUrl: `https://youtube.com/watch?v=${id}`,
    techniques: [{ name: 'anger-trigger', severity: 6, confidence: 0.9, why: 'quotes the text' }], overallScore: 6,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `ih-${id}`, signature: 'sig',
    publicKeyFingerprint: 'fp', chainPosition: pos, kind: 'post', verdict: 'flagged', ...overrides,
  } as ForensicRecord;
}
const HASH = 'a'.repeat(64);
const target = rec('withheld-one', 1, { integrityHash: HASH });
const marker = rec('fr-redaction-1', 2, {
  kind: 'redaction-marker', verdict: 'pass', author: 'system', postUrl: '', techniques: [], overallScore: 0,
  originalText: `[redaction-marker @ 2026-09-15T10:05:00.000Z] record=withheld-one recordHash=${HASH} fields=author,originalText,postUrl reason=asked to`,
});
/** What the tab hands the export functions: the list as the dashboard holds it, already blanked. */
const asTheTabHoldsThem = (): ForensicRecord[] => applyRedactions([rec('plain', 0), target, marker]);

let downloaded: Blob | null = null;
beforeEach(() => {
  downloaded = null;
  URL.createObjectURL = vi.fn((b: Blob) => { downloaded = b; return 'blob:x'; }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
});
const textOf = async (): Promise<string> => (downloaded ? await (downloaded as Blob).text() : '');

describe('a withheld record still exports', () => {
  it('the fixture is a record the redaction really blanked', () => {
    const held = asTheTabHoldsThem().find((r) => r.id === 'withheld-one')!;
    expect(held.originalText).toBeUndefined();
    expect(held.author).toBeUndefined();
    expect(held.redacted?.markerId).toBe('fr-redaction-1');
  });

  it('the CSV is written, and the withheld cells say so', async () => {
    const records = asTheTabHoldsThem();
    expect(() => exportCSV(records, applyExportGate(records, { minOverallScore: 0 }))).not.toThrow();
    const csv = await textOf();
    const row = csv.split('\n').find((l) => l.includes('2026-09-15T10:01:00.000Z')) ?? '';
    expect(row).toContain('[withheld]');
    expect(row).not.toContain('undefined');
  });

  it('the PDF view is built, and says the record was withheld', async () => {
    const records = asTheTabHoldsThem();
    const gate = applyExportGate(records, { minOverallScore: 0 });
    const html = await buildEvidenceReportHTML(gate.included, 'en', gate);
    expect(html).toContain('Withheld');
    expect(html).not.toContain('undefined');
  });

  it('the JSON carries the marker that attests the blanked record', async () => {
    const records = asTheTabHoldsThem();
    exportJSON(records, applyExportGate(records, { minOverallScore: 0 }));
    const json = JSON.parse(await textOf()) as { included_count: number; redaction_markers: number; records: ForensicRecord[] };
    const held = json.records.find((r) => r.id === 'withheld-one')!;
    expect(json.records.some((r) => r.id === held.redacted!.markerId), 'the marker the blanked record names is in the file').toBe(true);
    // The count of what the report included stays the count of content; the markers are counted beside it.
    expect(json.included_count).toBe(2);
    expect(json.redaction_markers).toBe(1);
  });
});
