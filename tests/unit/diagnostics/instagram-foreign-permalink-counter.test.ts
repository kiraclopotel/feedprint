// @vitest-environment jsdom
//
// `postUrlForeignHostRejected` (src/content/platforms/instagram.ts,
// _extractPostUrl) is bumped once per absolute `/p/` or `/reel/` link that
// belongs to another host inside an Instagram card. Facebook uses both path
// shapes, so an embedded cross-platform link would otherwise become this
// Instagram record's permalink. The link is refused, counted, and the scan
// continues to the card's own permalink.
//
// Every handle and shortcode below is fabricated in Instagram's grammar.

import { beforeEach, describe, expect, it } from 'vitest';
import { InstagramAdapter } from '../../../src/content/platforms/instagram';
import {
  _resetDiagnosticsForTesting,
  _getDiagnosticCountersForTesting,
} from '../../../src/diagnostics/diagnostics';

function setPath(pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: {
      hostname: 'www.instagram.com',
      pathname,
      href: `https://www.instagram.com${pathname}`,
    },
    writable: true,
    configurable: true,
  });
}

function nodesOf(el: HTMLElement): NodeList {
  const holder = document.createElement('div');
  holder.appendChild(el);
  return holder.querySelectorAll('article');
}

function card(links: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = `
    <a href="/synth_poster_fp/" role="link"><span>synth_poster_fp</span></a>
    ${links}
    <span dir="auto">A caption comfortably longer than the twenty character floor.</span>
  `;
  return article;
}

function counter(name: string): number {
  return _getDiagnosticCountersForTesting()[name] ?? 0;
}

describe('postUrlForeignHostRejected counter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _resetDiagnosticsForTesting();
    setPath('/');
  });

  it('refuses an absolute Facebook /p/ link, counts it once, and takes the card\'s own permalink', () => {
    const adapter = new InstagramAdapter();
    const article = card(`
      <a href="https://www.facebook.com/p/SynthPage-100000000000001/">shared from Facebook</a>
      <a href="/p/FwSynthFp01/"><time datetime="2026-09-05T10:00:00Z">1h</time></a>
    `);

    const posts = adapter.extractPosts(nodesOf(article)).filter(p => p.kind === 'post');

    expect(posts).toHaveLength(1);
    expect(posts[0].sourceUrl).toBe('https://www.instagram.com/p/FwSynthFp01/');
    // The id follows the same rule: the Facebook page's /p/ code is not this card's shortcode.
    expect(posts[0].id).toBe('FwSynthFp01');
    expect(counter('postUrlForeignHostRejected')).toBe(1);
  });

  it('counts each foreign link, /reel/ included, and leaves the URL empty when no own link exists', () => {
    const adapter = new InstagramAdapter();
    const article = card(`
      <a href="https://www.facebook.com/reel/100000000000002/">a reel</a>
      <a href="https://www.facebook.com/p/SynthPage-100000000000003/">a page post</a>
    `);

    const posts = adapter.extractPosts(nodesOf(article)).filter(p => p.kind === 'post');

    expect(posts).toHaveLength(1);
    expect(posts[0].sourceUrl).toBe('');
    expect(counter('postUrlForeignHostRejected')).toBe(2);
  });

  it('does not count an absolute link that is Instagram\'s own, and takes it', () => {
    const adapter = new InstagramAdapter();
    const article = card(`
      <a href="https://www.instagram.com/p/FwSynthFp02/"><time datetime="2026-09-05T10:00:00Z">1h</time></a>
    `);

    const posts = adapter.extractPosts(nodesOf(article)).filter(p => p.kind === 'post');

    expect(posts).toHaveLength(1);
    expect(posts[0].sourceUrl).toBe('https://www.instagram.com/p/FwSynthFp02/');
    expect(counter('postUrlForeignHostRejected')).toBe(0);
  });
});
