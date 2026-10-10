// @vitest-environment jsdom
//
// The printable report (the PDF's source) and the CSV, read on the records the post path writes when
// the page did something other than rewrite: a Child video skipped, an Adult caption marked in yellow, a
// Child hide after a rewrite that did not land. The report printed a "Neutralized version" heading over an
// empty box for every record with no rewrite, which reads as a rewrite that came out empty, and it never
// said what was done. A record with no rewrite prints no such box, says what the reader was shown in the
// reader's language, and a record that holds a rewrite prints it as before. The CSV holds no rewrite text
// for these records and no claim of one.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildEvidenceReportHTML, exportCSV } from '../../../src/forensics/exporter';
import { I18N } from '../../../src/forensics/html-export';
import { UI_LANGUAGES } from '../../../src/i18n';
import { decisionForJudge, rewriteStage } from '../../../src/content/record/decision';
import { verdictFor } from '../../../src/core/policy/table';
import type { DecisionAction, ForensicRecord } from '../../../src/types/forensic';

type Judge = Parameters<typeof decisionForJudge>[0]['judge'];
const JUDGE = { id: 'judge-v1', hash: 'h', model: 'm', provider: 'p', charged: true, family: 'hostility', severity: 8, effect: 'pressure', intent: 'x' } as unknown as Judge;

let seq = 0;
function record(
  mode: 'child' | 'teen' | 'adult',
  applied: DecisionAction,
  rewrite: { attempted: boolean; outcome: string } | null,
  neutralizedText = '',
): ForensicRecord {
  seq++;
  return {
    id: `p-${seq}`, timestamp: `2026-09-26T01:00:0${seq}.000Z`, platform: 'tiktok', originalText: 'a hostile caption with words', originalHash: 'h',
    originalLength: 28, neutralizedText, author: '@user', postUrl: '', techniques: [{ name: 'combined', severity: 8, confidence: 0.9 }],
    overallScore: 8, userAgeCategory: mode, aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih', signature: 's', publicKeyFingerprint: 'fp',
    chainPosition: seq, kind: 'video', verdict: verdictFor(applied),
    decision: decisionForJudge({ mode, judge: JUDGE, provider: 'p', applied, mask: false, rewrite }), reader: 'default',
  } as unknown as ForensicRecord;
}

const OFF = { attempted: false, outcome: 'off' };
const skip = () => record('child', 'hide', OFF);
const yellow = () => record('adult', 'mark', OFF);
const hideAfterFailedRewrite = () => record('child', 'hide', rewriteStage(false, null));
const softened = () => record('teen', 'soften', rewriteStage(true, { model: 'm' }), 'a calm caption');

const EMPTY_REWRITE_BOX = '<div class="post-text neutralized"></div>';
const capitalised = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

describe('the printable report', () => {
  it.each(UI_LANGUAGES)('%s: a record with no rewrite prints no empty rewrite box and says what the reader was shown', async (lang) => {
    const t = I18N[lang];
    for (const [r, word] of [[skip(), t.act_hide], [hideAfterFailedRewrite(), t.act_hide], [yellow(), t.act_mark]] as const) {
      const html = await buildEvidenceReportHTML([r], lang);
      expect(html, `${lang} ${r.decision!.applied}: no empty rewrite box`).not.toContain(EMPTY_REWRITE_BOX);
      expect(html, `${lang}: names what was shown`).toContain(`${capitalised(t.feedDecisionShownAs)}:</span> ${word}`);
      expect(html).toContain('a hostile caption with words');
    }
  });

  it.each(UI_LANGUAGES)('%s: a record that holds a rewrite still prints it', async (lang) => {
    const html = await buildEvidenceReportHTML([softened()], lang);
    expect(html).toContain('<div class="post-text neutralized">a calm caption</div>');
  });

  it('a record with no decision block and no rewrite prints no empty box and states nothing it does not know', async () => {
    const legacy = { ...skip(), decision: undefined, reader: undefined } as unknown as ForensicRecord;
    const html = await buildEvidenceReportHTML([legacy], 'en');
    expect(html).not.toContain(EMPTY_REWRITE_BOX);
    expect(html).not.toContain(`${capitalised(I18N.en.feedDecisionShownAs)}:`);
  });
});

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

describe('the CSV', () => {
  it('holds no rewrite text for a record with none, and the rewrite for one that has it', async () => {
    const csv = await csvOf([skip(), yellow(), hideAfterFailedRewrite(), softened()]);
    const [header, ...rows] = csv.trim().split('\n');
    const col = header.split(',').indexOf('neutralized_text');
    expect(col).toBeGreaterThan(-1);
    const cells = rows.map((row) => row.split(',')[col]);
    expect(cells.slice(0, 3)).toEqual(['', '', '']);
    expect(cells[3]).toContain('a calm caption');
  });
});
