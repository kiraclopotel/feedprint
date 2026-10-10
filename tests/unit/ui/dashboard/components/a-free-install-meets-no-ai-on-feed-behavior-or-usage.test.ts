// A free install is not offered the AI reading, so it never meets the word (ai-wording.ts). Feed behavior's tone and
// composition panels are the AI's reading of the comment sections and of each item, and the usage panel on the Record
// tab counted "rewritten" items, which only the reading does. On a free install the two panels are gone and the usage
// panel says marked; a paid install keeps all three as they were.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PatternsTab } from '../../../../../src/ui/dashboard/components/PatternsTab';
import { UsageTimePanel } from '../../../../../src/ui/dashboard/components/UsageTimePanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { dashboardWords } from '../../../../../src/ui/dashboard/dashboard-words';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const room = {
  id: 'room', timestamp: '2026-07-03T10:00:00.000Z', platform: 'tiktok', originalText: '', originalHash: 'h',
  originalLength: 0, neutralizedText: '', author: 'creator', postUrl: 'https://x/y', techniques: [], overallScore: 0,
  userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih', kind: 'environment',
  environment: { label: 'healthy-discussion', summary: 's', dominantTechnique: null, positivePct: 70, neutralPct: 20, negativePct: 10, sampled: 50 },
} as unknown as ForensicRecord;

const AI_WORD = /\bAI\b|\bIA\b|rewrit|rescri|reescri/i;

function feedBehavior(lang: 'en' | 'ro', readingOffered: boolean): string {
  return renderToStaticMarkup(React.createElement(I18nProvider, {
    lang, children: React.createElement(PatternsTab, { records: [room], readingOffered }),
  }));
}

function usage(lang: 'en' | 'ro', readingOffered: boolean): string {
  return renderToStaticMarkup(React.createElement(I18nProvider, {
    lang, children: React.createElement(UsageTimePanel, { records: [room], readingOffered }),
  }));
}

describe('a free install meets no AI words on Feed behavior or in the usage panel', () => {
  for (const lang of ['en', 'ro'] as const) {
    it(`${lang}: Feed behavior shows neither the tone nor the composition panel`, () => {
      const t = DASHBOARD_STRINGS[lang];
      const html = feedBehavior(lang, false);
      expect(html).not.toContain(t.patToneTitle);
      expect(html).not.toContain(t.patCompTitle);
      expect(html).not.toMatch(AI_WORD);
    });

    it(`${lang}: the usage panel says marked, never rewritten`, () => {
      const html = usage(lang, false);
      expect(html).toContain(dashboardWords(lang).usageFlaggedNoAi);
      expect(html).toContain(dashboardWords(lang).legendMarkNoAi);
      expect(html).not.toMatch(AI_WORD);
    });
  }

  it('a paid install keeps the tone panel and the rewrite wording', () => {
    const t = DASHBOARD_STRINGS.en;
    expect(feedBehavior('en', true)).toContain(t.patToneTitle);
    const html = usage('en', true);
    expect(html).toContain(t.usageRewritesLabel);
    expect(html).toContain(t.legendRewrite);
  });
});
