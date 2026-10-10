/** @vitest-environment jsdom */
// The forensic export's reading mode (futurestate.md section 3b, item 2,
// part 2). Two things are locked here.
//
// 1. EXPORT_NUMBERS_INLINE_SOURCE is export-numbers.ts restated as plain
//    script for the recipient's browser, the way WILSON_INLINE_SOURCE
//    restates wilson.ts. Both run over the same fixtures below and must
//    return identical answers for every exported function, or the numbers a
//    reader sees in the page drift from the numbers the tests measure.
// 2. The page itself: the platform rows render with the engine's numbers over
//    the whole file; a mark filters the rows and the list; a user rule shows
//    as "your rule: <name>" with no severity; interpretation sits behind a
//    closed details; the blur toggle exists and is visual only.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport, FEED_SCRIPT, READING_SCRIPT, I18N, type ExportMetadata,
  EXPOSURE_SCRIPT,
} from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import * as engine from '../../../src/forensics/export-numbers';
import type { ForensicRecord } from '../../../src/types/forensic';

let n = 0;
function rec(over: Partial<ForensicRecord> = {}): ForensicRecord {
  n++;
  return {
    id: `fr-${n}`,
    timestamp: `2026-09-10T10:${String(n % 60).padStart(2, '0')}:00.000Z`,
    platform: 'twitter',
    originalText: `text ${n}`,
    originalHash: `hash-${n}`,
    originalLength: 6,
    neutralizedText: '',
    author: '@person',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: `ih-${n}`,
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: n,
    verdict: 'pass',
    kind: 'post',
    ...over,
  } as ForensicRecord;
}

const judgeFlag = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'flagged', aiSource: 'cloud', detectionMode: 'combined-detect-neutralize',
  techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }], overallScore: 7, ...over,
});

/** The rule wearing a judge's number: severity 10, verdict blocked, aiSource rules. */
const aiBlock = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:ai-label:en',
  techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }], overallScore: 10,
  feedSource: 'video', ...over,
});

const sponsoredTeen = (over: Partial<ForensicRecord> = {}) => rec({
  verdict: 'flagged', aiSource: 'rules', detectionMode: 'sponsored-ad',
  techniques: [{ name: 'consumer-rapid-frame', severity: 6, confidence: 0.99 }], overallScore: 6, ...over,
});

/** Same shape as tests/unit/forensics/export-numbers.test.ts, with a second sitting on the end. */
function fixture(): ForensicRecord[] {
  n = 0;
  return [
    rec({ platform: 'twitter', originalHash: 'dup' }),
    rec({ platform: 'twitter', originalHash: 'dup' }),
    rec({ platform: 'twitter', originalHash: 'dup' }),
    sponsoredTeen({ platform: 'twitter' }),
    aiBlock({ platform: 'twitter' }),
    judgeFlag({ platform: 'twitter' }),
    rec({ platform: 'facebook', kind: 'comment', feedSource: 'profile' }),
    rec({ platform: 'facebook', verdict: 'blocked', aiSource: 'rules',
      detectionMode: 'block:ads:platform-ad-marker', accountType: 'advertiser',
      techniques: [{ name: 'ai-content-block', severity: 10, confidence: 1 }] }),
    rec({ platform: 'youtube', kind: 'video', originalHash: 'dup', feedSource: 'search' }),
    rec({ platform: 'tiktok', kind: 'reset-marker', verdict: undefined }),
    rec({ platform: 'tiktok', kind: 'gap-marker', verdict: undefined }),
    rec({ platform: 'tiktok', kind: 'environment' }),
    rec({ platform: 'tiktok', kind: 'image' }),
    rec({ platform: 'instagram', verdict: 'flagged', aiSource: 'rules',
      detectionMode: 'blocklist:word:elon', feedSource: 'permalink' }),
    // a second sitting, three hours on
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:30:00.000Z', originalHash: 'dup',
      detectionMode: 'late-after-rotation:combined-detect-neutralize' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:31:00.000Z', feedSource: 'manual', id: 'fr-manual-1' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:32:00.000Z', overrideOrigin: 'profanity-tier',
      decision: { row: 'x', action: 'soften', rails: [{ name: 'blocklist', match: 'word' }] } as unknown as ForensicRecord['decision'] }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:33:00.000Z',
      decision: { row: 'x', action: 'hide', rails: [{ name: 'sponsored', match: 'Ad' }] } as unknown as ForensicRecord['decision'] }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:34:00.000Z', originalText: '[blocked: ai-label]', originalHash: 'ph',
      verdict: 'blocked', aiSource: 'rules', detectionMode: 'block:hashtag:#ai' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:35:00.000Z', originalText: '[blocked: ai-label]', originalHash: 'ph',
      verdict: 'blocked', aiSource: 'none', detectionMode: 'block:reel-surface:x' }),
    rec({ platform: 'twitter', timestamp: 'not a date', kind: undefined, verdict: undefined, aiSource: 'local' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:36:00.000Z', decision: { row: 'x', action: 'hide', rails: [{ name: 'identity-slur' }] } as unknown as ForensicRecord['decision'] }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:37:00.000Z', decision: { row: 'x', action: 'hide', rails: [{ name: 'coded-harm' }] } as unknown as ForensicRecord['decision'] }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:38:00.000Z', verdict: 'blocked', detectionMode: 'block:media-timeout:x' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:39:00.000Z', verdict: 'blocked', detectionMode: 'block:odd:x' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:40:00.000Z', verdict: 'blocked', detectionMode: 'block' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:41:00.000Z', detectionMode: 'blocklist:account:@x' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:42:00.000Z', detectionMode: 'blocklist:hashtag:#x' }),
    rec({ platform: 'twitter', timestamp: '2026-09-10T13:43:00.000Z', detectionMode: 'sponsored-ad:adult', verdict: 'flagged-hidden' }),
  ];
}

type Inline = typeof engine;
function loadInline(): Inline {
  return new Function(`${EXPORT_NUMBERS_INLINE_SOURCE}; return FWN;`)() as Inline;
}

describe('EXPORT_NUMBERS_INLINE_SOURCE drift', () => {
  const inline = loadInline();
  const records = fixture();

  it('classifies every record the same way as the module', () => {
    for (const r of records) {
      expect(inline.ruleLabel(r), r.id).toBe(engine.ruleLabel(r));
      expect(inline.isUserRule(inline.ruleLabel(r)), r.id).toBe(engine.isUserRule(engine.ruleLabel(r)));
      expect(inline.isImpression(r), r.id).toBe(engine.isImpression(r));
      expect(inline.contentIdentity(r), r.id).toBe(engine.contentIdentity(r));
      expect(inline.isPaidPlacement(r), r.id).toBe(engine.isPaidPlacement(r));
      expect(inline.isUserHidden(r), r.id).toBe(engine.isUserHidden(r));
      expect(inline.isModelNamed(r), r.id).toBe(engine.isModelNamed(r));
      expect(inline.surfaceBucket(r), r.id).toBe(engine.surfaceBucket(r));
    }
    expect(inline.PLATFORM_ORDER).toEqual(engine.PLATFORM_ORDER);
    expect(inline.SITTING_GAP_MS).toBe(engine.SITTING_GAP_MS);
  });

  it('sittings and seen-before agree', () => {
    expect(inline.sittingByRecordId(records)).toEqual(engine.sittingByRecordId(records));
    expect(inline.seenBeforeIds(records)).toEqual(engine.seenBeforeIds(records));
  });

  it('rows and filters agree over a grid of filter states', () => {
    const filters: engine.FilterState[] = [
      {},
      { platforms: ['twitter'] },
      { platforms: ['facebook', 'youtube'] },
      { surfaces: ['for-you'] },
      { surfaces: ['other'] },
      { sittings: [1] },
      { sittings: [2] },
      { seenBefore: true },
      { seenBefore: false },
      { platforms: ['twitter'], surfaces: ['for-you'], sittings: [2], seenBefore: false },
      { platforms: [], surfaces: [], sittings: [] },
    ];
    expect(inline.computePlatformRows(records)).toEqual(engine.computePlatformRows(records));
    for (const f of filters) {
      expect(inline.applyFilters(records, f), JSON.stringify(f)).toEqual(engine.applyFilters(records, f));
      expect(inline.computePlatformRows(records, f), JSON.stringify(f)).toEqual(engine.computePlatformRows(records, f));
    }
  });
});

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

/** Build the page, mount its static markup and run the engine, feed and reading scripts as the browser would. */
function mount(records: ForensicRecord[]): { html: string } {
  const html = buildForensicHtmlExport(records, META);
  const payload = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1];
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(payload);
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="application/json"'));
  document.body.innerHTML = body;
  (window as unknown as { FWN?: unknown }).FWN = loadInline();
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  new Function(READING_SCRIPT)();
  return { html };
}

function rowNumbers(platform: string): number[] {
  const tr = document.querySelector(`#fw-reading-numbers tr[data-platform="${platform}"]`);
  expect(tr, platform).not.toBeNull();
  return Array.from(tr!.querySelectorAll('td')).map(td => Number(td.textContent!.replace(/[^0-9]/g, '')));
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  delete (window as unknown as { __FW_FEED__?: unknown }).__FW_FEED__;
});

// PLAN-2026-09-14 item 7: the numbers are filters and the level is a filter.
// Proof line: click "high" and the list narrows; click a platform and the
// numbers change.
describe('the reading mode: numbers and level narrow the list', () => {
  const cards = () => document.querySelectorAll('#fw-feed article.fw-item').length;
  const matching = () => document.querySelector('.fw-matching')!.textContent!;

  it('the engine keeps only judged items at a level, never an ad or a rule', () => {
    const records = fixture();
    const high = engine.applyFilters(records, { level: 'high' });
    expect(high.map(r => r.id)).toEqual(records.filter(r => engine.severityLevel(r) === 'high').map(r => r.id));
    expect(high.length).toBeGreaterThan(0);
    for (const r of high) expect(engine.isModelNamed(r)).toBe(true);
    expect(engine.severityLevel(sponsoredTeen())).toBeNull();
    expect(engine.severityLevel(aiBlock())).toBeNull();
    const inline = loadInline();
    for (const f of [{ level: 'high' as const }, { level: 'low' as const }, { column: 'paidPlacements' as const },
      { column: 'extraCopies' as const }, { column: 'uniquePosts' as const }, { column: 'userHidden' as const },
      { column: 'modelNamed' as const, platforms: ['twitter' as const] }]) {
      expect(inline.applyFilters(records, f).map(r => r.id), JSON.stringify(f)).toEqual(engine.applyFilters(records, f).map(r => r.id));
      expect(inline.computePlatformRows(records, f), JSON.stringify(f)).toEqual(engine.computePlatformRows(records, f));
    }
  });

  it('a column filter keeps exactly what that column counts', () => {
    const records = fixture();
    for (const col of ['uniquePosts', 'extraCopies', 'paidPlacements', 'userHidden', 'modelNamed'] as const) {
      const total = engine.computePlatformRows(records)[5][col];
      const kept = engine.applyFilters(records, { column: col }).filter(engine.isImpression);
      expect(kept.length, col).toBe(total);
    }
  });

  it('the level select narrows the list and the numbers, and "any" brings them back', () => {
    const records = fixture();
    mount(records);
    const before = cards();
    const level = document.getElementById('fw-filter-level') as HTMLSelectElement;
    level.value = 'high';
    level.dispatchEvent(new Event('change'));
    const expected = engine.applyFilters(records, { level: 'high' });
    expect(cards()).toBeLessThan(before);
    expect(matching()).toContain(String(expected.length));
    expect(rowNumbers('total')[0]).toBe(engine.computePlatformRows(records, { level: 'high' })[5].impressions);
    level.value = '';
    level.dispatchEvent(new Event('change'));
    expect(cards()).toBe(before);
  });

  it('pressing "high" in the summary sets the level, and pressing it again lifts it', () => {
    const records = fixture();
    mount(records);
    const root = document.createElement('div');
    root.id = 'fw-exposure';
    document.body.appendChild(root);
    new Function(EXPOSURE_SCRIPT)();
    const before = cards();
    const high = document.querySelector('#fw-exposure [data-level="high"]') as HTMLElement;
    expect(high).not.toBeNull();
    // The bar shows the number the click will list.
    const shown = Number(high.querySelector('.fw-exp-barnum')!.textContent!.split(' ')[0]);
    expect(shown).toBe(engine.applyFilters(records, { level: 'high' }).filter(engine.isImpression).length);
    high.click();
    expect((document.getElementById('fw-filter-level') as HTMLSelectElement).value).toBe('high');
    expect(cards()).toBeLessThan(before);
    high.click();
    expect(cards()).toBe(before);
  });

  it('a number narrows the list to what it counts on its row, and pressing it again lifts it', () => {
    const records = fixture();
    mount(records);
    const before = cards();
    const btn = () => document.querySelector('#fw-reading-numbers tr[data-platform="twitter"] button[data-col="extraCopies"]') as HTMLButtonElement;
    btn().click();
    expect(btn().getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.fw-mark[data-platform="twitter"]')!.getAttribute('aria-pressed')).toBe('true');
    const expected = engine.applyFilters(records, { platforms: ['twitter'], column: 'extraCopies' });
    expect(matching()).toContain(String(expected.length));
    expect(rowNumbers('total')[2]).toBe(rowNumbers('total')[0]);
    btn().click();
    expect(btn().getAttribute('aria-pressed')).toBe('false');
    (document.querySelector('.fw-mark[data-platform="all"]') as HTMLButtonElement).click();
    expect(cards()).toBe(before);
  });
});

describe('the reading mode', () => {
  it('renders the platform rows with the engine\'s numbers over the whole file', () => {
    const records = fixture();
    mount(records);
    const rows = engine.computePlatformRows(records);
    const x = rows[0];
    expect(rowNumbers('twitter')).toEqual([x.impressions, x.uniquePosts, x.extraCopies, x.paidPlacements, x.userHidden, x.modelNamed]);
    const total = rows[5];
    expect(rowNumbers('total')).toEqual([total.impressions, total.uniquePosts, total.extraCopies, total.paidPlacements, total.userHidden, total.modelNamed]);
    // The column headed "seen before" carries the extra-copies count, in words.
    const heads = Array.from(document.querySelectorAll('#fw-reading-numbers thead th')).map(th => th.textContent);
    expect(heads).toContain(I18N.en.rdColSeenBefore);
    expect(document.querySelector('.fw-numbers-note')!.textContent).toContain(String(records.length));
  });

  it('the marks switch the numbers and the list to one platform, and "all" comes back', () => {
    const records = fixture();
    mount(records);
    const allBefore = document.querySelectorAll('#fw-feed article.fw-item').length;
    const fb = document.querySelector('.fw-mark[data-platform="facebook"]') as HTMLButtonElement;
    fb.click();
    expect(fb.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.fw-mark[data-platform="all"]')!.getAttribute('aria-pressed')).toBe('false');
    const fbRow = engine.computePlatformRows(records, { platforms: ['facebook'] })[1];
    expect(rowNumbers('facebook')).toEqual([fbRow.impressions, fbRow.uniquePosts, fbRow.extraCopies, fbRow.paidPlacements, fbRow.userHidden, fbRow.modelNamed]);
    expect(rowNumbers('total')[0]).toBe(fbRow.impressions);
    // the list re-rendered to Facebook's two records
    const cards = Array.from(document.querySelectorAll('#fw-feed article.fw-item'));
    expect(cards.length).toBe(2);
    expect(cards.length).toBeLessThan(allBefore);
    // CHANGED 2026-09-20, M360: this read 'facebook', the record's own key, on
    // cards sitting under a numbers table whose rows have said Facebook, X and
    // YouTube since that table was written. What the case protects is that the
    // marks re-rendered the list to this platform's two records, and the name
    // is what a reader of those cards sees.
    for (const c of cards) expect(c.textContent).toContain('Facebook');
    (document.querySelector('.fw-mark[data-platform="all"]') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#fw-feed article.fw-item').length).toBe(allBefore);
  });

  it('surface, sitting and seen-before selects filter the list and the numbers', () => {
    const records = fixture();
    mount(records);
    const surface = document.getElementById('fw-filter-surface') as HTMLSelectElement;
    surface.value = 'search';
    surface.dispatchEvent(new Event('change'));
    // The one impression on the search surface stays; the For You cards go.
    // The image analysis record (13) is not an impression and passes every
    // filter but platform, as the engine documents, so it stays too.
    const searchCards = Array.from(document.querySelectorAll('#fw-feed article.fw-item')).map(c => c.textContent!);
    expect(searchCards.some(t => t.includes('text 9'))).toBe(true);
    expect(searchCards.some(t => t.includes('text 6'))).toBe(false);
    expect(searchCards.some(t => /text 1(?!\d)/.test(t))).toBe(false);
    expect(rowNumbers('youtube')[0]).toBe(1);
    surface.value = '';
    surface.dispatchEvent(new Event('change'));
    const sitting = document.getElementById('fw-filter-sitting') as HTMLSelectElement;
    expect(sitting.options.length).toBe(3); // any, sitting 1, sitting 2
    sitting.value = '2';
    sitting.dispatchEvent(new Event('change'));
    const s2 = engine.applyFilters(records, { sittings: [2] }).filter(r => engine.isImpression(r)).length;
    expect(rowNumbers('total')[0]).toBe(s2);
    sitting.value = '';
    sitting.dispatchEvent(new Event('change'));
    const seen = document.getElementById('fw-filter-seen') as HTMLSelectElement;
    seen.value = 'before';
    seen.dispatchEvent(new Event('change'));
    const before = engine.computePlatformRows(records, { seenBefore: true })[5];
    expect(rowNumbers('total')[0]).toBe(before.impressions);
    expect(document.querySelector('.fw-matching')!.textContent).toContain(String(engine.applyFilters(records, { seenBefore: true }).length));
  });

  it('a user rule shows as "your rule: <name>" with no severity; a judge flag keeps its number', () => {
    const records = fixture();
    mount(records);
    const cards = Array.from(document.querySelectorAll('#fw-feed article.fw-item'));
    const blocked = cards.find(c => c.textContent!.includes('text 5'))!;
    expect(blocked.textContent).toContain(`${I18N.en.feedYourRule}: ${I18N.en.ruleAiContentBlock}`);
    expect(blocked.textContent).not.toMatch(/10\/10/);
    expect(blocked.textContent).not.toContain(I18N.en.feedSeverityWord + ' 10');
    const word = cards.find(c => c.textContent!.includes('text 14'))!;
    expect(word.textContent).toContain(`${I18N.en.feedYourRule}: ${I18N.en.ruleWordFilter}`);
    const judge = cards.find(c => c.textContent!.includes('text 6'))!;
    expect(judge.textContent).toContain(`${I18N.en.feedSeverityWord} 7/10`);
    expect(judge.textContent).not.toContain(I18N.en.feedYourRule);
    // Block Ads is the reader's own switch, so since 2026-09-14 an ad reads as
    // their rule too (rebuild plan, standing decision 1: ads are recorded,
    // hidden by the user's rule and counted as paid placement). No severity
    // number on the card, the same as every other rule.
    const ad = cards.find(c => c.textContent!.includes('text 8'))!;
    expect(ad.textContent).toContain(`${I18N.en.feedYourRule}: ${I18N.en.ruleAdMarker}`);
    expect(ad.textContent).not.toMatch(/\d+\/10/);
  });

  it('interpretation and methodology sit behind closed details; the verifier stays outside them', () => {
    const { html } = mount(fixture());
    const interp = document.querySelector('details.fw-interpretation') as HTMLDetailsElement;
    expect(interp).not.toBeNull();
    expect(interp.open).toBe(false);
    expect(interp.querySelector('#fw-behavior')).not.toBeNull();
    expect(interp.querySelector('summary')!.textContent).toBe(I18N.en.rdInterpSummary);
    expect(html).not.toMatch(/<details class="fw-interpretation" open/);
    expect(html).not.toMatch(/<details class="fw-methodology" open/);
    expect(document.querySelector('details.fw-interpretation #fw-verify-btn')).toBeNull();
    expect(document.querySelector('#fw-verify-btn')).not.toBeNull();
  });

  it('page order: marks and numbers, verifier, list, then the file rows, exposure, interpretation, per-record detail', () => {
    const { html } = mount(fixture());
    const at = (s: string) => { const i = html.indexOf(s); expect(i, s).toBeGreaterThan(-1); return i; };
    const order = [
      'id="fw-reading"', 'id="fw-verify-btn"', 'id="fw-feed"', 'data-fw-prov="precision"',
      'id="fw-exposure"', 'class="fw-interpretation"', 'id="fw-results"',
    ].map(at);
    for (let i = 1; i < order.length; i++) expect(order[i], `${i}`).toBeGreaterThan(order[i - 1]);
  });

  it('the blur toggle exists, is off by default, says it is for a screenshot, and only adds a class', () => {
    const { html } = mount(fixture());
    expect(html).toContain('<input type="checkbox" id="fw-blur-authors">');
    expect(html).toContain(I18N.en.rdBlur);
    expect(I18N.en.rdBlur).toContain('screenshot');
    const box = document.getElementById('fw-blur-authors') as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(document.body.classList.contains('fw-blur-authors')).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    expect(document.body.classList.contains('fw-blur-authors')).toBe(true);
    // visual only: the names are still in the list and in the payload
    expect(document.querySelector('.fw-item-author')!.textContent).toBe('@person');
    expect(html).toContain('"author":"@person"');
    expect(html).toMatch(/\.fw-blur-authors \.fw-item-author[^{]*\{[^}]*filter:blur/);
  });

  it('every locale carries the reading-mode strings, and none uses an em dash', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      const t = I18N[locale];
      for (const k of ['rdHeader', 'rdColSeenBefore', 'rdBlur', 'rdInterpSummary', 'feedYourRule', 'ruleWordFilter'] as const) {
        expect(t[k], `${locale}.${k}`).toBeTruthy();
        expect(t[k], `${locale}.${k}`).not.toContain('—');
      }
    }
  });
});

// Wiring audit 13 Sep, L2: the surface select offers every bucket the engine
// counts, so Following and "not captured" can be picked, not only folded away.
describe('the reading mode: surface choices', () => {
  it('offers Following and not captured, and each narrows to its own records', () => {
    const records = fixture();
    records.push(rec({ platform: 'twitter', feedSource: 'following' }));
    records.push(rec({ platform: 'twitter', feedSource: undefined }));
    mount(records);
    const surface = document.getElementById('fw-filter-surface') as HTMLSelectElement;
    const values = Array.from(surface.options).map(o => o.value);
    expect(values).toContain('following');
    expect(values).toContain('unknown');
    for (const v of ['following', 'unknown'] as const) {
      surface.value = v;
      surface.dispatchEvent(new Event('change'));
      const expected = engine.applyFilters(records, { surfaces: [v] }).filter(engine.isImpression).length;
      expect(expected, v).toBeGreaterThan(0);
      expect(rowNumbers('total')[0], v).toBe(expected);
    }
  });
});
