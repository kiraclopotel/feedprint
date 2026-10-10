// @vitest-environment jsdom
//
// The sidebar ad remover hides the whole ad MODULE (so the rail closes the gap)
// and NEVER touches the trends / who-to-follow modules — the only trigger is the
// leaf "Ad" label, which those modules don't carry. Structure mirrors the
// live-verified X sidebar (2026-06-15): modules are direct children of a stacked
// module-list div.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hideSidebarAds, startSidebarAdBlocker } from '../../../src/content/engagement/sidebar-ad-blocker';
import { adultPreset } from '../../../src/storage/presets';
import { CURRENT_SETTINGS_SCHEMA_VERSION, type FWSettings, type FeatureToggles } from '../../../src/storage/settings';

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

/** Build an X-shaped sidebar: a module list with trends, who-to-follow, and an
 *  ad module (the ad carries a leaf "Ad" label, the others don't). */
function buildSidebar(): { root: HTMLElement; ad: HTMLElement; whoToFollow: HTMLElement; trends: HTMLElement } {
  const root = document.createElement('div');
  root.setAttribute('data-testid', 'sidebarColumn');
  const list = document.createElement('div'); // the stacked module list

  const trends = document.createElement('div');
  trends.innerHTML = '<h2>What’s happening</h2><div><span>Trending now</span></div>';

  const whoToFollow = document.createElement('div');
  whoToFollow.innerHTML = '<h2>Who to follow</h2><ul><li>@a</li><li>@b</li><li>@c</li></ul>';

  // The ad module: deep inner structure + a leaf "Ad" label, like X.
  const ad = document.createElement('div');
  const inner = document.createElement('div');
  const card = document.createElement('div');
  const img = document.createElement('div');
  const label = document.createElement('span');
  label.textContent = 'Ad';
  const link = document.createElement('a');
  link.href = 'https://advertiser.test/landing';
  card.append(img, label, link);
  inner.append(card);
  ad.append(inner);

  // Pad the list so the module-list parent clearly has the most siblings.
  const pad1 = document.createElement('div');
  const pad2 = document.createElement('div');
  const pad3 = document.createElement('div');
  list.append(pad1, trends, pad2, whoToFollow, ad, pad3);
  root.append(list);
  document.body.append(root);
  return { root, ad, whoToFollow, trends };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('hideSidebarAds', () => {
  it('hides the ad module and leaves trends / who-to-follow visible', () => {
    const { root, ad, whoToFollow, trends } = buildSidebar();
    hideSidebarAds(root);
    expect(ad.style.display).toBe('none');
    expect(ad.getAttribute('data-fw-sidebar-ad-hidden')).toBe('true');
    expect(whoToFollow.style.display).not.toBe('none');
    expect(trends.style.display).not.toBe('none');
  });

  it('is idempotent (does not re-process an already-hidden ad)', () => {
    const { root, ad } = buildSidebar();
    hideSidebarAds(root);
    hideSidebarAds(root);
    expect(ad.style.display).toBe('none');
  });

  it('reads the Facebook "Sponsored" heading with its trailing zero-width space (live, 2026-09-03)', () => {
    const root = document.createElement('div');
    root.setAttribute('role', 'complementary');
    const contacts = document.createElement('div'); contacts.innerHTML = '<h2>Contacts</h2><ul><li>A</li><li>B</li></ul>';
    const ad = document.createElement('div');
    ad.innerHTML = '<div><span><h3><span><span style="">Sponsored​</span></span></h3></div><a href="https://example.test/burger"><img alt=""></a></div>';
    const filler = [1, 2, 3].map(() => { const d = document.createElement('div'); d.textContent = 'x'; return d; });
    root.append(ad, contacts, ...filler);
    document.body.appendChild(root);
    hideSidebarAds(root);
    expect(ad.getAttribute('data-fw-sidebar-ad-hidden')).toBe('true');
    expect(contacts.hasAttribute('data-fw-sidebar-ad-hidden')).toBe(false);
  });

  it('resolves the Facebook column, one wrapper with three sections, and never takes the Contacts section', () => {
    // Owner's live tab, 2026-09-03: the "Sponsored" heading sits fourteen
    // levels deep, the widest level on the way up has three siblings
    // (Sponsored, Contacts, group chats), and the old floor of four left the
    // panel in place.
    const root = document.createElement('div');
    root.setAttribute('role', 'complementary');
    // The heading and the ad units are sibling branches under one section
    // (his DevTools, 08:10): hiding the heading's branch alone left the ads.
    root.innerHTML = `<div><div><div>
      <div class="sponsored"><div><div>
        <div class="hdrwrap"><div><div class="hdr"><span><h3><span><span>Sponsored​</span></span></h3></span></div></div></div>
        <div class="ads"><div><a href="https://l.facebook.com/l.php?u=x" target="_blank"><span>🚨 OFERTĂ LIMITATĂ 🚨</span></a></div>
          <div><a href="https://lp.example-bet.test/3-bonus/" target="_blank"><span>Bonusul tău</span></a></div></div>
      </div></div></div>
      <div class="contacts"><h2>Contacts</h2><ul><li>A</li><li>B</li><li>C</li></ul></div>
      <div class="chats"><h2>Group chats</h2><ul><li>G</li></ul></div>
    </div></div></div>`;
    document.body.appendChild(root);
    hideSidebarAds(root);
    expect(root.querySelector('.sponsored')!.getAttribute('data-fw-sidebar-ad-hidden')).toBe('true');
    expect(root.querySelector('.hdr')!.hasAttribute('data-fw-sidebar-ad-hidden')).toBe(false);
    expect(root.querySelector('.contacts')!.hasAttribute('data-fw-sidebar-ad-hidden')).toBe(false);
    expect(root.querySelector('.chats')!.hasAttribute('data-fw-sidebar-ad-hidden')).toBe(false);
  });

  it('never hides a section that carries another heading besides the label', () => {
    const root = document.createElement('div');
    root.setAttribute('role', 'complementary');
    root.innerHTML = `<div><div>
      <div class="mixed"><div><h3>Sponsored</h3></div><a href="https://x.test"></a><h2>Contacts</h2><ul><li>A</li></ul></div>
      <div>x</div><div>y</div>
    </div></div>`;
    document.body.appendChild(root);
    hideSidebarAds(root);
    expect(root.querySelector('.mixed')!.hasAttribute('data-fw-sidebar-ad-hidden')).toBe(false);
  });

  it('recognises the label in other languages (Facebook right column, "Sponsorizat")', () => {
    // 2026-09-03: the owner's Facebook sidebar panel (Romanian UI) survived Off
    // because the label test was English-only.
    const root = document.createElement('div');
    root.setAttribute('role', 'complementary');
    const list = document.createElement('div');
    const contacts = document.createElement('div'); contacts.innerHTML = '<h2>Contacte</h2><ul><li>A</li><li>B</li></ul>';
    const ad = document.createElement('div');
    ad.innerHTML = '<div><div><span>Sponsorizat</span></div><a href="https://example.test/casino"><img alt=""></a></div>';
    const pad1 = document.createElement('div'); const pad2 = document.createElement('div');
    list.append(pad1, ad, contacts, pad2);
    root.append(list);
    document.body.append(root);
    hideSidebarAds(root);
    expect(ad.style.display).toBe('none');
    expect(contacts.style.display).not.toBe('none');
  });

  it('does nothing when the sidebar has no ad label', () => {
    const root = document.createElement('div');
    const list = document.createElement('div');
    const a = document.createElement('div'); a.innerHTML = '<h2>Who to follow</h2>';
    const b = document.createElement('div'); b.innerHTML = '<h2>Trending</h2>';
    const c = document.createElement('div'); const d = document.createElement('div');
    list.append(a, b, c, d);
    root.append(list);
    hideSidebarAds(root);
    expect(root.querySelectorAll('[data-fw-sidebar-ad-hidden]').length).toBe(0);
  });
});

describe('startSidebarAdBlocker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('hides the ad on start, follows a module inserted later after the throttle, and restores on stop', async () => {
    const { root, ad } = buildSidebar();
    const stop = startSidebarAdBlocker('twitter', makeSettings(adultPreset()));
    expect(ad.getAttribute('data-fw-sidebar-ad-hidden')).toBe('true');

    // A second ad module arrives later: the observer schedules one scan, at
    // most one per THROTTLE_MS.
    const late = document.createElement('div');
    late.innerHTML = '<div><div><span>Ad</span><a href="https://advertiser.test/x">x</a></div></div>';
    root.firstElementChild!.append(late);
    await Promise.resolve(); // MutationObserver delivery
    expect(late.getAttribute('data-fw-sidebar-ad-hidden')).toBeNull();
    vi.advanceTimersByTime(700);
    expect(late.getAttribute('data-fw-sidebar-ad-hidden')).toBe('true');

    stop();
    expect(document.querySelectorAll('[data-fw-sidebar-ad-hidden]').length).toBe(0);
    expect(ad.style.display).toBe('');
  });

  it('is a no-op when Block Ads is off, and on a platform with no sidebar rule', () => {
    const { ad } = buildSidebar();
    const off = adultPreset();
    off['block-ads'] = { enabled: false };
    const stop = startSidebarAdBlocker('twitter', makeSettings(off));
    expect(ad.getAttribute('data-fw-sidebar-ad-hidden')).toBeNull();
    stop();
    const stop2 = startSidebarAdBlocker('tiktok', makeSettings(adultPreset()));
    expect(ad.getAttribute('data-fw-sidebar-ad-hidden')).toBeNull();
    stop2();
  });
});
