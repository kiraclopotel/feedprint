// The tester's finding 7 (8 Oct 2026, raised by the journalist): the export said "274 impressions of 78 posts" and no
// page said what an impression is; a post with no recorded comment was labelled "Comments not recorded", which reads
// as a failure next to the store's promise that a harassing comment is still there later. Comments are recorded when
// they come on screen (src/content/comment-batch), so the label now says none were recorded and the tip says how
// to have them kept. An impression is one recorded thing the feed showed (src/forensics/export-numbers.ts).

import { describe, it, expect } from 'vitest';
import { I18N } from '../../../src/i18n/export-strings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

// Each language's definition starts with the word its numbers table uses for the column.
const IMPRESSION = {
  en: ['An impression is', 'impressions'],
  ro: ['O afișare este', 'afișări'],
  es: ['Una impresión es', 'impresiones'],
  'pt-BR': ['Uma impressão é', 'impressões'],
} as const;

describe('the export says what an impression is', () => {
  it.each(Object.entries(IMPRESSION))('%s: the numbers intro defines the word its table uses', (lang, [start, column]) => {
    const s = I18N[lang as keyof typeof I18N];
    expect(s.rdColImpressions).toBe(column);
    expect(s.rdIntro).toContain(start);
  });
});

describe('a post with no recorded comment', () => {
  it.each(Object.keys(DASHBOARD_STRINGS))('%s: is not labelled as a failure, and the tip says how comments are kept', (lang) => {
    const t = DASHBOARD_STRINGS[lang as keyof typeof DASHBOARD_STRINGS];
    expect(t.feedCommentStatus['not-captured']).not.toMatch(/not recorded|neînregistrate|no registrados|não registrados/i);
    expect(t.feedCommentStatusTip['not-captured'].length).toBeGreaterThan(t.feedCommentStatus['not-captured'].length + 40);
  });

  it('English names the screen as where comments are kept', () => {
    expect(DASHBOARD_STRINGS.en.feedCommentStatusTip['not-captured']).toContain('comments that come on your screen');
  });
});
