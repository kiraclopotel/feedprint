/** @vitest-environment jsdom */
// Wiring audit 13 Sep, C22: the export card names a verdict a fixed product
// gate set (overrideOrigin) as a rule's, with no severity, and a reset marker
// shows the hash of the chain it replaced (priorChainHash).

import { describe, it, expect } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

const META: ExportMetadata = { fwVersion: 'test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };

function feed(records: Partial<ForensicRecord>[]): HTMLElement {
  const full = records.map((over, i) => ({
    id: `r-${i}`, timestamp: `2026-09-15T06:0${i}:00.000Z`, platform: 'twitter', originalText: `text ${i}`, originalHash: `h${i}`,
    originalLength: 6, neutralizedText: '', author: '@a', postUrl: '', overallScore: 0, userAgeCategory: 'adult', aiSource: 'cloud',
    feedSource: 'for-you', integrityHash: `ih${i}`, signature: 's', publicKeyFingerprint: 'fp', chainPosition: i, kind: 'post',
    verdict: 'pass', techniques: [], ...over,
  })) as unknown as ForensicRecord[];
  const html = buildForensicHtmlExport(full, META);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

describe('a gate verdict on the card', () => {
  it('names the rule and prints no severity', () => {
    const f = feed([{ verdict: 'flagged', aiSource: 'rules', overrideOrigin: 'identity-slur', overallScore: 9,
      techniques: [{ name: 'shame-attack', severity: 9, confidence: 1 }] as ForensicRecord['techniques'] }]);
    const tag = f.querySelector('.fw-tag-gate');
    expect(tag).not.toBeNull();
    expect(tag!.textContent).toContain(I18N.en.feedGateIdentitySlur);
    expect(tag!.getAttribute('title')).toBe(I18N.en.feedGateRule);
    expect(f.textContent).not.toContain('9/10');
  });

  it('a judged verdict keeps its severity and gets no gate tag', () => {
    const f = feed([{ verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 6, confidence: 0.9 }] as ForensicRecord['techniques'] }]);
    expect(f.querySelector('.fw-tag-gate')).toBeNull();
    expect(f.textContent).toContain('6/10');
  });
});

describe('a reset marker on the card', () => {
  it('shows the start of the hash of the chain it replaced', () => {
    const f = feed([{ kind: 'reset-marker', verdict: undefined, resetReason: 'user reset', priorChainHash: 'abcdef0123456789ffff' } as Partial<ForensicRecord>]);
    expect(f.textContent).toContain(`${I18N.en.feedPriorChain} abcdef012345`);
    expect(f.textContent).not.toContain('abcdef0123456789ffff');
  });

  it('says nothing about a prior chain when there was none', () => {
    const f = feed([{ kind: 'reset-marker', verdict: undefined, resetReason: 'user reset' } as Partial<ForensicRecord>]);
    expect(f.textContent).not.toContain(I18N.en.feedPriorChain);
  });

  it('every interface language carries the new words', () => {
    for (const loc of Object.keys(I18N) as Array<keyof typeof I18N>) {
      for (const k of ['feedPriorChain', 'feedGateRule', 'feedGateIdentitySlur', 'feedGateProfanityTier', 'feedGateCodedHarm', 'feedGateAdHominem', 'feedGateHarmFloor', 'feedGateRageFormat'] as const) {
        expect(I18N[loc][k], `${loc} ${k}`).toBeTruthy();
      }
    }
  });
});
