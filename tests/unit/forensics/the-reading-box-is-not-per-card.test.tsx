// @vitest-environment jsdom
//
// Unit 1 of RECORD-VIEW-BRIEF-2026-09-27.md: the "FeelingWise's reading; the
// signature covers that it was stored, not that it is right" box repeats on every post, about
// 45% of the card by the brief's count. Its sentence goes to the file's first page once; per post, only
// the reading's chips stay. This proves the header text is not duplicated per card once the
// page's own intro already states it, and that a card still carries its own chips.

import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';

import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { verdictFor } from '../../../src/core/policy/table';
import { decisionForJudge } from '../../../src/content/record/decision';
import type { ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

type Judge = Parameters<typeof decisionForJudge>[0]['judge'];
const judge = (severity: number): Judge => ({ id: 'judge-v1', hash: 'h', model: 'm', provider: 'p', charged: true, family: 'hostility', severity, effect: 'pressure', intent: 'x' }) as unknown as Judge;

let seq = 0;
function flaggedRecord(): ForensicRecord {
  seq++;
  const decision = decisionForJudge({ mode: 'adult', judge: judge(6), provider: 'p', applied: 'mark', mask: false, rewrite: { attempted: false, outcome: 'off' } });
  return {
    id: `card-${seq}`, timestamp: `2026-09-26T01:00:0${seq % 10}.000Z`, platform: 'tiktok', originalText: 'a hostile caption with words',
    originalHash: 'h', originalLength: 28, neutralizedText: '', author: '@user', postUrl: '',
    techniques: [{ name: 'combined', severity: 6, confidence: 0.9, why: 'a stated reason' }],
    overallScore: 6, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp',
    chainPosition: seq - 1, prevRecordHash: '', kind: 'post', verdict: verdictFor('mark'), decision, reader: 'default',
  } as unknown as ForensicRecord;
}

const META: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };

function renderFeed(records: ForensicRecord[]): Document {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)!;
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m[1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document;
}

describe('the reading box, across a feed of several cards', () => {
  it('states the full sentence once, on the page, not once per card', () => {
    const doc = renderFeed([flaggedRecord(), flaggedRecord(), flaggedRecord()]);
    const fullSentenceCount = Array.from(doc.querySelectorAll('body *'))
      .filter((e) => e.textContent === I18N.en.feedOpinionNote).length;
    expect(fullSentenceCount).toBe(1);
  });

  it('still shows each card\'s own reading as chips', () => {
    const doc = renderFeed([flaggedRecord(), flaggedRecord()]);
    const cardsWithChips = doc.querySelectorAll('.fw-opinion .fw-tags, .fw-opinion .fw-note-muted');
    expect(cardsWithChips.length).toBeGreaterThan(0);
  });

  it('does not repeat the header sentence\'s own text inside every card\'s opinion box', () => {
    const doc = renderFeed([flaggedRecord(), flaggedRecord()]);
    const perCardHeaderRepeats = Array.from(doc.querySelectorAll('.fw-opinion-head'))
      .filter((e) => e.textContent === I18N.en.feedOpinionHeader).length;
    expect(perCardHeaderRepeats).toBe(0);
  });
});

describe('the avatar initial, unit 3: skips leading punctuation, not just @', () => {
  it('an underscore-led handle still initials on its first letter (his own report: _Confessfantasm gives C)', () => {
    const r = flaggedRecord();
    (r as unknown as { author: string }).author = '_Confessfantasm';
    const doc = renderFeed([r]);
    const initial = doc.querySelector('.fw-avatar')?.textContent;
    expect(initial).toBe('C');
  });

  it('a plain @handle still initials the same as before (no regression)', () => {
    const r = flaggedRecord();
    (r as unknown as { author: string }).author = '@daily_example';
    const doc = renderFeed([r]);
    expect(doc.querySelector('.fw-avatar')?.textContent).toBe('D');
  });
});
