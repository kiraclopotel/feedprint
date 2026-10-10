// @vitest-environment jsdom
//
// POC test (2026-05-24, branch audit/dom-mechanism-poc) — section-model
// chip finder. Pure platform-agnostic finder that targets count CHIPS
// without per-platform branching.
//
// Critical assertions (the bugs this is replacing):
//   1. Finds the FB feed "<div role=button><span>4 comments</span></div>"
//      shape — failure mode of the structural-finder on FB main feed.
//   2. SKIPS the FB Reels "<div role=button aria-label=Like><div><svg/>
//      <span>83K</span></div></div>" inner wrapper — failure mode of
//      the structural-finder on FB Reels (over-hide).
//   3. Finds aria-labeled reaction-toolbar chips on FB modal.
//   4. Finds Romanian counts ("194 comentarii").
//   5. SKIPS pure action buttons ("Like" with no digit).
//
// Runs in isolation — does not depend on structural-finder or any
// platform module.

import { describe, it, expect, beforeEach } from 'vitest';
import { findCountChips } from '../../../../src/content/engagement/section-model';

function div(role?: string, ariaLabel?: string): HTMLDivElement {
  const el = document.createElement('div');
  if (role) el.setAttribute('role', role);
  if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
  return el;
}

function span(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.textContent = text;
  return el;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('findCountChips — POC', () => {
  it('finds the FB feed "4 comments" small-wrapper shape', () => {
    // <div role="button"><span>4 comments</span></div>
    const wrapper = div('button');
    wrapper.appendChild(span('4 comments'));
    document.body.appendChild(wrapper);

    const chips = findCountChips(document.body);

    expect(chips.length).toBeGreaterThanOrEqual(1);
    // The inner span is the leaf chip; the wrapper has no direct text but
    // also no aria-label, so it isn't a Pass-1 hit. The span IS a Pass-2
    // hit (small leaf, direct text matches digit + noun, no interactive
    // ancestor with non-metric label).
    expect(chips).toContain(wrapper.firstElementChild);
  });

  it('finds a Romanian "194 comentarii" anchor', () => {
    const a = document.createElement('a');
    a.textContent = '194 comentarii';
    document.body.appendChild(a);

    const chips = findCountChips(document.body);

    expect(chips).toContain(a);
  });

  it('finds an aria-labeled reaction toolbar ("View all 1.2K reactions")', () => {
    const toolbar = div('toolbar', 'View all 1.2K reactions');
    document.body.appendChild(toolbar);

    const chips = findCountChips(document.body);

    expect(chips).toContain(toolbar);
  });

  it('SKIPS the FB Reels Like inner wrapper ("83K" inside aria=Like)', () => {
    // <div role="button" aria-label="Like">
    //   <div>                              <- inner wrapper (test target)
    //     <svg></svg>
    //     <span>83K</span>
    //   </div>
    // </div>
    const outer = div('button', 'Like');
    const inner = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    inner.appendChild(svg);
    const countSpan = span('83K');
    inner.appendChild(countSpan);
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const chips = findCountChips(document.body);

    // The inner span "83K" has an interactive ancestor (outer) whose
    // aria-label "Like" is non-metric → ancestor-guard skips it.
    expect(chips).not.toContain(countSpan);
    expect(chips).not.toContain(inner);
    expect(chips).not.toContain(outer);
  });

  it('SKIPS a Comment button interior ("596" inside aria=Comment)', () => {
    const outer = div('button', 'Comment');
    const inner = document.createElement('div');
    const countSpan = span('596');
    inner.appendChild(countSpan);
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(countSpan);
  });

  it('SKIPS a pure action button ("Like" with no digit)', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', 'Like');
    btn.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(btn);
  });

  it('still finds a standalone "4 comments" chip whose parent is role=button (no aria)', () => {
    // FB main feed shape: the COUNT chip itself is the role=button, with
    // empty aria-label. Walking up from the inner span, the ancestor IS
    // interactive but has no aria → guard does not fire. Pass 2 catches
    // the inner span; Pass 2 also catches the chip via its own aria-name
    // fallback (textContent slice).
    const chip = div('button');
    const inner = span('4 comments');
    chip.appendChild(inner);
    document.body.appendChild(chip);

    const chips = findCountChips(document.body);

    expect(chips).toContain(inner);
  });

  it('SKIPS a long post-body span that mentions a count incidentally', () => {
    const s = span('50 things you should know about how comments shape culture today');
    document.body.appendChild(s);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(s);
  });

  it('SKIPS elements inside [data-fw-essential] (FW own UI)', () => {
    const wrap = document.createElement('div');
    wrap.setAttribute('data-fw-essential', 'true');
    const insideCount = span('108');
    wrap.appendChild(insideCount);
    document.body.appendChild(wrap);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(insideCount);
  });

  it('finds an IG bare-count button ("209" pure numeric, no aria-label)', () => {
    // Probed live 2026-05-24 on instagram.com/ home feed: zost.memes post
    // action region contains `<button>209</button>` between the Comment and
    // Repost buttons. No aria-label; direct text is just the number.
    const btn = document.createElement('button');
    btn.textContent = '209';
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).toContain(btn);
  });

  it('finds an IG bare-count button ("1.4K" K-suffixed numeric)', () => {
    // Same surface, uncrustamemes post: `<button>1.4K</button>` for the
    // repost count.
    const btn = document.createElement('button');
    btn.textContent = '1.4K';
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).toContain(btn);
  });

  it('SKIPS an X action button labeled "642 Likes. Like" (action verb at end)', () => {
    // Probed live 2026-05-24 on x.com/home: every action button has
    // aria-label of shape "<count> <noun>. <action-verb>". Pass 1 used
    // to tag the whole button via aria-name regex match, hiding the
    // Like action. Refinement: Pass 1 skips buttons; Pass 2 broadened
    // to buttons but only pure-numeric, so the metric-noun label here
    // doesn't qualify the button itself for tagging.
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', '642 Likes. Like');
    // X renders the visible count in an inner span; this stays catch-able
    // by Pass 2 via its own direct-text "642". Ancestor-guard passes
    // because the parent button's label IS metric (matches regex).
    const innerCount = span('642');
    btn.appendChild(innerCount);
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(btn);
    expect(chips).toContain(innerCount);
  });

  it('SKIPS an X reply action button labeled "39 Replies. Reply"', () => {
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', '39 Replies. Reply');
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(btn);
  });

  it('SKIPS an X Reply button with aria="42 Replies. Reply" and direct numeric text "42"', () => {
    // Probed live 2026-05-24 on x.com/home: some X action buttons have
    // the count as direct text of the button itself (no inner span). The
    // button: <button aria-label="42 Replies. Reply">42</button>. Pass 2's
    // pure-numeric branch was tagging the button → display:none → button
    // collapsed → entire row appeared empty even though section-model's
    // children-count gate kept the role="group" wrapper visible.
    //
    // Fix: Pass 2 skips buttons that have a non-empty aria-label. An
    // aria-labeled button is an action button (X pattern); its count
    // should be hidden via inner-span tagging if a span exists, or left
    // visible if the count is direct text (twitter-engagement.ts handles
    // that case via its span-only visibility:hidden sweep).
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', '42 Replies. Reply');
    btn.setAttribute('data-testid', 'reply');
    btn.textContent = '42';
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(btn);
  });

  it('SKIPS an X Like button with aria + inner span, but TAGS the inner span "23K"', () => {
    // The other X button structure: count is in an inner <span>. We want
    // to hide the span (count) but leave the button (action) visible.
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', '23000 Likes. Like');
    btn.setAttribute('data-testid', 'like');
    const innerCount = span('23K');
    btn.appendChild(innerCount);
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(btn);
    expect(chips).toContain(innerCount);
  });

  it('SKIPS an X engagement-row wrapper "1.8K replies, 2.7K reposts, 23K likes, 10M views" (multi-button container)', () => {
    // Probed live 2026-05-24 on x.com/home: every post's engagement row is
    // wrapped in <div role="group" aria-label="<compound counts>"> with 6
    // button children (reply, retweet, like, view, bookmark, share). The
    // compound aria-label matches the metric-noun regex, so without the
    // children-count gate, Pass 1 tagged the wrapper → display:none on the
    // entire engagement row → all 6 buttons disappear.
    //
    // The children-count gate (<=1) preserves leaf chip detection while
    // refusing to tag multi-child containers.
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'group');
    wrapper.setAttribute(
      'aria-label',
      '1.8K replies, 2.7K reposts, 23K likes, 1234 bookmarks, 10M views',
    );
    for (let i = 0; i < 6; i++) {
      const child = document.createElement('button');
      child.setAttribute('data-testid', `action-${i}`);
      wrapper.appendChild(child);
    }
    document.body.appendChild(wrapper);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(wrapper);
  });

  it('still tags an X view-count link "381953 views. View post analytics"', () => {
    // X view-count is an <a> tag (not a button), so Pass 1 IS allowed to
    // tag it. The link wraps both the formatted count and the
    // click-to-analytics affordance as one unit — hiding the link is
    // acceptable, matches the user's intent of hiding view counts.
    const a = document.createElement('a');
    a.setAttribute('aria-label', '381953 views. View post analytics');
    a.setAttribute('href', '/analytics');
    document.body.appendChild(a);

    const chips = findCountChips(document.body);

    expect(chips).toContain(a);
  });

  it('finds an X repost-style count inside a leaf <div> ("42") nested under an aria-labeled button', () => {
    // Probed live 2026-05-24 on x.com/home: small repost counts render
    // as <button aria-label="42 reposts. Repost"><div>...<div>42</div>
    // ...</div></button>. The a11y tree collapses everything inside the
    // button into the accessible name, but the visible "42" is a leaf
    // div. Pass 2's prior selector (span/a/strong/b/bdi) missed it.
    // The div extension with strict 0-children gate catches leaf divs
    // without over-firing on FB's div-heavy DOM.
    const btn = document.createElement('button');
    btn.setAttribute('aria-label', '42 reposts. Repost');
    btn.setAttribute('data-testid', 'retweet');
    const wrapper = document.createElement('div');
    const inner = document.createElement('div');
    inner.textContent = '42';
    wrapper.appendChild(inner);
    btn.appendChild(wrapper);
    document.body.appendChild(btn);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(btn);
    expect(chips).not.toContain(wrapper);
    expect(chips).toContain(inner);
  });

  it('does NOT catch a leaf div that contains text but no numeric count', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello';
    document.body.appendChild(div);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(div);
  });

  it('does NOT catch a non-leaf div container (skip via 0-children gate)', () => {
    const outer = document.createElement('div');
    const inner = document.createElement('span');
    inner.textContent = 'something';
    outer.appendChild(inner);
    document.body.appendChild(outer);

    const chips = findCountChips(document.body);

    expect(chips).not.toContain(outer);
  });

  it('platform-agnosticism — same shape works under any container', () => {
    // Wrap the FB-feed pattern in three different platform-style roots:
    // article (IG), div[role="article"] (FB), div[data-pagelet="X"] (FB).
    // The finder should hit all three identically — no per-platform code.
    const a1 = document.createElement('article');
    a1.appendChild(span('108'));
    const a2 = document.createElement('div');
    a2.setAttribute('role', 'article');
    a2.appendChild(span('42'));
    const a3 = document.createElement('div');
    a3.setAttribute('data-pagelet', 'FeedUnit_5');
    a3.appendChild(span('1.5K'));
    document.body.append(a1, a2, a3);

    const chips = findCountChips(document.body);

    expect(chips).toContain(a1.firstElementChild);
    expect(chips).toContain(a2.firstElementChild);
    expect(chips).toContain(a3.firstElementChild);
  });
});
