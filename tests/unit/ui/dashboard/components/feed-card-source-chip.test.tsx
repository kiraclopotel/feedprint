// The Activity card's source chip says WHO posted an item. A person is the
// default and says nothing, so the chip stays off for it; on X every post is
// a person and a "Person" chip beside every count read as noise
// (likes and quoted posts looked as if they named a person). Group, page
// and ad still show, because those carry information.

import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { SourceChip } from '../../../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

function record(accountType: ForensicRecord['accountType'], sourceContainer?: string): ForensicRecord {
  return {
    id: 'fr-1', timestamp: '2026-09-05T00:00:00.000Z', platform: 'twitter', originalText: 'x', originalHash: 'h',
    originalLength: 1, neutralizedText: '', author: 'a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'i', verdict: 'pass',
    accountType, sourceContainer,
  } as ForensicRecord;
}

function render(r: ForensicRecord, lang: 'en' | 'ro' = 'en'): string {
  return renderToString(createElement(I18nProvider, { lang, children: createElement(SourceChip, { record: r }) }));
}

describe('the source chip', () => {
  it('renders nothing for a person, in every language', () => {
    expect(render(record('person'), 'en')).toBe('');
    expect(render(record('person'), 'ro')).toBe('');
  });

  it('still names a group, a page and an ad', () => {
    expect(render(record('group', 'Example Hobby Group'))).toContain(DASHBOARD_STRINGS.en.sourceChipLabels.group);
    expect(render(record('group', 'Example Hobby Group'))).toContain('Example Hobby Group');
    expect(render(record('page'))).toContain(DASHBOARD_STRINGS.en.sourceChipLabels.page);
    expect(render(record('advertiser'))).toContain(DASHBOARD_STRINGS.en.sourceChipLabels.advertiser);
  });

  it('renders nothing for a legacy record with no label', () => {
    expect(render(record(undefined))).toBe('');
  });
});
