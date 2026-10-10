// DASH-3 (2026-07-13 dashboard-ui audit): "frequent flaggers" keyed the tally
// on raw `r.author`, reintroducing the exact bug class known-issues M18 fixed
// in `author-store` ("same @handle on two platforms merges into one profile,
// corrupting totalSeen/totalFlagged"). Two unrelated real accounts on two
// platforms sharing a handle (e.g. "@news") showed up as one combined
// "frequent flagger" row — a direct identity misattribution, not just an
// aggregate-count bug. This locks the fix: identity is now keyed on
// `authorProfileKey(handle, platform)`, the same composite key author-store
// uses, so same-handle-different-platform never merges.

import { describe, it, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  RecidivistAuthorsPanel,
  computeRecidivistSet,
} from '../../../../../src/ui/dashboard/components/RecidivistAuthorsPanel';
import { authorProfileKey } from '../../../../../src/forensics/author-store';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: 'r1',
    timestamp: '2026-06-13T21:00:00.000Z',
    platform: 'tiktok',
    originalText: 'sample text',
    originalHash: 'h',
    originalLength: 11,
    neutralizedText: '',
    author: '@news',
    postUrl: 'https://x',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    verdict: 'flagged',
    ...over,
  } as ForensicRecord;
}

describe('computeRecidivistSet platform scoping (DASH-3 / M18 class)', () => {
  it('same handle on two platforms does NOT merge — each platform is judged on its own flag count', () => {
    const records = [
      rec({ id: 'a1', platform: 'tiktok', author: '@news' }),
      rec({ id: 'a2', platform: 'tiktok', author: '@news' }),
      rec({ id: 'b1', platform: 'instagram', author: '@news' }), // only 1 flag on IG — below threshold
    ];
    const set = computeRecidivistSet(records, 2);
    expect(set.has(authorProfileKey('@news', 'tiktok'))).toBe(true);
    expect(set.has(authorProfileKey('@news', 'instagram'))).toBe(false);
  });

  it('a genuine repeat offender on both platforms earns two distinct identities, not one merged count', () => {
    const records = [
      rec({ id: 'a1', platform: 'tiktok', author: '@news' }),
      rec({ id: 'a2', platform: 'tiktok', author: '@news' }),
      rec({ id: 'b1', platform: 'instagram', author: '@news' }),
      rec({ id: 'b2', platform: 'instagram', author: '@news' }),
    ];
    const set = computeRecidivistSet(records, 2);
    expect(set.has(authorProfileKey('@news', 'tiktok'))).toBe(true);
    expect(set.has(authorProfileKey('@news', 'instagram'))).toBe(true);
    expect(set.size).toBe(2);
  });

  it('a raw-handle lookup (the pre-fix bug) no longer matches — callers must key by platform', () => {
    const records = [
      rec({ id: 'a1', platform: 'tiktok', author: '@news' }),
      rec({ id: 'a2', platform: 'tiktok', author: '@news' }),
    ];
    const set = computeRecidivistSet(records, 2);
    expect(set.has('@news')).toBe(false);
  });
});

describe('RecidivistAuthorsPanel rendering (DASH-3)', () => {
  it('renders TWO separate rows for the same handle flagged on two different platforms', () => {
    const records = [
      rec({ id: 'a1', platform: 'tiktok', author: '@news' }),
      rec({ id: 'a2', platform: 'tiktok', author: '@news' }),
      rec({ id: 'b1', platform: 'instagram', author: '@news' }),
      rec({ id: 'b2', platform: 'instagram', author: '@news' }),
    ];
    const html = renderToStaticMarkup(
      React.createElement(I18nProvider, {
        lang: 'en',
        children: React.createElement(RecidivistAuthorsPanel, {
          records,
          onPickAuthor: () => {},
        }),
      }),
    );
    const rowCount = (html.match(/recidivist-row/g) ?? []).length;
    // Two <button class="recidivist-row"> elements — one per platform-scoped
    // identity — not one merged row with a combined 4x count.
    expect(rowCount).toBe(2);
    expect(html).not.toContain('4×');
    expect(html).toContain('2×');
  });
});
