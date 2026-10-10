// @vitest-environment jsdom
//
// The lines left on the page when a post, comment or video is hidden or folded speak to their
// reader and never name the product as the one who ruled: a child reads one kind line that moves
// on and never the reason, a teen reads where the post went, an adult reads it plainly.

import { beforeEach, describe, expect, it } from 'vitest';
import { MARKER_STRINGS, type MarkerStrings } from '../../../src/i18n/marker-strings';
import { injectCollapseOrHide } from '../../../src/content/injector';
import { commentHideNoticeFor } from '../../../src/content/markers/comment-hide-notice';
import type { AnalysisResult } from '../../../src/types/analysis';

const LANGS = Object.keys(MARKER_STRINGS) as Array<keyof typeof MARKER_STRINGS>;

function onPageLines(t: MarkerStrings): Record<string, string> {
  return {
    hidLine: t.hidLine('x'), foldedLine: t.foldedLine('x'), foldedLineNoReason: t.foldedLineNoReason,
    hidLineTeen: t.hidLineTeen('x'), foldedLineTeen: t.foldedLineTeen('x'), foldedLineNoReasonTeen: t.foldedLineNoReasonTeen,
    skipLineChild: t.skipLineChild, hideNoticeBy: t.hideNoticeBy('@a'), hideNoticePlain: t.hideNoticePlain,
    hideNoticeByTeen: t.hideNoticeByTeen('@a'), hideNoticePlainTeen: t.hideNoticePlainTeen, hideNoticeChild: t.hideNoticeChild,
    hidCommentLine: t.hidCommentLine('x'), hidCommentPlain: t.hidCommentPlain,
    hidCommentLineTeen: t.hidCommentLineTeen('x'), hidCommentPlainTeen: t.hidCommentPlainTeen,
    videoRunNotice: t.videoRunNotice(3), videoHiddenScrollOn: t.videoHiddenScrollOn, adSlotNote: t.adSlotNote,
    greenAriaLabel: t.greenAriaLabel, yellowAriaLabel: t.yellowAriaLabel, redAriaLabel: t.redAriaLabel,
    collapseCalmAria: t.collapseCalmAria, collapseWhyAria: t.collapseWhyAria,
    checkingText: t.checkingText, checkingAria: t.checkingAria,
  };
}

function analysisWith(technique: AnalysisResult['techniques'][number]['technique']): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [{ technique, present: true, confidence: 0.9, severity: 8, evidence: [] }],
    overallScore: 8, overallConfidence: 0.9, isManipulative: true, processingTimeMs: 0,
    primaryTechnique: technique, explanation: 'x',
  };
}

function xPostText(): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = 'original caption text';
  article.appendChild(text);
  document.body.appendChild(article);
  return text;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('the words on the page', () => {
  it.each(LANGS)('%s: no hide, fold or skip line names the product', (lang) => {
    for (const [key, line] of Object.entries(onPageLines(MARKER_STRINGS[lang]))) {
      expect(line, `${lang}.${key}`).not.toMatch(/FeelingWise/);
    }
  });

  it.each(LANGS)('%s: the child lines name no reason', (lang) => {
    const t = MARKER_STRINGS[lang];
    const reasons = [t.catAdvertisement, t.catGraphicViolence, t.catSexual, t.catSelfHarm, t.catDrugPromotion,
      t.catAiSynthetic, t.catGroupClaim, t.catExtremeHostility, t.catDirectThreat];
    for (const line of [t.skipLineChild, t.hideNoticeChild]) {
      for (const r of reasons) expect(line.toLowerCase()).not.toContain(r.toLowerCase());
    }
  });

  it('a folded post reads in its mode: a skip for a child, where it went for a teen, plainly for an adult', () => {
    const t = MARKER_STRINGS.en;
    const child = xPostText();
    injectCollapseOrHide(child, analysisWith('sexual'), 'collapse', false, '', 'en', 'child');
    expect(document.body.textContent).toContain(t.skipLineChild);
    expect(document.body.textContent).not.toContain(t.catSexual);

    document.body.innerHTML = '';
    const teen = xPostText();
    injectCollapseOrHide(teen, analysisWith('sexual'), 'collapse', false, '', 'en', 'teen');
    expect(document.body.textContent).toContain(t.foldedLineTeen(t.catSexual));

    document.body.innerHTML = '';
    const adult = xPostText();
    injectCollapseOrHide(adult, analysisWith('sexual'), 'collapse', false, '', 'en', 'adult');
    expect(document.body.textContent).toContain(t.foldedLine(t.catSexual));
  });

  // A comment sits under its post, not in the feed, so Teen and Adult may share words for it.
  it('a hidden comment reads in its mode, and a child gets no notice', () => {
    const facts = { detectionMode: 'slur:1', techniques: ['extreme-toxicity'], severity: 9 };
    expect(commentHideNoticeFor('child', 'en', facts)).toBeNull();
    expect(commentHideNoticeFor('teen', 'en', facts)!.text).toBe(MARKER_STRINGS.en.hidCommentLineTeen(MARKER_STRINGS.en.whyByRow.R2));
    expect(commentHideNoticeFor('adult', 'en', facts)!.text.startsWith('Comment hidden')).toBe(true);
  });
});
