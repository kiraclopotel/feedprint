// @vitest-environment jsdom
//
// The Silent veil (12 Oct 2026, the owner's yes): a plain veil with no words on it, lifted at fifteen seconds at the latest, and
// lifted as the local result: the rules that need no model (the person's own list, slurs, a swear mask) are applied to a post
// that was still waiting for its reading, so the post that shows is never the raw one. A post those rules leave alone is lifted
// as it is, and its reading lands late if it comes. It was sixty seconds, from the days when a cover past a second was a fault.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChildProtectionManager } from '../../../../src/content/protection/child-first-protection';
import { readSource } from '../../../helpers/read-source';

type Item = { id: string; text: string; domRef: WeakRef<HTMLElement> };

function item(id = 'p1'): { item: Item; element: HTMLElement } {
  const element = document.createElement('article');
  element.textContent = 'original';
  document.body.appendChild(element);
  return { item: { id, text: 'original', domRef: new WeakRef(element) }, element };
}

const covered = (element: HTMLElement): boolean => element.querySelector('.fw-provisional-shield') !== null;

beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('the deadline is fifteen seconds', () => {
  it('the constant says so', () => {
    expect(ChildProtectionManager.RELEASE_DEADLINE_MS).toBe(15_000);
  });

  it('a cover is up at 14.9 seconds and gone at fifteen when no rule has anything to say', () => {
    const manager = new ChildProtectionManager<Item>();
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);
    vi.advanceTimersByTime(14_999);
    expect(covered(target.element)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(covered(target.element)).toBe(false);
  });
});

describe('the deadline asks for the local result before the cover goes', () => {
  it('a rule that has nothing to say lifts the cover', async () => {
    const onDeadline = vi.fn(async (_item: Item, _stillCovered: () => boolean) => false);
    const manager = new ChildProtectionManager<Item>(undefined, undefined, 'post', onDeadline);
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(onDeadline).toHaveBeenCalledTimes(1);
    expect(onDeadline.mock.calls[0][0]).toBe(target.item);
    expect(covered(target.element)).toBe(false);
    expect(manager.activeCount).toBe(0);
  });

  it('the cover stays up until the local result is applied, and that result\'s terminal is what lifts it', async () => {
    let finish: (applied: boolean) => void = () => undefined;
    const onDeadline = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    const ended = vi.fn();
    const manager = new ChildProtectionManager<Item>(undefined, ended, 'post', onDeadline);
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(covered(target.element), 'still covered while the rules run').toBe(true);

    // The applier hides the post and settles the cover through its own terminal.
    manager.commit(target.item);
    finish(true);
    await vi.advanceTimersByTimeAsync(0);

    expect(ended).toHaveBeenCalledTimes(1);
    expect(manager.activeCount).toBe(0);
  });

  it('a verdict that lands while the rules run settles the post, and the callback is told the cover is no longer its own', async () => {
    let seen: boolean | undefined;
    const onDeadline = vi.fn(async (_item: Item, stillCovered: () => boolean) => {
      await Promise.resolve();
      seen = stillCovered();
      return false;
    });
    const manager = new ChildProtectionManager<Item>(undefined, undefined, 'post', onDeadline);
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    vi.advanceTimersByTime(15_000);
    manager.release(target.item);
    await vi.advanceTimersByTimeAsync(0);

    expect(seen).toBe(false);
  });

  it('a result that was applied but left the cover up is reaped at the backstop, sixty seconds in all', async () => {
    const manager = new ChildProtectionManager<Item>(undefined, undefined, 'post', async () => true);
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(covered(target.element)).toBe(true);
    await vi.advanceTimersByTimeAsync(44_999);
    expect(covered(target.element)).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(covered(target.element)).toBe(false);
  });

  it('a held cover is not asked about: a hide that could not land is not a verdict that never came', async () => {
    const onDeadline = vi.fn(async () => false);
    const manager = new ChildProtectionManager<Item>(undefined, undefined, 'post', onDeadline);
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);
    expect(manager.hold(target.item)).toBe(true);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(onDeadline).not.toHaveBeenCalled();
    expect(covered(target.element)).toBe(true);
  });

  it('a callback that fails lifts the cover as before, never leaves it up', async () => {
    const manager = new ChildProtectionManager<Item>(undefined, undefined, 'post', async () => { throw new Error('boom'); });
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(covered(target.element)).toBe(false);
  });

  it('a verdict that came in time makes the deadline do nothing at all', async () => {
    const onDeadline = vi.fn(async () => true);
    const manager = new ChildProtectionManager<Item>(undefined, undefined, 'post', onDeadline);
    manager.setMode('child');
    const target = item();
    manager.protect(target.item);
    manager.release(target.item);

    await vi.advanceTimersByTimeAsync(120_000);

    expect(onDeadline).not.toHaveBeenCalled();
  });
});

describe('the page script wires it once, to the pipeline\'s rules and to the queue', () => {
  const src = readSource('src/content/index.ts');

  it('the deadline asks the pipeline for the local result only, and leaves a comment to the door that already ran its rules', () => {
    const wiring = src.match(/const childProtection = new ChildProtectionManager<PostContent>\([\s\S]*?\n\}\);/)?.[0] ?? '';
    expect(wiring, 'the manager is built with a deadline callback').toContain('processPipeline(post, undefined, { localOnly: true })');
    expect(wiring).toContain("post.kind === 'top-comment'");
    expect(wiring).toContain('settledAtDeadline.add(post)');
    expect(wiring).toContain("local.action === 'pass'");
  });

  it('the queue\'s completion is dropped for a post the deadline settled, so one post has one result', () => {
    expect(src).toContain('if (!settledAtDeadline.has(post)) onProcessingResult(post, result);');
  });
});
