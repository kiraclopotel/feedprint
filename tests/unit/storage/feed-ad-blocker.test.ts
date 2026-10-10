// @vitest-environment jsdom
//
// Off's feed ad hider (engagement/feed-ad-blocker.ts). The contract is the
// precision posture: a post is hidden only on the platform's own ad signal
// or on an element whose entire text is an ad label, outside the body and
// outside every comment; the worst case is a missed ad, never a hidden
// organic post. Off only: the recorder hides and records feed ads in the
// pipeline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return { ...actual, incrementMetricsHidden: vi.fn(() => Promise.resolve()) };
});

import { _setProductForTesting } from '../../../src/product';
import {
  isFeedAd,
  scanFeedAds,
  startFeedAdBlocker,
  FEED_AD_HIDDEN_MARKER,
} from '../../../src/content/engagement/feed-ad-blocker';
import { isAdLabelText, labelTexts } from '../../../src/content/engagement/ad-labels';
import { __flushHiddenCountForTest } from '../../../src/content/engagement/mark-hidden';
import { incrementMetricsHidden } from '../../../src/storage/settings';
import {
  FWSettings,
  FeatureToggles,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { adultPreset } from '../../../src/storage/presets';

function makeSettings(features: FeatureToggles): FWSettings {
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
    features,
    presets: { appliedAt: '', appliedPreset: 'adult' },
    dashboardTheme: 'dark',
  };
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const FB_POST = (header: string, body = 'A plain organic post about the weekend.', comments = '') => `
  <div role="article" aria-posinset="1">
    <div><h3><a role="link" href="/pagina">Pagina</a></h3>${header}</div>
    <div data-ad-comet-preview="message"><div dir="auto">${body}</div></div>
    <video></video>
    <div>${comments}</div>
  </div>`;

const FB_COMMENT = (text: string) => `
  <div role="article" aria-label="Comentariu adăugat de Ana"><div dir="auto">${text}</div></div>`;

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { _setProductForTesting(null); document.body.innerHTML = ''; });

describe('isAdLabelText', () => {
  it('matches whole labels in several languages, folded', () => {
    for (const t of ['Sponsored', 'Ad', 'Sponsorizat', 'SPONSORIZAT', 'Gesponsert', 'Publicité', 'Реклама', 'Paid partnership']) {
      expect(isAdLabelText(t), t).toBe(true);
    }
  });
  it('never matches a mention inside prose or a near miss', () => {
    for (const t of ['this is not sponsored', 'Add', 'Adding photos', 'sponsor', '']) {
      expect(isAdLabelText(t), t).toBe(false);
    }
  });
});

describe('isFeedAd — Facebook', () => {
  it('an aria-labelled sponsored link in the header is an ad', () => {
    const host = mount(FB_POST('<a aria-label="Sponsorizat" href="#"><span>S</span><span>p</span></a>'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(true);
  });
  it('a bare "Ad" leaf in the header is an ad', () => {
    const host = mount(FB_POST('<span>Ad</span>'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(true);
  });
  it('the label with its separator in the same node ("Ad · ") is an ad', () => {
    // Owner's Facebook screenshot 2026-09-03: a Tuborg post labelled "Ad ·"
    // survived with block-ads on.
    const host = mount(FB_POST('<span>Ad · </span>'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(true);
  });
  it('the 3 Sep guess at the split label (nine letters, one hidden decoy) is no longer read as an ad', () => {
    // 701be956 modelled the split label without a live read ("Not live-verified"). The live form read on
    // 8 Oct (glued pieces, CSS order, many stacked decoys) is pinned in
    // tests/unit/content/engagement/a-scrambled-facebook-label-is-read-as-drawn.test.ts; this guessed shape
    // is also the shape of an ordinary styled word, which two fresh checks on 8 Oct showed read as an ad.
    const letters = 'Sponsored'.split('').map((l, i) => `<span>${l}</span>${i === 3 ? '<span aria-hidden="true">x</span>' : ''}`).join('');
    const host = mount(FB_POST(`<span>${letters}</span>`));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(false);
  });
  it('the /ads/about link is an ad', () => {
    const host = mount(FB_POST('<a href="https://www.facebook.com/ads/about/?entry_product=ad_preferences">Why am I seeing this</a>'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(true);
  });
  it('the word "Ad" as the whole post body is not an ad', () => {
    const host = mount(FB_POST('<span>2 h</span>', 'Ad'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(false);
  });
  it('a comment that is exactly "Sponsored" is not an ad marker', () => {
    const host = mount(FB_POST('<span>2 h</span>', 'organic', FB_COMMENT('Sponsored')));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(false);
  });
  it('a caption mentioning sponsorship is not an ad', () => {
    const host = mount(FB_POST('<span>2 h</span>', 'this post is not sponsored by anyone'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(false);
  });
});

// Owner's live look, 2026-09-03 (his open tab, read through the browser MCP):
// the home feed's units are [aria-posinset]; the role=article inside one is
// an empty shell; the "Ad" label, the timestamp and "Learn more" are SVG
// <use> chains ending in a <text> defined elsewhere in the document, so the
// word is never inside the post. The label rule resolves the chain.
const SVG_WORDS = `
  <div class="__fb-dark-mode" style="position:absolute;width:0;height:0">
    <svg id="SvgWml25"><use xlink:href="#SvgWml26"></use></svg>
    <svg id="SvgWml26"><use xlink:href="#SvgWml27"></use></svg>
    <svg id="SvgWml27"><text id="SvgWml28" y="12">Ad</text></svg>
    <svg id="SvgWml17"><use xlink:href="#SvgWml18"></use></svg>
    <svg id="SvgWml18"><text id="SvgWml20" y="12">15 hours ago</text></svg>
  </div>`;
const FB_UNIT = (headerSvgId: string, body = 'organic text about the weekend') => `
  <div aria-posinset="3" class="x1lliihq">
    <div><div role="article" aria-label=""></div>
      <div><h3><a role="link" href="/profile.php" aria-label="Atlas AI Studio">Atlas AI Studio</a></h3>
        <a href="/?__cft__[0]=x"><svg style="width:124px;height:17px"><use href="#${headerSvgId}"></use></svg></a>
        <span> · </span><svg><title>Shared with Public</title></svg>
      </div>
      <div data-ad-rendering-role="story_message"><div dir="auto">${body}</div></div>
      <video></video>
    </div>
  </div>`;

describe('isFeedAd — Facebook feed units with SVG words', () => {
  it('an [aria-posinset] unit whose header <use> chain resolves to "Ad" is an ad', () => {
    mount(SVG_WORDS);
    const host = mount(FB_UNIT('SvgWml25'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(true);
  });
  it('a unit whose <use> chain resolves to a timestamp is organic', () => {
    mount(SVG_WORDS);
    const host = mount(FB_UNIT('SvgWml17'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(false);
  });
  it('a <use> pointing outside the document, or to nothing, is not a label', () => {
    const host = mount(FB_UNIT('nowhere'));
    expect(isFeedAd(host.firstElementChild!, 'facebook')).toBe(false);
    const ext = mount('<div aria-posinset="4"><svg><use href="https://x.test/s.svg#Ad"></use></svg></div>');
    expect(isFeedAd(ext.firstElementChild!, 'facebook')).toBe(false);
  });
  it('labelTexts reads every channel a word can be drawn in: text, aria, title, alt, SVG word', () => {
    mount(SVG_WORDS);
    const host = mount('<div><span>Sponsored</span><a aria-label="Sponsorizat">x</a><i title="Ad"></i><img alt="Reclamă"><svg><use href="#SvgWml25"></use></svg><p>a whole caption of ordinary words that runs long enough to be dropped</p></div>');
    const [span, a, i, img, use, p] = ['span', 'a', 'i', 'img', 'use', 'p'].map(s => host.querySelector(s)!);
    expect(labelTexts(span)).toEqual(['Sponsored']);
    expect(labelTexts(a)).toContain('Sponsorizat');
    expect(labelTexts(i)).toContain('Ad');
    expect(labelTexts(img)).toContain('Reclamă');
    expect(labelTexts(use)).toEqual(['Ad']);
    expect(labelTexts(p)).toEqual([]);
  });
  it('a title-drawn label in the header is an ad; the same label in the body is not', () => {
    const ad = mount(FB_UNIT('none').replace('<span> · </span>', '<i title="Sponsored"></i><span> · </span>'));
    expect(isFeedAd(ad.firstElementChild!, 'facebook')).toBe(true);
    const organic = mount(FB_UNIT('none', '<i title="Sponsored"></i> organic words'));
    expect(isFeedAd(organic.firstElementChild!, 'facebook')).toBe(false);
  });
  it('tallies posts judged and ads found per platform, each post once (the blindness measure)', () => {
    __flushHiddenCountForTest();
    vi.mocked(incrementMetricsHidden).mockClear();
    mount(SVG_WORDS);
    const host = mount(FB_UNIT('SvgWml25') + FB_UNIT('SvgWml17') + FB_UNIT('SvgWml17'));
    scanFeedAds(host, 'facebook');
    scanFeedAds(host, 'facebook');
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).toHaveBeenCalledWith(1, { 'ads-judged:facebook': 3, 'ads-found:facebook': 1, 'block-ads': 1 });
  });
  it('scanFeedAds hides the unit once and never judges the empty article shell on its own', () => {
    mount(SVG_WORDS);
    const host = mount(FB_UNIT('SvgWml25') + FB_UNIT('SvgWml17'));
    const [ad, organic] = Array.from(host.children) as HTMLElement[];
    expect(scanFeedAds(host, 'facebook')).toBe(1);
    expect(ad.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
    expect(ad.querySelector('[role="article"]')!.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    expect(organic.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
  });
});

describe('isFeedAd — other platforms', () => {
  it('Instagram: a header span "Sponsored" is an ad; a comment row is not', () => {
    const ad = mount('<article><header><span>Sponsored</span></header><h1>caption</h1></article>');
    expect(isFeedAd(ad.firstElementChild!, 'instagram')).toBe(true);
    const organic = mount('<article><header><span>user</span></header><ul><li><span>Sponsored</span></li></ul></article>');
    expect(isFeedAd(organic.firstElementChild!, 'instagram')).toBe(false);
  });
  it('X: a bare "Ad" leaf with no <time> is an ad; with a <time> it is organic', () => {
    const ad = mount('<article data-testid="tweet"><div><span>Brand</span><span>Ad</span></div><div data-testid="tweetText">buy</div></article>');
    expect(isFeedAd(ad.firstElementChild!, 'twitter')).toBe(true);
    const organic = mount('<article data-testid="tweet"><div><span>User</span><time>2h</time></div><div><span>Ad</span></div></article>');
    expect(isFeedAd(organic.firstElementChild!, 'twitter')).toBe(false);
  });
  it('YouTube: an ad slot inside a rich item is an ad', () => {
    const host = mount('<ytd-rich-item-renderer><ytd-ad-slot-renderer></ytd-ad-slot-renderer></ytd-rich-item-renderer>');
    expect(isFeedAd(host.firstElementChild!, 'youtube')).toBe(true);
  });
});

describe('scanFeedAds — hiding', () => {
  it('hides the Facebook ad, mutes its video, stamps marker and reason, leaves the organic post', () => {
    const host = mount(FB_POST('<span>Sponsorizat</span>') + FB_POST('<span>2 h</span>'));
    const [ad, organic] = Array.from(host.children) as HTMLElement[];
    expect(scanFeedAds(host, 'facebook')).toBe(1);
    expect(ad.getAttribute(FEED_AD_HIDDEN_MARKER)).toBe('true');
    expect(ad.getAttribute('data-fw-block-reason')).toBe('block-ads:feed-ad');
    expect(ad.style.display).toBe('none');
    expect(ad.querySelector('video')!.muted).toBe(true);
    expect(organic.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
    expect(organic.style.display).not.toBe('none');
  });
  it('judges a comment as part of its post, never on its own', () => {
    const host = mount(FB_POST('<span>2 h</span>', 'organic', FB_COMMENT('Sponsored')));
    expect(scanFeedAds(host, 'facebook')).toBe(0);
    expect(host.querySelectorAll(`[${FEED_AD_HIDDEN_MARKER}]`).length).toBe(0);
  });
  it('a root inserted inside a post (a late label) hides the post above it', () => {
    const host = mount(FB_POST('<span id="late"></span>'));
    const post = host.firstElementChild as HTMLElement;
    const late = host.querySelector<HTMLElement>('#late')!;
    late.textContent = 'Sponsorizat';
    expect(scanFeedAds(late, 'facebook')).toBe(1);
    expect(post.style.display).toBe('none');
  });
  it('Instagram keeps the box: visibility hidden, display untouched, one visible line saying why', () => {
    const host = mount('<article><header><span>Sponsored</span></header></article>');
    scanFeedAds(host, 'instagram', 'ro');
    const a = host.firstElementChild as HTMLElement;
    expect(a.style.visibility).toBe('hidden');
    expect(a.style.display).not.toBe('none');
    const note = a.querySelector<HTMLElement>(':scope > [data-fw-ad-slot-note]')!;
    expect(note.textContent).toContain('Reclama de aici e ascunsă');
    expect(note.style.visibility).toBe('visible');
    expect(note.style.position).toBe('absolute');
    expect(a.style.position).toBe('relative');
  });
  it('X hides the feed cell, not just the article', () => {
    const host = mount('<div data-testid="cellInnerDiv"><article data-testid="tweet"><span>Ad</span></article></div>');
    scanFeedAds(host, 'twitter');
    expect((host.firstElementChild as HTMLElement).style.display).toBe('none');
  });
  it('is idempotent across passes', () => {
    const host = mount(FB_POST('<span>Sponsorizat</span>'));
    expect(scanFeedAds(host, 'facebook')).toBe(1);
    expect(scanFeedAds(host, 'facebook')).toBe(0);
  });
});

describe('startFeedAdBlocker — gating', () => {
  it('does nothing in the recorder, even with block-ads on', () => {
    const host = mount(FB_POST('<span>Sponsorizat</span>'));
    const stop = startFeedAdBlocker('facebook', makeSettings(adultPreset()));
    expect((host.firstElementChild as HTMLElement).style.display).not.toBe('none');
    stop();
  });
  it('does nothing in Off when block-ads is off', () => {
    _setProductForTesting('off');
    const features = adultPreset();
    features['block-ads'] = { enabled: false };
    const host = mount(FB_POST('<span>Sponsorizat</span>'));
    const stop = startFeedAdBlocker('facebook', makeSettings(features));
    expect((host.firstElementChild as HTMLElement).style.display).not.toBe('none');
    stop();
  });
  it('in Off with block-ads on it hides at start and restores on cleanup', () => {
    _setProductForTesting('off');
    const host = mount(FB_POST('<span>Sponsorizat</span>'));
    const post = host.firstElementChild as HTMLElement;
    const stop = startFeedAdBlocker('facebook', makeSettings(adultPreset()));
    expect(post.style.display).toBe('none');
    stop();
    expect(post.style.display).not.toBe('none');
    expect(post.hasAttribute(FEED_AD_HIDDEN_MARKER)).toBe(false);
  });
});
