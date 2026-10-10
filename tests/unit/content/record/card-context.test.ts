// @vitest-environment jsdom
// content/card-context.ts: what an X card carries beyond the author's words.

import { describe, it, expect } from 'vitest';
import { readCardContext } from '../../../../src/content/record/card-context';

function article(inner: string): HTMLElement {
  const el = document.createElement('article');
  el.setAttribute('role', 'article');
  el.innerHTML = inner;
  return el;
}

describe('readCardContext on X', () => {
  it('reads the quoted post text and its author', () => {
    const a = article(
      '<div data-testid="User-Name"><a href="/outer">outer</a></div>' +
      '<div data-testid="tweetText">outer words</div>' +
      '<article role="link"><div data-testid="User-Name"><a href="/adabrightwell">Ada Brightwell</a></div><div data-testid="tweetText">quoted words</div></article>',
    );
    const c = readCardContext(a, 'twitter');
    expect(c.accounts).toEqual(['adabrightwell']);
    expect(c.text).toContain('quoted words');
    // The display name rides the card text, so a phrase rule reads it.
    expect(c.text).toContain('Ada Brightwell');
  });

  it('reads a From attribution and a link card, and never the outer author', () => {
    const a = article(
      '<div data-testid="User-Name"><a href="/outer">outer</a></div>' +
      '<div data-testid="tweetText">outer words</div>' +
      '<div data-testid="videoPlayer"><a href="/drsam">From Dr. Sam</a></div>' +
      '<div data-testid="card.wrapper">A headline on the card</div>',
    );
    const c = readCardContext(a, 'twitter');
    expect(c.accounts).toEqual(['drsam']);
    expect(c.text).toContain('A headline on the card');
    expect(c.text).toContain('From Dr. Sam');
    expect(c.text).not.toContain('outer words');
  });

  it('returns nothing for a plain post, and nothing on a platform it does not read', () => {
    const a = article('<div data-testid="User-Name"><a href="/outer">outer</a></div><div data-testid="tweetText">plain</div>');
    expect(readCardContext(a, 'twitter')).toEqual({});
    expect(readCardContext(a, 'facebook')).toEqual({});
    expect(readCardContext(null, 'twitter')).toEqual({});
  });
});

// The shapes below follow the live read of 2026-09-07 (docs/spec/STRUCTURE-MAP.md):
// the header is every link before the media, the caption every link after it.
function igArticle(header: string, caption: string): HTMLElement {
  const el = document.createElement('article');
  el.innerHTML =
    '<div><a href="/author/"><img alt="author\'s profile picture"></a>' + header + '</div>' +
    '<div><a href="/p/ABC123/"><img alt="Photo shared by author" srcset="x 1x"></a></div>' +
    '<div><span>Liked by <a href="/liker/">liker</a> and others</span></div>' +
    '<div><a href="/author/">author</a><span> ' + caption + '</span></div>';
  return el;
}

describe('readCardContext on Instagram', () => {
  it('reads a collab post\'s second author and the audio line, never the caption\'s mentions', () => {
    const a = igArticle(
      '<a href="/author/">author</a><span>and</span><a href="/coauthor/">coauthor</a><div><a href="/reels/audio/123/">coauthor · Original audio</a></div>',
      'with <a href="/mentioned/">@mentioned</a> tonight',
    );
    const c = readCardContext(a, 'instagram');
    expect(c.accounts).toEqual(['coauthor']);
    expect(c.text).toContain('coauthor');
    expect(c.text).toContain('Original audio');
    expect(c.text).not.toContain('tonight');
  });

  it('reads a repost line and the account it names', () => {
    const a = igArticle(
      '<a href="/author/">author</a><div><span>Reposted from</span><a href="/origin/">origin</a></div>',
      'plain caption',
    );
    const c = readCardContext(a, 'instagram');
    expect(c.accounts).toEqual(['origin']);
    expect(c.text).toContain('Reposted from');
  });

  it('returns nothing for a plain post, for a comment row with no media, and never reads reserved paths as handles', () => {
    expect(readCardContext(igArticle('<a href="/author/">author</a>', 'plain'), 'instagram')).toEqual({});
    const li = document.createElement('li');
    li.innerHTML = '<a href="/commenter/">commenter</a><span>hello <a href="/friend/">@friend</a></span>';
    expect(readCardContext(li, 'instagram')).toEqual({});
    const a = igArticle('<a href="/author/">author</a><a href="/explore/">explore</a>', 'plain');
    expect(readCardContext(a, 'instagram')).toEqual({});
  });
});

function ttUnit(inner: string): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-e2e', 'recommend-list-item-container');
  el.innerHTML =
    '<section data-e2e="feed-video"><a href="/@author"><img alt=""></a><a href="/@author">author</a><video></video></section>' + inner;
  return el;
}

describe('readCardContext on TikTok', () => {
  it('reads the sound line as text, and the account it links', () => {
    const plain = ttUnit('<section><a data-e2e="video-music" href="/music/original-sound-123">original sound - Some Name</a></section>');
    const c = readCardContext(plain, 'tiktok');
    expect(c.text).toBe('original sound - Some Name');
    expect(c.accounts).toBeUndefined();
    const linked = ttUnit('<section><div data-e2e="video-music"><a href="/@soundowner">original sound - Sound Owner</a></div></section>');
    expect(readCardContext(linked, 'tiktok').accounts).toEqual(['soundowner']);
  });

  it('reads a duet or stitch line and the other account, never an ordinary caption\'s mentions', () => {
    const duet = ttUnit('<div data-e2e="video-desc">Duet with <a href="/@other">@other</a> look at this <a href="/tag/fun">#fun</a></div>');
    const c = readCardContext(duet, 'tiktok');
    expect(c.accounts).toEqual(['other']);
    expect(c.text).toContain('Duet with');
    const plain = ttUnit('<div data-e2e="video-desc">shoutout <a href="/@friend">@friend</a></div>');
    expect(readCardContext(plain, 'tiktok')).toEqual({});
  });

  it('returns nothing for a comment row', () => {
    const row = document.createElement('div');
    row.setAttribute('data-e2e', 'comment-level-1');
    row.innerHTML = '<a href="/@commenter">commenter</a><p>hello <a href="/@friend">@friend</a></p>';
    expect(readCardContext(row, 'tiktok')).toEqual({});
  });
});
