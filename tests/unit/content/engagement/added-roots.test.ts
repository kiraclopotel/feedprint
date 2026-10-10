// @vitest-environment jsdom
//
// The shared inserted-subtree observer (engagement/added-roots.ts): one body
// MutationObserver hands every registered handler the inserted subtrees,
// deduplicated to their outermost roots, synchronously in the mutation
// callback. This is what lets the engagement modules hide a post before its
// first paint instead of after their own timers (2026-09-03 latency cut).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  observeAddedRoots,
  __addedRootsHandlerCountForTest,
} from '../../../../src/content/engagement/added-roots';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

let stops: (() => void)[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  for (const s of stops) s();
  stops = [];
  document.body.innerHTML = '';
});

describe('observeAddedRoots', () => {
  it('hands inserted elements to the handler', async () => {
    const handler = vi.fn();
    stops.push(observeAddedRoots(handler));
    const post = document.createElement('article');
    document.body.appendChild(post);
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual([post]);
  });

  it('reports only the outermost root of a nested insert', async () => {
    const handler = vi.fn();
    stops.push(observeAddedRoots(handler));
    const outer = document.createElement('div');
    const inner = document.createElement('article');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    // A second element appended inside the already-inserted subtree in the
    // same batch is covered by the outer root.
    const late = document.createElement('span');
    inner.appendChild(late);
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual([outer]);
  });

  it('hands over the parent of an inserted text node', async () => {
    const handler = vi.fn();
    const span = document.createElement('span');
    document.body.appendChild(span);
    await flush();
    stops.push(observeAddedRoots(handler));
    span.appendChild(document.createTextNode('42'));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual([span]);
  });

  it('ignores FeelingWise\'s own essential UI and nodes already removed', async () => {
    const handler = vi.fn();
    stops.push(observeAddedRoots(handler));
    const own = document.createElement('div');
    own.setAttribute('data-fw-essential', '');
    document.body.appendChild(own);
    const gone = document.createElement('div');
    document.body.appendChild(gone);
    gone.remove();
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('one observer serves every handler, and the last unsubscribe stops it', async () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = observeAddedRoots(a);
    const stopB = observeAddedRoots(b);
    expect(__addedRootsHandlerCountForTest()).toBe(2);
    document.body.appendChild(document.createElement('p'));
    await flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    stopB();
    expect(__addedRootsHandlerCountForTest()).toBe(0);
    document.body.appendChild(document.createElement('p'));
    await flush();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('a throwing handler does not stop the others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = vi.fn(() => { throw new Error('boom'); });
    const good = vi.fn();
    stops.push(observeAddedRoots(bad), observeAddedRoots(good));
    document.body.appendChild(document.createElement('p'));
    await flush();
    expect(good).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('collapses a wholesale rebuild to one body-wide root', async () => {
    const handler = vi.fn();
    stops.push(observeAddedRoots(handler));
    for (let i = 0; i < 401; i++) document.body.appendChild(document.createElement('i'));
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual([document.body]);
  });
});
