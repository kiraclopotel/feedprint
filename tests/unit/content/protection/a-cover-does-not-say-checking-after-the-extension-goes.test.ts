// @vitest-environment jsdom
//
// M68, open since 2026-07-13 with live evidence, HIGH on the honesty side.
//
// The extension can be replaced under an open tab: a reload, an update, a
// reinstall. The page-side script keeps running, because extraction and cover
// mounting are pure DOM, while every call into the extension throws "Extension
// context invalidated". So a Child cover mounted as "FeelingWise is checking
// this content" waits for a verdict that can never arrive, and goes on saying
// that sentence for as long as the tab stays open. The only signal was one
// console line, which nobody the product is for will ever read.
//
// The fix keeps the post COVERED, which was never the broken part, and changes
// what the cover says. These cases hold both halves of that, and the harder
// half is the second: a stranded cover must not be reaped, because the reaper
// exists for a verdict that never arrived and this is a verdict that can never
// be asked for.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildProtectionManager } from '../../../../src/content/protection/child-first-protection';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';

type Item = { id: string; text: string; domRef: WeakRef<HTMLElement> };

function item(id = 'p1'): { item: Item; element: HTMLElement } {
  const element = document.createElement('article');
  element.textContent = 'original';
  document.body.appendChild(element);
  return { item: { id, text: 'original', domRef: new WeakRef(element) }, element };
}

const coverText = (element: HTMLElement): string =>
  element.querySelector('.fw-provisional-shield')?.textContent ?? '';

const covered = (element: HTMLElement): boolean =>
  element.querySelector('.fw-provisional-shield') !== null;

beforeEach(() => { document.body.innerHTML = ''; });

describe('a cover left behind when the extension goes away', () => {
  it('stops saying the post is being checked', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    const before = coverText(target.element);
    expect(before).not.toBe('');

    manager.strandAll();

    expect(coverText(target.element)).toBe(MARKER_STRINGS.en.coverStrandedNotice);
    expect(coverText(target.element)).not.toBe(before);
  });

  it('keeps the post covered, because uncovering it is the unsafe direction', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    manager.strandAll();

    // The cover is an overlay, so the original text node stays in the DOM and
    // is hidden by it. What proves the post is still covered is the shield
    // element being there and the host still being marked busy and inert, which
    // is what the shield sets and what a release takes away.
    expect(covered(target.element)).toBe(true);
    expect(target.element.getAttribute('aria-busy')).toBe('true');
    expect(target.element.hasAttribute('inert')).toBe(true);
  });

  it('says it in the language the cover was already speaking', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    manager.setLang('ro');
    const target = item();
    manager.protect(target.item);

    manager.strandAll();

    expect(coverText(target.element)).toBe(MARKER_STRINGS.ro.coverStrandedNotice);
  });

  it('tells a screen reader too', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    manager.strandAll();

    const overlay = target.element.querySelector('.fw-provisional-shield');
    expect(overlay?.getAttribute('aria-label')).toBe(MARKER_STRINGS.en.coverStrandedNotice);
  });

  it('mounts no new cover afterwards, because a new one could never resolve', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    manager.strandAll();

    const target = item();
    const handle = manager.protect(target.item);

    expect(handle).toBeNull();
    expect(covered(target.element)).toBe(false);
  });

  it('survives the deadline reaper, which answers a different question', () => {
    // The reaper uncovers a post whose verdict never arrived, after 60 seconds.
    // A stranded cover must not be uncovered by it: no verdict is coming,
    // because there is nothing left to ask, and a Child would be shown the post.
    vi.useFakeTimers();
    try {
      const manager = new ChildProtectionManager<Item>();
      manager.setMode('child');
      const target = item();
      manager.protect(target.item);

      manager.strandAll();
      vi.advanceTimersByTime(120_000);

      expect(covered(target.element)).toBe(true);
      expect(coverText(target.element)).toBe(MARKER_STRINGS.en.coverStrandedNotice);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is not repainted by a hold that lands afterwards', () => {
    // A hold says "FeelingWise hid this post", which reads as a verdict. After
    // the extension is gone that is a claim nothing can stand behind, and the
    // refresh instruction is the only useful thing left on the cover.
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    manager.strandAll();
    manager.hold(target.item);

    expect(coverText(target.element)).toBe(MARKER_STRINGS.en.coverStrandedNotice);
  });

  it('can be called twice without a second pass over the covers', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    manager.strandAll();
    manager.strandAll();

    expect(manager.isStranded()).toBe(true);
    expect(coverText(target.element)).toBe(MARKER_STRINGS.en.coverStrandedNotice);
  });
});

describe('the sentence itself', () => {
  it.each(['en', 'ro', 'es', 'pt-BR'] as const)('tells a %s reader what to do', lang => {
    const notice = MARKER_STRINGS[lang].coverStrandedNotice;
    expect(notice.length).toBeGreaterThan(0);
    // The one thing the reader needs is the refresh. A sentence that only says
    // something went wrong leaves them with a covered feed and no way out.
    expect(notice).toMatch(/refresh|reîncarc|vuelve a cargar|recarregue/i);
  });

  it('does not use an em dash, which the house does not ship to a reader', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      expect(MARKER_STRINGS[lang].coverStrandedNotice).not.toContain('—');
    }
  });
});
