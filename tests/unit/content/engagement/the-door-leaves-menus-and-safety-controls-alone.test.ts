// @vitest-environment jsdom
//
// The door leaves menus and the means of protecting yourself alone (11 Oct 2026, the owner's report).
//
// With Off on, the card that opens when the pointer rests on an account name on Facebook lost the choices to unfollow
// and to block. No one filter has been shown to be the cause; the owner could name three switches that were on, not
// which. The scan that finds action bars (structural-finder.ts) takes two weak signals as proof, and "share", "send",
// "save" and "react" are among its words, so a row of buttons in any layer it scans can be taken for a bar. The
// first time this happened (ENG-1, July) the fix was a smarter score. A score is a guess; the rule here is an
// invariant at the one door every filter already passes through (mark-hidden.ts, 2026-09-20): nothing that hides
// things for a person may hide the controls by which the person acts on an account (block, unfollow, unfriend,
// report), nor anything inside a menu, a tooltip or a list of choices. A miss then costs one stray button on screen;
// a wrong hide costs the person their way out.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', () => ({
  incrementMetricsHidden: vi.fn(() => Promise.resolve()),
}));

import { hideElement, markHidden, BLOCK_REASON_ATTR } from '../../../../src/content/engagement/mark-hidden';

const opts = (marker = 'data-fw-test') => ({ marker, value: 'true', reason: 'hide-action-buttons:structural-bar' });

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

function stayedVisible(el: HTMLElement): void {
  expect(el.style.display, 'not collapsed').not.toBe('none');
  expect(el.hasAttribute('data-fw-test'), 'not marked').toBe(false);
  expect(el.hasAttribute(BLOCK_REASON_ATTR), 'no reason stamped').toBe(false);
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('a menu of choices is never hidden into', () => {
  const MENU = `
    <div role="menu" aria-label="Actions">
      <div role="menuitem" tabindex="0"><span>Save post</span></div>
      <div role="menuitem" tabindex="0"><span>Unfollow</span></div>
      <div role="menuitem" tabindex="0"><span>Block</span></div>
      <div role="menuitem" tabindex="0"><span>Report</span></div>
    </div>`;

  it('refuses the menu, every item in it, and a wrapper of the whole row', () => {
    const host = mount(`<div id="layer">${MENU}</div>`);
    const menu = host.querySelector<HTMLElement>('[role="menu"]')!;
    for (const el of [menu, ...Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]'))]) {
      expect(hideElement(el, opts()), el.textContent?.trim() || 'menu').toBe(false);
      expect(markHidden(el, opts()), 'the marking form too').toBe(false);
      stayedVisible(el);
    }
  });

  it('refuses a tooltip and a list of choices', () => {
    const host = mount(`
      <div role="tooltip"><span>Following</span></div>
      <div role="listbox"><div role="option">Close friends</div><div role="option">Favorites</div></div>`);
    for (const el of Array.from(host.querySelectorAll<HTMLElement>('[role="tooltip"], [role="listbox"], [role="option"]'))) {
      expect(hideElement(el, opts())).toBe(false);
      stayedVisible(el);
    }
  });
});

describe('the controls for blocking and unfollowing are never hidden, in any layer and any language', () => {
  const LABELS = [
    'Block', 'Unfollow', 'Unfriend', 'Report', 'Block this person', 'Report post',
    'Blochează', 'Nu mai urmări', 'Raportează', 'Elimină din prieteni',
    'Bloquear', 'Dejar de seguir', 'Denunciar', 'Bloquer', 'Ne plus suivre', 'Signaler',
    'Blockieren', 'Nicht mehr folgen', 'Melden', 'Deixar de seguir', 'Blocca', 'Smetti di seguire', 'Segnala',
    'Zablokuj', 'Przestań obserwować', 'Zgłoś', 'Letiltás', 'Követés megszüntetése', 'Jelentés',
  ];

  for (const label of LABELS) {
    it(`"${label}": the control, the row that holds it, and its wrapper stay on the page`, () => {
      const host = mount(`
        <div id="wrap"><div id="row">
          <div role="button" tabindex="0" id="ctl" aria-label="${label}"><span>${label}</span></div>
          <div role="button" tabindex="0"><span>Message</span></div>
        </div></div>`);
      for (const id of ['ctl', 'row', 'wrap']) {
        const el = host.querySelector<HTMLElement>(`#${id}`)!;
        expect(hideElement(el, opts()), id).toBe(false);
        stayedVisible(el);
      }
    });
  }

  it('a plain link or button with the words in its text and no label is still a control', () => {
    const host = mount('<div id="row"><a href="/settings/blocking"><span>Block</span></a><button id="b">Report</button></div>');
    expect(hideElement(host.querySelector<HTMLElement>('#b')!, opts())).toBe(false);
    expect(hideElement(host.querySelector<HTMLElement>('#row')!, opts())).toBe(false);
  });
});

describe('what the door still lets a filter hide', () => {
  it('a feed post row of Like, Comment and Share', () => {
    const host = mount(`
      <div role="article"><div id="bar">
        <div role="button" aria-label="Like">Like</div>
        <div role="button" aria-label="Comment">Comment</div>
        <div role="button" aria-label="Share">Share</div>
      </div></div>`);
    const bar = host.querySelector<HTMLElement>('#bar')!;
    expect(hideElement(bar, opts())).toBe(true);
    expect(bar.style.display).toBe('none');
  });

  it('a post modal that holds a post: its engagement row is hidden as before', () => {
    const host = mount(`
      <div role="dialog"><div role="article"><div id="bar">
        <button aria-label="Comment">Comment</button><button aria-label="Share">Share</button>
      </div></div></div>`);
    expect(hideElement(host.querySelector<HTMLElement>('#bar')!, opts())).toBe(true);
  });

  it('a whole ad module that happens to carry a "Report ad" link among many controls', () => {
    const links = Array.from({ length: 12 }, (_, i) => `<a href="/x/${i}">Offer ${i}</a>`).join('');
    const host = mount(`<section id="ad"><span>Sponsored</span>${links}<a href="/ads/report">Report ad</a></section>`);
    const ad = host.querySelector<HTMLElement>('#ad')!;
    expect(hideElement(ad, opts())).toBe(true);
    expect(ad.style.display).toBe('none');
  });

  it('a post whose own words mention blocking and reporting is a post, not a control', () => {
    const host = mount('<div role="article" id="post"><p>How to block and report a scammer</p><span>Like</span></div>');
    expect(hideElement(host.querySelector<HTMLElement>('#post')!, { ...opts(), reason: 'word-filter:household' })).toBe(true);
  });
});

describe('the refusal that was already there is unchanged', () => {
  it('a private conversation log is still refused', () => {
    const host = mount('<div role="log"><div id="m">hello</div></div>');
    expect(hideElement(host.querySelector<HTMLElement>('#m')!, opts())).toBe(false);
  });
});
