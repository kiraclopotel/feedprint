// @vitest-environment jsdom
//
// Facebook's header words as drawn on 2026-10-08 (live read, ledger
// ADS-RESILIENCE-2026-10-08.md): a flex row of 60 one-letter pieces, each
// glued to U+034F; the real pieces are put in reading order by CSS `order`,
// the decoys (the same letters scrambled, plus digits) are absolutely
// positioned and stacked out of the row. The owner's screen the same evening:
// an "Ad" post stood in the feed with Block ads on. The label must be read as
// a person sees it, never in DOM order.

import { afterEach, describe, expect, it } from 'vitest';
import { isFeedAd } from '../../../../src/content/engagement/feed-ad-blocker';
import { extractIsFacebookSponsored } from '../../../../src/content/platforms/facebook';

const GLUE = '͏';

/** A deterministic shuffle, so a failure reproduces. */
function shuffled<T>(xs: T[], seed: number): T[] {
  const out = xs.slice();
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2147483648;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** The scramble as read live: `word` in the row by CSS order, decoys stacked below, 60 pieces in all. */
function scramble(word: string, seed = 7, total = 60): string {
  const real = word.split('').map((ch, k) => `<span style="order: ${k + 1}">${ch}${GLUE}</span>`);
  const pool = ('sponsored' + '0123456789').split('');
  const decoys = Array.from({ length: total - real.length }, (_, k) =>
    `<span style="position: absolute; top: 36px">${pool[(k * 5 + seed) % pool.length]}${GLUE}</span>`);
  return `<span style="display: flex">${shuffled([...real, ...decoys], seed).join('')}</span>`;
}

const FB_POST = (header: string) => `
  <div role="article" aria-posinset="1">
    <div><h3><a role="link" href="/pagina">Dr. Oetker</a></h3><div>${header}</div></div>
    <div data-ad-comet-preview="message"><div dir="auto">Pizza de la Dr. Oetker</div></div>
  </div>`;

function post(header: string): Element {
  const host = document.createElement('div');
  host.innerHTML = FB_POST(header);
  document.body.appendChild(host);
  return host.firstElementChild!;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('a scrambled Facebook header word is read as it is drawn', () => {
  it('"Sponsored" in 60 glued pieces, shuffled, with stacked decoys, is an ad', () => {
    for (const seed of [1, 7, 42, 99]) {
      expect(isFeedAd(post(scramble('Sponsored', seed)), 'facebook')).toBe(true);
      document.body.innerHTML = '';
    }
  });

  it('"Ad" in glued pieces with decoys is an ad', () => {
    expect(isFeedAd(post(scramble('Ad')), 'facebook')).toBe(true);
  });

  it('the Romanian "Sponsorizat" in glued pieces is an ad', () => {
    expect(isFeedAd(post(scramble('Sponsorizat', 3)), 'facebook')).toBe(true);
  });

  it('the time stamp drawn the same way ("17m") is not an ad', () => {
    expect(isFeedAd(post(scramble('17m')), 'facebook')).toBe(false);
  });

  it('pieces that spell "Sponsored" only in DOM order, but read otherwise by CSS order, are not an ad', () => {
    // The reading is by order: the same nine letters drawn as "dSponsore" are no label.
    const pieces = 'Sponsored'.split('').map((ch, k) => `<span style="order: ${k === 8 ? 0 : k + 1}">${ch}${GLUE}</span>`);
    expect(isFeedAd(post(`<span style="display: flex">${pieces.join('')}</span>`), 'facebook')).toBe(false);
  });

  it('the decoys alone, whatever they spell, are never read', () => {
    const decoys = 'Sponsored'.split('').map((ch) => `<span style="position: absolute">${ch}${GLUE}</span>`);
    expect(isFeedAd(post(`<span style="display: flex">${decoys.join('')}<span>2${GLUE}</span><span>h${GLUE}</span></span>`), 'facebook')).toBe(false);
  });

  it('a row with a piece of two letters is not read as pieces', () => {
    const pieces = ['Sp', 'o', 'n', 's', 'o', 'r', 'e', 'd'].map((ch) => `<span>${ch}</span>`);
    expect(isFeedAd(post(`<span>${pieces.join('')}</span>`), 'facebook')).toBe(false);
  });

  it('Receipts reads the same: its record notes the scrambled "Sponsored" post as sponsored, and not the time stamp', () => {
    expect(extractIsFacebookSponsored(post(scramble('Sponsored')))).toBe(true);
    document.body.innerHTML = '';
    expect(extractIsFacebookSponsored(post(scramble('17m')))).toBe(false);
  });

  // The fresh check of 8 Oct 21:3x broke the first version with these: letters that spell a label without the trick.
  it.each([
    ['a name set in two letter spans', '<div class="name"><span>A</span><span>d</span></div>'],
    ['a link of letter spans', '<a href="/x"><span>A</span><span>d</span></a>'],
    ['nine div tiles', `<div>${'Sponsored'.split('').map((l) => `<div>${l}</div>`).join('')}</div>`],
    ['bold letters after loose text', '<div>Buy now! <b>A</b><b>d</b></div>'],
    ['a plain span of letter spans, no glue, no decoy', '<span><span>A</span><span>d</span></span>'],
    ['loose text beside glued pieces', `<span>Buy <span>A${GLUE}</span><span>d${GLUE}</span></span>`],
    ['an SVG of two text pieces', '<svg><text>A</text><text>d</text></svg>'],
    // The second fresh check (22:0x): one hidden sibling or a zero-width space is not the trick.
    ['"Ad" with one out-of-row sibling', '<span><span>A</span><span>d</span><span style="position: absolute">x</span></span>'],
    ['"Ad" with one aria-hidden dot', '<span><span>A</span><span>d</span><span aria-hidden="true">.</span></span>'],
    ['"Ad" with zero-width spaces', '<span><span>A​</span><span>d​</span></span>'],
    ['"Ad" with one hidden letter between', '<span><span>A</span><span style="display: none">z</span><span>d</span></span>'],
    // The third fresh check (22:4x): decoys without the joiner are not the trick, however many.
    ['"Ad" with two hidden siblings', '<span><span>A</span><span>d</span><span style="display: none">x</span><span style="display: none">y</span></span>'],
    ['"Ad" with two aria-hidden siblings', '<span><span>A</span><span>d</span><span aria-hidden="true">x</span><span aria-hidden="true">y</span></span>'],
    ['"Ad", one letter joined, two out-of-row siblings', `<span><span>A${GLUE}</span><span>d</span><span style="position: absolute">x</span><span style="position: absolute">y</span></span>`],
    ['"Sponsored" in plain spans with nine out-of-row decoys', `<span>${'Sponsored'.split('').map((l) => `<span>${l}</span><span style="position: absolute">${l}</span>`).join('')}</span>`],
  ])('%s is not an ad', (_name, header) => {
    expect(isFeedAd(post(header), 'facebook')).toBe(false);
    document.body.innerHTML = '';
    expect(extractIsFacebookSponsored(post(header))).toBe(false);
  });
});
