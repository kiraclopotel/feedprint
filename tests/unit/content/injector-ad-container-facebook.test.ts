// @vitest-environment jsdom
//
// The recorder's ad hide on Facebook's current home feed: the unit is
// [aria-posinset] and the role=article inside it is an empty shell, so the
// hide must resolve the unit from the caption (owner's tab 2026-09-03: an
// "Explee AI · Ad" post was folded with its picture and button left).

import { describe, expect, it } from 'vitest';
import { injectAdHide } from '../../../src/content/injector';

describe('injectAdHide on Facebook', () => {
  it('hides the [aria-posinset] unit when the caption sits beside an empty article shell', () => {
    document.body.innerHTML = `
      <div aria-posinset="3"><div role="article" aria-label=""></div>
        <div data-ad-rendering-role="story_message"><div dir="auto" id="cap">Get your first leads free</div></div>
      </div>`;
    const cap = document.getElementById('cap') as HTMLElement;
    expect(injectAdHide(cap, 'facebook')).toBe(true);
    const unit = document.querySelector<HTMLElement>('[aria-posinset]')!;
    expect(unit.getAttribute('data-fw-ad-hidden')).toBe('true');
    expect(unit.style.display).toBe('none');
  });

  it('still hides a permalink post that is a role=article', () => {
    document.body.innerHTML = `<div role="article"><div dir="auto" id="cap">Sponsored text</div></div>`;
    expect(injectAdHide(document.getElementById('cap') as HTMLElement, 'facebook')).toBe(true);
    expect(document.querySelector<HTMLElement>('[role="article"]')!.style.display).toBe('none');
  });
});
