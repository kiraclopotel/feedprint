// @vitest-environment jsdom
//
// The notice must never outlive the hide it describes.
//
// Live test, 2026-08-02, X post detail view: "FeelingWise hid this post · show
// anyway" rendered over a fully readable post, and the post had NOT been
// hidden in the feed. The notice is mounted as a SIBLING of the post
// container, so nothing tied its lifetime to whether the post was actually
// hidden — and the hard-hide path is the only injection path in injector.ts
// with no MutationObserver guard, while the rewrite path has had one since the
// X virtual-scroll fix. A platform re-render that restored the post left the
// notice behind, still claiming a hide that had been undone.
//
// On this product's trust surface that is not cosmetic: the whole claim is
// that it never says more than happened.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { injectHardHide, type HardHideRevealOpts } from '../../../src/content/injector';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../src/diagnostics/diagnostics';

function makeXPost(): { article: HTMLElement; text: HTMLElement } {
  const article = document.createElement('article');
  article.setAttribute('role', 'article');
  const text = document.createElement('div');
  text.setAttribute('data-testid', 'tweetText');
  text.textContent = 'threat post text';
  article.append(text);
  document.body.appendChild(article);
  return { article, text };
}

function opts(over: Partial<HardHideRevealOpts> = {}): HardHideRevealOpts {
  return {
    noticeText: 'FeelingWise hid this post',
    showLabel: 'show anyway',
    hideLabel: 'hide again',
    ...over,
  };
}

const noticeIn = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-fw-hide-notice="true"]');

/** MutationObserver callbacks are microtasks; let them drain. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  _resetDiagnosticsForTesting();
});

describe('a hide notice may not outlive its hide', () => {
  it('leaves a genuinely hidden post alone', async () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();
    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(noticeIn(document.body)).not.toBeNull();
  });

  it('re-asserts the hide when the platform restores the post', async () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();

    // What X's React layer does on a re-render of the focal post.
    article.style.removeProperty('display');
    await settle();

    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(article.style.getPropertyPriority('display')).toBe('important');
    expect(noticeIn(document.body)).not.toBeNull();
    expect(_getDiagnosticCountersForTesting().hardHideReasserted).toBeGreaterThan(0);
  });

  it('withdraws the notice once the hide cannot be kept — it stops claiming what it cannot do', async () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();

    // A renderer that wins every time. Bounded at three re-asserts, then the
    // claim is taken off the screen rather than left standing over a readable
    // post — which is exactly the state the 2026-08-02 test screenshotted.
    for (let i = 0; i < 6; i++) {
      article.style.removeProperty('display');
      await settle();
    }

    expect(noticeIn(document.body)).toBeNull();
    expect(_getDiagnosticCountersForTesting().hardHideNoticeWithdrawn).toBe(1);
  });

  it('never touches a post the user chose to reveal', async () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();
    const button = noticeIn(document.body)!.querySelector('button')!;

    button.click();
    await settle();
    await settle();

    // Visible post under a notice reading "hide again" is the one CORRECT
    // version of this state, and the guard must not fight the user for it.
    expect(article.style.getPropertyValue('display')).not.toBe('none');
    expect(noticeIn(document.body)).not.toBeNull();
    expect(button.textContent).toBe('hide again');
    expect(_getDiagnosticCountersForTesting().hardHideNoticeWithdrawn).toBeUndefined();
  });

  it('removes the notice when the platform swaps the post node out entirely', async () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();

    article.remove();
    await settle();

    expect(noticeIn(document.body)).toBeNull();
  });

  it('M97: a REVEALED post\'s notice is still removed when its container leaves the DOM', async () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();
    noticeIn(document.body)!.querySelector('button')!.click();
    await settle();

    // The old guard returned early on the revealed state BEFORE its
    // disconnection cleanup, so an unmounted revealed post left its chip
    // floating anchorless forever.
    article.remove();
    await settle();

    expect(noticeIn(document.body)).toBeNull();
  });

  it('M96: the notice is opaque — underlying content can never read through it', async () => {
    const { text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();

    const notice = noticeIn(document.body)!;
    expect(notice.style.background).not.toBe('');
    expect(notice.style.background).not.toBe('transparent');
  });

  it('M97: a stale reveal attribute on a recycled element does not exempt a NEW post from its hide', async () => {
    const { article, text } = makeXPost();
    // Another post's leftovers: X recycled an element the user once revealed.
    article.setAttribute('data-fw-user-revealed', 'true');
    // THIS post was never revealed (initiallyRevealed is absent/false).
    injectHardHide(text, 'twitter', opts());
    await settle();

    expect(article.style.getPropertyValue('display')).toBe('none');
    expect(article.getAttribute('data-fw-user-revealed')).toBeNull();
    expect(noticeIn(document.body)!.querySelector('button')!.textContent).toBe('show anyway');
  });

  it('M97: with no reveal affordance at all (Child), a stale attribute still hides', async () => {
    const { article, text } = makeXPost();
    article.setAttribute('data-fw-user-revealed', 'true');
    expect(injectHardHide(text, 'twitter')).toBe(true);
    await settle();
    expect(article.style.getPropertyValue('display')).toBe('none');
  });

  it('M97: a genuine replayed reveal is still honored on an attribute-carrying element', async () => {
    const { article, text } = makeXPost();
    article.setAttribute('data-fw-user-revealed', 'true');
    injectHardHide(text, 'twitter', opts({ initiallyRevealed: true }));
    await settle();

    expect(article.style.getPropertyValue('display')).not.toBe('none');
    expect(noticeIn(document.body)!.querySelector('button')!.textContent).toBe('hide again');
  });

  it('M97: spaced-out defeats never exhaust the reassert budget — only a rapid fight withdraws', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { article, text } = makeXPost();
      injectHardHide(text, 'twitter', opts());
      await settle();

      // Five defeats, each well outside the rapid-fight window: five separate
      // incidents, each won. The old cumulative budget withdrew at the 4th.
      for (let i = 0; i < 5; i++) {
        vi.setSystemTime(Date.now() + 30_000);
        article.style.removeProperty('display');
        await settle();
        expect(article.style.getPropertyValue('display')).toBe('none');
      }
      expect(noticeIn(document.body)).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('mounts exactly one notice even when the platform inserts a node between', async () => {
    const { article, text } = makeXPost();
    injectHardHide(text, 'twitter', opts());
    await settle();

    // The old dedup check read `container.previousElementSibling`, so anything
    // the platform put in between let a second notice mount.
    article.before(document.createElement('div'));
    injectHardHide(text, 'twitter', opts());
    await settle();

    expect(document.querySelectorAll('[data-fw-hide-notice="true"]').length).toBe(1);
  });
});
