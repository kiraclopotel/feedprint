/** @vitest-environment jsdom */
// The one line a reader gets for a chain marker has to read as a sentence and say what happened.
//
// Found 2026-09-20 on an export of a chain in which the product's own code had written one of
// every marker kind:
//   - the month rotation rendered as a bare "chain marker": no reason, no month, no link,
//     on the one marker every whole-record file holds after its first month;
//   - the prune line read "forensic-cap-prune: deleted 12 oldest records", an internal name,
//     over 12 records the same file still held, beside hashed text saying archived=2026-09;
//   - the lost-chain line ended "... The chain continues after this marker between T and T";
//   - the reload line ended "between T and T", the same instant twice;
//   - "1 records lost", "1 positions since the last".
// The reader's line rides in resetReason, which is hashed, so these change the markers
// written from now on. A marker already on a chain keeps the line it was signed with.

import { describe, it, expect, beforeEach } from 'vitest';
import { gapMarkerSummary } from '../../../src/forensics/gap-marker';
import { heartbeatSummary } from '../../../src/forensics/heartbeat';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { readSource } from '../../helpers/read-source';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

const A = '2026-09-06T10:00:00.000Z';
const B = '2026-09-06T10:03:00.000Z';

beforeEach(() => { document.body.innerHTML = ''; });

describe('a marker line reads as a sentence', () => {
  it('one instant is "at", and a sentence-shaped reason takes the time first', () => {
    const reload = gapMarkerSummary({ reason: 'context-invalidated', platform: 'unknown', count: 0, unit: 'records', fromISO: A, toISO: A });
    expect(reload.startsWith(`gap at ${A}: `)).toBe(true);
    expect(reload).not.toContain(`between ${A} and ${A}`);
    const lost = gapMarkerSummary({
      reason: 'chain-lost', platform: 'unknown', count: 7, unit: 'records', fromISO: A, toISO: B,
      lost: { chainPositions: 7, archivedMonths: 0, archivedRecords: 0 },
    });
    expect(lost.startsWith(`gap between ${A} and ${B}: `)).toBe(true);
    expect(lost.endsWith('The chain continues after this marker')).toBe(true);
  });

  it('the ordinary reasons keep their shape, and one of something is singular', () => {
    expect(gapMarkerSummary({ reason: 'recorder-down', platform: 'unknown', count: 0, unit: 'records', fromISO: A, toISO: B }))
      .toBe(`gap: no heartbeat between ${A} and ${B}`);
    expect(gapMarkerSummary({ reason: 'delivery-quarantined', platform: 'twitter', count: 1, unit: 'records', fromISO: A, toISO: B }))
      .toBe(`gap: 1 record lost (delivery-quarantined, twitter) between ${A} and ${B}`);
    expect(gapMarkerSummary({ reason: 'backlog-overflow', platform: 'tiktok', count: 14, unit: 'nodes', fromISO: A, toISO: B }))
      .toContain('14 nodes lost');
  });

  it('a heartbeat after one position says one position', () => {
    const line = heartbeatSummary({
      fromISO: A, toISO: B, platformsOpen: ['twitter'], positionsSince: 1, canaryWarnings: {}, skippedExcluded: 0,
    } as Parameters<typeof heartbeatSummary>[0]);
    expect(line).toContain('; 1 position since the last;');
  });

  it('the prune line names no internal key and does not say deleted over records an archive took', () => {
    const src = readSource('src/forensics/store.ts');
    expect(src).not.toMatch(/resetReason: `forensic-cap-prune/);
    expect(src).toMatch(/moved out of the live record into the archive for/);
    expect(src).toMatch(/no archive took/);
  });

  it('a month rotation says which month it closed, in every language, with its link', () => {
    const base = {
      timestamp: '2026-09-01T09:00:00.000Z', platform: 'twitter', originalHash: 'h', originalLength: 1, neutralizedText: '',
      author: '', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'none', feedSource: 'unknown',
      integrityHash: 'i', signature: 'sig', publicKeyFingerprint: 'fp', verdict: 'pass',
    };
    const records = [
      { ...base, id: 'p', originalText: 'a post', chainPosition: 0, kind: 'post', author: '@a', integrityHash: 'abcdef0123456789aa' },
      { ...base, id: 'm', originalText: '[month-rotation @ 2026-09-01T09:00:00.000Z from=2026-08]', chainPosition: 0, kind: 'month-rotation-marker',
        detectionMode: 'month-rotation-marker', priorChainHash: 'abcdef0123456789aa' },
    ] as unknown as ForensicRecord[];
    for (const lang of UI_LANGUAGES) {
      const meta: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: lang };
      const html = buildForensicHtmlExport(records, meta);
      const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
      (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
      document.body.innerHTML = '<div id="fw-feed"></div>';
      new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
      const line = document.querySelector('#fw-feed .fw-marker')?.textContent ?? '';
      expect(line, lang).toContain(I18N[lang].feedMonthRotation.replace('{month}', '2026-08'));
      expect(line, lang).toContain('abcdef012345');
      expect(line, lang).not.toBe(`— ${I18N[lang].feedChainMarker} —`);
    }
  });
});
