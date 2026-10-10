// @vitest-environment jsdom
// PAGES-PRODUCER (2026-07-22): a verified-org badge on the POST AUTHOR header
// stamps platform_specific.isVerified so deriveAccountType -> accountType:'page'
// and the dashboard "Pages" filter populates. The badge query is bounded to the
// author header so a verified COMMENTER nested in the same post can never
// mis-stamp the post as a page (the over-flag guard — child-safety asymmetry:
// any error must be under-detection, never over-flag).
import { describe, it, expect, beforeEach } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { deriveAccountType } from '../../../../src/content/record/account-type';

function fbArticle(innerHTML: string): HTMLElement {
  const article = document.createElement('div');
  article.setAttribute('role', 'article');
  article.innerHTML = innerHTML;
  return article;
}
function toNodeList(elements: HTMLElement[]): NodeList {
  const container = document.createElement('div');
  for (const el of elements) container.appendChild(el);
  return container.querySelectorAll('div[role="article"]');
}

describe('post verified-page producer (accountType=page)', () => {
  let adapter: FacebookAdapter;
  beforeEach(() => {
    adapter = new FacebookAdapter();
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/' },
      writable: true, configurable: true,
    });
  });

  it('FB: a verified badge in the post-author header stamps the post as a page', () => {
    const article = fbArticle(`
      <h2 role="heading">
        <a role="link" href="/CoolBrand/"><span data-ad-rendering-role="profile_name">Cool Brand</span></a>
        <svg aria-label="Verified"></svg>
      </h2>
      <div dir="auto">This is a verified brand post with enough text to pass the minimum length filter.</div>
    `);
    const post = adapter.extractPosts(toNodeList([article])).find(p => p.kind === 'post');
    expect(post).toBeDefined();
    expect((post!.platform_specific as { isVerified?: boolean }).isVerified).toBe(true);
    expect(deriveAccountType(post!)).toEqual({ accountType: 'page' });
  });

  it('FB over-flag guard: a verified badge OUTSIDE the author header does not make the post a page', () => {
    const article = fbArticle(`
      <h2 role="heading">
        <a role="link" href="/JohnDoe/"><span data-ad-rendering-role="profile_name">John Doe</span></a>
      </h2>
      <div dir="auto">A normal person post with enough text to pass the minimum length filter here now.</div>
      <div aria-label="Comment by a verified user"><svg aria-label="Verified"></svg></div>
    `);
    const post = adapter.extractPosts(toNodeList([article])).find(p => p.kind === 'post');
    expect(post).toBeDefined();
    expect((post!.platform_specific as { isVerified?: boolean }).isVerified).toBeFalsy();
    expect(deriveAccountType(post!)).toEqual({ accountType: 'person' });
  });
});
