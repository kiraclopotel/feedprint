// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildProtectionManager } from '../../../../src/content/protection/child-first-protection';

type Item = {
  id: string;
  text: string;
  platform?: 'twitter' | 'instagram' | 'facebook';
  kind?: 'post' | 'comment' | 'top-comment' | 'reply' | 'reply-to-reply';
  domRef: WeakRef<HTMLElement>;
};

function item(id = 'p1'): { item: Item; element: HTMLElement } {
  const element = document.createElement('article');
  element.textContent = 'original';
  document.body.appendChild(element);
  return { item: { id, text: 'original', domRef: new WeakRef(element) }, element };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('Child first protection manager', () => {
  it('mounts protection before enqueue in Child mode', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    let coveredAtEnqueue = false;

    manager.protectThen(target.item, () => {
      coveredAtEnqueue = !!target.element.querySelector('.fw-provisional-shield');
    });

    expect(coveredAtEnqueue).toBe(true);
    manager.release(target.item);
  });

  it.each(['teen', 'adult'] as const)('does not mutate %s content', mode => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode(mode);
    const target = item();

    manager.protectThen(target.item, () => undefined);

    expect(target.element.innerHTML).toBe('original');
    expect(target.element.hasAttribute('aria-busy')).toBe(false);
  });

  it('releases all active covers when leaving Child mode', () => {
    const terminal = vi.fn();
    const manager = new ChildProtectionManager<Item>(undefined, terminal);
    manager.setMode('child');
    const first = item('a');
    const second = item('b');
    manager.protect(first.item);
    manager.protect(second.item);

    manager.setMode('adult');

    expect(first.element.querySelector('.fw-provisional-shield')).toBeNull();
    expect(second.element.querySelector('.fw-provisional-shield')).toBeNull();
    expect(terminal).toHaveBeenCalledTimes(2);
    expect(terminal).toHaveBeenCalledWith(first.item, expect.any(Number));
    expect(terminal).toHaveBeenCalledWith(second.item, expect.any(Number));
  });

  it('prunes the old manager entry after a same-host route owner replaces it', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const first = item('same-post');
    manager.protect(first.item);
    const replacement: Item = {
      ...first.item,
      domRef: new WeakRef(first.element),
    };

    manager.protect(replacement);

    expect(manager.activeCount).toBe(1);
    manager.release(first.item);
    expect(first.element.querySelector('.fw-provisional-shield')).not.toBeNull();
    manager.release(replacement);
    expect(manager.activeCount).toBe(0);
  });

  it('prunes a disconnected pending owner when the next item is protected', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const detached = item('detached');
    manager.protect(detached.item);
    detached.element.remove();

    const current = item('current');
    manager.protect(current.item);

    expect(manager.activeCount).toBe(1);
    manager.release(current.item);
    expect(manager.activeCount).toBe(0);
  });

  it('does not suppress a pending verdict after the mode changes out of Child', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    manager.setMode('teen');

    expect(manager.prepareMutation(target.item)).toBe(true);
  });

  it('releases protection when enqueue throws', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();

    expect(() => manager.protectThen(target.item, () => { throw new Error('enqueue failed'); })).toThrow('enqueue failed');

    expect(target.element.querySelector('.fw-provisional-shield')).toBeNull();
    expect(target.element.hasAttribute('aria-busy')).toBe(false);
  });

  it('releases protection synchronously when admission rejects the item', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();

    manager.protectThen(target.item, () => false);

    expect(target.element.querySelector('.fw-provisional-shield')).toBeNull();
    expect(target.element.hasAttribute('aria-busy')).toBe(false);
  });

  it('permits settlement after a verified final mutation changes the text', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    expect(manager.prepareMutation(target.item)).toBe(true);
    target.element.firstChild!.textContent = 'safe replacement';
    manager.release(target.item);

    expect(target.element.textContent).toBe('safe replacement');
    expect(target.element.querySelector('.fw-provisional-shield')).toBeNull();
    expect(target.element.hasAttribute('aria-busy')).toBe(false);
    expect(target.element.style.position).toBe('');
  });

  it('allows a verdict after unrelated live text changes while the post text remains', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);
    target.element.append(' 2 likes');

    expect(manager.prepareMutation(target.item)).toBe(true);
    manager.release(target.item);
    expect(target.element.querySelector('.fw-provisional-shield')).toBeNull();
  });

  it('moves a Child cover to an exact recovered comment anchor before mutation', () => {
    const oldWrapper = document.createElement('div');
    oldWrapper.setAttribute('role', 'article');
    oldWrapper.setAttribute('aria-label', 'Comment by Alice');
    const oldBody = document.createElement('div');
    oldBody.textContent = 'exact harmful comment';
    oldWrapper.appendChild(oldBody);
    document.body.appendChild(oldWrapper);
    const post: Item = {
      id: 'facebook-comment',
      text: 'exact harmful comment',
      platform: 'facebook',
      kind: 'comment',
      domRef: new WeakRef(oldBody),
    };
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    manager.protect(post);

    const newWrapper = document.createElement('div');
    newWrapper.setAttribute('role', 'article');
    newWrapper.setAttribute('aria-label', 'Comment by Alice');
    const newBody = document.createElement('div');
    newBody.textContent = post.text;
    newWrapper.appendChild(newBody);
    oldWrapper.replaceWith(newWrapper);

    expect(manager.prepareMutation(post, newBody)).toBe(true);
    expect(newWrapper.querySelector('.fw-provisional-shield')).not.toBeNull();
    manager.commit(post);
    expect(manager.activeCount).toBe(0);
    expect(newWrapper.querySelector('.fw-provisional-shield')).toBeNull();
  });

  it('keeps recycled connected content covered until its replacement owner settles', () => {
    const element = document.createElement('article');
    element.textContent = 'first content';
    element.dataset.fwProcessed = 'true';
    document.body.appendChild(element);
    const first: Item = {
      id: 'same-id', text: 'first content', platform: 'twitter', kind: 'post', domRef: new WeakRef(element),
    };
    const replacement: Item = {
      id: 'same-id', text: 'replacement content', platform: 'twitter', kind: 'post', domRef: new WeakRef(element),
    };
    let manager!: ChildProtectionManager<Item>;
    let oldMutationRejected = false;
    const rearm = (post: Item, anchor: HTMLElement): void => {
      expect(post).toBe(first);
      delete anchor.dataset.fwProcessed;
      manager.protect(replacement);
      oldMutationRejected = !manager.prepareMutation(first);
    };
    manager = new ChildProtectionManager<Item>(rearm);
    manager.setMode('child');
    manager.protect(first);

    element.firstChild!.textContent = 'replacement content';
    manager.release(first);

    expect(element.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(element.dataset.fwProcessed).toBeUndefined();
    expect(oldMutationRejected).toBe(true);
    expect(manager.prepareMutation(replacement)).toBe(true);
    manager.release(replacement);
    expect(element.querySelector('.fw-provisional-shield')).toBeNull();
  });

  it.each(['same caption', ''])(
    'invalidates an old owner when a recycled host gets a new post id (%s)',
    (text) => {
      const manager = new ChildProtectionManager<Item>();
      manager.setMode('child');
      const element = document.createElement('article');
      element.textContent = text;
      document.body.appendChild(element);
      const first: Item = { id: 'post-a', text, platform: 'twitter', kind: 'post', domRef: new WeakRef(element) };
      const second: Item = { id: 'post-b', text, platform: 'twitter', kind: 'post', domRef: new WeakRef(element) };
      manager.protect(first);

      const secondHandle = manager.protect(second);

      expect(manager.prepareMutation(first)).toBe(false);
      expect(secondHandle).not.toBeNull();
      expect(manager.prepareMutation(second)).toBe(true);
      manager.release(first);
      expect(manager.activeCount).toBe(1);
      manager.release(second);
      expect(manager.activeCount).toBe(0);
    },
  );

  it('covers an Instagram grid tile host instead of appending into its img anchor', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const tile = document.createElement('a');
    tile.href = '/p/GRID123/';
    const image = document.createElement('img');
    image.alt = 'grid caption';
    tile.appendChild(image);
    document.body.appendChild(tile);
    const post: Item = {
      id: 'GRID123', text: 'grid caption', platform: 'instagram', kind: 'post', domRef: new WeakRef(image),
    };

    const handle = manager.protect(post);

    expect(handle?.element).toBe(tile);
    expect(tile.querySelector(':scope > .fw-provisional-shield')).not.toBeNull();
    expect(image.querySelector('.fw-provisional-shield')).toBeNull();
    expect(manager.prepareMutation(post)).toBe(true);
    manager.release(post);
  });

  it('covers an Instagram comment row instead of only its inline body span', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const row = document.createElement('div');
    row.dataset.fwCommentRow = 'true';
    const body = document.createElement('span');
    body.textContent = 'comment body';
    row.appendChild(body);
    document.body.appendChild(row);
    const post: Item = {
      id: 'ig-cmt-1', text: 'comment body', platform: 'instagram', kind: 'top-comment', domRef: new WeakRef(body),
    };

    const handle = manager.protect(post);

    expect(handle?.element).toBe(row);
    expect(row.querySelector(':scope > .fw-provisional-shield')).not.toBeNull();
    manager.release(post);
  });

  it('rejects an old mutation anchor replaced inside a still-connected row', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const row = document.createElement('div');
    row.dataset.fwCommentRow = 'true';
    const oldBody = document.createElement('span');
    oldBody.textContent = 'same comment';
    row.appendChild(oldBody);
    document.body.appendChild(row);
    const post: Item = {
      id: 'ig-cmt-stale', text: 'same comment', platform: 'instagram', kind: 'top-comment', domRef: new WeakRef(oldBody),
    };
    manager.protect(post);
    const replacement = document.createElement('span');
    replacement.textContent = 'same comment';
    oldBody.replaceWith(replacement);

    expect(manager.prepareMutation(post)).toBe(false);
    manager.release(post);
    expect(row.querySelector('.fw-provisional-shield')).toBeNull();
  });

  it('releases an empty same-post card when its stable DOM identity survives media hydration', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const row = document.createElement('article');
    row.dataset.postId = 'stable-empty';
    const video = document.createElement('video');
    video.src = 'blob:placeholder';
    row.appendChild(video);
    document.body.appendChild(row);
    const post: Item = {
      id: 'stable-empty', text: '', platform: 'twitter', kind: 'post', domRef: new WeakRef(row),
    };
    manager.protect(post);

    video.src = 'blob:hydrated';
    manager.release(post);

    expect(row.querySelector('.fw-provisional-shield')).toBeNull();
    expect(video.muted).toBe(false);
  });

  it('covers the outer TikTok comment wrapper when the anchor is an inline body span', () => {
    const manager = new ChildProtectionManager<{
      id: string; text: string; platform: 'tiktok'; kind: 'top-comment'; domRef: WeakRef<HTMLElement>;
    }>();
    manager.setMode('child');
    const row = document.createElement('div');
    row.className = 'css-abc-DivCommentItemWrapper';
    const body = document.createElement('span');
    body.dataset.e2e = 'comment-level-1';
    body.textContent = 'tiktok comment';
    row.appendChild(body);
    document.body.appendChild(row);
    const post = {
      id: 'tk-cmt-1', text: 'tiktok comment', platform: 'tiktok' as const,
      kind: 'top-comment' as const, domRef: new WeakRef(body),
    };

    const handle = manager.protect(post);

    expect(handle?.element).toBe(row);
    expect(row.querySelector(':scope > .fw-provisional-shield')).not.toBeNull();
    manager.release(post);
  });

  it('keeps pending Facebook legacy comments on independent row leases', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    const list = document.createElement('ul');
    const firstRow = document.createElement('li');
    const firstBody = document.createElement('div');
    firstBody.dir = 'auto';
    firstBody.textContent = 'first pending comment';
    firstRow.appendChild(firstBody);
    const secondRow = document.createElement('li');
    const secondBody = document.createElement('div');
    secondBody.dir = 'auto';
    secondBody.textContent = 'second pending comment';
    secondRow.appendChild(secondBody);
    list.append(firstRow, secondRow);
    article.appendChild(list);
    document.body.appendChild(article);
    const first: Item = {
      id: 'fb-comment-1', text: firstBody.textContent, platform: 'facebook', kind: 'top-comment',
      domRef: new WeakRef(firstBody),
    };
    const second: Item = {
      id: 'fb-comment-2', text: secondBody.textContent, platform: 'facebook', kind: 'top-comment',
      domRef: new WeakRef(secondBody),
    };

    const firstHandle = manager.protect(first);
    const secondHandle = manager.protect(second);

    expect(firstHandle?.element).toBe(firstRow);
    expect(secondHandle?.element).toBe(secondRow);
    expect(article.querySelectorAll('.fw-provisional-shield')).toHaveLength(2);
    manager.release(first);
    expect(firstRow.querySelector('.fw-provisional-shield')).toBeNull();
    expect(secondRow.querySelector('.fw-provisional-shield')).not.toBeNull();
    manager.release(second);
  });

  it('covers the whole modern Facebook feed unit when story text is a sibling of the article shell', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const feedUnit = document.createElement('div');
    feedUnit.setAttribute('aria-posinset', '1');
    const emptyArticle = document.createElement('div');
    emptyArticle.setAttribute('role', 'article');
    const storyText = document.createElement('div');
    storyText.dataset.adRenderingRole = 'story_message';
    storyText.textContent = 'modern Facebook caption';
    const image = document.createElement('img');
    feedUnit.append(emptyArticle, storyText, image);
    document.body.appendChild(feedUnit);
    const post: Item = {
      id: 'fb-modern', text: storyText.textContent, platform: 'facebook', kind: 'post',
      domRef: new WeakRef(storyText),
    };

    const handle = manager.protect(post);

    expect(handle?.element).toBe(feedUnit);
    expect(feedUnit.querySelector(':scope > .fw-provisional-shield')).not.toBeNull();
    expect(storyText.querySelector('.fw-provisional-shield')).toBeNull();
    manager.release(post);
  });

  it('mounts a plain veil with the Romanian label once setLang(ro) is called', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    manager.setLang('ro');
    const target = item();

    manager.protect(target.item);

    try {
      const overlay = target.element.querySelector('.fw-provisional-shield') as HTMLElement;
      expect(overlay.textContent, 'a plain veil: no words on it while it waits').toBe('');
      expect(overlay.getAttribute('aria-label')).toBe('Se verifică…');
    } finally {
      manager.release(target.item);
    }
  });

  it('defaults to a plain veil with the English label when setLang is never called', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();

    manager.protect(target.item);

    try {
      const overlay = target.element.querySelector('.fw-provisional-shield') as HTMLElement;
      expect(overlay.textContent, 'a plain veil: no words on it while it waits').toBe('');
      expect(overlay.getAttribute('aria-label')).toBe('Checking…');
    } finally {
      manager.release(target.item);
    }
  });

  it('rearms the connected host when the original mutation anchor was replaced', () => {
    const row = document.createElement('article');
    const oldBody = document.createElement('span');
    oldBody.textContent = 'old body';
    oldBody.dataset.fwProcessed = 'true';
    row.appendChild(oldBody);
    document.body.appendChild(row);
    const post: Item = {
      id: 'replaced-anchor', text: 'old body', platform: 'twitter', kind: 'post',
      domRef: new WeakRef(oldBody),
    };
    const rearm = vi.fn();
    const manager = new ChildProtectionManager<Item>((_item, anchor) => rearm(anchor));
    manager.setMode('child');
    manager.protect(post);
    const replacement = document.createElement('span');
    replacement.textContent = 'different body';
    replacement.dataset.fwProcessed = 'true';
    oldBody.replaceWith(replacement);

    manager.release(post);

    expect(rearm).toHaveBeenCalledWith(row);
    expect(row.querySelector('.fw-provisional-shield')).not.toBeNull();
  });

  // Deadline reaper: a cover whose verdict never arrives (dropped by an
  // extension reload, a queue cancel, or a thrown handler) must not stay
  // opaque forever — a permanent black cover reads as FW deleting the post.
  describe('release deadline', () => {
    it('reaps an unreleased cover after the deadline and reports protection end', () => {
      vi.useFakeTimers();
      try {
        const terminal = vi.fn();
        const manager = new ChildProtectionManager<Item>(undefined, terminal);
        manager.setMode('child');
        const target = item('stuck');
        manager.protect(target.item);
        expect(target.element.querySelector('.fw-provisional-shield')).not.toBeNull();

        vi.advanceTimersByTime(60_000);

        expect(target.element.querySelector('.fw-provisional-shield')).toBeNull();
        expect(terminal).toHaveBeenCalledTimes(1);
        expect(manager.activeCount).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('leaves a held cover alone: a hide that did not land is not a verdict that never came', () => {
      vi.useFakeTimers();
      try {
        const terminal = vi.fn();
        const manager = new ChildProtectionManager<Item>(undefined, terminal);
        manager.setMode('child');
        const target = item('held');
        manager.protect(target.item);
        expect(manager.hold(target.item)).toBe(true);

        vi.advanceTimersByTime(180_000);

        expect(target.element.querySelector('.fw-provisional-shield')).not.toBeNull();
        expect(terminal).not.toHaveBeenCalled();
        expect(manager.activeCount).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('a held cover still comes off when a later terminal releases it', () => {
      const terminal = vi.fn();
      const manager = new ChildProtectionManager<Item>(undefined, terminal);
      manager.setMode('child');
      const target = item('held-then-released');
      manager.protect(target.item);
      manager.hold(target.item);

      manager.release(target.item);

      expect(target.element.querySelector('.fw-provisional-shield')).toBeNull();
      expect(terminal).toHaveBeenCalledTimes(1);
    });

    it('a held cover goes when its post leaves the page', () => {
      const manager = new ChildProtectionManager<Item>();
      manager.setMode('child');
      const target = item('held-then-detached');
      manager.protect(target.item);
      manager.hold(target.item);

      target.element.remove();
      manager.pruneStale();

      expect(manager.activeCount).toBe(0);
    });

    it('holds nothing outside Child, and nothing for an item with no cover', () => {
      const manager = new ChildProtectionManager<Item>();
      manager.setMode('child');
      const unprotected = item('never-protected');
      expect(manager.hold(unprotected.item)).toBe(false);

      const teen = new ChildProtectionManager<Item>();
      teen.setMode('teen');
      const target = item('teen-item');
      teen.protect(target.item);
      expect(teen.hold(target.item)).toBe(false);
    });

    it('the cover of a held post moves the child on, in the language the session resolved', () => {
      const manager = new ChildProtectionManager<Item>();
      manager.setMode('child');
      manager.setLang('ro');
      const target = item('held-ro');
      manager.protect(target.item);
      const cover = target.element.querySelector('.fw-provisional-shield');
      expect(cover?.textContent, 'a plain veil while it waits').toBe('');

      manager.hold(target.item);

      expect(cover?.textContent).toBe('Filtrul tău Silențios a sărit peste asta. Continuă să derulezi.');
      manager.release(target.item);
    });

    it('does nothing when the verdict released the cover in time', () => {
      vi.useFakeTimers();
      try {
        const terminal = vi.fn();
        const manager = new ChildProtectionManager<Item>(undefined, terminal);
        manager.setMode('child');
        const target = item('timely');
        manager.protect(target.item);
        manager.release(target.item);
        expect(terminal).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(120_000);

        // No double-fire from the expired timer.
        expect(terminal).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
