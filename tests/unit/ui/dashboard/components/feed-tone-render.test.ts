// Render test for the Patterns-tab "tone of the comment sections" panel.
// Synchronous read, renders above the async theme guard. Verifies the title,
// the three share percentages with their labels, the coverage line, the empty
// state, and RO localization.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PatternsTab } from '../../../../../src/ui/dashboard/components/PatternsTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function envRecord(id: string, pos: number, neu: number, neg: number, sampled: number): ForensicRecord {
  return {
    id,
    timestamp: '2026-07-03T10:00:00.000Z',
    platform: 'tiktok',
    originalText: '',
    originalHash: 'h',
    originalLength: 0,
    neutralizedText: '',
    author: 'creator',
    postUrl: 'https://x/y',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'ih',
    kind: 'environment',
    environment: {
      label: 'healthy-discussion', summary: 's', dominantTechnique: null,
      positivePct: pos, neutralPct: neu, negativePct: neg, sampled,
    },
  } as ForensicRecord;
}

function render(records: ForensicRecord[], lang: 'en' | 'ro' = 'en'): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { lang, children: React.createElement(PatternsTab, { records }) }),
  );
}

describe('PatternsTab feed tone', () => {
  it('renders the tone title, share percentages, and coverage line', () => {
    const html = render([
      envRecord('a', 70, 20, 10, 50),
      envRecord('b', 70, 20, 10, 50),
    ]);
    expect(html).toContain('The tone of the comment sections');
    expect(html).toContain('70%');
    expect(html).toContain('positive');
    expect(html).toContain('negative');
    // 2 rooms, 100 comments read.
    expect(html).toContain('Across 2 comment sections (100 comments read).');
  });

  it('shows the empty state when no room sentiment exists in range', () => {
    const html = render([
      { id: 'p', timestamp: '2026-07-03T10:00:00.000Z', platform: 'tiktok', kind: 'post', techniques: [], originalText: '', originalHash: 'h', originalLength: 0, neutralizedText: '', author: 'a', postUrl: '', overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih' } as ForensicRecord,
    ]);
    expect(html).toContain('No comment-section readings in this range yet.');
  });

  it('localizes the tone copy in Romanian', () => {
    const html = render([envRecord('a', 60, 30, 10, 20)], 'ro');
    expect(html).toContain('Tonul secțiunilor de comentarii');
    expect(html).toContain('pozitiv');
  });
});
