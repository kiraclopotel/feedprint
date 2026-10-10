// @vitest-environment jsdom
// The why and reader lines on a record's card, in the dashboard and in the
// export (docs/design/DECISION-BLOCK-2026-09-07.md section 4). The words are
// the policy row's own, the same table the on-page notice used, so the reader
// sees on the page what the parent sees in the record. A record without a
// decision block shows no why line: absent states nothing.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { DecisionNote } from '../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../src/i18n/react';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { DecisionBlock, ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { NOTE_AD_HIDDEN, NOTE_NOT_APPLIED, NOTE_SETTING_OFF, NOTE_LEGACY_ACTED, NOTE_VIDEO_SKIPPED, NOTE_VIDEO_MARKED, NOTE_VIDEO_FOLDED, NOTE_LATE_VERDICT, NOTE_PAIR_VETOED } from '../../../src/content/record/decision';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`,
    timestamp: '2026-09-07T01:00:00Z',
    platform: 'facebook',
    originalText: 'a post that quoted the blocked name',
    originalHash: 'h',
    originalLength: 36,
    neutralizedText: '',
    author: '@user',
    postUrl: 'https://facebook.com/p/1',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'rules',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind: 'post',
    verdict: 'flagged-hidden',
    ...overrides,
  } as ForensicRecord;
}

const blocklistHide: DecisionBlock = {
  judge: null, reading: null, descriptor: null,
  rails: [{ name: 'blocklist', match: 'elon' }],
  household: { mode: 'adult', reader: 'default', topicRule: null, mask: false },
  row: 'R1', action: 'hide', applied: 'hide', rewrite: null, note: null,
};
const missedHide: DecisionBlock = { ...blocklistHide, rails: [{ name: 'coded-harm', match: '' }], row: 'R3', applied: 'mark', note: 'n' };

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function renderDashboard(r: ForensicRecord, lang: 'en' | 'ro' | 'es' | 'pt-BR' = 'en'): string {
  return renderToString(createElement(I18nProvider, { lang, children: createElement(DecisionNote, { record: r }) }))
    .replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

function renderFeed(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  expect(m).not.toBeNull();
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).innerHTML;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('the dashboard card', () => {
  it('says why in the row\'s words, quotes the household word, names the action, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const html = renderDashboard(rec({ decision: blocklistHide, reader: 'default' }), lang);
      expect(html, lang).toContain(MARKER_STRINGS[lang].whyByRow.R1);
      expect(html, lang).toContain('elon');
      expect(html, lang).toContain(DASHBOARD_STRINGS[lang].feedDecisionAction.hide);
      expect(html, lang).toContain(DASHBOARD_STRINGS[lang].feedReader);
    }
  });

  it('says what the page showed when it differs from what the table chose', () => {
    const html = renderDashboard(rec({ decision: missedHide }));
    expect(html).toContain(DASHBOARD_STRINGS.en.feedDecisionAction.hide);
    expect(html).toContain(DASHBOARD_STRINGS.en.feedDecisionShownAs);
    expect(html).toContain(DASHBOARD_STRINGS.en.feedDecisionAction.mark);
  });

  it('shows nothing for a record without a block or a reader', () => {
    expect(renderDashboard(rec())).toBe('');
  });
});

describe('the export card', () => {
  it('carries the same why and reader lines from the digested string table', () => {
    const html = renderFeed([rec({ decision: blocklistHide, reader: 'default' })]);
    expect(html).toContain('fw-decision');
    expect(html).toContain(MARKER_STRINGS.en.whyByRow.R1);
    expect(html).toContain('("elon")');
    expect(html).toContain(DASHBOARD_STRINGS.en.feedDecisionAction.hide);
    // CHANGED 2026-09-20, M360: this read 'Reader: default'. 'default' is the
    // record's value when nobody was declared (READER_DEFAULT in
    // src/content/record/decision.ts), an internal word that reads on a card as
    // the name of a person, and the export now prints the string table's
    // 'nobody declared' for it. The word is read from the table rather than
    // written here, because this file's subject is that both surfaces take
    // their words from the digested tables and not from their own code.
    expect(html).toContain(`${I18N.en.feedReader}: ${I18N.en.feedReaderDefault}`);
    expect(html).not.toContain('Reader: default');
  });

  it('writes no why line for a record without a block', () => {
    expect(renderFeed([rec()])).not.toContain('fw-decision');
  });

  // The swearing mask is the one action that stacks: the table allows the item
  // and the household's own filter stars the words, so action is allow and
  // applied is mask with nothing overridden. Rendered as a difference that came
  // out "shown, shown as shown with swearing starred", the same word twice, and
  // it read as a decision that had been reversed. One outcome, one phrase
  // (2026-09-18). D1 moved with it: its cells are allow in every mode, so this
  // is the only card it can ever reach, and "nothing found" beside a thing that
  // was done left the reader to bridge the two.
  it('a mask stacked on allow is one phrase, not a decision that was overridden', () => {
    const masked: DecisionBlock = {
      ...blocklistHide, rails: [], row: 'D1', action: 'allow', applied: 'mask',
      household: { mode: 'teen', reader: 'default', topicRule: null, mask: true },
    };
    const html = renderFeed([rec({ decision: masked, reader: 'default' })]);
    expect(html).toContain(MARKER_STRINGS.en.whyByRow.D1);
    expect(html).toContain(DASHBOARD_STRINGS.en.feedDecisionAction.mask);
    expect(html).not.toContain(DASHBOARD_STRINGS.en.feedDecisionShownAs);
    // The bare allow word must not be there either: it is what made the stutter.
    expect(html).not.toContain('&#183; ' + DASHBOARD_STRINGS.en.feedDecisionAction.allow);
  });

  // The control: a real override still says so, so the branch above cannot be
  // passing by swallowing every "shown as".
  it('an action the page could not apply still says what was shown instead', () => {
    const html = renderFeed([rec({ decision: missedHide, reader: 'default' })]);
    expect(html).toContain(DASHBOARD_STRINGS.en.feedDecisionShownAs);
    expect(html).toContain(DASHBOARD_STRINGS.en.feedDecisionAction.mark);
  });

  it('the export string table carries every row and action word in every locale', () => {
    for (const lang of UI_LANGUAGES) {
      for (const [row, text] of Object.entries(MARKER_STRINGS[lang].whyByRow)) {
        expect((I18N[lang] as unknown as Record<string, string>)[`why_${row}`], `${lang} ${row}`).toBe(text);
      }
      for (const [act, text] of Object.entries(DASHBOARD_STRINGS[lang].feedDecisionAction)) {
        expect((I18N[lang] as unknown as Record<string, string>)[`act_${act}`], `${lang} ${act}`).toBe(text);
      }
    }
  });
});

// 2026-09-20: the export card's decision line now appends the record's own note
// (src/content/record/decision.ts) when the page showed something other than what
// the row asked for. Found by reading the feed script's own NOTE map against the
// three exported constants: the map is keyed on the constants' text, copied by
// hand into the script string, and nothing forces the two to move together.
describe('the export card shows the record’s own note', () => {
  it('the note map inside the feed script is keyed on the seven signed sentences, character for character', () => {
    const m = FEED_SCRIPT.match(/var NOTE=\{([\s\S]*?)\};/);
    expect(m).not.toBeNull();
    const pairs = [...m![1].matchAll(/'((?:[^'\\]|\\.)*)':'((?:[^'\\]|\\.)*)'/g)];
    const map: Record<string, string> = {};
    for (const [, key, val] of pairs) map[key] = val;
    // The one that matters: if a sentence's wording ever changes in decision.ts
    // without this map changing too, the key here goes stale and the card falls
    // back to printing the raw English sentence instead of the reader's language.
    expect(map[NOTE_NOT_APPLIED]).toBe('feedNoteNotApplied');
    expect(map[NOTE_SETTING_OFF]).toBe('feedNoteSettingOff');
    expect(map[NOTE_LEGACY_ACTED]).toBe('feedNoteLegacyActed');
    expect(map[NOTE_VIDEO_SKIPPED]).toBe('feedNoteVideoSkipped');
    expect(map[NOTE_VIDEO_MARKED]).toBe('feedNoteVideoMarked');
    expect(map[NOTE_VIDEO_FOLDED]).toBe('feedNoteVideoFolded');
    expect(map[NOTE_LATE_VERDICT]).toBe('feedNoteLateVerdict');
    expect(map[NOTE_PAIR_VETOED]).toBe('feedNotePairVetoed');
    expect(map[NOTE_AD_HIDDEN]).toBe('feedNoteAdHidden');
    expect(Object.keys(map).sort()).toEqual(
      [NOTE_AD_HIDDEN, NOTE_NOT_APPLIED, NOTE_SETTING_OFF, NOTE_LEGACY_ACTED, NOTE_VIDEO_SKIPPED, NOTE_VIDEO_MARKED, NOTE_VIDEO_FOLDED, NOTE_LATE_VERDICT, NOTE_PAIR_VETOED].sort(),
    );
  });

  it('every locale carries a non-empty translation of all six notes', () => {
    for (const lang of UI_LANGUAGES) {
      expect(I18N[lang].feedNoteNotApplied.length, `${lang} feedNoteNotApplied`).toBeGreaterThan(0);
      expect(I18N[lang].feedNoteSettingOff.length, `${lang} feedNoteSettingOff`).toBeGreaterThan(0);
      expect(I18N[lang].feedNoteLegacyActed.length, `${lang} feedNoteLegacyActed`).toBeGreaterThan(0);
      expect(I18N[lang].feedNoteVideoSkipped.length, `${lang} feedNoteVideoSkipped`).toBeGreaterThan(0);
      expect(I18N[lang].feedNoteVideoMarked.length, `${lang} feedNoteVideoMarked`).toBeGreaterThan(0);
      expect(I18N[lang].feedNoteVideoFolded.length, `${lang} feedNoteVideoFolded`).toBeGreaterThan(0);
      expect(I18N[lang].feedNotePairVetoed.length, `${lang} feedNotePairVetoed`).toBeGreaterThan(0);
      expect(I18N[lang].feedNoteAdHidden.length, `${lang} feedNoteAdHidden`).toBeGreaterThan(0);
    }
  });

  it('a setting-off note renders on the decision line, in English on the English export', () => {
    const settingOff: DecisionBlock = {
      ...blocklistHide, rails: [], row: 'D1', action: 'hide', applied: 'allow', note: NOTE_SETTING_OFF,
    };
    const html = renderFeed([rec({ decision: settingOff, reader: 'default' })]);
    expect(html).toContain(I18N.en.feedNoteSettingOff);
  });

  it('a record with no note renders none of the three note sentences', () => {
    const html = renderFeed([rec({ decision: blocklistHide, reader: 'default' })]);
    expect(html).not.toContain(I18N.en.feedNoteNotApplied);
    expect(html).not.toContain(I18N.en.feedNoteSettingOff);
    expect(html).not.toContain(I18N.en.feedNoteLegacyActed);
  });

  it('a note the page does not recognize is shown exactly as written', () => {
    const strangeNote = 'a note no map here has ever named';
    const stranger: DecisionBlock = { ...missedHide, note: strangeNote };
    const html = renderFeed([rec({ decision: stranger, reader: 'default' })]);
    expect(html).toContain(strangeNote);
  });
});
