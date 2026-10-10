// content/comment-hide-notice.ts and content/hide-why.ts: what the comment
// placeholder says per mode and language. Child says nothing (null); Teen and
// Adult get the row's fragment after the sentence, the household's word quoted
// on R1, the plain sentence when no row can be named.

import { describe, it, expect } from 'vitest';
import { commentHideNoticeFor } from '../../../../src/content/markers/comment-hide-notice';
import { withWhy, whyFragment } from '../../../../src/content/markers/hide-why';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';

describe('commentHideNoticeFor', () => {
  it('Child gets no notice at all', () => {
    expect(commentHideNoticeFor('child', 'en', { detectionMode: 'slur:1', techniques: [], severity: 9 })).toBeNull();
  });

  it('Teen and Adult get the sentence with the row fragment and the reveal labels', () => {
    const n = commentHideNoticeFor('teen', 'en', { detectionMode: 'slur:1', techniques: ['extreme-toxicity'], severity: 9 });
    expect(n).not.toBeNull();
    expect(n!.text).toBe('Comment hidden: an identity slur');
    expect(n!.showLabel).toBe('show anyway');
    expect(n!.hideLabel).toBe('hide again');
    const a = commentHideNoticeFor('adult', 'ro', { detectionMode: 'slur:1', techniques: [], severity: 9 });
    expect(a!.text).toBe(`Comentariu ascuns: ${MARKER_STRINGS.ro.whyByRow.R2}`);
  });

  it('the household word is quoted, a slur never appears in the sentence', () => {
    const b = commentHideNoticeFor('adult', 'en', { detectionMode: 'blocklist:word:elon', techniques: [], severity: 9 });
    expect(b!.text).toBe('Comment hidden: on this household\'s block list ("elon")');
    const s = commentHideNoticeFor('adult', 'en', { detectionMode: 'slur:1', techniques: ['extreme-toxicity'], severity: 9 });
    expect(s!.text).not.toMatch(/\(/);
  });

  it('a profanity-tier hide gets the plain sentence, never an invented reason', () => {
    const p = commentHideNoticeFor('teen', 'es', { detectionMode: 'pre-rewrite-hide:profanity-tier', techniques: ['profanity'], severity: 9 });
    expect(p!.text).toBe(MARKER_STRINGS.es.hidCommentPlainTeen);
  });
});

describe('withWhy / whyFragment', () => {
  it('appends the fragment after a colon, and leaves the sentence alone without a why', () => {
    expect(withWhy('S', 'en', null)).toBe('S');
    expect(withWhy('S', 'en', { row: 'P5' })).toBe(`S: ${MARKER_STRINGS.en.whyByRow.P5}`);
    expect(whyFragment('pt-BR', { row: 'R1', match: 'tesla' })).toBe(`${MARKER_STRINGS['pt-BR'].whyByRow.R1} ("tesla")`);
  });
});
