// @vitest-environment jsdom
//
// The records written before 12 Oct 2026 carry the platform's "See more" button on the end of a cut Facebook or Instagram
// post (2,256 of the 6,904 Facebook texts in the owner's export). The signed text is not touched; the dashboard shows the
// words without the button: on the card, in the readable text the Feed log row and the search read, and in the shown text.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { readableText } from '../../../../../src/ui/dashboard/record-sets';
import { shownText } from '../../../../../src/ui/dashboard/shown-text';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../../../src/i18n/react';
import { buildSearchIndex, recordPasses, matchesWhat, type ActivityFilterState } from '../../../../../src/ui/dashboard/components/activity-filters';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: over.id ?? 'r', timestamp: '2026-10-11T10:00:00.000Z', platform: 'facebook', kind: 'post',
    originalText: 'x', originalHash: 'h', originalLength: 1, neutralizedText: '', author: 'a',
    postUrl: 'https://www.facebook.com/a/posts/1', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih',
    verdict: 'pass', chainPosition: 1,
    ...over,
  } as ForensicRecord;
}

const STUCK = 'Three lines of a long post that Facebook cut… See more';
const CLEAN = 'Three lines of a long post that Facebook cut…';

const cardText = (r: ForensicRecord): string =>
  (new DOMParser().parseFromString(
    renderToStaticMarkup(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedCard, { record: r }) })),
    'text/html',
  ).body.textContent ?? '').replace(/\s+/g, ' ');

describe('an old record shows its words without the stuck button', () => {
  it('the readable text and the shown text are the words, and the signed text stays as it was', () => {
    const r = rec({ originalText: STUCK, textCapture: 'cut' });
    expect(readableText(r)).toBe(CLEAN);
    expect(shownText(r, 'en')).toBe(CLEAN);
    expect(r.originalText).toBe(STUCK);
  });

  it('the card shows the words, not the button', () => {
    const text = cardText(rec({ originalText: STUCK, textCapture: 'cut' }));
    expect(text).toContain(CLEAN);
    expect(text).not.toContain('See more');
  });

  it('the Romanian button too, on a post the record did not mark cut', () => {
    const r = rec({ originalText: 'Un text lung tăiat de Facebook… Vezi mai mult', textCapture: 'whole' });
    expect(readableText(r)).toBe('Un text lung tăiat de Facebook…');
  });

  it('a record from a platform whose control sits beside the text is shown as it is', () => {
    const r = rec({ platform: 'twitter', originalText: 'A post… Show more', textCapture: 'cut' });
    expect(readableText(r)).toBe('A post… Show more');
  });

  it('a search for the words finds the record, and a search for the button does not', () => {
    const NONE: ActivityFilterState = {
      filter: 'all', platformFilter: 'all', accountFilter: 'all', whenFilter: 'any',
      severityFilter: null, kindFilter: null, modeFilter: null, modelFilter: null,
      techniqueFilter: null, hiddenCategoryFilter: null, safetyBucketFilter: null,
      recordIdsFilter: null, roomUrlFilter: null, hourRangeFilter: null, search: '',
      surfaceFilter: null, sessionFilter: null, seenBeforeFilter: null, authorFilter: null,
    };
    const what = (r: ForensicRecord, f: ActivityFilterState['filter']) => matchesWhat(r, f, new Map(), new Set());
    const r = rec({ originalText: STUCK, textCapture: 'cut' });
    const index = buildSearchIndex([r]);
    expect(recordPasses(r, { ...NONE, search: 'Facebook cut' }, what, index)).toBe(true);
    expect(recordPasses(r, { ...NONE, search: '"see more"' }, what, index)).toBe(false);
  });
});
