/** @vitest-environment jsdom */
//
// The count-chip scan walked the whole page and had no private-surface gate.
//
// The standing rule is one sentence: "Private surfaces (Messenger dock, DMs,
// chat overlays) are out of scope for every filter, not only the emoji
// stripper; the gate is by DOM region, not by URL alone."
//
// structural-finder, ai-content-blocker and empty-comment-hide all call
// isInPrivateChatSubtree. section-model did not, and unlike the others it takes
// no root at all: it calls scan(document.body) on a 50ms timer and again every
// two seconds, so nothing upstream could scope it either.
//
// findCountChips visits nearly every leaf on the page and hides one whose whole
// direct text is a bare number, or a number beside a metric noun. An unread
// badge, or a message in a DM that is just a number, is exactly that shape. So
// with a Messenger dock or a DM panel open over the feed, a private message
// could be hidden by the feature that hides like counts.
//
// The chips themselves are the subject here, not the hiding: findCountChips is
// what decides, and what it returns is what gets display:none.

import { describe, it, expect, beforeEach } from 'vitest';
import { findCountChips } from '../../../../src/content/engagement/section-model';

beforeEach(() => { document.body.innerHTML = ''; });

const chips = () => findCountChips(document.body);
const has = (id: string) => chips().some((el) => el.id === id);

describe('the count-chip scan leaves private chats alone (2026-09-19)', () => {
  it('still finds a count chip in the feed', () => {
    // The feature has to keep working, or this is not a fix.
    document.body.innerHTML = '<div role="article"><span id="likes">1.2K</span></div>';
    expect(has('likes'), 'an ordinary like count is still a chip').toBe(true);
  });

  it('leaves a bare number inside a role=log alone', () => {
    // role="log" is Messenger's own marker, per adapter.ts.
    document.body.innerHTML = '<div role="log"><span id="msg">42</span></div>';
    expect(has('msg'), 'a message that is just a number is not a like count').toBe(false);
  });

  it('leaves a number inside a chat overlay alone', () => {
    document.body.innerHTML = `
      <div role="dialog" aria-label="Chat with Maria">
        <span id="dm">7</span>
      </div>`;
    expect(has('dm')).toBe(false);
  });

  it('a feed chip and a private one on the same page are told apart', () => {
    // The real shape: a dock open on top of a feed, both present at once.
    document.body.innerHTML = `
      <div role="article"><span id="feedlikes">318</span></div>
      <div role="log"><span id="private">318</span></div>`;
    const found = chips().map((el) => el.id);
    expect(found, 'the feed one is hidden').toContain('feedlikes');
    expect(found, 'the identical one in the chat is not').not.toContain('private');
  });

  it('checks the region, not the text, so identical numbers get opposite answers', () => {
    // Stated as its own case because it is the whole rule: the gate is by DOM
    // region and not by anything readable in the string.
    document.body.innerHTML = `
      <div role="article"><span id="a">5</span></div>
      <div role="log"><span id="b">5</span></div>`;
    expect(has('a')).toBe(true);
    expect(has('b')).toBe(false);
  });
});
