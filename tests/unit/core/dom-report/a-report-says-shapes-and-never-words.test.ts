// @vitest-environment jsdom
//
// A "this broke" report carries the shape of a page and never its words (11 Oct 2026, the owner released the report
// button).
//
// The owner asked for a way to tell us a site changed without sending us what he reads. What leaves is a skeleton: tags,
// roles, which attributes exist, how things nest, the shape of a label and of an address. These tests build a skeleton
// from a page full of names, a phone number, a handle, an id, an image address and a comment, and check that none of it
// is in what comes out, however it is searched. The grammar check at the end is what the sender runs on its own report
// before it leaves, and what the relay runs on arrival.

import { afterEach, describe, expect, it } from 'vitest';
import { buildSkeleton, MAX_REPORT_CHARS } from '../../../../src/core/dom-report/skeleton';
import { hrefShape, labelShape, pathShape } from '../../../../src/core/dom-report/vocabulary';
import { validateSkeleton } from '../../../../src/core/dom-report/report';

const PERSONAL = [
  'Jane', 'Doe', 'Michael', 'Smith', 'engaged', '555', 'jane.doe', '9876543210', 'secret', 'x1a2b3c', 'mainFeed',
  'fbcdn', 'Rex', 'dog', 'comment_id', 'abc.jpg', 'janedoe', 'wedding', 'Cluj', 'hunter2',
];

const PAGE = `
<div role="main" id="mainFeed">
  <div role="feed" data-pagelet="FeedUnit_3">
    <div role="article" aria-label="Post by Jane Doe" class="x1a2b3c secret-class" id="u_0_1a">
      <a href="https://www.facebook.com/jane.doe.1234/posts/9876543210?comment_id=555" aria-label="Jane Doe">Jane Doe</a>
      <div dir="auto">I just got engaged to Michael Smith, call me on 555-0100 wedding in Cluj 😀</div>
      <div role="button" aria-label="Send Message" tabindex="0">Send Message</div>
      <div role="button" aria-label="Like Michael Smith's photo">Like</div>
      <img src="https://scontent.fbcdn.net/v/t39/abc.jpg" alt="Photo of my dog Rex">
      <input type="text" value="hunter2" placeholder="Write a comment, Jane" name="janedoe">
      <input type="password" value="hunter2">
      <textarea>secret draft about Michael</textarea>
      <div contenteditable="true">secret words typed here</div>
    </div>
  </div>
</div>`;

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => { document.body.innerHTML = ''; });

const OPTIONS = { ownHost: 'www.facebook.com' };

describe('what a label and an address say', () => {
  it('keeps interface words and counts the rest', () => {
    expect(labelShape('Send Message')).toBe('send+message');
    expect(labelShape('Actions for this post by Jane Doe')).toBe('actions+for+this+4w');
    expect(labelShape('Like Michael Smith\'s photo')).toBe('like+3w');
    expect(labelShape('Jane Doe')).toBe('2w');
    expect(labelShape('Răspunde')).toBe('raspunde');
    expect(labelShape('')).toBe('');
  });

  it('never copies a word that is not on the list', () => {
    for (const label of ['Jane Doe', 'Michael\'s wedding', 'call 555-0100', 'hunter2 is my password', '山田太郎']) {
      expect(labelShape(label)).toMatch(/^\d+w$/);
    }
  });

  it('keeps the section of an address and drops the person', () => {
    expect(pathShape('/@jane/video/7123456')).toBe('/@/video/0');
    expect(pathShape('/jane.doe.1234/posts/9876543210')).toBe('/*/posts/0');
    expect(pathShape('/p/Cx1y2Z3/')).toBe('/p/*');
    expect(pathShape('/groups/12345/posts/678')).toBe('/groups/0/posts/0');
    expect(pathShape('/a/b/c/d/e/f/g/h')).toBe('/*/*/*/*/*/*');
  });

  it('says "ext" for another site and never copies its host', () => {
    expect(hrefShape('https://www.facebook.com/jane.doe/posts/1?comment_id=5', 'www.facebook.com')).toBe('/*/posts/0?');
    expect(hrefShape('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com', 'www.facebook.com')).toBe('/*?');
    expect(hrefShape('https://example.com/secret', 'www.facebook.com')).toBe('ext');
    expect(hrefShape('https://facebook.com.evil.example/x', 'www.facebook.com')).toBe('ext');
    expect(hrefShape('#top', 'www.facebook.com')).toBe('#');
    expect(hrefShape('mailto:jane@example.com', 'www.facebook.com')).toBe('mailto');
    expect(hrefShape('weirdscheme:abc', 'www.facebook.com')).toBe('*');
    expect(hrefShape('', 'www.facebook.com')).toBe('');
  });
});

describe('a skeleton of a page', () => {
  it('carries none of the words, names, numbers, ids, classes or addresses on the page', () => {
    const host = mount(PAGE);
    const text = JSON.stringify(buildSkeleton(host, OPTIONS));
    for (const word of PERSONAL) expect(text.toLowerCase()).not.toContain(word.toLowerCase());
    for (const emoji of ['😀']) expect(text).not.toContain(emoji);
    expect(text).not.toContain('http');
    expect(text).not.toContain('.com');
  });

  it('keeps what a finder needs: tags, roles, attribute names, label and address shapes, a text size', () => {
    const host = mount(PAGE);
    const root = buildSkeleton(host, OPTIONS);
    const text = JSON.stringify(root);
    expect(text).toContain('"r":"article"');
    expect(text).toContain('"r":"feed"');
    expect(text).toContain('"r":"button"');
    expect(text).toContain('"l":"send+message"');
    expect(text).toContain('"l":"like+3w"');
    expect(text).toContain('"h":"/*/posts/0?"');
    expect(text).toContain('"data-pagelet":"FeedUnit_0"');
    expect(text).toContain('data-pagelet');
    expect(text).toContain('"class"'); // that a class exists, not what it is
  });

  it('says that text is there and how long, and whether it holds a picture character, and nothing of it', () => {
    const host = mount(PAGE);
    const nodes: any[] = [];
    const walk = (n: any) => { nodes.push(n); (n.c ?? []).forEach(walk); };
    walk(buildSkeleton(host, OPTIONS));
    const long = nodes.find((n) => n.t === 'div' && n.e === 1);
    expect(long).toBeTruthy();
    expect(long.n).toBe(3); // 50 to 199 characters
  });

  it('keeps no value from an input, a text area or an editable box, and no child of them', () => {
    const host = mount(PAGE);
    const text = JSON.stringify(buildSkeleton(host, OPTIONS));
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('draft');
    expect(text).not.toContain('typed here');
    const nodes: any[] = [];
    const walk = (n: any) => { nodes.push(n); (n.c ?? []).forEach(walk); };
    walk(buildSkeleton(host, OPTIONS));
    for (const n of nodes.filter((x) => x.t === 'input' || x.t === 'textarea')) expect(n.c).toBeUndefined();
  });

  it('puts one marker where a private chat was and nothing of what is in it', () => {
    const host = mount(`<div role="main"><section><div role="log" aria-label="Chat with Jane"><p>meet me at Cluj station</p></div></section></div>`);
    const root = buildSkeleton(host, { ...OPTIONS, isPrivate: (el: Element) => !!el.closest('[role="log"]') });
    const text = JSON.stringify(root);
    expect(text).toContain('"t":"private"');
    expect(text).not.toContain('Cluj');
    expect(text).not.toContain('Jane');
    expect(text).not.toContain('meet');
  });

  it('collapses a run of identical siblings into one with a count', () => {
    const items = Array.from({ length: 30 }, (_, i) => `<li><a href="/p/Cx${i}ab/">post number ${i}</a></li>`).join('');
    const host = mount(`<ul>${items}</ul>`);
    const root = buildSkeleton(host, { ownHost: 'www.instagram.com' });
    const ul = root.c![0];
    expect(ul.c).toHaveLength(1);
    expect(ul.c![0].x).toBe(30);
    expect(JSON.stringify(root)).not.toContain('post number');
  });

  it('marks what is hidden as drawn, and our own stamps by name', () => {
    const host = mount(`<div><div data-fw-block-reason="word-filter:hunter2" style="display:none">x</div><div style="visibility:hidden">y</div></div>`);
    const text = JSON.stringify(buildSkeleton(host, OPTIONS));
    expect(text).toContain('"s":"n"');
    expect(text).toContain('"s":"h"');
    expect(text).toContain('"data-fw-block-reason":"word-filter"');
    expect(text).not.toContain('hunter2');
  });

  it('stays inside its caps on a page of thousands of elements', () => {
    let html = '';
    for (let i = 0; i < 4000; i++) html += `<div role="${i % 2 ? 'button' : 'link'}" data-k="${i}"><span>${i}</span><b role="button" aria-label="Like"></b></div>`;
    let chain = 'bottom';
    for (let i = 0; i < 40; i++) chain = `<div role="${i % 2 ? 'group' : 'region'}">${chain}</div>`;
    const host = mount(html + chain);
    const root = buildSkeleton(host, OPTIONS);
    let count = 0;
    let depth = 0;
    const walk = (n: any, d: number) => { count++; depth = Math.max(depth, d); (n.c ?? []).forEach((c: any) => walk(c, d + 1)); };
    walk(root, 1);
    expect(count).toBeLessThanOrEqual(500);
    expect(depth).toBeLessThanOrEqual(15);
    expect(JSON.stringify(root).length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
  }, 30_000); // building a page of thousands of elements takes a slow shared runner past the default five seconds

  it('is accepted by its own grammar', () => {
    const host = mount(PAGE);
    expect(validateSkeleton(buildSkeleton(host, OPTIONS))).toEqual([]);
  });
});
