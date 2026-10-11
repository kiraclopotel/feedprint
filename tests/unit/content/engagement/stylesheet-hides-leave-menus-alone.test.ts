// @vitest-environment jsdom
//
// A rule written in a stylesheet leaves menus and tooltips alone too (11 Oct 2026, the owner's report).
//
// The first answer to "Off took the choices to unfollow and block out of the card on an account name" was at the
// door every JavaScript hide goes through (mark-hidden.ts). A second road to the page does not pass that door: a
// selector written in a <style> tag, such as the comment-block family `[aria-label*="Reply to" i]`, hides whatever
// matches wherever it is, a menu included. Every such tag is created by ensureStyleTag, so the guard sits there: each
// hiding rule gets the same exclusion the door applies, no matter which module wrote it.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', () => ({
  incrementMetricsHidden: vi.fn(() => Promise.resolve()),
}));

import { ensureStyleTag, removeStyleTag } from '../../../../src/content/engagement/style-tag';
import { blockCommentInputCSS } from '../../../../src/content/engagement/facebook-engagement';

const ID = 'fw-test-style';

afterEach(() => {
  removeStyleTag(ID);
  document.body.replaceChildren();
});

function shown(el: Element): boolean {
  return getComputedStyle(el).display !== 'none';
}

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

describe('a hiding rule in a stylesheet does not reach into a menu', () => {
  it('hides the match on the page and leaves the same match inside a menu, a tooltip and a list of choices', () => {
    ensureStyleTag(ID, '[aria-label*="Reply to" i] { display: none !important; }');
    const host = mount(`
      <div><button id="page" aria-label="Reply to Jane">x</button></div>
      <div role="menu"><button id="menu" aria-label="Reply to Jane">x</button></div>
      <div role="tooltip"><button id="tip" aria-label="Reply to Jane">x</button></div>
      <div role="listbox"><div id="opt" role="option" aria-label="Reply to Jane">x</div></div>
      <div role="alertdialog"><button id="alert" aria-label="Reply to Jane">x</button></div>`);
    expect(shown(host.querySelector('#page')!), 'page').toBe(false);
    for (const id of ['menu', 'tip', 'opt', 'alert']) {
      expect(shown(host.querySelector(`#${id}`)!), id).toBe(true);
    }
  });

  it('the menu element itself is kept as well', () => {
    ensureStyleTag(ID, '[role="menu"][aria-label*="Reply" i] { display: none !important; }');
    const host = mount('<div id="m" role="menu" aria-label="Reply options"><span>x</span></div>');
    expect(shown(host.querySelector('#m')!)).toBe(true);
  });

  it('keeps a selector list apart: each member is guarded, commas inside :is() and quotes stay intact', () => {
    ensureStyleTag(ID, `
      [aria-label="a,b"], :is(.x, .y) > i, form[role="presentation"] { display: none !important; }`);
    const host = mount(`
      <div role="menu"><button aria-label="a,b" id="m1"></button><span class="x"><i id="m2"></i></span><form role="presentation" id="m3"></form></div>
      <div><button aria-label="a,b" id="p1"></button><span class="y"><i id="p2"></i></span><form role="presentation" id="p3"></form></div>`);
    for (const id of ['m1', 'm2', 'm3']) expect(shown(host.querySelector(`#${id}`)!), id).toBe(true);
    for (const id of ['p1', 'p2', 'p3']) expect(shown(host.querySelector(`#${id}`)!), id).toBe(false);
  });

  it('reaches a rule inside @media', () => {
    ensureStyleTag(ID, '@media all { [aria-label*="Reply to" i] { display: none !important; } }');
    const host = mount(`
      <div role="menu"><button id="menu" aria-label="Reply to Jane"></button></div>
      <div><button id="page" aria-label="Reply to Jane"></button></div>`);
    expect(shown(host.querySelector('#menu')!)).toBe(true);
    expect(shown(host.querySelector('#page')!)).toBe(false);
  });

  it('a visibility:hidden rule is guarded the same way', () => {
    ensureStyleTag(ID, '[aria-label*="Reply to" i] { visibility: hidden !important; }');
    const host = mount(`
      <div role="menu"><button id="menu" aria-label="Reply to Jane"></button></div>
      <div><button id="page" aria-label="Reply to Jane"></button></div>`);
    expect(getComputedStyle(host.querySelector('#menu')!).visibility).not.toBe('hidden');
    expect(getComputedStyle(host.querySelector('#page')!).visibility).toBe('hidden');
  });
});

describe('what the guard leaves as written', () => {
  it('a rule that does not hide anything', () => {
    ensureStyleTag(ID, '[aria-label*="Reply to" i] { color: red; }');
    const rule = (document.getElementById(ID) as HTMLStyleElement).sheet!.cssRules[0] as CSSStyleRule;
    expect(rule.selectorText).toBe('[aria-label*="Reply to" i]');
  });

  it('a rule keyed to our own stamp: the stamping already asked the door', () => {
    ensureStyleTag(ID, '[data-fw-engagement-bar="true"] { display: none !important; }');
    const rule = (document.getElementById(ID) as HTMLStyleElement).sheet!.cssRules[0] as CSSStyleRule;
    expect(rule.selectorText).toBe('[data-fw-engagement-bar="true"]');
  });

  it('a pseudo-element selector, which cannot take a :not() after it', () => {
    ensureStyleTag(ID, '.x::before { display: none; }');
    const rule = (document.getElementById(ID) as HTMLStyleElement).sheet!.cssRules[0] as CSSStyleRule;
    expect(rule.selectorText).toBe('.x::before');
  });

  it('a second call with the same id changes nothing', () => {
    ensureStyleTag(ID, '.a { display: none; }');
    ensureStyleTag(ID, '.b { display: none; }');
    const sheet = (document.getElementById(ID) as HTMLStyleElement).sheet!;
    expect(sheet.cssRules.length).toBe(1);
    expect((sheet.cssRules[0] as CSSStyleRule).selectorText).toContain('.a');
  });
});

describe('the real comment-block sheet', () => {
  it('hides the comment bits of a post and leaves the choices of a menu in the same page', () => {
    ensureStyleTag(ID, blockCommentInputCSS());
    const host = mount(`
      <div role="article"><div id="reply" role="button" aria-label="Reply to Jane">Reply</div><form id="composer" role="presentation"></form></div>
      <div role="menu"><div id="item" role="menuitem" aria-label="Reply to Jane">Reply</div></div>`);
    expect(shown(host.querySelector('#reply')!), 'reply in the post').toBe(false);
    expect(shown(host.querySelector('#composer')!), 'composer').toBe(false);
    expect(shown(host.querySelector('#item')!), 'item in the menu').toBe(true);
  });
});
