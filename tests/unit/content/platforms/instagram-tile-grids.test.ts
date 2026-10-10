// @vitest-environment jsdom
// InstagramAdapter — tile-grid surfaces (/explore/, profile, /tagged/)
//
// Cut out of instagram-adapter.test.ts on 2026-09-16 (PLAN-2026-09-16 item 11.3).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { makeArticle, makeTile } from './instagram-page-fixtures';

describe('InstagramAdapter — tile-grid surfaces (/explore/, profile, /tagged/)', () => {
  let adapter: InstagramAdapter;

  beforeEach(() => {
    document.body.innerHTML = '';
    adapter = new InstagramAdapter();
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'www.instagram.com',
        pathname: '/explore/',
        href: 'https://www.instagram.com/explore/',
      },
      writable: true,
      configurable: true,
    });
  });

  it('emits one post record per tile with the img[alt] caption and /p/<id>/ URL', () => {
    const grid = document.createElement('div');
    grid.appendChild(
      makeTile('/p/SYNTHPOST01/', 'Synthetic post caption for grid extraction.'),
    );
    grid.appendChild(
      makeTile('/p/DXabc12345A/', 'Another genuine human caption that should be classified.'),
    );
    document.body.appendChild(grid);

    // extractPosts iterates the passed NodeList for <article>, finds none, then
    // the tile-grid dispatch fires document-scoped. Pass an empty NodeList of
    // articles to model the interceptor mutation on a grid (no <article>).
    const posts = adapter.extractPosts(document.querySelectorAll('article'));

    expect(posts).toHaveLength(2);
    expect(posts[0].kind).toBe('post');
    expect(posts[0].id).toBe('SYNTHPOST01');
    expect(posts[0].text).toContain('Synthetic post caption');
    expect(posts[0].sourceUrl).toBe('https://www.instagram.com/p/SYNTHPOST01/');
    expect(posts[1].id).toBe('DXabc12345A');
  });

  it('stamps the page owner as tile author on a PROFILE grid; explore stays unknown', () => {
    // On /username the grid's tiles all belong to that user (mirrors the
    // 2026-06-12 TikTok profile-author fix). /explore tiles stay 'unknown'.
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/synthetic.profile/', href: 'https://www.instagram.com/synthetic.profile/' },
      writable: true,
      configurable: true,
    });
    // M123: the owner is taken from the page, not from the URL, so the fixture
    // now carries the profile header's self-link that a real profile page has.
    // Both assertions below are unchanged.
    const profileHeader = document.createElement('header');
    const selfLink = document.createElement('a');
    selfLink.setAttribute('href', '/synthetic.profile/');
    selfLink.textContent = 'synthetic.profile';
    profileHeader.appendChild(selfLink);
    document.body.appendChild(profileHeader);
    const grid = document.createElement('div');
    grid.appendChild(makeTile('/p/DOwner11111/', 'A genuine human caption long enough to be classified.'));
    document.body.appendChild(grid);
    const posts = adapter.extractPosts(document.querySelectorAll('article'));
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('synthetic.profile');

    // Reserved top-level routes must NOT be treated as a profile owner.
    document.body.innerHTML = '';
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/explore/', href: 'https://www.instagram.com/explore/' },
      writable: true,
      configurable: true,
    });
    const grid2 = document.createElement('div');
    grid2.appendChild(makeTile('/p/DExplore111/', 'Another genuine human caption long enough to classify.'));
    document.body.appendChild(grid2);
    const posts2 = new InstagramAdapter().extractPosts(document.querySelectorAll('article'));
    expect(posts2).toHaveLength(1);
    expect(posts2[0].author).toBe('unknown');
  });

  it('skips tiles whose img[alt] is IG auto-generated (over-flag safety)', () => {
    const grid = document.createElement('div');
    grid.appendChild(makeTile('/p/DAAA1111111/', 'Photo by Jane Doe on May 21, 2026.'));
    grid.appendChild(makeTile('/p/DBBB2222222/', 'May be an image of one person and text.'));
    grid.appendChild(makeTile('/p/DCCC3333333/', 'Blue text on a black background.'));
    grid.appendChild(makeTile('/p/DDDD4444444/', 'No photo description available.'));
    grid.appendChild(makeTile('/p/DEEE5555555/', 'Reel by someone you might know.'));
    // One genuine caption mixed in — only this should emit.
    grid.appendChild(
      makeTile('/p/DFFF6666666/', 'A genuine human caption that carries real emotional content.'),
    );
    document.body.appendChild(grid);

    const posts = adapter.extractPosts(document.querySelectorAll('article'));

    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('DFFF6666666');
    expect(posts[0].text).toContain('genuine human caption');
  });

  it('classifies /reel/ tiles as kind video, /p/ tiles as kind post', () => {
    const grid = document.createElement('div');
    grid.appendChild(makeTile('/p/DPOST111111/', 'A post-tile caption long enough to be a real caption.'));
    grid.appendChild(makeTile('/reel/DREEL22222/', 'A reel-tile caption long enough to be a real caption.'));
    document.body.appendChild(grid);

    const posts = adapter.extractPosts(document.querySelectorAll('article'));

    const post = posts.find(p => p.id === 'DPOST111111');
    const reel = posts.find(p => p.id === 'DREEL22222');
    expect(post?.kind).toBe('post');
    expect(reel?.kind).toBe('video');
    expect(reel?.sourceUrl).toBe('https://www.instagram.com/reel/DREEL22222/');
    expect(reel?.platform_specific?.platform).toBe('instagram');
    expect((reel?.platform_specific as { surfaceKind?: string })?.surfaceKind).toBe('instagram-reel');
  });

  it('skips tiles with no img[alt] at all', () => {
    const grid = document.createElement('div');
    grid.appendChild(makeTile('/p/DNOIMG11111/', null));
    document.body.appendChild(grid);

    const posts = adapter.extractPosts(document.querySelectorAll('article'));
    expect(posts).toHaveLength(0);
  });

  it('re-emits each tile exactly once across incremental grid loads (per-tile dedup)', () => {
    const grid = document.createElement('div');
    grid.appendChild(makeTile('/p/DTILE111111/', 'First tile caption with enough real human text.'));
    document.body.appendChild(grid);

    const first = adapter.extractPosts(document.querySelectorAll('article'));
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe('DTILE111111');

    // Explore appends a new tile as the user scrolls; interceptor re-invokes.
    grid.appendChild(makeTile('/p/DTILE222222/', 'Second tile caption lazy-loaded after the first scan.'));

    const second = adapter.extractPosts(document.querySelectorAll('article'));
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe('DTILE222222');
  });

  it('does not fire on the home feed (article-based surface unaffected)', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.instagram.com', pathname: '/' },
      writable: true,
      configurable: true,
    });
    // A home-feed article plus a stray /p/ tile link (e.g. a "suggested post"
    // thumbnail). The tile-grid dispatch must NOT fire on `/`, so only the
    // article caption is emitted — the stray tile is left alone.
    const article = makeArticle(`
      <a href="/p/DHOME111111/" role="link">View</a>
      <span dir="auto">Home feed caption that is long enough to be extracted by the article path.</span>
    `);
    document.body.appendChild(article);

    const posts = adapter.extractPosts(document.querySelectorAll('article'));
    expect(posts.filter(p => p.kind === 'post')).toHaveLength(1);
    expect(posts[0].text).toContain('Home feed caption');
  });

  it('does not fire on a /p/<id>/ permalink (permalink path unaffected)', () => {
    Object.defineProperty(window, 'location', {
      value: {
        hostname: 'www.instagram.com',
        pathname: '/p/SYNTHPOST01/',
        href: 'https://www.instagram.com/p/SYNTHPOST01/',
      },
      writable: true,
      configurable: true,
    });
    // isInstagramTileGridSurface() returns false for /p/ — the permalink
    // extractor owns this surface. With no permalink content in the DOM,
    // nothing is emitted, and the tile dispatch must not pick up the (absent)
    // grid links.
    const grid = document.createElement('div');
    grid.appendChild(makeTile('/p/DSTRAY11111/', 'A related-post thumbnail caption on the permalink page.'));
    document.body.appendChild(grid);

    const posts = adapter.extractPosts(document.querySelectorAll('article'));
    expect(posts).toHaveLength(0);
  });
});
