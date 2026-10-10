/** @vitest-environment jsdom */
// A hidden YouTube ad is most of a YouTube record, so a store user meets its row on the first day. Read on a fresh
// profile (9 ads hidden, 3 videos), every ad row printed the marker the record stores when an ad has no caption,
// "[blocked: ads]", as the post's text, in the dashboard and in the file a parent hands to others. These records are
// built as the product writes them: the ad hider's own decision block (decisionForBlock) and the logger's placeholder
// and mode, "block:<reason>:<token>", for every reason the product sends.

import { afterEach, describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { buildSearchIndex, foldSearchText } from '../../../../../src/ui/dashboard/components/activity-filters';
import { I18nProvider } from '../../../../../src/i18n/react';
import { decisionForBlock } from '../../../../../src/content/record/decision';
import { isHiddenAd } from '../../../../../src/ui/dashboard/record-sets';
import { shownText } from '../../../../../src/ui/dashboard/shown-text';
import { standInKey } from '../../../../../src/forensics/stand-in';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../../../src/forensics/html-export';
import { VERIFIER_SCRIPT_TEMPLATE } from '../../../../../src/forensics/html-export-scripts';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../../../src/forensics/export-numbers-inline';
import { buildEvidenceReportHTML, exportCSV } from '../../../../../src/forensics/exporter';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { repoPath } from '../../../../helpers/repo-root';
import type { DecisionAction, ForensicRecord } from '../../../../../src/types/forensic';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;
type Lang = typeof LANGS[number];

let seq = 0;
function blocked(reason: string, token: string, caption = '', applied: DecisionAction = 'hide', verdict = 'blocked'): ForensicRecord {
  seq++;
  const text = caption || `[blocked: ${reason}]`;
  return {
    id: `fr-blk-${seq}`,
    timestamp: new Date(Date.parse('2026-10-09T08:00:00Z') + seq * 60_000).toISOString(),
    platform: 'youtube',
    originalText: text,
    originalHash: `h-${seq}`,
    originalLength: text.length,
    neutralizedText: '',
    author: '',
    postUrl: 'https://www.youtube.com/watch?v=abc',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'rules',
    feedSource: 'unknown',
    verdict,
    kind: 'post',
    detectionMode: `block:${reason}:${token}`,
    decision: decisionForBlock({ mode: 'adult', blockReason: reason, matchedToken: token, applied, mask: false }),
    integrityHash: `ih-${seq}`,
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
  } as unknown as ForensicRecord;
}

const playerAd = (): ForensicRecord => blocked('ads', 'player-ad');
const slotAd = (): ForensicRecord => blocked('ads', 'ad-slot', 'Learn guitar chords in a week');
// The person turned Block ads off: the ad stays on the page, and its own verdict says so.
const keptAd = (): ForensicRecord => blocked('ads', 'ad-slot', 'A paid post left on the page', 'allow', 'pass');

function card(record: ForensicRecord, lang: Lang): string {
  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record }) }),
  );
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe.each(LANGS)('%s: the dashboard card of a hidden ad', (lang) => {
  it('says it is an ad that was hidden, never the marker, and gives the hiding as its reason', () => {
    const text = card(playerAd(), lang);
    expect(text).toContain(I18N[lang].feedAdHidden);
    expect(text).not.toContain('[blocked');
    expect(text).not.toContain(I18N[lang].feedNoteLegacyActed);
    expect(text).toContain(DASHBOARD_STRINGS[lang].feedDecisionAction.hide);
    expect(text).not.toContain(DASHBOARD_STRINGS[lang].feedDecisionAction.collapse);
  });

  it('keeps an ad caption when the record has one, under the same words', () => {
    const text = card(slotAd(), lang);
    expect(text).toContain(I18N[lang].feedAdHidden);
    expect(text).toContain('Learn guitar chords in a week');
  });
});

// Point 1: the HTML export and the printed report say the same as the dashboard.
const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

function exportFeed(records: ForensicRecord[], lang: Lang): string {
  const html = buildForensicHtmlExport(records, { ...META, locale: lang });
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).textContent ?? '';
}

describe.each(LANGS)('%s: the exported file of a hidden ad', (lang) => {
  it('the feed card says an ad was hidden and keeps a caption, never the marker', () => {
    const text = exportFeed([playerAd(), slotAd()], lang);
    expect(text).toContain(I18N[lang].feedAdHidden);
    expect(text).toContain('Learn guitar chords in a week');
    expect(text).not.toContain('[blocked');
  });

  it('the reason gives the hiding, without the older-path sentence or a "shown as" difference', () => {
    const text = exportFeed([playerAd()], lang);
    expect(text).toContain(I18N[lang].act_hide);
    expect(text).not.toContain(I18N[lang].feedNoteLegacyActed);
    expect(text).not.toContain(I18N[lang].feedDecisionShownAs);
  });

  it('the printed report says the same', async () => {
    const html = await buildEvidenceReportHTML([playerAd(), slotAd()], lang);
    expect(html).toContain(I18N[lang].feedAdHidden);
    expect(html).not.toContain('[blocked');
  });

  it('the printed report says it once for an ad with no caption, with no "shown as" row repeating it', async () => {
    const html = await buildEvidenceReportHTML([playerAd()], lang);
    expect(html.split(I18N[lang].feedAdHidden).length - 1).toBe(1);
    const shownAs = I18N[lang].feedDecisionShownAs;
    expect(html).not.toContain(`${shownAs.charAt(0).toUpperCase()}${shownAs.slice(1)}:`);
  });
});

describe('the file restates the rule, and restates it the same', () => {
  it('the file helper and stand-in.ts give the same answer for every reason the product sends', () => {
    const fwn = new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};return FWN;`)() as { standInKey(r: ForensicRecord): string | null };
    const all = [playerAd(), slotAd(), keptAd(), blocked('hashtag', '#giveaway'), blocked('ai-label:en', 'made with ai'),
      blocked('reel-surface', 'shorts'), blocked('media-timeout', 'parent-toggle')];
    for (const r of all) expect(fwn.standInKey(r)).toBe(standInKey(r));
  });

  it('the checker card in the file asks the same helper before it quotes a record', () => {
    expect(VERIFIER_SCRIPT_TEMPLATE).toContain('FWN.standInKey(r)');
  });
});

// Point 2: the Feed behavior lists show the words, not a blank.
describe('the Feed behavior lists', () => {
  it('read a hidden ad as an ad in every language', () => {
    for (const lang of LANGS) expect(shownText(playerAd(), lang)).toBe(I18N[lang].feedAdHidden);
  });

  it('print what an item reads as in all three lists', () => {
    const src = readFileSync(repoPath('src/ui/dashboard/components/PatternsTab.tsx'), 'utf8');
    expect(src.split('{shownText(r, lang).slice(0, 140)}').length - 1).toBe(3);
    expect(src).not.toContain('(r.originalText || \'\').slice(0, 140)');
  });
});

// Point 3: "your rule" only for a rule the person wrote.
describe('the words for a hidden item with no caption', () => {
  it('name the person\'s rule only for a hashtag they blocked', () => {
    expect(standInKey(blocked('hashtag', '#giveaway'))).toBe('feedHiddenOwnRuleNoCaption');
  });

  it('are neutral for a switch: AI content, reels, a break', () => {
    for (const r of [blocked('ai-label:en', 'made with ai'), blocked('reel-surface', 'shorts'), blocked('media-timeout', 'parent-toggle')]) {
      expect(standInKey(r)).toBe('feedHiddenNoCaption');
    }
  });

  it('the neutral words name no rule in any language', () => {
    for (const lang of LANGS) {
      expect(I18N[lang].feedHiddenNoCaption).not.toBe(I18N[lang].feedHiddenOwnRuleNoCaption);
    }
    expect(I18N.en.feedHiddenNoCaption).not.toMatch(/rule/i);
  });
});

// Point 4: an ad left on the page is not called hidden, and a search finds hidden ads by what they read as.
describe('an ad left on the page, and the search', () => {
  it('a paid placement kept visible is not titled as a hidden ad', () => {
    const r = keptAd();
    expect(isHiddenAd(r)).toBe(false);
    for (const lang of LANGS) expect(card(r, lang)).not.toContain(I18N[lang].feedAdHidden);
  });

  it('a search finds a hidden ad by its words in every language, and never by the marker', () => {
    const r = playerAd();
    const hay = buildSearchIndex([r]).get(r.id) ?? '';
    for (const lang of LANGS) expect(hay).toContain(foldSearchText(I18N[lang].feedAdHidden));
    expect(hay).not.toContain('[blocked');
  });
});

// The CSV keeps the stored text, which the record's hash covers, and says beside it what a caption-less hidden item was.
async function csvOf(records: ForensicRecord[]): Promise<string[][]> {
  let captured: Blob | null = null;
  if (typeof URL.createObjectURL !== 'function') (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => 'blob:stub';
  if (typeof URL.revokeObjectURL !== 'function') (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => undefined;
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { captured = blob as Blob; return 'blob:ad'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  exportCSV(records);
  const text = await captured!.text();
  return text.trim().split('\n').map(cellsOf);
}

function cellsOf(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { cells.push(cell); cell = ''; } else cell += c;
  }
  cells.push(cell);
  return cells;
}

describe('the CSV', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('keeps the stored marker in original_text and says what the item was in text_shown_as, beside it', async () => {
    const [header, ad, captioned, hashtag] = await csvOf([playerAd(), slotAd(), blocked('hashtag', '#giveaway')]);
    const raw = header.indexOf('original_text');
    const shown = header.indexOf('text_shown_as');
    expect(shown).toBe(raw + 1);
    expect(ad[raw]).toBe('[blocked: ads]');
    expect(ad[shown]).toBe(I18N.en.feedAdHidden);
    expect(captioned[shown]).toBe('');
    expect(hashtag[shown]).toBe(I18N.en.feedHiddenOwnRuleNoCaption);
    for (const row of [ad, captioned, hashtag]) expect(row.length).toBe(header.length);
  });
});
