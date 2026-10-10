/** @vitest-environment jsdom */
//
// "Block this" had no private-surface gate, and it is the filter that would
// have carried a private conversation the furthest.
//
// Found 2026-09-19 by a read of the free product, then checked against the
// source here. Every other Off filter consults isInPrivateChatSubtree; the
// picker consulted only its own NEVER list. NEVER holds `[role="dialog"]`,
// which stops the chat dialog ITSELF from being picked, and says nothing at
// all about the rows inside it. `[role="log"]`, Messenger's own marker, is not
// in that list.
//
// Two ways out, both reachable on an ordinary feed page with the dock open:
//
//   1. The account branch of boundaryFor never reaches guard(). On Facebook
//      CONTAINER_SELECTORS is `div[role="article"], [role="article"]`, so a
//      click on a message row that carries that role returns kind:'post',
//      readAuthor takes the name off it, and the caller writes that name into
//      the stored blocklist. The name of the person someone is talking to
//      privately, copied out of the conversation into settings.
//
//   2. The shape branch remembers a selector chain and then scans the WHOLE
//      document against it every two seconds, forever. A shape taken from a
//      message row matches other message rows, so one pick would silently
//      erase chat messages on every later visit, on a product whose whole
//      promise is that it does not touch private conversations.
//
// The fix is two lines: boundaryFor refuses before either branch, and guard()
// refuses, which covers scanPicked as well, so a shape recorded somewhere
// public still cannot land on a message row later.
//
// These cases are the two sides. The picker must still pick in the feed, or
// the gate has just broken the feature it protects.

import { describe, it, expect, beforeEach } from 'vitest';
import { boundaryFor } from '../../../../src/content/engagement/picker';

// jsdom gives every element a zero-size rect, and guard() requires 24x24, so
// the box branch needs a real measurement to be exercised at all.
beforeEach(() => {
  document.body.innerHTML = '';
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return { width: 300, height: 200, top: 0, left: 0, right: 300, bottom: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});

const pick = (id: string) => boundaryFor(document.getElementById(id)!, 'facebook');

describe('a pick never lands in a conversation (2026-09-19)', () => {
  it('still names the author of a post in the feed, or this is not a fix', () => {
    document.body.innerHTML = `
      <div role="feed">
        <div role="article" id="post"><h3><a href="/ann">Ann Smith</a></h3><div id="body">a holiday photo</div></div>
      </div>`;
    const b = pick('body');
    expect(b?.kind, 'a click in the feed still resolves to a post').toBe('post');
  });

  it('still takes the shape of a tray in the feed', () => {
    document.body.innerHTML = '<div role="region" aria-label="Stories" id="tray"><div id="card">a story</div></div>';
    const b = pick('card');
    expect(b?.kind, 'a click on a panel still resolves to a box').toBe('box');
  });

  it('refuses a message row inside the chat log', () => {
    // role="log" is Messenger's own live-region marker, per adapter.ts. The
    // row carries role="article" here, which is what makes the account branch
    // reachable: without the gate this returns kind:'post' with an author.
    document.body.innerHTML = `
      <div role="log">
        <div role="article" id="msg"><h3><a href="/mara">Mara</a></h3><div id="said">see you at six</div></div>
      </div>`;
    expect(pick('said'), 'nothing in a chat log is pickable').toBeNull();
    expect(pick('msg')).toBeNull();
  });

  it('refuses a row inside a chat dialog that the URL gate never sees', () => {
    // The dock on a feed page: the URL is still the feed, so isPrivateMessageSurface
    // is false and the content script is running. Only the DOM region says this
    // is private. The dialog has an aria-label from CHAT_OVERLAY_MARKERS.
    document.body.innerHTML = `
      <div role="dialog" aria-label="Chat with Mara">
        <div data-testid="message-row" id="bubble"><span id="text">are you coming</span></div>
      </div>`;
    expect(pick('text'), 'a bubble in the dock is not a box to block').toBeNull();
  });

  it('refuses the composer inside a chat dialog in another language', () => {
    // The marker list is multi-language on purpose: Facebook localizes the
    // dialog label, and the 2026-05-27 incident was a Romanian one.
    document.body.innerHTML = `
      <div role="dialog" aria-label="Conversație cu Mara">
        <div role="textbox" aria-label="Scrie un mesaj" id="composer">buna</div>
      </div>`;
    expect(pick('composer')).toBeNull();
  });
});
