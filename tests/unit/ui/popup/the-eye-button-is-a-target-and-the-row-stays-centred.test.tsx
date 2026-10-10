/** @vitest-environment jsdom */
// PAG (PAINT-5 P5-1, P5-2, P5-3, build a9d895f5). The Hold to show button sat inside the centred row, so every PIN row
// moved 15 px left of the title's centre line; its target was 22 by 14 px; and the mask dot was 4 by 4 px in a 40 by 48
// box, so a filled row read almost like an empty one. jsdom draws nothing, so these read the styles that decide it;
// the geometry itself is read on a built package (run/maker/evidence/pag-geometry.mjs).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';

import { installStorage, unmount, mount, host } from '../../../helpers/popup-walk';
import { PinDigits } from '../../../../src/ui/popup/controls';

beforeEach(() => { installStorage({}); });
afterEach(async () => { await unmount(); });

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
const row = () => host.querySelector<HTMLElement>('.pin-row')!;
const showButton = () => host.querySelector<HTMLButtonElement>('button[data-pin-show]')!;
const px = (v: string) => parseFloat(v);

describe('the eye button stays out of the row\'s width (P5-1)', () => {
  it('the row is a positioning parent and the button is placed absolutely, right of the last box', async () => {
    await mount(createElement(PinDigits, { value: ['', '', '', ''], set: () => {} }));
    expect(row().style.position).toBe('relative');
    expect(showButton().style.position, 'out of the flex flow, so the four boxes stay centred').toBe('absolute');
    expect(showButton().style.left, 'placed from the row\'s centre, past the last box').toMatch(/^calc\(50% \+ \d+px\)$/);
    expect(boxes().length).toBe(4);
  });
});

describe('the eye button is a target a pointer can hit (P5-2)', () => {
  it('its box is at least 24 by 24 px; the icon stays 14 px', async () => {
    await mount(createElement(PinDigits, { value: ['', '', '', ''], set: () => {} }));
    expect(px(showButton().style.width)).toBeGreaterThanOrEqual(24);
    expect(px(showButton().style.height)).toBeGreaterThanOrEqual(24);
    const icon = showButton().querySelector('svg')!;
    expect(icon.getAttribute('width')).toBe('14');
    expect(icon.getAttribute('height')).toBe('14');
  });
});

describe('a masked box shows a disc a person can see, a shown digit is unchanged (P5-3)', () => {
  it('masked boxes carry a larger font size than the digit; while held, the digits are the size they were', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '', ''], set: () => {} }));
    for (const b of boxes()) {
      expect(b.getAttribute('data-masked')).toBe('true');
      expect(px(b.style.fontSize), 'the disc is drawn at the font size: bigger than the 18 px digit').toBeGreaterThanOrEqual(26);
    }
    await act(async () => { showButton().dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    for (const b of boxes()) {
      expect(b.getAttribute('data-masked')).toBe('false');
      expect(b.style.fontSize, 'shown digits keep the stylesheet\'s size').toBe('');
    }
  });
});
