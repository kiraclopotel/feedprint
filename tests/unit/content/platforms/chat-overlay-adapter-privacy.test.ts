// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import {
  _resetTikTokVideoDedupForTesting,
  TiktokAdapter,
} from '../../../../src/content/platforms/tiktok';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { YoutubeAdapter } from '../../../../src/content/platforms/youtube';

const PUBLIC_TEXT = 'A public feed post that FeelingWise must continue extracting beside chat.';
const PRIVATE_TEXT = 'A private conversation that must never enter public-feed extraction.';

function setLocation(hostname: string, pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: {
      hostname,
      pathname,
      search: '',
      href: `https://${hostname}${pathname}`,
    },
    writable: true,
    configurable: true,
  });
}

function chatDialog(candidate: HTMLElement): HTMLElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Chat with Example Contact');
  dialog.appendChild(candidate);
  return dialog;
}

// X-3 (audit swarm-2026-07-13) — IG/FB pair every generic candidate scan
// with a `[role="log"]` (ARIA messages live-region) exclusion in addition to
// the chat-overlay dialog gate. X only had the dialog gate. This helper
// simulates the DM message-list wrapper the ARIA spec calls for.
function chatLogSurface(candidate: HTMLElement): HTMLElement {
  const log = document.createElement('div');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-label', 'Messages in conversation with Example Contact');
  log.appendChild(candidate);
  return log;
}

function failOnTextRead(...elements: HTMLElement[]): void {
  for (const element of elements) {
    Object.defineProperty(element, 'textContent', {
      configurable: true,
      get: () => {
        throw new Error('private chat text was read');
      },
    });
  }
}

function facebookCandidate(text: string): HTMLElement {
  const unit = document.createElement('div');
  unit.setAttribute('aria-posinset', '1');
  unit.innerHTML = `<div data-ad-rendering-role="story_message">${text}</div>`;
  return unit;
}

function twitterCandidate(text: string, id: string): HTMLElement {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  article.innerHTML = `
    <a href="/author" role="link"><span>Author</span></a>
    <a href="/author/status/${id}" role="link">now</a>
    <div data-testid="tweetText" lang="en" dir="ltr">${text}</div>
  `;
  return article;
}

function tiktokCandidate(text: string): HTMLElement {
  const unit = document.createElement('div');
  unit.setAttribute('data-e2e', 'recommend-list-item-container');
  unit.innerHTML = `
    <div data-e2e="browse-video-desc"><span>${text}</span></div>
    <a data-e2e="browse-username" href="/@author">@author</a>
  `;
  return unit;
}

function instagramCandidate(text: string): HTMLElement {
  const article = document.createElement('article');
  article.innerHTML = `<span dir="auto"><span>${text}</span></span>`;
  return article;
}

function youtubeCandidate(text: string, id: string): HTMLElement {
  const unit = document.createElement('ytd-backstage-post-renderer') as HTMLElement;
  unit.innerHTML = `
    <div id="content-text"><yt-attributed-string>${text}</yt-attributed-string></div>
    <a id="author-text" href="/@author">author</a>
    <a href="/post/${id}">post</a>
  `;
  return unit;
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetTikTokVideoDedupForTesting();
});

describe('platform adapters — chat overlay privacy boundary', () => {
  it('Facebook skips the private candidate before stamps and keeps its public sibling', () => {
    setLocation('www.facebook.com', '/');
    const publicUnit = facebookCandidate(PUBLIC_TEXT);
    const privateUnit = facebookCandidate(PRIVATE_TEXT);
    failOnTextRead(
      privateUnit,
      privateUnit.querySelector<HTMLElement>('[data-ad-rendering-role="story_message"]')!,
    );
    document.body.append(publicUnit, chatDialog(privateUnit));

    const posts = new FacebookAdapter().extractPosts(document.body.childNodes);

    expect(posts.map(post => post.text)).toEqual([PUBLIC_TEXT]);
    expect(publicUnit.dataset.fwProcessed).toBe('true');
    expect(privateUnit.dataset.fwProcessed).toBeUndefined();
    expect(privateUnit.dataset.fwPostId).toBeUndefined();
  });

  it('X skips the private candidate and keeps its public sibling', () => {
    setLocation('x.com', '/home');
    const publicArticle = twitterCandidate(PUBLIC_TEXT, '1001');
    const privateArticle = twitterCandidate(PRIVATE_TEXT, '1002');
    failOnTextRead(
      privateArticle,
      privateArticle.querySelector<HTMLElement>('[data-testid="tweetText"]')!,
    );
    document.body.append(publicArticle, chatDialog(privateArticle));

    const posts = new TwitterAdapter().extractPosts(document.body.childNodes);

    expect(posts.map(post => post.text)).toEqual([PUBLIC_TEXT]);
    expect(privateArticle.querySelector<HTMLElement>('[data-testid="tweetText"]')!
      .dataset.fwProcessed).toBeUndefined();
  });

  it('X-3: skips a role="log" chat-log candidate and keeps its public sibling', () => {
    // X-3 — the X adapter had no `role="log"` belt-and-suspenders exclusion,
    // relying solely on `findChatOverlayAncestor` (role="dialog"). A DM
    // message list rendered as [role="log"] (not a dialog) must still be
    // excluded from the candidate scan.
    setLocation('x.com', '/home');
    const publicArticle = twitterCandidate(PUBLIC_TEXT, '2001');
    const privateArticle = twitterCandidate(PRIVATE_TEXT, '2002');
    failOnTextRead(
      privateArticle,
      privateArticle.querySelector<HTMLElement>('[data-testid="tweetText"]')!,
    );
    document.body.append(publicArticle, chatLogSurface(privateArticle));

    const posts = new TwitterAdapter().extractPosts(document.body.childNodes);

    expect(posts.map(post => post.text)).toEqual([PUBLIC_TEXT]);
    expect(privateArticle.querySelector<HTMLElement>('[data-testid="tweetText"]')!
      .dataset.fwProcessed).toBeUndefined();
  });

  it('TikTok skips the private candidate before per-record stamps and keeps its public sibling', () => {
    setLocation('www.tiktok.com', '/');
    const publicUnit = tiktokCandidate(PUBLIC_TEXT);
    const privateUnit = tiktokCandidate(PRIVATE_TEXT);
    failOnTextRead(
      privateUnit,
      privateUnit.querySelector<HTMLElement>('[data-e2e="browse-video-desc"]')!,
      privateUnit.querySelector<HTMLElement>('[data-e2e="browse-video-desc"] span')!,
    );
    document.body.append(publicUnit, chatDialog(privateUnit));

    const posts = new TiktokAdapter().extractPosts(document.body.childNodes);

    expect(posts.map(post => post.text)).toEqual([PUBLIC_TEXT]);
    expect(publicUnit.dataset.fwCaptionEmitted).toBe('true');
    expect(privateUnit.dataset.fwCaptionEmitted).toBeUndefined();
  });

  it('Instagram skips the private candidate before stamps and keeps its public sibling', () => {
    setLocation('www.instagram.com', '/');
    const publicArticle = instagramCandidate(PUBLIC_TEXT);
    const privateArticle = instagramCandidate(PRIVATE_TEXT);
    failOnTextRead(privateArticle, ...privateArticle.querySelectorAll<HTMLElement>('span'));
    document.body.append(publicArticle, chatDialog(privateArticle));

    const posts = new InstagramAdapter().extractPosts(document.body.childNodes);

    expect(posts.map(post => post.text)).toEqual([PUBLIC_TEXT]);
    expect(publicArticle.dataset.fwCaptionEmitted).toBe('true');
    expect(privateArticle.dataset.fwCaptionEmitted).toBeUndefined();
  });

  it('Instagram permalink fallback skips chat text while extracting the public main surface', () => {
    setLocation('www.instagram.com', '/p/public-post-1/');
    const main = document.createElement('main');
    const publicCaption = document.createElement('span');
    publicCaption.setAttribute('dir', 'auto');
    publicCaption.textContent = PUBLIC_TEXT;
    const author = document.createElement('a');
    author.href = '/author/';
    author.textContent = 'author';
    const privateCaption = document.createElement('span');
    privateCaption.setAttribute('dir', 'auto');
    privateCaption.textContent = PRIVATE_TEXT;
    failOnTextRead(privateCaption);
    main.append(publicCaption, author, chatDialog(privateCaption));
    document.body.appendChild(main);

    const posts = new InstagramAdapter().extractPosts(document.body.childNodes);

    expect(posts.map(post => post.text)).toEqual([PUBLIC_TEXT]);
    expect(main.dataset.fwPermalinkPostId).toBe('public-post-1');
    expect(privateCaption.dataset.fwCommentSeen).toBeUndefined();
  });

  it('YouTube skips a community-shaped private candidate and keeps its public sibling', () => {
    setLocation('www.youtube.com', '/feed/trending');
    const publicUnit = youtubeCandidate(PUBLIC_TEXT, 'public-1');
    const privateUnit = youtubeCandidate(PRIVATE_TEXT, 'private-1');
    failOnTextRead(
      privateUnit,
      privateUnit.querySelector<HTMLElement>('#content-text')!,
      privateUnit.querySelector<HTMLElement>('yt-attributed-string')!,
    );
    document.body.append(publicUnit, chatDialog(privateUnit));

    const posts = new YoutubeAdapter().extractPosts(document.body.childNodes);

    expect(posts.map(post => post.text)).toEqual([PUBLIC_TEXT]);
    expect(publicUnit.dataset.fwProcessed).toBe('true');
    expect(privateUnit.dataset.fwProcessed).toBeUndefined();
  });
});
