// @vitest-environment jsdom
//
// M119 - Instagram shortcode/author coherence.
//
// The 2026-08-24 signed-chain export carried two `kind:'post'` groups where one
// Instagram shortcode was recorded under two DIFFERENT named authors, both
// members of a group sharing one `observedSequence`
// (docs/audits/2026-08-23-objective-audit/browse-2026-08-24-export-analysis.md,
// "Anomalies" item 2). `observedSequence` is memoised by `post.id`
// (src/content/record/impression-order.ts), so an identical sequence proves both
// records carried the SAME id while their authors disagreed - the author was
// read from a different card than the shortcode.
//
// Probe A is the DOM-slot-recycling hypothesis M66 fixed on Twitter. It does
// not reproduce here and is kept as the lock on why: the article path stamps
// `fwCaptionEmitted` per <article> node and never clears it, so a recycled slot
// emits at most one caption record. Probes B to F are the mechanisms that DO
// reproduce.
//
// EVERY identifier below is fabricated. The export that motivated this file is
// the owner's private browsing and its analysis document is deliberately
// untracked, so no real handle, shortcode or session id is reproduced here. The
// synthetic handles keep Instagram's `[a-zA-Z0-9_.]` grammar (with and without a
// dot) and the synthetic shortcodes keep the real 11-character
// `[A-Za-z0-9_-]` shape, so the extraction regexes are exercised identically.
import { describe, it, expect, beforeEach } from 'vitest';
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

/** Every named (non-`unknown`) author recorded against each shortcode. */
function namedAuthorsByShortcode(
  posts: { id: string; author: string }[],
): Map<string, Set<string>> {
  const byId = new Map<string, Set<string>>();
  for (const p of posts) {
    if (p.author === 'unknown') continue;
    if (!byId.has(p.id)) byId.set(p.id, new Set());
    byId.get(p.id)!.add(p.author);
  }
  return byId;
}

describe('M119 - a recycled feed slot cannot mint a second author (probe A)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setPath('/');
  });

  it('re-reading one article node after its content is swapped emits no second caption', () => {
    const adapter = new InstagramAdapter();
    const article = document.createElement('article');
    article.innerHTML = `
      <a href="/synth_poster_one/" role="link"><span>synth_poster_one</span></a>
      <a href="/p/FwSynthA-a1/"><time datetime="2026-08-19T10:00:00Z">1h</time></a>
      <span dir="auto">First caption, comfortably longer than the twenty character floor.</span>
    `;
    const first = adapter.extractPosts(nodesOf(article));

    // Slot recycles: header and caption are patched to a new post while the
    // permalink anchor still carries the previous shortcode.
    article.querySelector('a[role="link"]')!.setAttribute('href', '/synth_poster_two/');
    article.querySelector('a[role="link"] span')!.textContent = 'synth_poster_two';
    article.querySelector('span[dir="auto"]')!.textContent =
      'A completely different second caption, also longer than twenty characters.';
    const second = adapter.extractPosts(nodesOf(article));

    expect(second.filter(p => p.kind === 'post')).toHaveLength(0);
    for (const [, authors] of namedAuthorsByShortcode([...first, ...second])) {
      expect(authors.size).toBe(1);
    }
  });
});

describe('M119 - the author never comes from a comment row (probe B)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setPath('/');
  });

  it('a commenter is not named as the post author when the header link is absent', () => {
    const adapter = new InstagramAdapter();
    const article = document.createElement('article');
    article.innerHTML = `
      <a href="/p/FwSynthBbb2/"><time datetime="2026-08-19T10:00:00Z">1h</time></a>
      <span dir="auto">The real caption of this post, long enough to clear the floor.</span>
      <ul>
        <li><a href="/synth_poster_four/" role="link"><span>synth_poster_four</span></a><span dir="auto">nice one</span></li>
      </ul>
    `;
    const posts = adapter.extractPosts(nodesOf(article)).filter(p => p.kind === 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('FwSynthBbb2');
    expect(posts[0].author).toBe('unknown');
  });
});

describe('M119 - the shortcode never comes from a comment row (probe D)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setPath('/');
  });

  it('a post linked inside a preview comment does not become this card id', () => {
    const adapter = new InstagramAdapter();
    const article = document.createElement('article');
    // IG renders the comment preview above the card's own timestamp permalink,
    // so a post linked in a comment is the first /p/ anchor in document order.
    article.innerHTML = `
      <a href="/synth.poster.three/" role="link"><span>synth.poster.three</span></a>
      <span dir="auto">The card's own caption, long enough to clear the twenty char floor.</span>
      <ul>
        <li><a href="/viewer1/" role="link"><span>viewer1</span></a><span dir="auto">see <a href="/p/FwSynthIii9/">this</a></span></li>
      </ul>
      <a href="/p/FwSynthBbb2/"><time datetime="2026-08-19T10:00:00Z">1h</time></a>
    `;
    const posts = adapter.extractPosts(nodesOf(article)).filter(p => p.kind === 'post');
    expect(posts).toHaveLength(1);
    expect(posts[0].id).toBe('FwSynthBbb2');
    expect(posts[0].author).toBe('synth.poster.three');
    expect(posts[0].sourceUrl).toContain('/p/FwSynthBbb2/');
  });
});

describe('M119 - /p/ permalink read while main still holds the previous post (probe C)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function mountFirstPost(): HTMLElement {
    const main = document.createElement('main');
    main.innerHTML = `
      <a href="/synth.poster.three/" role="link"><span>synth.poster.three</span></a>
      <span dir="auto">Caption belonging to the FIRST permalink, long enough to qualify.</span>
      <div>
        <div><a href="/p/FwSynthCcc3/c/17900000000000001/">2 h</a><span dir="auto">a comment</span></div>
        <div><a href="/p/FwSynthCcc3/c/17900000000000002/">1 h</a><span dir="auto">another comment</span></div>
      </div>
    `;
    document.body.appendChild(main);
    return main;
  }

  it('does not attribute the new shortcode to the author still mounted from the previous post', () => {
    const adapter = new InstagramAdapter();
    mountFirstPost();

    setPath('/p/FwSynthCcc3/');
    const first = adapter.extractPosts(document.querySelectorAll('article'));

    // SPA route change: location updates first, main is still the old post.
    setPath('/p/FwSynthBbb2/');
    const stale = adapter.extractPosts(document.querySelectorAll('article'));

    expect(first.filter(p => p.kind === 'post').map(p => `${p.id}/${p.author}`))
      .toEqual(['FwSynthCcc3/synth.poster.three']);
    expect(stale.filter(p => p.kind === 'post')).toHaveLength(0);
  });

  it('refuses on the FIRST read too, when the mounted comments name another post (probe E)', () => {
    const adapter = new InstagramAdapter();
    mountFirstPost();

    // No prior snapshot for this main; only the mounted /c/ permalinks say the
    // DOM belongs to FwSynthCcc3 while the URL already says FwSynthBbb2.
    setPath('/p/FwSynthBbb2/');
    const all = adapter.extractPosts(document.querySelectorAll('article'));
    const posts = all.filter(p => p.kind === 'post');

    // Nothing has recorded this caption yet, so it stays protectable, but under
    // a synthetic local id, with no named author and no external URL.
    expect(posts).toHaveLength(1);
    expect(posts[0].id).not.toBe('FwSynthBbb2');
    expect(posts[0].author).toBe('unknown');
    expect(posts[0].sourceUrl).toBe('');
    expect(posts[0].parentVideoId).toBeUndefined();

    // The comment rows hang off the post their own /c/ permalinks name, never
    // off the URL shortcode this read cannot vouch for.
    const comments = all.filter(p => p.kind === 'top-comment');
    expect(comments.length).toBeGreaterThan(0);
    for (const c of comments) {
      expect(c.parent_id).toBe('FwSynthCcc3');
      expect(c.parentVideoId).toBe('FwSynthCcc3');
    }
  });

  it('still emits normally once main catches up with the route change', () => {
    const adapter = new InstagramAdapter();
    const main = mountFirstPost();

    setPath('/p/FwSynthCcc3/');
    adapter.extractPosts(document.querySelectorAll('article'));

    setPath('/p/FwSynthBbb2/');
    adapter.extractPosts(document.querySelectorAll('article'));

    // main re-renders to the second post.
    main.innerHTML = `
      <a href="/synth_poster_four/" role="link"><span>synth_poster_four</span></a>
      <span dir="auto">Caption belonging to the SECOND permalink, long enough to qualify.</span>
      <div>
        <div><a href="/p/FwSynthBbb2/c/17900000000000003/">2 h</a><span dir="auto">a comment</span></div>
        <div><a href="/p/FwSynthBbb2/c/17900000000000004/">1 h</a><span dir="auto">another comment</span></div>
      </div>
    `;
    const settled = adapter.extractPosts(document.querySelectorAll('article'))
      .filter(p => p.kind === 'post');

    expect(settled.map(p => `${p.id}/${p.author}`)).toEqual(['FwSynthBbb2/synth_poster_four']);
  });
});

describe('M119 - reel URL rotating ahead of its container (probe F)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not sign the next reel id with the reel still on screen', () => {
    const adapter = new InstagramAdapter();
    const main = document.createElement('main');
    const container = document.createElement('div');
    container.innerHTML = `
      <video></video>
      <a href="/synth.poster.three/"><span>synth.poster.three</span></a>
      <span dir="auto">First reel caption on this container.</span>
    `;
    main.appendChild(container);
    document.body.appendChild(main);

    setPath('/reels/FwSynthDdd4/');
    const first = adapter.extractPosts(document.querySelectorAll('article'));
    expect(first.map(p => `${p.id}/${p.author}`)).toEqual(['FwSynthDdd4/synth.poster.three']);

    // The URL rotates on scroll before the container swaps its content.
    setPath('/reels/FwSynthEee5/');
    const stale = adapter.extractPosts(document.querySelectorAll('article'));
    expect(stale).toHaveLength(0);

    // Container catches up: the second reel is recorded honestly.
    container.querySelector('a')!.setAttribute('href', '/synth_poster_four/');
    container.querySelector('a span')!.textContent = 'synth_poster_four';
    container.querySelector('span[dir="auto"]')!.textContent =
      'Second reel caption on this container.';
    const settled = adapter.extractPosts(document.querySelectorAll('article'));
    expect(settled.map(p => `${p.id}/${p.author}`)).toEqual(['FwSynthEee5/synth_poster_four']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// M123 - the tile-grid page owner must be established, not assumed.
//
// `_extractTileGridSurface` inferred the author of every /p/ tile from the URL
// whenever the path was a single segment absent from `RESERVED_IG_PATHS`. That
// set is an allowlist-by-omission over Instagram's single-segment routes, so any
// route Meta adds (or any the set never listed: saved, archive, topics, tv,
// igtv, locations, favourites, inbox, settings, notifications, your_activity,
// ai, about, legal, terms, qr, nametag, guide, s) is treated as a username, and
// every tile on that page is signed with the route word as its author. That is a
// signed, immutable record naming a person who does not exist.
//
// Measured on the owner's real logged-in Chrome, 2026-08-24: `/reels/`
// (`location.pathname === '/reels/'`) satisfies the single-segment predicate and
// is only saved by `reels` happening to be in the set.
// ─────────────────────────────────────────────────────────────────────────────

function makeTile(href: string, alt: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  const img = document.createElement('img');
  img.setAttribute('alt', alt);
  a.appendChild(img);
  return a;
}

/** A profile page whose header names its own account, as Instagram renders it. */
function mountProfilePage(handle: string, tileHref: string): void {
  const header = document.createElement('header');
  const selfLink = document.createElement('a');
  selfLink.setAttribute('href', `/${handle}/`);
  selfLink.textContent = handle;
  header.appendChild(selfLink);
  document.body.appendChild(header);

  const grid = document.createElement('main');
  grid.appendChild(makeTile(tileHref, 'A genuine human caption long enough to be classified.'));
  document.body.appendChild(grid);
}

// The M119 known-issues row names these two counters AS the live gate: the owner
// is meant to read them off a Copy Diagnostics paste to tell which mechanism
// produced the recorded conflicts. Counters are free-form strings with no
// central allowlist, so a silent rename would break that gate while every probe
// stayed green - verified 2026-08-24 by appending TYPO to both production string
// literals and watching 13 of 13 tests still pass. These lock the exact names,
// each isolated to the path that fires it, the way m98-photo-probe.test.ts does.
describe('M119 - the two counters fire under their exact published names', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    _resetDiagnosticsForTesting();
  });

  function mountPermalinkOfFirstPost(): void {
    const main = document.createElement('main');
    main.innerHTML = `
      <a href="/synth.poster.three/" role="link"><span>synth.poster.three</span></a>
      <span dir="auto">Caption belonging to the FIRST permalink, long enough to qualify.</span>
      <div>
        <div><a href="/p/FwSynthCcc3/c/17900000000000001/">2 h</a><span dir="auto">a comment</span></div>
        <div><a href="/p/FwSynthCcc3/c/17900000000000002/">1 h</a><span dir="auto">another comment</span></div>
      </div>
    `;
    document.body.appendChild(main);
  }

  function mountReelContainer(): HTMLElement {
    const main = document.createElement('main');
    const container = document.createElement('div');
    container.innerHTML = `
      <video></video>
      <a href="/synth.poster.three/"><span>synth.poster.three</span></a>
      <span dir="auto">First reel caption on this container.</span>
    `;
    main.appendChild(container);
    document.body.appendChild(main);
    return container;
  }

  it('probe E path bumps m119PermalinkCommentsNameAnotherPost, and only that one', () => {
    mountPermalinkOfFirstPost();
    setPath('/p/FwSynthBbb2/');
    new InstagramAdapter().extractPosts(document.querySelectorAll('article'));

    const counters = _getDiagnosticCountersForTesting();
    expect(counters.m119PermalinkCommentsNameAnotherPost).toBe(1);
    // First read of this main, so no snapshot exists to fall behind.
    expect(counters.m119ContainerFellBehind).toBeUndefined();
  });

  it('probe F path bumps m119ContainerFellBehind, and only that one', () => {
    mountReelContainer();
    setPath('/reels/FwSynthDdd4/');
    const adapter = new InstagramAdapter();
    adapter.extractPosts(document.querySelectorAll('article'));
    expect(_getDiagnosticCountersForTesting().m119ContainerFellBehind).toBeUndefined();

    // URL rotates ahead of the container.
    setPath('/reels/FwSynthEee5/');
    adapter.extractPosts(document.querySelectorAll('article'));

    const counters = _getDiagnosticCountersForTesting();
    expect(counters.m119ContainerFellBehind).toBe(1);
    // The reel path mounts no comment permalinks, so the other counter is silent.
    expect(counters.m119PermalinkCommentsNameAnotherPost).toBeUndefined();
  });

  it('probe C path bumps both, once each', () => {
    mountPermalinkOfFirstPost();
    const adapter = new InstagramAdapter();

    setPath('/p/FwSynthCcc3/');
    adapter.extractPosts(document.querySelectorAll('article'));
    // A coherent first read leaves both counters untouched.
    let counters = _getDiagnosticCountersForTesting();
    expect(counters.m119PermalinkCommentsNameAnotherPost).toBeUndefined();
    expect(counters.m119ContainerFellBehind).toBeUndefined();

    setPath('/p/FwSynthBbb2/');
    adapter.extractPosts(document.querySelectorAll('article'));

    counters = _getDiagnosticCountersForTesting();
    expect(counters.m119PermalinkCommentsNameAnotherPost).toBe(1);
    expect(counters.m119ContainerFellBehind).toBe(1);
  });
});

describe('M123 - a route word is never signed as a tile author', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('a single-segment route absent from the reserved set is not a person', () => {
    setPath('/saved/');
    const grid = document.createElement('main');
    // Saved posts are other people's posts; none of them is authored by "saved".
    grid.appendChild(makeTile('/p/FwSynthFff6/', 'Someone else post caption, long enough to classify.'));
    document.body.appendChild(grid);

    const posts = new InstagramAdapter().extractPosts(document.querySelectorAll('article'));
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('unknown');
  });

  it('a profile page that names its own account still stamps the owner', () => {
    setPath('/synth.poster.three/');
    mountProfilePage('synth.poster.three', '/p/FwSynthJjj0/');

    const posts = new InstagramAdapter().extractPosts(document.querySelectorAll('article'));
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('synth.poster.three');
  });

  it('a profile-shaped path the page never corroborates falls back to unknown', () => {
    setPath('/topics/');
    const grid = document.createElement('main');
    grid.appendChild(makeTile('/p/FwSynthGgg7/', 'A recommended post caption, long enough to classify.'));
    document.body.appendChild(grid);

    const posts = new InstagramAdapter().extractPosts(document.querySelectorAll('article'));
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('unknown');
  });

  // The counter name is the whole point of the instrument: the owner reads it
  // off a Copy Diagnostics paste, so a silent drift in the string makes the
  // probe unreadable without failing anything. Locked here the way
  // m98-photo-probe.test.ts locks its own names. This assertion did not exist
  // before the M120 to M123 renumber; nothing was checking these strings.
  it('bumps m123ProfileOwnerUncorroborated, by that exact name, when nothing corroborates', () => {
    _resetDiagnosticsForTesting();
    setPath('/topics/');
    const grid = document.createElement('main');
    grid.appendChild(makeTile('/p/FwSynthGgg7/', 'A recommended post caption, long enough to classify.'));
    document.body.appendChild(grid);

    const posts = new InstagramAdapter().extractPosts(document.querySelectorAll('article'));
    expect(posts[0].author).toBe('unknown');

    const counters = _getDiagnosticCountersForTesting();
    expect(counters.m123ProfileOwnerUncorroborated).toBe(1);
    expect(counters.m120ProfileOwnerUncorroborated).toBeUndefined();
  });

  it('leaves the counter alone when the page does corroborate the owner', () => {
    _resetDiagnosticsForTesting();
    setPath('/synth.poster.three/');
    mountProfilePage('synth.poster.three', '/p/FwSynthKkk1/');

    const posts = new InstagramAdapter().extractPosts(document.querySelectorAll('article'));
    expect(posts[0].author).toBe('synth.poster.three');
    expect(_getDiagnosticCountersForTesting().m123ProfileOwnerUncorroborated).toBeUndefined();
  });

  it('a site-navigation link to the route does not corroborate an owner', () => {
    setPath('/topics/');
    const nav = document.createElement('nav');
    const navLink = document.createElement('a');
    navLink.setAttribute('href', '/topics/');
    navLink.textContent = 'Topics';
    nav.appendChild(navLink);
    document.body.appendChild(nav);

    const grid = document.createElement('main');
    grid.appendChild(makeTile('/p/FwSynthHhh8/', 'Another recommended caption, long enough to classify.'));
    document.body.appendChild(grid);

    const posts = new InstagramAdapter().extractPosts(document.querySelectorAll('article'));
    expect(posts).toHaveLength(1);
    expect(posts[0].author).toBe('unknown');
  });
});
