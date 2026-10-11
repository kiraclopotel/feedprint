// @vitest-environment jsdom
//
// The paid reading asks a third reader, Claude Haiku at Anthropic, beside the second model on the
// items the first judge fires on (src/ai/judge-pair.ts actFires). Until 11 Oct 2026 an item acted on
// because Haiku agreed was signed as the pair alone (decision.judge: gpt-oss+gemma, DeepInfra), and
// no export said a second company had read it. The record now carries the Claude stamp under
// decision.claude, the CSV holds it in its last column, the printable report prints it in the
// reader's language, and a record the reader was not asked about carries no such key, so every
// block written before this field hashes as it did.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEvidenceReportHTML, exportCSV, paidReadingCell } from '../../../src/forensics/exporter';
import { UI_LANGUAGES } from '../../../src/i18n';
import { decisionForJudge } from '../../../src/content/record/decision';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import { verdictFor } from '../../../src/core/policy/table';
import type { ForensicRecord } from '../../../src/types/forensic';

type Judge = Parameters<typeof decisionForJudge>[0]['judge'];
const PAIR = { id: 'judge-v1-pair', hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b+google/gemma-3-27b-it', charged: true, family: 'hostility', severity: 6, effect: 'pressure', intent: 'react' } as unknown as Judge;
const CLAUDE_READ = { model: 'claude-haiku-5-5', provider: 'anthropic', hash: 'd83cd0253c1c', outcome: 'read', reading: { charged: true, family: 'hostility', severity: 7, effect: 'pressure', intent: 'react' } };
const CLAUDE_PAUSED = { model: 'claude-haiku-5-5', provider: 'anthropic', hash: 'd83cd0253c1c', outcome: 'paused-near-cap' };
const asked = () => ({ ...PAIR, claude: CLAUDE_READ }) as unknown as Judge;
const paused = () => ({ ...PAIR, claude: CLAUDE_PAUSED }) as unknown as Judge;
/** The label the printable report uses, per language (src/forensics/exporter.ts PDF_STRINGS). */
const LABEL: Record<string, string> = { en: 'Paid reading', ro: 'Analiza plătită', es: 'Lectura de pago', 'pt-BR': 'Leitura paga' };

let seq = 0;
function record(judge: Judge): ForensicRecord {
  seq++;
  return {
    id: `p-${seq}`, timestamp: `2026-10-11T03:00:0${seq}.000Z`, platform: 'facebook', originalText: 'a pressing post with words', originalHash: 'h',
    originalLength: 26, neutralizedText: '', author: '@user', postUrl: '', techniques: [{ name: 'combined', severity: 6, confidence: 0.9 }],
    overallScore: 6, userAgeCategory: 'adult', aiSource: 'cloud', aiModel: 'openai/gpt-oss-120b+google/gemma-3-27b-it', aiProvider: 'deepinfra',
    feedSource: 'for-you', integrityHash: 'ih', signature: 's', publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: verdictFor('mark'),
    decision: decisionForJudge({ mode: 'adult', judge, provider: 'deepinfra', applied: 'mark', mask: false, rewrite: { attempted: false, outcome: 'off' } }),
    reader: 'default',
  } as unknown as ForensicRecord;
}

async function csvOf(records: ForensicRecord[]): Promise<string> {
  if (typeof URL.createObjectURL !== 'function') {
    (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = () => 'blob:stub';
  }
  if (typeof URL.revokeObjectURL !== 'function') {
    (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = () => undefined;
  }
  let captured: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { captured = blob as Blob; return 'blob:v1'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  exportCSV(records);
  expect(captured).not.toBeNull();
  return captured!.text();
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the decision block', () => {
  it('carries the Claude stamp when the paid reading asked, verbatim, beside the pair it names', () => {
    const d = decisionForJudge({ mode: 'adult', judge: asked(), provider: 'deepinfra', applied: 'mark', mask: false, rewrite: null });
    expect(d.claude).toEqual(CLAUDE_READ);
    expect(d.judge).toEqual({ id: 'judge-v1-pair', hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b+google/gemma-3-27b-it', provider: 'deepinfra' });
  });

  it('carries the reason when Claude gave no reading, without a reading key', () => {
    const d = decisionForJudge({ mode: 'adult', judge: paused(), provider: 'deepinfra', applied: 'mark', mask: false, rewrite: null });
    expect(d.claude).toEqual(CLAUDE_PAUSED);
    expect(d.claude).not.toHaveProperty('reading');
  });

  it('has no claude key at all when the reader was not asked, so older blocks hash as they did', () => {
    const d = decisionForJudge({ mode: 'adult', judge: PAIR, provider: 'deepinfra', applied: 'mark', mask: false, rewrite: null });
    expect(d).not.toHaveProperty('claude');
    expect(JSON.stringify(d)).not.toContain('claude');
  });
});

describe('the CSV', () => {
  it('names the paid reader in its last column and leaves it empty where it was not asked', async () => {
    const csv = await csvOf([record(asked()), record(PAIR), record(paused())]);
    const [header, rowAsked, rowNotAsked, rowPaused] = csv.trim().split('\n');
    expect(header.endsWith(',action,paid_reading')).toBe(true);
    expect(rowAsked.endsWith(',anthropic / claude-haiku-5-5: read')).toBe(true);
    expect(rowNotAsked.endsWith(',')).toBe(true);
    expect(rowPaused.endsWith(',anthropic / claude-haiku-5-5: paused-near-cap')).toBe(true);
  });

  it('the cell itself', () => {
    expect(paidReadingCell(record(asked()))).toBe('anthropic / claude-haiku-5-5: read');
    expect(paidReadingCell(record(PAIR))).toBe('');
  });
});

describe('the printable report', () => {
  it.each(UI_LANGUAGES)('%s: prints the paid reader once, on the record it read, in the reader\'s language', async (lang) => {
    const html = await buildEvidenceReportHTML([record(asked()), record(PAIR)], lang);
    const label = LABEL[lang];
    expect(label).toBeTruthy();
    expect(html.split(`${label}:`).length - 1).toBe(1);
    expect(html).toContain('anthropic / claude-haiku-5-5: read');
  });
});

describe('the methodology block', () => {
  it('names the paid reader as its own entry and leaves the adult reader sentence as it was', () => {
    const m = buildMethodologyBlock('2.5.19');
    expect(m.models.paidReader).toContain('claude-haiku-5-5');
    expect(m.models.paidReader).toContain('Anthropic');
    expect(m.models.paidReader).toContain('decision.claude');
    expect(m.models.adultReader).not.toContain('Anthropic');
  });
});
