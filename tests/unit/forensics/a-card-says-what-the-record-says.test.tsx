// @vitest-environment jsdom
//
// The dashboard card and the export card, read against the record they draw:
//   - a swear mask is said once ("shown with swearing starred") and is not chipped "rewritten";
//   - the record's own note is on the dashboard card in the export's words, and a hide that did not land
//     with no note carries the same sentence on both cards;
//   - "too harmful to rewrite" is said only of a hide a reading or a slur rule made, never of a rule or a
//     limit (Reels switch, time limit, AI label, the household's own word).

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { webcrypto } from 'node:crypto';

import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { FeedCard } from '../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../src/i18n/react';
import { UI_LANGUAGES } from '../../../src/i18n';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { DECISION_NOTE_KEYS, decisionNoteWords } from '../../../src/i18n/decision-notes';
import {
  NOTE_AD_HIDDEN, NOTE_LEGACY_ACTED, NOTE_NOT_APPLIED, NOTE_PAIR_VETOED, NOTE_SETTING_OFF, NOTE_VIDEO_FOLDED, NOTE_VIDEO_MARKED, NOTE_VIDEO_SKIPPED,
  decisionForJudge, decisionForMask, rewriteStage,
} from '../../../src/content/record/decision';
import { verdictFor } from '../../../src/core/policy/table';
import { decisionForBlock, decisionForLegacy } from '../../../src/content/record/decision';
import type { DecisionAction, ForensicRecord } from '../../../src/types/forensic';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

type Judge = Parameters<typeof decisionForJudge>[0]['judge'];
const judge = (severity: number): Judge => ({ id: 'judge-v1', hash: 'h', model: 'm', provider: 'p', charged: true, family: 'hostility', severity, effect: 'pressure', intent: 'x' }) as unknown as Judge;

let seq = 0;
function base(decision: ForensicRecord['decision'], applied: DecisionAction, over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `c-${seq}`, timestamp: `2026-09-26T01:00:0${seq % 10}.000Z`, platform: 'tiktok', originalText: 'a hostile caption with words', originalHash: 'h',
    originalLength: 28, neutralizedText: '', author: '@user', postUrl: '', techniques: [{ name: 'combined', severity: 5, confidence: 0.9 }],
    overallScore: 5, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', publicKeyFingerprint: 'fp', chainPosition: seq - 1,
    prevRecordHash: '', kind: 'video', verdict: verdictFor(applied), decision, reader: 'default', ...over,
  } as unknown as ForensicRecord;
}

/** A swear mask that landed: the stars are the words the page showed. */
const maskLanded = () => base(decisionForMask('teen'), 'mask', { neutralizedText: 'a hostile **** with words', techniques: [] });
/** A hide the page could not apply, as the writer records it. */
const hideNotApplied = () => base(decisionForJudge({ mode: 'adult', judge: judge(8), provider: 'p', applied: 'mark', mask: false, rewrite: { attempted: false, outcome: 'off' }, landed: false }), 'mark', { visualApplied: false, verdict: 'flagged' });
/** A fold that failed and kept its action: the writer signs no note, and visualApplied says it did not land. */
const foldNotApplied = () => base(decisionForJudge({ mode: 'adult', judge: judge(5), provider: 'p', applied: 'mark', mask: false, rewrite: { attempted: false, outcome: 'off' }, landed: false }), 'mark', { visualApplied: false, verdict: 'flagged' });

const LANGS = UI_LANGUAGES;
const dashText = (r: ForensicRecord, lang: (typeof LANGS)[number] = 'en'): string =>
  (new DOMParser().parseFromString(renderToStaticMarkup(React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record: r }) })), 'text/html').body.textContent ?? '').replace(/\s+/g, ' ');
const dashDoc = (r: ForensicRecord, lang: (typeof LANGS)[number] = 'en'): Document =>
  new DOMParser().parseFromString(renderToStaticMarkup(React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record: r }) })), 'text/html');

const META: ExportMetadata = { fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };
function exportDecision(r: ForensicRecord): string {
  const html = buildForensicHtmlExport([r], META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)!;
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m[1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return Array.from(document.querySelectorAll('.fw-decision')).map((e) => e.textContent).join(' | ');
}

describe('a swear mask on the dashboard card', () => {
  it.each(LANGS)('%s: says the outcome once, as the export card does', (lang) => {
    const t = DASHBOARD_STRINGS[lang];
    const text = dashText(maskLanded(), lang);
    expect(text).toContain(t.feedDecisionAction.mask);
    expect(text).not.toContain(`${t.feedDecisionShownAs} ${t.feedDecisionAction.mask}`);
    expect(text).not.toContain(`${t.feedDecisionAction.allow}, ${t.feedDecisionShownAs}`);
  });

  it('is not chipped "rewritten": a mask stars words, it does not rewrite them', () => {
    const doc = dashDoc(maskLanded());
    expect(doc.querySelector('.fc-action-label.rewritten')).toBeNull();
    // the block that names what was shown is still there
    expect(doc.body.textContent).toContain(DASHBOARD_STRINGS.en.feedMaskedLabel);
  });

  it('a rewrite that landed is still chipped rewritten', () => {
    const r = base(decisionForJudge({ mode: 'teen', judge: judge(6), provider: 'p', applied: 'soften', mask: false, rewrite: rewriteStage(true, { model: 'm' }) }), 'soften', { neutralizedText: 'a calm caption', userAgeCategory: 'teen' });
    expect(dashDoc(r).querySelector('.fc-action-label.rewritten')).not.toBeNull();
  });

  // The BETA pill speaks for the rewrite, which a model writes. The mask uses no model and is not
  // a beta feature, and it runs on installs with no key, where no rewrite ever happens.
  it.each(LANGS)('%s: carries no BETA pill, while a rewrite that landed keeps it', (lang) => {
    expect(dashDoc(maskLanded(), lang).querySelector('.beta-pill')).toBeNull();
    const r = base(decisionForJudge({ mode: 'teen', judge: judge(6), provider: 'p', applied: 'soften', mask: false, rewrite: rewriteStage(true, { model: 'm' }) }), 'soften', { neutralizedText: 'a calm caption', userAgeCategory: 'teen' });
    expect(dashDoc(r, lang).querySelector('.beta-pill')).not.toBeNull();
  });
});

describe('the record\'s note on the dashboard card', () => {
  it.each(LANGS)('%s: a hide that could not be applied says so, in the export card\'s words', (lang) => {
    expect(dashText(hideNotApplied(), lang)).toContain(I18N[lang].feedNoteNotApplied);
  });

  it('a fold that failed and carries no note says the same, from visualApplied', () => {
    const r = foldNotApplied();
    expect((r.decision as { note: string | null }).note).toBeNull();
    expect(dashText(r)).toContain(I18N.en.feedNoteNotApplied);
  });

  it('a record whose hide landed says nothing of the kind', () => {
    const landed = base(decisionForJudge({ mode: 'adult', judge: judge(8), provider: 'p', applied: 'hide', mask: false, rewrite: { attempted: false, outcome: 'off' } }), 'hide');
    expect(dashText(landed)).not.toContain(I18N.en.feedNoteNotApplied);
  });

  it('every sentence a decision block can carry has words in every language, and the constants are the keys', () => {
    for (const note of [NOTE_NOT_APPLIED, NOTE_SETTING_OFF, NOTE_LEGACY_ACTED, NOTE_VIDEO_SKIPPED, NOTE_VIDEO_MARKED, NOTE_VIDEO_FOLDED, NOTE_PAIR_VETOED, NOTE_AD_HIDDEN]) {
      expect(DECISION_NOTE_KEYS[note], note).toBeDefined();
      for (const lang of LANGS) {
        const words = decisionNoteWords(lang, note, undefined);
        expect(words, `${lang}: ${note}`).toBeTruthy();
        expect(words).not.toBe(note);
      }
    }
    expect(Object.keys(DECISION_NOTE_KEYS)).toHaveLength(9);
  });

  it('a sentence this build does not know is shown as written, and no note and no failure is nothing', () => {
    expect(decisionNoteWords('en', 'a sentence from a later build', undefined)).toBe('a sentence from a later build');
    expect(decisionNoteWords('en', null, undefined)).toBeNull();
    expect(decisionNoteWords('en', null, true)).toBeNull();
  });
});

describe('"too harmful to rewrite" on the dashboard card', () => {
  const blocked = (reason: string, token: string, withRow: boolean) => base(
    withRow ? decisionForBlock({ mode: 'child', blockReason: reason, matchedToken: token, applied: 'hide', mask: false }) : undefined,
    'hide',
    { verdict: 'blocked', detectionMode: `block:${reason}:${token}`, techniques: [], overallScore: 0, aiSource: 'rules', neutralizedText: '' },
  );
  const t = DASHBOARD_STRINGS.en;

  it.each([
    ['a Reels switch', () => blocked('reel-surface', 'reels', false)],
    ['a media time limit', () => blocked('media-timeout', 'parent-toggle', false)],
    ['an AI label', () => blocked('ai-label', 'AI-generated', false)],
    ['a household hashtag', () => blocked('hashtag', '#cheap', true)],
  ])('%s: a rule hid it, so the card does not say harm', (_name, make) => {
    const text = dashText(make());
    expect(text).not.toContain(t.feedHarmFloorNote);
    expect(text).toContain(t.feedHiddenKeptNote);
  });

  it("the household's own word in a post hides it without a finding of harm", () => {
    const r = base(decisionForLegacy({ mode: 'child', detectionMode: 'blocklist:word:cheapthing', techniques: [], applied: 'hide', mask: false }), 'hide', { techniques: [], overallScore: 0, aiSource: 'rules' });
    expect((r.decision as { row: string }).row).toBe('R1');
    expect(dashText(r)).not.toContain(t.feedHarmFloorNote);
  });

  it('a slur and a judged hide still say so, the controls', () => {
    const slur = base(decisionForLegacy({ mode: 'child', detectionMode: 'slur:1', techniques: ['profanity'], severity: 9, applied: 'hide', mask: false }), 'hide', { aiSource: 'rules' });
    expect((slur.decision as { row: string }).row).toBe('R2');
    expect(dashText(slur)).toContain(t.feedHarmFloorNote);
    const judged = base(decisionForJudge({ mode: 'child', judge: judge(8), provider: 'p', applied: 'hide', mask: false, rewrite: { attempted: false, outcome: 'off' } }), 'hide');
    expect(dashText(judged)).toContain(t.feedHarmFloorNote);
  });
});

describe('the export card for a hide that did not land', () => {
  it('a hide with a note says the note, and a fold that failed with none says the same sentence', () => {
    expect(exportDecision(hideNotApplied())).toContain(I18N.en.feedNoteNotApplied);
    const fold = exportDecision(foldNotApplied());
    expect(fold).toContain(I18N.en.feedNoteNotApplied);
    expect(fold.split(I18N.en.feedNoteNotApplied)).toHaveLength(2);
  });

  it('says nothing of the kind for a record that landed', () => {
    const landed = base(decisionForJudge({ mode: 'adult', judge: judge(8), provider: 'p', applied: 'hide', mask: false, rewrite: { attempted: false, outcome: 'off' } }), 'hide');
    expect(exportDecision(landed)).not.toContain(I18N.en.feedNoteNotApplied);
  });
});
