// @vitest-environment jsdom
//
// M118: a Facebook feed post with no timestamp permalink (no stable id in the
// DOM) gets a random UUID on first extraction and stashes it on the element
// as data-fw-post-id. A rescan that clears the processed stamps (route
// change, Child turn-on: interceptor `_clearExtractionStamps`) sends the same
// element back through the FIRST-entry path, which minted a second UUID, so
// the post's later comments carried a new id and the id-keyed session verdict
// cache missed (a second LLM call for the same post). The first-entry path now
// falls back to the stash before minting; a real extracted id still wins.

import { beforeEach, describe, expect, it } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';

function setLocation(hostname: string, pathname: string): void {
  Object.defineProperty(window, 'location', {
    value: { hostname, pathname, search: '', href: `https://${hostname}${pathname}`, origin: `https://${hostname}` },
    writable: true,
    configurable: true,
  });
}

/** An anchorless feed unit: body text, no timestamp link, no permalink. */
function anchorlessUnit(text: string): HTMLElement {
  const unit = document.createElement('div');
  unit.setAttribute('aria-posinset', '1');
  unit.innerHTML = `<div data-ad-rendering-role="story_message"><span>${text}</span></div>`;
  return unit;
}

/** The adapter prefixes the random fallback: `fb-post-<uuid>`. */
const UUID_RE = /^fb-post-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  document.body.innerHTML = '';
  setLocation('www.facebook.com', '/');
});

describe('Facebook anchorless post id survives a stamp-clearing rescan (M118)', () => {
  it('keeps the first UUID when the processed stamp is cleared and the unit is re-extracted', () => {
    const adapter = new FacebookAdapter();
    const unit = anchorlessUnit('A feed post body long enough to be extracted as content');
    document.body.appendChild(unit);

    const first = adapter.extractPosts(document.body.childNodes);
    expect(first.length).toBeGreaterThanOrEqual(1);
    const firstId = first[0].id;
    expect(firstId).toMatch(UUID_RE);
    // The adapter stashes the raw id for re-entry; the record id carries the
    // platform prefix on top of it.
    const stamped = document.body.querySelector<HTMLElement>('[data-fw-post-id]');
    expect(stamped?.dataset.fwPostId).toBeTruthy();
    expect(firstId.endsWith(stamped!.dataset.fwPostId!)).toBe(true);

    // What the interceptor's _clearExtractionStamps does on a route change
    // or Child turn-on: the processed stamp goes, the id stash stays.
    document.body.querySelectorAll<HTMLElement>('[data-fw-processed]').forEach((el) => {
      delete el.dataset.fwProcessed;
    });

    const second = adapter.extractPosts(document.body.childNodes);
    expect(second.length).toBeGreaterThanOrEqual(1);
    expect(second[0].id).toBe(firstId);
  });
});
