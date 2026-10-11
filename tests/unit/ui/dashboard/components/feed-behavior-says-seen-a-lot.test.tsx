/** @vitest-environment jsdom */
// Feed behavior printed the raw code "repeat-exposure" under a post group, where the Feed log says "seen a lot" and
// Statistics "Seen a lot". The chip under a group says every technique in the reader's words, so no code reaches the
// screen in that view, in any of the four languages. The post groups paint after the tab's word grouping settles, so
// the tab is mounted and read once they are there.

import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { PatternsTab } from '../../../../../src/ui/dashboard/components/PatternsTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const served = (i: number, technique: string): ForensicRecord => ({
  id: `p${i}`, timestamp: new Date(Date.parse('2026-10-09T08:00:00Z') + i * 6 * 3_600_000).toISOString(), platform: 'facebook',
  originalText: 'Only today: everything must go before midnight!', originalHash: `same-${technique}`, originalLength: 48,
  neutralizedText: '', author: '@book.corner', postUrl: '', overallScore: 5, userAgeCategory: 'adult', aiSource: 'rules',
  feedSource: 'home', integrityHash: 'ih', kind: 'post', verdict: 'flagged',
  techniques: [{ name: technique, severity: 5, confidence: 0.9 }],
} as unknown as ForensicRecord);

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

/** The tab's text once its post groups have painted. */
async function feedBehaviorText(lang: typeof UI_LANGUAGES[number], technique: string, make: (i: number, technique: string) => ForensicRecord = served): Promise<string> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const records = [0, 1, 2, 3].map((i) => make(i, technique));
  await act(async () => {
    root!.render(React.createElement(I18nProvider, { lang, children: React.createElement(PatternsTab, { records, readingOffered: false }) }));
  });
  const title = DASHBOARD_STRINGS[lang].patReserveTitle;
  for (let i = 0; i < 50 && !(host.textContent ?? '').includes(title); i++) {
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  expect(host.textContent, `${lang}: the post groups never painted`).toContain(title);
  return host.textContent ?? '';
}

describe('a post group on Feed behavior', () => {
  for (const lang of UI_LANGUAGES) {
    it(`${lang}: says "seen a lot" in the reader's words, never the code`, async () => {
      const text = await feedBehaviorText(lang, 'repeat-exposure');
      expect(text, lang).toContain(DASHBOARD_STRINGS[lang].techniqueLabel('repeat-exposure'));
      expect(text, lang).not.toContain('repeat-exposure');
    });
  }

  it('says any other technique in words too', async () => {
    const text = await feedBehaviorText('en', 'false-urgency');
    expect(text).toContain(DASHBOARD_STRINGS.en.techniqueLabel('false-urgency'));
    expect(text).not.toContain('false-urgency');
  });
});

// A hidden ad served again: the page named no advertiser, so its record has no author.
const hiddenAdAgain = (i: number, technique: string): ForensicRecord => ({
  ...served(i, technique), author: '', verdict: 'blocked', detectionMode: 'block:ads:platform-ad-marker',
  originalText: 'Sponsored An invented ad, hidden.', originalHash: 'same-ad',
} as unknown as ForensicRecord);

describe('a hidden ad served again on Feed behavior', () => {
  for (const lang of UI_LANGUAGES) {
    it(`${lang}: reads as the card does, "Sponsored post, advertiser not shown", never an empty name`, async () => {
      const text = await feedBehaviorText(lang, 'ai-content-block', hiddenAdAgain);
      expect(text, lang).toContain(`${DASHBOARD_STRINGS[lang].feedAdAuthorNotShown} · Sponsored An invented ad, hidden.`);
    });
  }
});
