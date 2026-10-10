// Render test for the Patterns-tab "What the feed was made of" section.
// The composition panel is a synchronous read, so it renders above
// PatternsTab's async theme guard. Verifies the coverage line (labeled /
// eligible with its denominator), the two axis headings, the humanized
// label chips, the empty state, and RO localization for the new keys.
// Also covers the FeedCard per-card topic chips on environment records.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PatternsTab } from '../../../../../src/ui/dashboard/components/PatternsTab';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function makeRecord(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-07-01T10:00:00.000Z',
    platform: 'tiktok',
    originalText: 'text',
    originalHash: 'h',
    originalLength: 4,
    neutralizedText: '',
    author: 'creator',
    postUrl: 'https://www.tiktok.com/@creator/video/123',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    ...over,
  } as ForensicRecord;
}

function envRecord(id: string, topicLabels: string[]): ForensicRecord {
  return makeRecord({
    id,
    kind: 'environment',
    environment: {
      label: 'healthy-discussion',
      summary: 'calm room',
      dominantTechnique: null,
      topicLabels,
      negativePct: 0,
      positivePct: 100,
      neutralPct: 0,
      sampled: 5,
    },
  });
}

function renderPatterns(records: ForensicRecord[], lang: 'en' | 'ro' = 'en'): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang,
      children: React.createElement(PatternsTab, { records }),
    }),
  );
}

describe('PatternsTab feed composition', () => {
  it('renders the coverage line, axis heading, and humanized label chips', () => {
    const html = renderPatterns([
      envRecord('a', ['comedy-memes', 'gaming']),
      makeRecord({ id: 'p1', kind: 'post' }),
    ]);
    expect(html).toContain('What the feed was made of');
    // 1 labeled of 2 entries seen: the unlabeled post stays in the denominator, and the
    // sentence says that only the comment-section summary can carry a topic.
    expect(html).toMatch(/1 of 2 entries seen in the 7 days to [^<]+ carry a content label; topic labels come only from the 1 comment-section summary among them./);
    expect(html).toContain('What it was about');
    expect(html).toContain('comedy memes'); // dash humanized
    expect(html).toContain('gaming');
  });

  it('renders the format axis from videoContext.contentType', () => {
    const html = renderPatterns([
      makeRecord({
        id: 'v1',
        kind: 'video',
        videoContext: {
          overlayText: '', scene: '', contentType: 'music-dance',
          techniques: [], severity: 0, model: 'm', frameCount: 4,
        } as ForensicRecord['videoContext'],
      }),
    ]);
    expect(html).toContain('What form it took');
    expect(html).toContain('music dance');
  });

  it('shows the empty state when no labels exist in range', () => {
    const html = renderPatterns([makeRecord({ id: 'p1', kind: 'post' })]);
    expect(html).toContain('No content labels in this range.');
  });

  it('localizes the composition copy in Romanian', () => {
    const html = renderPatterns([envRecord('a', ['news'])], 'ro');
    expect(html).toContain('Din ce a fost compus feedul');
    expect(html).toContain('Despre ce a fost');
  });
});

describe('FeedCard environment topic chips', () => {
  it('renders topic label chips on an environment record', () => {
    const html = renderToStaticMarkup(
      React.createElement(I18nProvider, {
        lang: 'en',
        children: React.createElement(FeedCard, { record: envRecord('e1', ['finance-crypto']) }),
      }),
    );
    expect(html).toContain('finance crypto');
  });
});
