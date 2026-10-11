/** @vitest-environment jsdom */
// The first sentence of the CSV, the JSON and the evidence report says who acted (11 Oct 2026, the night walk). A file
// whose only record was hidden by the person's own blocked word, with no AI and no key, opened with "AI Safety
// Interpretation. This report identifies retained items that FeelingWise flagged as showing manipulative framing
// patterns": a file handed to a school or a lawyer crediting an AI with a judgment nobody made. The sentence now asks
// the records it carries.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyExportGate, exportCSV, exportJSON } from '../../../src/forensics/exporter';
import type { ForensicRecord } from '../../../src/types/forensic';

let n = 0;
function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  n += 1;
  return {
    id: `fr-caveat-${n}`,
    timestamp: '2026-06-28T00:00:00.000Z',
    platform: 'youtube',
    originalText: `text ${n}`,
    originalHash: `hash${n}`,
    originalLength: 6,
    neutralizedText: '',
    author: '@example',
    postUrl: 'https://example.test/post',
    techniques: [{ name: 'fear-appeal', severity: 6, confidence: 0.9 }],
    overallScore: 6,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'video',
    integrityHash: `integrity${n}`,
    verdict: 'flagged',
    ...overrides,
  };
}

const byAi = (): ForensicRecord => makeRecord();
const byWord = (): ForensicRecord => makeRecord({
  aiSource: 'rules', detectionMode: 'blocklist:word:trump', techniques: [], overallScore: 7, verdict: 'flagged-hidden',
});

async function capture(run: () => void): Promise<string> {
  let captured: Blob | null = null;
  if (typeof URL.createObjectURL !== 'function') (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:stub';
  if (typeof URL.revokeObjectURL !== 'function') (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { captured = blob as Blob; return 'blob:caveat'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  run();
  return (captured as Blob | null)!.text();
}

async function caveatOf(records: ForensicRecord[], format: 'json' | 'csv'): Promise<string> {
  const filter = applyExportGate(records, { minOverallScore: 0 });
  const text = await capture(() => (format === 'json' ? exportJSON(records, filter) : exportCSV(records, filter)));
  // The JSON carries it as a field; the CSV carries it as its last row (the column names are row 1).
  return format === 'json' ? (JSON.parse(text) as { caveat: string }).caveat : text.split('\n').at(-1) ?? '';
}

afterEach(() => vi.restoreAllMocks());

describe.each(['json', 'csv'] as const)('the %s export opens by saying who acted', (format) => {
  it('credits no AI to a file whose only record a word rule hid', async () => {
    const caveat = await caveatOf([byWord()], format);
    expect(caveat).toContain('because of a rule');
    expect(caveat).toContain('No AI reading is among them');
    expect(caveat).not.toContain('AI Safety Interpretation');
    expect(caveat).not.toContain('flagged as showing manipulative framing patterns');
  });

  it('keeps the old sentence for a file of AI readings only', async () => {
    const caveat = await caveatOf([byAi(), byAi()], format);
    expect(caveat).toContain('AI Safety Interpretation');
    expect(caveat).toContain('flagged as showing manipulative framing patterns');
    expect(caveat).not.toContain('because of a rule');
  });

  it('splits a mixed file by who acted, with the counts', async () => {
    const caveat = await caveatOf([byAi(), byWord(), byWord()], format);
    expect(caveat).toContain('1 was flagged by an AI reading');
    expect(caveat).toContain('2 were acted on because of a rule');
    expect(caveat).toContain('carry no AI judgment');
  });

  it('names a household-list hide as a rule even when the record kept a cloud source', async () => {
    const hidden = makeRecord({ aiSource: 'cloud', detectionMode: 'blocklist:account:some-user', techniques: [], verdict: 'flagged-hidden', overallScore: 7 });
    const caveat = await caveatOf([hidden], format);
    expect(caveat).toContain('No AI reading is among them');
  });
});

describe('the CSV opens with its column names and ends with the sentence', () => {
  // 11 Oct 2026 (the Leader's decision on the night's Board): the first line was a "# ..." comment, so a spreadsheet took
  // it as row 1 and the column names as row 2. The names go first; the sentence is the last row, still starting with "#".
  it('row 1 is the column names, the last row is the sentence, and nothing else starts with "#"', async () => {
    const records = [byAi(), byWord()];
    const filter = applyExportGate(records, { minOverallScore: 0 });
    const text = await capture(() => exportCSV(records, filter));
    const lines = text.split('\n');
    expect(lines[0].startsWith('timestamp,platform,author,'), 'the column names are row 1').toBe(true);
    expect(lines.at(-1)!.startsWith('# '), 'the sentence is the last row').toBe(true);
    expect(lines.filter((l) => l.startsWith('# '))).toHaveLength(1);
    expect(text, 'the file still carries who acted').toContain('1 was flagged by an AI reading');
    expect(lines.length - 2, 'one row per included record between them').toBe(filter.included.length);
  });

  it('a file exported without a filter has no sentence row, as before', async () => {
    const records = [byAi()];
    const text = await capture(() => exportCSV(records));
    expect(text.split('\n').some((l) => l.startsWith('# '))).toBe(false);
  });
});
