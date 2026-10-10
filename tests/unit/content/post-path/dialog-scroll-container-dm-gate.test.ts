// @vitest-environment jsdom
//
// META-7 (audit swarm-2026-07-13) — both FB and IG adapters' modal-scroll-
// trigger wiring (`_findDialogScrollContainer`) discovers its target via
// `document.querySelectorAll('[role="dialog"]')` with NO chat/DM exclusion
// (no `findChatOverlayAncestor`, `role="log"`, or `isPrivateMessageSurface`
// reference anywhere in that method). A coexisting Messenger/IG chat dialog
// with a scrollable message list satisfies the exact same heuristic
// (`overflowY: auto|scroll` + `scrollHeight > clientHeight + 10`) and can be
// selected instead of the real comments/post modal — attaching a live
// scroll listener to, and walking the full DOM of, a private conversation
// window. Locks that the chat dialog is excluded from the candidate list so
// the trigger always wires to the genuine (non-chat) dialog's scroller.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/content/post-path/scroll-trigger', () => ({
  setupScrollExtractionTrigger: vi.fn(() => () => {}),
}));

import { setupScrollExtractionTrigger } from '../../../../src/content/post-path/scroll-trigger';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';

function setLocation(hostname: string, pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname, search: '', href: `https://${hostname}${pathname}` },
    writable: true,
    configurable: true,
  });
}

function makeScroller(id: string): HTMLDivElement {
  const el = document.createElement('div');
  el.id = id;
  el.style.overflowY = 'auto';
  Object.defineProperty(el, 'scrollHeight', { value: 2000, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: 400, configurable: true });
  return el;
}

function chatDialogWithScroller(id: string): HTMLDivElement {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Chat with Example Contact');
  dialog.appendChild(makeScroller(id));
  return dialog;
}

function genuineDialogWithScroller(id: string): { dialog: HTMLDivElement; scroller: HTMLDivElement } {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Comments');
  const scroller = makeScroller(id);
  dialog.appendChild(scroller);
  return { dialog, scroller };
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('a dialog with no scroller is not re-walked on every extractPosts call (H6, 2026-09-02)', () => {
  function dialogWithoutScroller(children: number): HTMLDivElement {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Comments');
    for (let i = 0; i < children; i++) {
      const el = document.createElement('div');
      el.textContent = `row ${i}`;
      dialog.appendChild(el);
    }
    return dialog;
  }

  for (const [label, make] of [
    ['IG', () => { setLocation('www.instagram.com', '/'); return new InstagramAdapter(); }],
    ['FB', () => { setLocation('www.facebook.com', '/'); return new FacebookAdapter(); }],
  ] as const) {
    it(`${label}: walks the dialog once, skips it inside 2 s, walks again after`, () => {
      const adapter = make();
      const dialog = dialogWithoutScroller(20);
      document.body.append(dialog);
      const styleSpy = vi.spyOn(window, 'getComputedStyle');
      let now = 1_000_000;
      const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);

      adapter.extractPosts(document.body.childNodes);
      const firstWalk = styleSpy.mock.calls.length;
      expect(firstWalk).toBeGreaterThan(0);

      now += 500;
      adapter.extractPosts(document.body.childNodes);
      expect(styleSpy.mock.calls.length).toBe(firstWalk);

      now += 2_000;
      adapter.extractPosts(document.body.childNodes);
      expect(styleSpy.mock.calls.length).toBeGreaterThan(firstWalk);

      expect(setupScrollExtractionTrigger).not.toHaveBeenCalled();
      nowSpy.mockRestore();
      styleSpy.mockRestore();
    });
  }
});

describe('META-7 — modal-scroll-trigger discovery excludes chat-overlay dialogs', () => {
  it('FB: does not wire the scroll trigger to a coexisting chat dialog scroller', () => {
    setLocation('www.facebook.com', '/');
    const chat = chatDialogWithScroller('fb-chat-scroller');
    const { dialog: commentsDialog, scroller: commentsScroller } = genuineDialogWithScroller('fb-comments-scroller');
    // Chat dialog first in DOM order — worst case, since the scan returns
    // the first qualifying dialog.
    document.body.append(chat, commentsDialog);

    new FacebookAdapter().extractPosts(document.body.childNodes);

    expect(setupScrollExtractionTrigger).toHaveBeenCalledTimes(1);
    expect((setupScrollExtractionTrigger as any).mock.calls[0][0]).toBe(commentsScroller);
  });

  it('IG: does not wire the scroll trigger to a coexisting chat dialog scroller', () => {
    setLocation('www.instagram.com', '/');
    const chat = chatDialogWithScroller('ig-chat-scroller');
    const { dialog: postDialog, scroller: postScroller } = genuineDialogWithScroller('ig-post-scroller');
    document.body.append(chat, postDialog);

    new InstagramAdapter().extractPosts(document.body.childNodes);

    expect(setupScrollExtractionTrigger).toHaveBeenCalledTimes(1);
    expect((setupScrollExtractionTrigger as any).mock.calls[0][0]).toBe(postScroller);
  });
});
