/** @vitest-environment jsdom */
//
// A number a model never gave, printed under the words "FeelingWise's reading".
//
// Read off a real export written by the running product during the board walk
// on 2026-09-17, in Child mode on the free tier, where no model runs at all.
// Three posts were hidden by the product's own fixed lists, and each card
// printed its technique with a severity:
//
//   "go kill yourself loser ... shame (signal level 9/10)"
//
// The record says aiSource 'rules'. The 9 is the stamp the gate writes, the
// same 9 on every coded-harm hide, and the card presented it as a reading.
//
// The comment path had this right: a record with `overrideOrigin` set names the
// gate and prints no severity. The post path sets no overrideOrigin, because
// that field is written by the comment scorer only; it names its gate in the
// detection mode ('coded-harm:self-harm-encouragement', 'slur:2',
// 'profanity:1'), which the card never read. So the honesty rule held on the
// path a parent rarely sees and failed on the one a Child-mode install uses.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport,
  FEED_SCRIPT,
  I18N,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-09-17T16:29:00Z') + seq * 60_000).toISOString(),
    platform: 'twitter',
    originalText: 'recorded post',
    originalHash: 'h',
    originalLength: 13,
    neutralizedText: '',
    author: '@walkbadone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'child',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

/** The three shapes the walk's own export carried, field for field. */
const codedHarmHide = () => rec({
  verdict: 'flagged-hidden',
  aiSource: 'rules',
  detectionMode: 'coded-harm:self-harm-encouragement',
  overallScore: 9,
  techniques: [{ name: 'shame-attack', severity: 9, confidence: 0.98 }],
});
const slurHide = () => rec({
  verdict: 'flagged-hidden',
  aiSource: 'rules',
  detectionMode: 'slur:2',
  overallScore: 9,
  techniques: [{ name: 'extreme-toxicity', severity: 9, confidence: 0.98 }],
});
const swearHide = () => rec({
  verdict: 'flagged-hidden',
  aiSource: 'rules',
  detectionMode: 'profanity:1',
  overallScore: 8,
  techniques: [{ name: 'profanity', severity: 8, confidence: 0.98 }],
});
/** A judge's finding, for the other side of the line. */
const judged = () => rec({
  verdict: 'flagged',
  aiSource: 'cloud',
  overallScore: 7,
  techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }],
});

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function feed(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).innerHTML;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  seq = 0;
});

describe('a post the product’s own list hid', () => {
  it('prints no severity on the coded-harm hide the walk recorded', () => {
    const html = feed([codedHarmHide()]);
    expect(html).not.toContain(`${I18N.en.feedSeverityWord} 9/10`);
  });

  it('names the list that hid it', () => {
    expect(feed([codedHarmHide()])).toContain(I18N.en.feedGateCodedHarm);
    expect(feed([slurHide()])).toContain(I18N.en.feedGateIdentitySlur);
    expect(feed([swearHide()])).toContain(I18N.en.feedGateProfanityTier);
  });

  it('keeps the technique name beside the list, so the card still says what it was', () => {
    const html = feed([swearHide()]);
    expect(html).toContain(`${I18N.en.feedGateProfanityTier}`);
    expect(html).toContain('fw-tag-gate');
  });

  it('says only "a fixed rule, not a model" when the mode names no known list', () => {
    const html = feed([rec({
      verdict: 'flagged-hidden',
      aiSource: 'rules',
      detectionMode: 'dehumanization:1',
      overallScore: 9,
      techniques: [{ name: 'extreme-toxicity', severity: 9, confidence: 0.98 }],
    })]);
    expect(html).toContain(I18N.en.feedGateRule);
    expect(html).not.toContain(`${I18N.en.feedSeverityWord} 9/10`);
  });

  it('reads the gate through a replayed record’s rotation prefix too', () => {
    const html = feed([rec({
      verdict: 'flagged-hidden',
      aiSource: 'rules',
      detectionMode: 'late-after-rotation:coded-harm:self-harm-encouragement',
      overallScore: 9,
      techniques: [{ name: 'shame-attack', severity: 9, confidence: 0.98 }],
    })]);
    expect(html).toContain(I18N.en.feedGateCodedHarm);
  });
});

describe('the line a judge’s reading holds', () => {
  it('still prints the severity a model gave', () => {
    const html = feed([judged()]);
    expect(html).toContain(`${I18N.en.feedSeverityWord} 7/10`);
    expect(html).not.toContain(I18N.en.feedGateRule);
  });

  it('leaves a record no rule and no model decided alone', () => {
    // Observed and never judged: no techniques, so no tag of any kind, and
    // above all not "a fixed rule" on a record no rule touched.
    const html = feed([rec({ verdict: 'skipped', aiSource: 'rules', detectionMode: 'skip:free-tier' })]);
    expect(html).not.toContain(I18N.en.feedGateRule);
  });
});
