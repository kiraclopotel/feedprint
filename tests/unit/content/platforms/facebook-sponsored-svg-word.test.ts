// @vitest-environment jsdom
//
// The recorder's Facebook sponsored detector reads the SVG-drawn "Ad" label
// (owner's live look, 2026-09-03: a <use> chain ending in a <text> outside
// the post), so the pipeline's sponsored gate sees the same ads Off hides.

import { beforeEach, describe, expect, it } from 'vitest';
import { extractIsFacebookSponsored } from '../../../../src/content/platforms/facebook';
import { svgUseText } from '../../../../src/content/engagement/ad-labels';

beforeEach(() => { document.body.innerHTML = ''; });

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const WORDS = `<div style="width:0;height:0">
  <svg id="W1"><use xlink:href="#W2"></use></svg>
  <svg id="W2"><text id="W3" y="12">Ad</text></svg>
  <svg id="T1"><use xlink:href="#T2"></use></svg>
  <svg id="T2"><text y="12">20 hours ago</text></svg>
</div>`;

describe('extractIsFacebookSponsored: SVG words', () => {
  it('svgUseText follows the chain to the <text>', () => {
    mount(WORDS);
    const host = mount('<svg><use href="#W1"></use></svg>');
    expect(svgUseText(host.querySelector('use')!)).toBe('Ad');
  });
  it('an [aria-posinset] unit with an "Ad" word is sponsored; one with a timestamp is not', () => {
    mount(WORDS);
    const ad = mount('<div aria-posinset="2"><h3>Atlas AI Studio</h3><a href="/?x"><svg><use href="#W1"></use></svg></a><div data-ad-rendering-role="story_message">text</div></div>');
    expect(extractIsFacebookSponsored(ad.firstElementChild!)).toBe(true);
    const organic = mount('<div aria-posinset="3"><h3>Friend</h3><a href="/posts/1"><svg><use href="#T1"></use></svg></a><div data-ad-rendering-role="story_message">text</div></div>');
    expect(extractIsFacebookSponsored(organic.firstElementChild!)).toBe(false);
  });
});
