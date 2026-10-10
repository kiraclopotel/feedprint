/** @vitest-environment jsdom */
// An ad the page left visible is not "blocked before analysis", and no sentence may say it was hidden.
//
// Found 2026-09-20 on an export of 57 adult-mode records built with the product's own
// writers. The tile read "4 Blocked before analysis", the note under it said blocked items
// "were hidden by a fixed rule", and page one said of the file's 4 ads "it is hidden by your
// own Block Ads rule". Three were blocked and collapsed. The fourth was a pass whose decision
// block says applied: allow, and whose own card said the page could not apply the action.
// The tile asked isBlock(), which is "blocked, or an ad": the right question for "is this a
// finding" and the wrong one for "was this hidden".
//
// The same note ended "the severity 10 on their record means the rule matched exactly". No
// blocked record written since 2026-09-13 carries a severity (src/forensics/logger.ts, the
// blocked-record writer's own comment), so in that file the sentence described nothing.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { decisionForBlock } from '../../../src/content/record/decision';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function adRecord(applied: 'collapse' | 'hide' | 'allow', verdict: ForensicRecord['verdict']): ForensicRecord {
  seq++;
  const decision = decisionForBlock({ mode: 'adult', blockReason: 'ads', matchedToken: '', applied, mask: false });
  return {
    id: `ad-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'twitter', originalText: 'sponsored', originalHash: `h-${seq}`, originalLength: 9, neutralizedText: '',
    author: '@advertiser', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'rules',
    feedSource: 'for-you', detectionMode: 'block:ads:marker', integrityHash: `i-${seq}`, signature: 'sig',
    publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict, decision,
  } as ForensicRecord;
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

function blockedTile(records: ForensicRecord[]): number {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  const out = (document.getElementById('fw-feed') as HTMLElement).innerHTML;
  const t = out.match(new RegExp(`<b>(\\d+)</b><span>${I18N.en.feedBlockedCount}</span>`));
  return t ? Number(t[1]) : 0;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  seq = 0;
});

describe('an ad left on the page is not counted as blocked', () => {
  it('the writer gives the two shapes this file is about', () => {
    const hidden = adRecord('collapse', 'blocked');
    const visible = adRecord('allow', 'pass');
    expect(hidden.decision?.row).toBe('R4');
    expect(visible.decision?.applied).toBe('allow');
    expect(visible.decision?.note, 'an ad that stayed visible carries the note saying so').toBeTruthy();
  });

  it('three hidden ads and one the page left visible: the tile says 3', () => {
    expect(blockedTile([
      adRecord('collapse', 'blocked'), adRecord('collapse', 'blocked'), adRecord('hide', 'blocked'),
      adRecord('allow', 'pass'),
    ])).toBe(3);
  });

  it('a file whose only ad stayed visible prints no blocked tile at all', () => {
    expect(blockedTile([adRecord('allow', 'pass')])).toBe(0);
  });

  it('no language says of every ad that it was hidden', () => {
    const ALL_HIDDEN = /and it is hidden by your own|și sunt ascunse de propria|y la oculta tu propia|e é ocultad[ao] pela sua própria/i;
    for (const lang of UI_LANGUAGES) {
      expect(I18N[lang].summaryPaidPlacementValue, lang).not.toMatch(ALL_HIDDEN);
    }
  });

  it('no language says every blocked record carries a severity of 10', () => {
    const EVERY_RECORD = /the severity 10 on their record|severitatea 10 din înregistrarea lor|la gravedad 10 de su registro|a gravidade 10 no registro deles/i;
    for (const lang of UI_LANGUAGES) {
      expect(I18N[lang].feedBlockedNote, lang).not.toMatch(EVERY_RECORD);
      expect(I18N[lang].feedBlockedNote, `${lang}: the date the severity stopped being written`).toMatch(/13/);
    }
  });
});
