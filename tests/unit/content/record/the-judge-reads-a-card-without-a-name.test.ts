// @vitest-environment jsdom
// What the judge may be told about a card (the Leader's decision, 12 Oct 2026): the quoted post's body, capped, with no name; a link
// card's title and its domain, nothing else. The household list still reads the whole card (text and accounts), because a blocked
// name quoted in someone else's post has to be found; the judge must not, because the consent screen promises a letter in place of
// every account name and no letter replaces a display name.

import { describe, it, expect } from 'vitest';
import { readCardContext } from '../../../../src/content/record/card-context';

function article(inner: string): HTMLElement {
  const el = document.createElement('article');
  el.setAttribute('role', 'article');
  el.innerHTML = '<div data-testid="User-Name"><a href="/outer">outer</a></div><div data-testid="tweetText">outer words</div>' + inner;
  return el;
}
const quotedPost = (body: string): string =>
  '<article role="link"><div data-testid="User-Name"><a href="/adabrightwell">Ada Brightwell</a></div><div data-testid="tweetText">' + body + '</div></article>';

describe('the quoted post, for the judge', () => {
  it('is its body alone: no display name, no handle', () => {
    const c = readCardContext(article(quotedPost('quoted words about the road works')), 'twitter');
    expect(c.quotedBody).toBe('quoted words about the road works');
    expect(c.quotedBody).not.toContain('Ada');
    expect(c.quotedBody).not.toContain('adabrightwell');
  });

  it('leaves the household list what it had: the whole card, display name and handle included', () => {
    const c = readCardContext(article(quotedPost('quoted words')), 'twitter');
    expect(c.text).toContain('Ada Brightwell');
    expect(c.text).toContain('quoted words');
    expect(c.accounts).toEqual(['adabrightwell']);
  });

  it('is cut at six hundred characters when it is read', () => {
    const c = readCardContext(article(quotedPost('y'.repeat(2000))), 'twitter');
    expect(c.quotedBody!.length).toBe(600);
  });

  it('is absent from a post that quotes nothing', () => {
    expect(readCardContext(article(''), 'twitter').quotedBody).toBeUndefined();
  });
});

describe('a link card, for the judge', () => {
  const card = (leaves: string): string => '<div data-testid="card.wrapper">' + leaves + '</div>';

  it('is its title and its domain, and not the description under them', () => {
    const c = readCardContext(article(card('<div><span>example.com</span></div><div><span>A headline about the road works</span></div><div><span>A long description of the story that goes on and on</span></div>')), 'twitter');
    expect(c.link).toEqual({ title: 'A headline about the road works', domain: 'example.com' });
    expect(JSON.stringify(c.link)).not.toContain('long description');
  });

  it('finds the domain after the title and under a From line', () => {
    const c = readCardContext(article(card('<span>A headline about the road works</span><span>A description line</span><span>From news.example.org</span>')), 'twitter');
    expect(c.link).toEqual({ title: 'A headline about the road works', domain: 'news.example.org' });
  });

  it('a card of one line is a title', () => {
    const c = readCardContext(article(card('A headline on the card')), 'twitter');
    expect(c.link).toEqual({ title: 'A headline on the card' });
  });

  it('a card of a domain alone is a domain', () => {
    const c = readCardContext(article(card('<span>example.com</span>')), 'twitter');
    expect(c.link).toEqual({ domain: 'example.com' });
  });

  it('the household list still reads the card as before', () => {
    const c = readCardContext(article(card('<span>example.com</span><span>A headline</span>')), 'twitter');
    expect(c.text).toContain('A headline');
  });

  it('a quoted post is not a link card', () => {
    const c = readCardContext(article(quotedPost('quoted words')), 'twitter');
    expect(c.link).toBeUndefined();
  });
});

describe('the other platforms', () => {
  it('Instagram and TikTok give the judge nothing new', () => {
    const el = document.createElement('article');
    el.innerHTML = '<a href="/author/"><img alt="profile picture"></a><a href="/author/">author</a><div><a href="/p/ABC/"><img alt="Photo" srcset="x 1x"></a></div>';
    const c = readCardContext(el, 'instagram');
    expect(c.quotedBody).toBeUndefined();
    expect(c.link).toBeUndefined();
  });
});
