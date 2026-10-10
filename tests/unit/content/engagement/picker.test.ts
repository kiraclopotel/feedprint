// @vitest-environment jsdom
//
// Off's "block this" picker (engagement/picker.ts): a pick on a post is an
// account rule; a pick on a box is a shape of roles, attribute names and
// child tags, never text (a heading is the one exception); a box with no
// anchor is refused; the guards refuse the feed and anything holding two
// posts; a remembered shape is hidden when it comes back and freed when the
// popup removes the pick.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saved: Record<string, unknown>[] = [];
const featureUpdates: Array<{ id: string; next: unknown }> = [];
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    incrementMetricsHidden: vi.fn(() => Promise.resolve()),
    getSettings: vi.fn(async () => ({ pickedBlocks: (saved[saved.length - 1]?.pickedBlocks as unknown[] | undefined) ?? [] })),
    saveSettings: vi.fn(async (p: Record<string, unknown>) => { saved.push(p); }),
    updateFeature: vi.fn(async (id: string, fn: (cur: unknown) => unknown) => { featureUpdates.push({ id, next: fn({ enabled: false }) }); }),
  };
});

import { _setProductForTesting } from '../../../../src/product';
import {
  arm, boundaryFor, matchesShape, scanPicked, shapeFor, startPickedBlocks, startPicker, PICKED_HIDDEN_MARKER, PICKER_ARMED_KEY,
} from '../../../../src/content/engagement/picker';
import type { PickedBlock } from '../../../../src/storage/settings';

type Listener = (c: Record<string, { newValue?: unknown }>) => void;
const listeners = new Set<Listener>();
const g = globalThis as unknown as { chrome?: unknown };
let savedChrome: unknown;

beforeEach(() => {
  savedChrome = g.chrome;
  g.chrome = { storage: { onChanged: { addListener: (l: Listener) => listeners.add(l), removeListener: (l: Listener) => listeners.delete(l) }, local: { remove: vi.fn(async () => {}), set: vi.fn(async () => {}) } } };
  _setProductForTesting('off');
  saved.length = 0;
  featureUpdates.length = 0;
  document.body.innerHTML = '';
  // jsdom has no layout: every box measures 0, so the size guard is bypassed here.
  Element.prototype.getBoundingClientRect = () => ({ width: 300, height: 120, left: 0, top: 0, right: 300, bottom: 120, x: 0, y: 0, toJSON: () => ({}) });
});
afterEach(() => { g.chrome = savedChrome; listeners.clear(); _setProductForTesting(null); });

const TWEET = (h: string) => `<article data-testid="tweet"><div data-testid="User-Name"><a href="/${h}">${h}</a></div><div data-testid="tweetText">hi</div></article>`;

describe('shapeFor / matchesShape', () => {
  it('names a box by its attributes up to the first anchor, never by class, and matches the child tags', () => {
    document.body.innerHTML = `<aside data-testid="sidebarColumn"><div class="x1 y2"><div class="z"><h2>Who to follow</h2><ul></ul></div></div></aside>`;
    const box = document.querySelector('aside > div > div')!;
    const shape = shapeFor(box)!;
    expect(shape.chain).toEqual(['div', 'div', 'aside[data-testid="sidebarColumn"]']);
    expect(shape.children).toBe('h2,ul');
    expect(shape.heading).toBeUndefined();
    expect(matchesShape(box, shape)).toBe(true);
    box.appendChild(document.createElement('p'));
    expect(matchesShape(box, shape)).toBe(false);
  });
  it('a box with no anchor within six levels is named by its heading, or refused', () => {
    document.body.innerHTML = `<div><div><div><div><div><div><div id="deep"><span>Suggested for you</span><a href="/x">See all</a></div></div></div></div></div></div></div>`;
    expect(shapeFor(document.getElementById('deep')!)).toBeNull();
    document.body.innerHTML = `<div><div><div><div><div><div><div id="deep"><h4>Suggested for you</h4><a href="/x">See all</a></div></div></div></div></div></div></div>`;
    const shape = shapeFor(document.getElementById('deep')!)!;
    expect(shape).toEqual({ chain: ['div'], children: 'h4,a', heading: 'Suggested for you' });
  });
});

describe('boundaryFor', () => {
  it('a click inside a post is the post and its author; a click in a stack of posts is refused', () => {
    document.body.innerHTML = `<main><section>${TWEET('alice')}${TWEET('bob')}</section></main>`;
    const inPost = document.querySelector('[data-testid="tweetText"]')!;
    expect(boundaryFor(inPost, 'twitter')).toMatchObject({ kind: 'post', author: 'alice' });
    expect(boundaryFor(document.querySelector('section')!, 'twitter')).toBeNull();
  });
  it('a click on a TikTok commenter\'s name or picture is the whole comment and its account', () => {
    document.body.innerHTML = '<div class="item"><a data-e2e="comment-avatar-1"><img id="pic"></a><div><a data-e2e="comment-username-1" href="/@troll">troll</a><p data-e2e="comment-level-1">text</p></div></div>';
    const b = boundaryFor(document.getElementById('pic')!, 'tiktok');
    expect(b).toMatchObject({ kind: 'post', author: 'troll' });
    expect((b as { el: Element }).el.className).toBe('item');
  });
  it('a click in a sidebar module is the module', () => {
    document.body.innerHTML = `<div data-testid="sidebarColumn"><div><div role="region" aria-label="Trending"><h2>Trends</h2><span id="t">#x</span></div></div></div>`;
    expect(boundaryFor(document.getElementById('t')!, 'twitter')).toMatchObject({ kind: 'box' });
    expect((boundaryFor(document.getElementById('t')!, 'twitter') as { el: Element }).el.getAttribute('aria-label')).toBe('Trending');
  });
});

describe('scanPicked and startPickedBlocks', () => {
  const pick: PickedBlock = { id: 'pk1', platform: 'twitter', createdAt: '2026-09-03T10:00:00.000Z', chain: ['div[role="region"][aria-label="Trending"]', 'div', 'div[data-testid="sidebarColumn"]'], children: 'h2,span', label: 'Trending' };
  it('hides the remembered shape and nothing else, and frees it when the pick is removed', () => {
    document.body.innerHTML = `<div data-testid="sidebarColumn"><div><div role="region" aria-label="Trending"><h2>Trends</h2><span>#x</span></div></div>
      <div><div role="region" aria-label="Trending"><h2>Trends</h2><span>#y</span><p>extra</p></div></div></div>`;
    const stop = startPickedBlocks('twitter', { pickedBlocks: [pick] } as never);
    const boxes = document.querySelectorAll<HTMLElement>('[role="region"]');
    expect(boxes[0].getAttribute(PICKED_HIDDEN_MARKER)).toBe('true');
    expect(boxes[0].style.display).toBe('none');
    expect(boxes[1].hasAttribute(PICKED_HIDDEN_MARKER)).toBe(false);
    for (const l of listeners) l({ pickedBlocks: { newValue: [] } });
    expect(boxes[0].hasAttribute(PICKED_HIDDEN_MARKER)).toBe(false);
    expect(boxes[0].style.display).toBe('');
    stop();
  });
  it('a heading-named pick is found from its heading', () => {
    document.body.innerHTML = `<div><div><div><div><div><div><div><h4>Suggested for you</h4><a href="/x">See all</a></div></div></div></div></div></div></div>`;
    const p: PickedBlock = { ...pick, id: 'pk2', platform: 'instagram', chain: ['div'], children: 'h4,a', heading: 'Suggested for you' };
    expect(scanPicked(document, 'instagram', [p])).toBe(1);
    expect(document.querySelector('h4')!.parentElement!.style.display).toBe('none');
  });
});

describe('arm', () => {
  it('a click on a post adds the account rule and hides the post; Escape disarms', () => {
    document.body.innerHTML = `<main>${TWEET('troll')}</main>`;
    const done = vi.fn();
    arm('twitter', 'en', done);
    expect(document.querySelector('[data-fw-picker-outline]')).not.toBeNull();
    const text = document.querySelector('[data-testid="tweetText"]')!;
    text.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    text.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(done).toHaveBeenCalled();
    expect(document.querySelector('[data-fw-picker-outline]')).toBeNull();
    expect(document.querySelector('article')!.getAttribute(PICKED_HIDDEN_MARKER)).toBe('true');
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(featureUpdates[0]).toMatchObject({ id: 'parent-blocklist', next: { enabled: true, value: { accounts: ['troll'] } } });
      resolve();
    }, 0));
  });
  it('a click on a box saves its shape; a nameless box is refused with a message', async () => {
    document.body.innerHTML = `<div data-testid="sidebarColumn"><div><div role="region" aria-label="Trending"><h2>Trends</h2><span id="t">#x</span></div></div></div>`;
    arm('twitter', 'ro', () => {});
    document.getElementById('t')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    // The box is its own anchor (role and aria-label), so the chain stops there.
    expect(saved[0]).toMatchObject({ pickedBlocks: [{ platform: 'twitter', chain: ['div[role="region"][aria-label="Trending"]'], children: 'h2,span', label: 'Trending' }] });
    expect(Array.from(document.querySelectorAll('[data-fw-picker-toast]')).pop()!.textContent).toContain('Ascuns');

    document.body.innerHTML = `<div><div><div><div><div><div><div><span id="s">plain</span></div></div></div></div></div></div></div>`;
    arm('twitter', 'en', () => {});
    document.getElementById('s')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(Array.from(document.querySelectorAll('[data-fw-picker-toast]')).pop()!.textContent).toContain('cannot name this box');
    expect(saved).toHaveLength(1);
  });
  it('"pick several" stays armed after a pick until Escape, and a post hides its whole X cell', () => {
    document.body.innerHTML = `<main><div data-testid="cellInnerDiv">${TWEET('a')}</div><div data-testid="cellInnerDiv">${TWEET('b')}</div></main>`;
    const stop = startPicker('twitter', { uiLanguage: 'en' } as never);
    for (const l of listeners) l({ [PICKER_ARMED_KEY]: { newValue: { at: Date.now(), many: true } } });
    const texts = document.querySelectorAll('[data-testid="tweetText"]');
    texts[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-fw-picker-outline]')).not.toBeNull();
    texts[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    const cells = document.querySelectorAll<HTMLElement>('[data-testid="cellInnerDiv"]');
    expect(cells[0].style.display).toBe('none');
    expect(cells[1].style.display).toBe('none');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-fw-picker-outline]')).toBeNull();
    stop();
  });
  it('the same box picked twice is remembered once, and a role of "none" is no name', async () => {
    document.body.innerHTML = `<div data-testid="sidebarColumn"><div role="none"><div role="region" aria-label="Trending"><h2>Trends</h2><span id="t">#x</span></div></div></div>`;
    arm('twitter', 'en', () => {}, true);
    document.getElementById('t')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById('t')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(saved).toHaveLength(1);
    expect((saved[0].pickedBlocks as Array<{ label: string }>)[0].label).toBe('Trending');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  it('the popup arms it through storage and Escape stops it', () => {
    document.body.innerHTML = `<main>${TWEET('a')}</main>`;
    const stop = startPicker('twitter', { uiLanguage: 'en' } as never);
    for (const l of listeners) l({ [PICKER_ARMED_KEY]: { newValue: Date.now() } });
    expect(document.querySelector('[data-fw-picker-outline]')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('[data-fw-picker-outline]')).toBeNull();
    stop();
  });
});
