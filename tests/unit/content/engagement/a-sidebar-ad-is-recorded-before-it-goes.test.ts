/** @vitest-environment jsdom */
// Receipts records every ad it hides. A sidebar ad module used to be hidden with no record at all; now its words and
// the site it points at are read before the hide and written once per page life, after the hide has landed, so the
// record never says an ad was hidden that is still on screen. Only the site is kept, never the ad's full address.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const recorded = vi.hoisted(() => [] as unknown[]);
vi.mock('../../../../src/content/engagement/recorder-sink', () => ({ recordBlocked: (p: unknown) => { recorded.push(p); } }));

import { hideSidebarAds } from '../../../../src/content/engagement/sidebar-ad-blocker';

/** An X-shaped right column: trends, who to follow, and one module carrying the leaf "Ad" label. */
function sidebar(): { root: HTMLElement; ad: HTMLElement } {
  document.body.innerHTML = `
    <div data-testid="sidebarColumn"><div>
      <div></div>
      <div><h2>What's happening</h2><div><span>Trending now</span></div></div>
      <div></div>
      <div><h2>Who to follow</h2><ul><li>@a</li><li>@b</li><li>@c</li></ul></div>
      <div id="ad"><div><div><div></div><span>Ad</span><span>Shoes that last</span>
        <a href="https://advertiser.test/landing?click=person-token-123">Shop</a></div></div></div>
      <div></div>
    </div></div>`;
  return { root: document.querySelector<HTMLElement>('[data-testid="sidebarColumn"]')!, ad: document.getElementById('ad')! };
}

beforeEach(() => { recorded.length = 0; });

describe('a sidebar ad is recorded when Receipts hides it', () => {
  it('writes one record with the words and the site, and hides the module', () => {
    const { root, ad } = sidebar();
    hideSidebarAds(root, { platform: 'twitter', mode: 'adult' });
    expect(ad.style.display).toBe('none');
    expect(recorded).toHaveLength(1);
    const entry = recorded[0] as { blockReason: string; matchedToken: string; caption: string; postUrl?: string };
    expect(entry.blockReason).toBe('ads');
    expect(entry.matchedToken).toBe('sidebar-ad-label');
    expect(entry.caption).toContain('Shoes that last');
    expect(entry.postUrl).toBe('https://advertiser.test');
    expect(JSON.stringify(entry)).not.toContain('person-token-123');
  });

  it('writes it once per page life, however often the sweep runs', () => {
    const { root } = sidebar();
    hideSidebarAds(root, { platform: 'twitter', mode: 'adult' });
    hideSidebarAds(root, { platform: 'twitter', mode: 'adult' });
    expect(recorded).toHaveLength(1);
  });

  it('writes nothing when no record is asked for', () => {
    const { root } = sidebar();
    hideSidebarAds(root);
    expect(recorded).toHaveLength(0);
  });
});
