/** @vitest-environment jsdom */
// An export prints the name a reader knows, never the key the record holds.
//
// Found 2026-09-20 on exports built with the product's own writers: cards and the per-platform
// bars said "twitter" and "youtube" under a numbers table whose rows said X and YouTube; every
// card said "Reader: default"; the narrative step said "consumer rapid frame" where the cards
// say "pressure to buy"; and page one gave a date range in the records' UTC two lines from a
// header in the viewer's own time zone, 14 to 15 September against 14 to 16, with nothing
// saying why they differ.

import { describe, it, expect, beforeEach } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, EXPOSURE_SCRIPT, BEHAVIOR_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { decisionForLegacy } from '../../../src/content/record/decision';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord>): ForensicRecord {
  seq++;
  return {
    id: `n-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(), platform: 'twitter',
    originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '', author: `@a${seq}`, postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`,
    signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const flagged = (name: string, platform: ForensicRecord['platform']): ForensicRecord => rec({
  platform, verdict: 'flagged', overallScore: 6, techniques: [{ name, severity: 6, confidence: 0.9 }],
  decision: decisionForLegacy({ mode: 'teen', detectionMode: 'ai-judge', techniques: [name], severity: 6, applied: 'mark', mask: false }),
  reader: 'default',
});
const file = (): ForensicRecord[] => [flagged('consumer-rapid-frame', 'twitter'), flagged('anger-trigger', 'twitter'), flagged('consumer-rapid-frame', 'youtube'), flagged('anger-trigger', 'youtube')];

function render(script: string, rootId: string, locale: ExportMetadata['locale'] = 'en'): { text: string; html: string } {
  const meta: ExportMetadata = { fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale };
  const html = buildForensicHtmlExport(file(), meta);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = `<div id="${rootId}"></div>`;
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${script}`)();
  return { text: (document.getElementById(rootId) as HTMLElement).textContent ?? '', html };
}

beforeEach(() => { document.body.innerHTML = ''; seq = 0; });

describe('an export prints names, not keys', () => {
  it('a card names the platform as the numbers table does', () => {
    const tags = (() => { render(FEED_SCRIPT, 'fw-feed'); return [...document.querySelectorAll('#fw-feed .fw-tag')].map((t) => t.textContent); })();
    expect(tags).toContain('X');
    expect(tags).toContain('YouTube');
    expect(tags).not.toContain('twitter');
    expect(tags).not.toContain('youtube');
  });

  it('so do the per-platform bars of the exposure summary', () => {
    render(EXPOSURE_SCRIPT, 'fw-exposure');
    const labels = [...document.querySelectorAll('#fw-exposure .fw-exp-barlabel')].map((t) => t.textContent);
    expect(labels).toContain('X');
    expect(labels).toContain('YouTube');
    expect(labels).not.toContain('twitter');
  });

  it('nobody declared at the keyboard is said in words, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const { text } = render(FEED_SCRIPT, 'fw-feed', lang);
      expect(text, lang).toContain(`${I18N[lang].feedReader}: ${I18N[lang].feedReaderDefault}`);
      expect(text, lang).not.toContain(`${I18N[lang].feedReader}: default`);
    }
  });

  it('the narrative step uses the label the cards use', () => {
    const { text, html } = render(BEHAVIOR_SCRIPT, 'fw-behavior');
    const labels = JSON.parse(html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1]).techLabels as Record<string, string>;
    expect(labels['consumer-rapid-frame'], 'the envelope carries a label for it').toBeTruthy();
    expect(text).toContain(labels['consumer-rapid-frame']);
    expect(text).not.toContain('consumer rapid frame');
  });

  it('page one says its date range is in UTC, once, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const { html } = render(FEED_SCRIPT, 'fw-feed', lang);
      const row = html.match(/<dd data-fw-prov="timeWindow">([\s\S]*?)<\/dd>/)?.[1] ?? '';
      expect(row, lang).toContain('2026-09-15');
      expect(row, lang).toContain('UTC');
    }
  });
});
