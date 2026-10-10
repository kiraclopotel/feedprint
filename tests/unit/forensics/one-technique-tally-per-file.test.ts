/** @vitest-environment jsdom */
// One file, one answer to "which techniques were flagged", and a pair is two FLAGGED items.
//
// Found 2026-09-20 on an export of adult-mode records built with the product's own writers,
// and again on the chain with gaps. The feed's own tally read "anger 6, swearing 1". The
// exposure summary under it, headed "flagged items", read "anger 10, swearing 4, pressure to
// buy 4". The second counted every record that carries a technique NAME: three starred-
// swearing records (masked, nothing flagged), three button readings, a comment that passed
// below the cut, and two passes whose rewrite did not land. The narrative step did the same:
// "which technique the next flagged item carried" was built from any record with a first
// technique, so it paired a starred swear word with an ad as two flagged items, 24 pairs
// over a file holding 19 flagged records. The panel's copy of the pairing had the same rule.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, EXPOSURE_SCRIPT, BEHAVIOR_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { computeFeedBehavior } from '../../../src/ui/dashboard/components/feed-behavior-data';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `t-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'twitter', originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '',
    author: `@a${seq}`, postUrl: `https://x.com/a/status/${seq}`, techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`, signature: 'sig',
    publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const tech = (name: string, severity: number) => [{ name, severity, confidence: 0.9 }];

/** Two flagged anger items, and between them three records that carry a technique name and were not flagged. */
function file(): ForensicRecord[] {
  return [
    rec({ verdict: 'flagged', techniques: tech('anger-trigger', 6), overallScore: 6 }),
    rec({ verdict: 'masked', techniques: tech('profanity', 2), overallScore: 2, aiSource: 'rules' }),
    rec({ verdict: 'pass', techniques: tech('consumer-rapid-frame', 3), overallScore: 3 }),
    rec({ verdict: 'pass', techniques: tech('fear-appeal', 6), overallScore: 6, detectionMode: 'pass:read-this:charged:afraid:share' }),
    rec({ verdict: 'flagged', techniques: tech('anger-trigger', 7), overallScore: 7 }),
  ];
}

const META: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en' };

function render(script: string, rootId: string): HTMLElement {
  const html = buildForensicHtmlExport(file(), META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = `<div id="${rootId}"></div>`;
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${script}`)();
  return document.getElementById(rootId) as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  seq = 0;
});

describe('one technique tally per file', () => {
  it('the exposure summary names only techniques of flagged items, as the feed above it does', () => {
    const feedBars = [...render(FEED_SCRIPT, 'fw-feed').querySelectorAll('.fw-barlist')].map((x) => x.textContent ?? '').join(' | ');
    expect(feedBars).toMatch(/anger[^0-9]*2/i);
    const exposure = render(EXPOSURE_SCRIPT, 'fw-exposure');
    const bars = [...exposure.querySelectorAll('.fw-exp-barlist')].map((b) => b.textContent ?? '');
    const techBars = bars.find((t) => /anger/i.test(t)) ?? '';
    expect(techBars, 'the exposure summary shows no technique bars').not.toBe('');
    expect(techBars).toMatch(/anger[^0-9]*2/i);
    for (const notFlagged of [/swearing|profanity/i, /pressure to buy|consumer/i, /fear/i]) {
      expect(techBars, `a technique of a record nobody flagged: ${notFlagged}`).not.toMatch(notFlagged);
      expect(feedBars, 'the feed tally').not.toMatch(notFlagged);
    }
  });

  it('a pair in the narrative step is two flagged items, in the export', () => {
    const text = render(BEHAVIOR_SCRIPT, 'fw-behavior').textContent ?? '';
    // Two flagged items in one sitting: exactly one adjacent pair, anger then anger.
    expect(text).toContain(I18N.en.bhChainsProv.replace('%1', '1'));
    expect(text).not.toMatch(/swearing|profanity|pressure to buy|consumer rapid frame|fear/i);
  });

  it('and in the panel, which computes the same step from the same records', () => {
    const model = computeFeedBehavior(file());
    expect(model).not.toBeNull();
    expect(model!.chains.totalPairs).toBe(1);
    expect(model!.chains.handoffs).toEqual([]);
    expect(model!.chains.sustained.map((p) => `${p.a}>${p.b}:${p.n}`)).toEqual(['anger-trigger>anger-trigger:1']);
  });
});
