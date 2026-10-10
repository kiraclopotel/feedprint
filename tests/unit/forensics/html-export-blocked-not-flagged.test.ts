/** @vitest-environment jsdom */
//
// Rule-based blocks are not safety findings, in BOTH scripts the export ships.
//
// The blocker (ai-content-blocker, media-only-ad-blocker, reels-blocker,
// media-timeout) writes verdict 'blocked' with a synthetic technique
// 'ai-content-block' at severity 10. The 10 means "the rule matched exactly",
// not "this was harmful" — most of these records are advertisements.
//
// Both export scripts defined flagged as "flag verdict OR max severity >= 5",
// so every blocked ad landed in the headline flag count AND in the
// high-severity bar. Measured on a real 5,365-record export: the feed summary
// read 307 flagged / 202 high-severity, when the true safety numbers were
// 243 / 138. A third of the scariest bar in a court-facing document was ads.
//
// The dashboard already ruled on this (overview-data.ts, note under
// isFlaggedVerdict, SOL review 2026-07-15 finding 5). These locks stop the
// export drifting back.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport,
  BEHAVIOR_SCRIPT,
  FEED_SCRIPT,
  I18N,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-07-01T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'tiktok',
    originalText: 'sample',
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@user',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
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

/** Exactly what the ad blocker writes. */
function blockedAd(): ForensicRecord {
  return rec({
    verdict: 'blocked',
    detectionMode: 'block:ads:platform-ad-marker',
    overallScore: 10,
    techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }],
  });
}

function flaggedPost(): ForensicRecord {
  return rec({
    verdict: 'flagged',
    overallScore: 8,
    techniques: [{ name: 'fear-appeal', severity: 8, confidence: 0.9 }],
  });
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function render(records: ForensicRecord[], script: string, mountId: string): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(
    /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/,
  );
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = `<div id="${mountId}"></div>`;
  // The numbers engine first, as the page loads it: run alone, these scripts
  // fall back to counting rules of their own that no recipient ever executes.
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${script}`)();
  return (document.getElementById(mountId) as HTMLElement).innerHTML;
}

const feed = (rs: ForensicRecord[]) => render(rs, FEED_SCRIPT, 'fw-feed');
const behavior = (rs: ForensicRecord[]) => render(rs, BEHAVIOR_SCRIPT, 'fw-behavior');

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('export feed summary — blocked ads stay out of the flag count', () => {
  it('counts only the real flag, not the three blocked ads beside it', () => {
    const html = feed([blockedAd(), blockedAd(), blockedAd(), flaggedPost()]);
    const flaggedTile = html.match(
      new RegExp(`<b>(\\d+)</b><span>${I18N.en.feedFlagged}</span>`),
    );
    expect(flaggedTile?.[1]).toBe('1');
  });

  it('gives blocks their own tile and says what the severity 10 on them means', () => {
    const html = feed([blockedAd(), blockedAd(), flaggedPost()]);
    const blockTile = html.match(
      new RegExp(`<b>(\\d+)</b><span>${I18N.en.feedBlockedCount}</span>`),
    );
    expect(blockTile?.[1]).toBe('2');
    expect(html).toContain('the rule matched exactly');
  });

  it('omits the block tile entirely when the blocker never fired', () => {
    const html = feed([flaggedPost(), rec()]);
    expect(html).not.toContain(I18N.en.feedBlockedCount);
    expect(html).not.toContain(I18N.en.feedBlockedNote);
  });

  it('keeps blocked ads out of the high-severity bar', () => {
    // Four severity-10 ads + one severity-8 flag. The high bar must read 1/1,
    // not 5/5 — this is the exact distortion measured on the real export.
    const html = feed([blockedAd(), blockedAd(), blockedAd(), blockedAd(), flaggedPost()]);
    const bars = html.match(/<span class="fw-barnum">(\d+)<\/span>/g) ?? [];
    expect(bars.slice(0, 3)).toEqual([
      '<span class="fw-barnum">1</span>', // high
      '<span class="fw-barnum">0</span>', // medium
      '<span class="fw-barnum">0</span>', // low
    ]);
  });

  it('keeps the block technique out of the "most common techniques" chart', () => {
    // The chart renders display labels, not enum names: 'fear' for
    // fear-appeal, 'made by AI' for ai-content-block.
    const html = feed([blockedAd(), blockedAd(), blockedAd(), flaggedPost()]);
    const chart = html.slice(html.indexOf(I18N.en.feedTechniquesHeader));
    const chartBars = chart.slice(0, chart.indexOf('fw-people'));
    expect(chartBars).toContain('>fear<');
    expect(chartBars).not.toContain('made by AI');
  });
});

describe('export behavior section — blocked ads break a run, they do not extend it', () => {
  it('does not let a wall of ads read as an unbroken flagged run', () => {
    // Six blocked ads in a row would previously have fired the run caution at
    // length 6. They are not flags, so no run and no caution.
    const html = behavior([
      blockedAd(), blockedAd(), blockedAd(), blockedAd(), blockedAd(), blockedAd(),
    ]);
    expect(html).toContain(I18N.en.bhCautionNone);
    expect(html).not.toContain(I18N.en.bhCautionRun);
  });

  it('still counts blocked items in the denominator — they were encountered', () => {
    const html = behavior([blockedAd(), blockedAd(), flaggedPost()]);
    expect(html).toContain('3 records');
  });
});

describe('a blocked row names what matched, not a severity it does not claim', () => {
  it('replaces the 10/10 on an ad with the rule that fired', () => {
    // With the numbers engine loaded, as every recipient has it, the row is
    // labelled by the engine: the user's own rule, named. This assertion used
    // to read the fallback label, because the test ran the page script alone.
    const html = feed([blockedAd()]);
    expect(html).toContain(`${I18N.en.feedYourRule}: ${I18N.en.ruleAdMarker}`);
    expect(html).toContain(I18N.en.feedBlocked);
    // The severity word must not appear beside a blocked technique: its 10 is
    // the rule matching, not a reading of the content.
    expect(html).not.toContain(`${I18N.en.feedSeverityWord} 10/10`);
  });

  it('still prints a real severity on a real finding', () => {
    const html = feed([flaggedPost()]);
    expect(html).toContain(`${I18N.en.feedSeverityWord} 8/10`);
    expect(html).not.toContain(`${I18N.en.feedYourRule}: ${I18N.en.ruleAdMarker}`);
  });
});
