/** @vitest-environment jsdom */
// Two stretches a month apart are two sittings, whatever order the file holds them in.
//
// A sitting is records less than 30 minutes apart. The export's numbers engine walked the
// records in FILE order and opened a new sitting when "this time minus the last time" was
// 30 minutes or more. A file is not always in time order: records brought back by an import
// are appended after newer ones. Going backwards in time makes that difference negative,
// which is never 30 minutes or more, so the older stretch joined the sitting before it.
// Found 2026-09-20 on a chain holding imported records: the sitting filter offered "sitting
// 6", holding 6 Facebook items from 3 September and 8 X items from 10 August, while the
// behaviour section of the same file counted one sitting more. The panel sorts by time
// before it splits (overview-data.ts computeOverview) and never had this.

import { describe, it, expect, beforeEach } from 'vitest';
import { sittingByRecordId } from '../../../src/forensics/export-numbers';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { buildForensicHtmlExport, BEHAVIOR_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(timestamp: string, platform: ForensicRecord['platform']): ForensicRecord {
  seq++;
  return {
    id: `s-${seq}`, timestamp, platform, originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6,
    neutralizedText: '', author: `@a${seq}`, postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult',
    aiSource: 'none', feedSource: 'for-you', integrityHash: `i-${seq}`, signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: seq, kind: 'post', verdict: 'pass',
  } as ForensicRecord;
}
const minutes = (day: string, n: number, platform: ForensicRecord['platform']): ForensicRecord[] =>
  Array.from({ length: n }, (_, i) => rec(`${day}T10:${String(i).padStart(2, '0')}:00.000Z`, platform));

/** Seven records on 3 September, then seven from 10 August that an import appended after them. */
function file(): ForensicRecord[] {
  return [...minutes('2026-09-03', 7, 'facebook'), ...minutes('2026-08-10', 7, 'twitter')];
}

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('a sitting does not span a month', () => {
  it('the numbers engine gives the two stretches two sittings, the older one first', () => {
    const records = file();
    const by = sittingByRecordId(records);
    const sept = new Set(records.slice(0, 7).map((r) => by[r.id]));
    const aug = new Set(records.slice(7).map((r) => by[r.id]));
    expect([...sept]).toEqual([2]);
    expect([...aug]).toEqual([1]);
  });

  it('the page engine agrees record for record', () => {
    const records = file();
    const fwn = new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};return FWN;`)() as { sittingByRecordId(rs: unknown[]): Record<string, number> };
    expect(fwn.sittingByRecordId(records)).toEqual(sittingByRecordId(records));
  });

  it('a file already in time order numbers its sittings as it always did', () => {
    const records = [...minutes('2026-08-10', 3, 'twitter'), ...minutes('2026-09-03', 3, 'facebook')];
    const by = sittingByRecordId(records);
    expect(records.map((r) => by[r.id])).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('the behaviour section splits them too: two sittings of 7 items, both long enough to read', () => {
    const meta: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en' };
    const html = buildForensicHtmlExport(file(), meta);
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
    document.body.innerHTML = '<div id="fw-behavior"></div>';
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${BEHAVIOR_SCRIPT}`)();
    const text = (document.getElementById('fw-behavior') as HTMLElement).textContent ?? '';
    // "Sittings with 6+ items only (%1 of %2)": two of two, not one of one.
    expect(text).toContain(I18N.en.bhSkewSub.replace('%1', '2').replace('%2', '2'));
  });
});
