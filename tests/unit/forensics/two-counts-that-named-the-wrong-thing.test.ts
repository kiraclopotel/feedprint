/** @vitest-environment jsdom */
// Two lines of an export that counted something other than what they name.
//
// Found 2026-09-20 on a chain of 107 records in which the product's own code had written one
// of every marker kind, exported whole.
//
//   1. "35 of them do not carry the settings the app was running under, so this file cannot
//      say what those were." All 35 were the chain's own markers, which never carry settings;
//      all 64 content records under that key carried them. The file could say exactly what
//      the settings were.
//   2. "Chain positions 0 to 8 are present, 99 records. The run is unbroken and starts at the
//      beginning of the chain." The file held three runs, 0 to 54, 0 to 34 and 0 to 8; the
//      sentence took the first position of the first and the last of the last.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { COMPLETENESS_SCRIPT } from '../../../src/forensics/html-export-scripts';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(chainPosition: number, overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `c-${seq}`, timestamp: new Date(Date.parse('2026-09-01T10:00:00Z') + seq * 60_000).toISOString(), platform: 'twitter',
    originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '', author: '@a', postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'none', feedSource: 'for-you',
    integrityHash: `i-${seq}`, signature: 'sig', publicKeyFingerprint: 'fp16', chainPosition, kind: 'post', verdict: 'pass',
    configSnapshot: { threshold: 0.6, dailyCap: 200 } as ForensicRecord['configSnapshot'],
    ...overrides,
  } as ForensicRecord;
}
const marker = (pos: number, kind: ForensicRecord['kind'], extra: Partial<ForensicRecord> = {}): ForensicRecord =>
  rec(pos, { kind, author: '', configSnapshot: undefined, detectionMode: String(kind), ...extra });

const META: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en' };
const prov = (html: string, name: string): string => html.match(new RegExp(`<dd data-fw-prov="${name}">([\\s\\S]*?)</dd>`))?.[1] ?? '';
const NO_SETTINGS = I18N.en.epochNoSnapshot.split('{n}')[1].slice(0, 40);

function completenessText(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-completeness"></div>';
  new Function(COMPLETENESS_SCRIPT)();
  return (document.getElementById('fw-completeness') as HTMLElement).textContent ?? '';
}

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('two counts that named the wrong thing', () => {
  it('markers are not records that lack their settings', () => {
    const html = buildForensicHtmlExport([rec(0), rec(1), marker(2, 'heartbeat-marker'), marker(3, 'gap-marker'), rec(4)], META);
    expect(prov(html, 'conditions')).not.toContain(NO_SETTINGS);
  });

  it('a content record that really lacks them is still counted, and counted alone', () => {
    const html = buildForensicHtmlExport([rec(0), rec(1, { configSnapshot: undefined }), marker(2, 'heartbeat-marker')], META);
    expect(prov(html, 'conditions')).toContain(I18N.en.epochNoSnapshot.replace('{n}', '1'));
  });

  it('a file of three runs says three runs, and never one unbroken run from 0 to the last position', () => {
    const records = [
      rec(0), rec(1), rec(2),
      marker(0, 'month-rotation-marker'), rec(1), rec(2), rec(3),
      marker(0, 'reset-marker'), rec(1),
    ];
    const text = completenessText(records);
    expect(text).not.toContain(I18N.en.completenessRun.replace('{a}', '0').replace('{b}', '1').replace('{n}', '9'));
    expect(text).not.toContain(I18N.en.completenessWhole);
    expect(text).toContain(I18N.en.completenessRuns.replace('{r}', '3').replace('{n}', '9'));
    expect(text).toContain(I18N.en.completenessWholeRuns);
  });

  it('a file of one run keeps the sentences it had', () => {
    const text = completenessText([rec(0), rec(1), rec(2)]);
    expect(text).toContain(I18N.en.completenessRun.replace('{a}', '0').replace('{b}', '2').replace('{n}', '3'));
    expect(text).toContain(I18N.en.completenessWhole);
  });
});
