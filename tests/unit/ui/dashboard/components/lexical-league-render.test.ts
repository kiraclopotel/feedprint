// Render test for the Patterns-tab lexical league section. The league is a
// synchronous read, so it renders above PatternsTab's async theme guard — the
// static markup carries it even while themes are still "computing". Verifies
// the verbatim term, tier label, denominator-bearing count, and the empty
// state, in both EN and RO (i18n coverage for the new keys).

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PatternsTab } from '../../../../../src/ui/dashboard/components/PatternsTab';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function makeRecord(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-06-13T21:00:00.000Z',
    platform: 'tiktok',
    originalText: '',
    originalHash: 'h',
    originalLength: 0,
    neutralizedText: '',
    author: 'creator99',
    postUrl: 'https://www.tiktok.com/@creator99/video/123',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

function render(records: ForensicRecord[], lang: 'en' | 'ro' = 'en'): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang,
      children: React.createElement(PatternsTab, { records }),
    }),
  );
}

describe('PatternsTab lexical league', () => {
  it('renders the verbatim term, its tier, and a denominator-bearing count', () => {
    const html = render([
      makeRecord({ id: 'a', originalText: 'shit shit', timestamp: '2026-06-13T20:00:00.000Z' }),
      makeRecord({ id: 'b', originalText: 'this is shit', timestamp: '2026-06-13T21:00:00.000Z' }),
    ]);
    expect(html).toContain('Words that appeared most');
    expect(html).toContain('shit');
    expect(html).toContain('profanity');
    // 3 occurrences across 2 distinct member records — the count names its denominator.
    expect(html).toContain('3× across 2 items');
  });

  it('marks identity slurs distinctly from profanity', () => {
    const html = render([
      makeRecord({ id: 'a', originalText: 'you retard', timestamp: '2026-06-13T21:00:00.000Z' }),
    ]);
    expect(html).toContain('retard');
    expect(html).toContain('identity slur');
  });

  it('shows the empty state when no flagged words are in range', () => {
    const html = render([
      makeRecord({ id: 'a', originalText: 'lovely sunset today', timestamp: '2026-06-13T21:00:00.000Z' }),
    ]);
    expect(html).toContain('No flagged words in the recorded text for this range.');
  });

  it('localizes the league copy in Romanian', () => {
    const html = render(
      [makeRecord({ id: 'a', originalText: 'shit', timestamp: '2026-06-13T21:00:00.000Z' })],
      'ro',
    );
    expect(html).toContain('Cuvintele care au apărut cel mai des');
    expect(html).toContain('înjurătură');
  });
});
