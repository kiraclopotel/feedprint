// @vitest-environment jsdom
//
// A judged post is judged again when its label changes in place, not only
// when it gains elements (ledger ADS-RESILIENCE-2026-10-08.md, step 6).
// Facebook fills a header word after the post is drawn and moves letter
// pieces in and out of the row by style; neither changes the post's element
// count, which was the only re-judge trigger, so a label drawn late stood.
// The worst case stays a missed ad: a change outside the label's size (a
// progress bar's style, a body sentence) does not re-judge.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { _setProductForTesting } from '../../../../src/product';
import { startFeedAdBlocker, FEED_AD_HIDDEN_MARKER } from '../../../../src/content/engagement/feed-ad-blocker';
import { __flushHiddenCountForTest } from '../../../../src/content/engagement/mark-hidden';
import { incrementMetricsHidden, type FWSettings, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../../src/storage/settings';
import { adultPreset } from '../../../../src/storage/presets';

function settings(): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'adult',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    features: adultPreset(),
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  };
}

const POST = (header: string) => `
  <div role="article" aria-posinset="1">
    <div><h3><a role="link" href="/pagina">Pagina</a></h3>${header}</div>
    <div data-ad-comet-preview="message"><div dir="auto" id="body">A plain organic post about the weekend.</div></div>
    <div id="bar" style="width: 10%"></div>
  </div>`;

/** Mount one post, start Off's ad hider on it, return the post. */
function start(header: string): { post: HTMLElement; stop: () => void } {
  const host = document.createElement('div');
  host.innerHTML = POST(header);
  document.body.appendChild(host);
  const post = host.firstElementChild as HTMLElement;
  const stop = startFeedAdBlocker('facebook', settings());
  return { post, stop };
}

/** Let the mutation observers run. */
const settle = () => new Promise((r) => setTimeout(r, 0));

let stop: () => void = () => {};
beforeEach(() => { document.body.innerHTML = ''; _setProductForTesting('off'); });
afterEach(() => { stop(); _setProductForTesting(null); document.body.innerHTML = ''; });

describe('a judged post is judged again when its label changes in place', () => {
  it('the header text is rewritten in the same node ("2 h" becomes "Sponsored")', async () => {
    const s = start('<span id="label">2 h</span>');
    stop = s.stop;
    expect(s.post.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    (document.getElementById('label')!.firstChild as Text).data = 'Sponsored';
    await settle();
    expect(s.post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
  });

  it('the header text node is swapped for a new one, element count unchanged', async () => {
    const s = start('<span id="label">2 h</span>');
    stop = s.stop;
    const count = s.post.getElementsByTagName('*').length;
    document.getElementById('label')!.textContent = 'Sponsorizat';
    expect(s.post.getElementsByTagName('*').length).toBe(count);
    await settle();
    expect(s.post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
  });

  // The pieces as drawn live 2026-10-08: one letter glued to U+034F each,
  // put in the row by CSS order, decoys stacked out of it.
  it('a stacked letter piece moves into the row by style, so the pieces now read "Ad"', async () => {
    const s = start('<span style="display: flex"><span style="order: 1">A͏</span>'
      + '<span id="d" style="position: absolute; top: 36px">d͏</span></span>');
    stop = s.stop;
    expect(s.post.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    document.getElementById('d')!.setAttribute('style', 'order: 2');
    await settle();
    expect(s.post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
  });

  it('the row is reordered by CSS order alone ("dA" becomes "Ad")', async () => {
    const s = start('<span style="display: flex"><span id="a" style="order: 2">A͏</span>'
      + '<span id="d" style="order: 1">d͏</span></span>');
    stop = s.stop;
    expect(s.post.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    document.getElementById('a')!.style.order = '1';
    document.getElementById('d')!.style.order = '2';
    await settle();
    expect(s.post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
  });

  it('an aria-label set later on a header link is read', async () => {
    const s = start('<a id="lnk" href="#"><span>·</span></a>');
    stop = s.stop;
    document.getElementById('lnk')!.setAttribute('aria-label', 'Sponsored');
    await settle();
    expect(s.post.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
  });
});

describe('what does not re-judge, and the tally', () => {
  it('a textless style change and a long body edit leave the judgement as it was', async () => {
    const s = start('<span>2 h</span>');
    stop = s.stop;
    const judged = s.post.getAttribute('data-fw-ad-judged');
    expect(judged).not.toBeNull();
    document.getElementById('bar')!.style.width = '55%';
    (document.getElementById('body')!.firstChild as Text).data = 'A plain organic post about the weekend, edited by its author.';
    await settle();
    expect(s.post.getAttribute('data-fw-ad-judged')).toBe(judged);
    expect(s.post.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
  });

  it('a post judged again is counted as judged once, and found once', async () => {
    __flushHiddenCountForTest();
    vi.mocked(incrementMetricsHidden).mockClear();
    const s = start('<span id="label">2 h</span>');
    stop = s.stop;
    (document.getElementById('label')!.firstChild as Text).data = '3 h';
    await settle();
    (document.getElementById('label')!.firstChild as Text).data = 'Sponsored';
    await settle();
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).toHaveBeenCalledWith(1, { 'ads-judged:facebook': 1, 'ads-found:facebook': 1, 'block-ads': 1 });
  });

  it('cleanup stops the label watch', async () => {
    const s = start('<span id="label">2 h</span>');
    s.stop();
    (document.getElementById('label')!.firstChild as Text).data = 'Sponsored';
    await settle();
    expect(s.post.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
  });
});
