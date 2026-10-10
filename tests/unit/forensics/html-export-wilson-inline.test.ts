/** @vitest-environment jsdom */
// The export's behavior section runs in the recipient's browser from an
// inlined script, so it cannot import forensics/wilson.ts. WILSON_INLINE_SOURCE
// is the same arithmetic restated; this pins it to the module over a grid, and
// checks the three rate lines the section prints now carry the interval.

import { describe, it, expect, afterEach } from 'vitest';
import { wilson } from '../../../src/forensics/wilson';
import {
  buildForensicHtmlExport, BEHAVIOR_SCRIPT, WILSON_INLINE_SOURCE, I18N, type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

describe('WILSON_INLINE_SOURCE drift', () => {
  it('matches wilson() on a grid, and returns null on n = 0', () => {
    const wl = new Function(`${WILSON_INLINE_SOURCE}; return wl;`)() as (k: number, n: number) => [number, number] | null;
    expect(wl(0, 0)).toBeNull();
    for (const n of [1, 2, 3, 5, 10, 37, 100, 1000, 2608]) {
      for (const k of [0, 1, Math.floor(n / 3), Math.floor(n / 2), n - 1, n]) {
        const ref = wilson(k, n)!;
        expect(wl(k, n), `k=${k} n=${n}`).toEqual([ref.lowerPct, ref.upperPct]);
      }
    }
  });
});

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`, timestamp: '2026-07-01T10:00:00Z', platform: 'tiktok', originalText: 'sample',
    originalHash: 'h', originalLength: 6, neutralizedText: '', author: '@user', postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq,
    kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

function renderBehavior(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const payload = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1];
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(payload);
  document.body.innerHTML = '<div id="fw-behavior"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${BEHAVIOR_SCRIPT}`)();
  return (document.getElementById('fw-behavior') as HTMLElement).textContent ?? '';
}
afterEach(() => { document.body.innerHTML = ''; });

describe('behavior section rates carry the interval', () => {
  it('baseline, in-sitting thirds and return-after-quiet lines each print a 95% interval', () => {
    const start = Date.parse('2026-07-01T10:00:00Z');
    const verdicts: Array<ForensicRecord['verdict']> = ['flagged', 'pass', 'pass', 'flagged', 'pass', 'pass', 'flagged', 'pass', 'pass'];
    const sitting = verdicts.map((verdict, i) => rec({ timestamp: new Date(start + i * 60_000).toISOString(), verdict }));
    // a return after a 3-hour quiet gap, flagged
    const back = rec({ timestamp: new Date(start + 3 * 3_600_000 + 9 * 60_000).toISOString(), verdict: 'flagged' });
    const text = renderBehavior([...sitting, back]);
    const ciWord = I18N.en.bhCi.split(' ')[0];           // "95%"
    const hits = text.match(new RegExp(`\\(${ciWord} interval \\d+–\\d+%\\)`, 'g')) ?? [];
    // baseline note, two skew rows, return stat, return note: at least five
    expect(hits.length).toBeGreaterThanOrEqual(5);
    const base = wilson(4, 10)!;
    expect(text).toContain(`(95% interval ${base.lowerPct}–${base.upperPct}%)`);
    const ret = wilson(1, 1)!;
    expect(text).toContain(`(95% interval ${ret.lowerPct}–${ret.upperPct}%)`);
  });
});
