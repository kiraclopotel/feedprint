// @vitest-environment jsdom
//
// The owner's 2026-09-05 export carried whole header sentences as Facebook
// authors: "Sample Person Verified account" (the badge's accessible text after
// a no-break space), "Pat Q. Example is with Lee ..." and "Sam Placeholder
// recommends Example Cafe" (a page's reviews tab). The actor element's text is
// the name plus whatever the header narrates; the name is the link inside it.

import { beforeEach, describe, expect, it } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';

function article(header: string): NodeList {
  const container = document.createElement('div');
  const el = document.createElement('div');
  el.setAttribute('role', 'article');
  el.innerHTML = `
    <div data-ad-rendering-role="profile_name">${header}</div>
    <div data-ad-rendering-role="story_message">A post with enough words in it to clear the minimum length filter for extraction.</div>
  `;
  container.appendChild(el);
  return container.querySelectorAll('div[role="article"]');
}

describe('Facebook author from the actor element', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.facebook.com', pathname: '/', href: 'https://www.facebook.com/' },
      writable: true,
      configurable: true,
    });
  });

  it('is the name link, not the verified badge text after it', () => {
    const posts = new FacebookAdapter().extractPosts(article('<a role="link" href="/sampleperson">Sample Person</a> Verified account'));
    expect(posts[0]?.author).toBe('Sample Person');
  });

  it('is the name link, not the relationship the header narrates', () => {
    const posts = new FacebookAdapter().extractPosts(article('<a role="link" href="/pat">Pat Q. Example</a> is with <a role="link" href="/lee">Lee</a>'));
    expect(posts[0]?.author).toBe('Pat Q. Example');
  });

  it('on a reviews tab it is the reviewer, not "recommends <page>"', () => {
    const posts = new FacebookAdapter().extractPosts(article('<a role="link" href="/profile.php?id=1">Sam Placeholder</a> recommends <a role="link" href="/examplecafe">Example Cafe</a>.'));
    expect(posts[0]?.author).toBe('Sam Placeholder');
  });

  it('a badge inside the link is cut at the no-break space; a bare name stays as it was', () => {
    expect(new FacebookAdapter().extractPosts(article('<a role="link" href="/samplenews">Sample News Verified account</a>'))[0]?.author).toBe('Sample News');
    expect(new FacebookAdapter().extractPosts(article('Travel Sample'))[0]?.author).toBe('Travel Sample');
    expect(new FacebookAdapter().extractPosts(article('Travel Sample · Follow'))[0]?.author).toBe('Travel Sample');
  });
});
