/** @vitest-environment jsdom */
// PA5F (verifier, built popup a9d895f5). After Hold to show was let go with a MOUSE, the typing did not go back to
// the PIN box: a mouse press leaves the focus on the page body, and the release handed the focus back only when the
// control held it. The unit test of PA unit 5 passed because it focused the control first. These checks never do:
// the box loses the focus (as a real press takes it) and the control is never focused.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, useState } from 'react';

import { installStorage, unmount, mount, host } from '../../../helpers/popup-walk';
import { PinDigits } from '../../../../src/ui/popup/controls';

beforeEach(() => { installStorage({}); });
afterEach(async () => { await unmount(); });

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
const showButton = () => host.querySelector<HTMLButtonElement>('button[data-pin-show]')!;
const fire = async (el: Element, type: string) => { await act(async () => { el.dispatchEvent(new Event(type, { bubbles: true })); }); };

/** The person is in box `i`; a mouse press on the control takes the focus off the box and gives it to the page body. */
async function mousePressAwayFromBox(i: number) {
  await act(async () => { boxes()[i].focus(); });
  await act(async () => { boxes()[i].blur(); });
  expect(document.activeElement, 'the press left the focus on the body, not on the control').toBe(document.body);
  await fire(showButton(), 'pointerdown');
}

async function typeIntoFocused(digit: string) {
  const el = document.activeElement as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, digit);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Hold to show, let go with a mouse or a finger: the typing goes back to the box (PA5F)', () => {
  it('a mouse release (pointerup) with the focus on the body gives the focus back, and the next digit lands in the same row', async () => {
    const set = vi.fn();
    await mount(createElement(PinDigits, { value: ['1', '', '', ''], set }));
    await mousePressAwayFromBox(1);
    await fire(showButton(), 'pointerup');

    expect(document.activeElement).toBe(boxes()[1]);
    await typeIntoFocused('7');
    expect(set).toHaveBeenLastCalledWith(['1', '7', '', '']);
  });

  it('a plain click (pointerdown, pointerup, click) does the same and the digits are hidden again', async () => {
    const set = vi.fn();
    await mount(createElement(PinDigits, { value: ['1', '2', '', ''], set }));
    await mousePressAwayFromBox(2);
    for (const b of boxes()) expect(b.getAttribute('data-masked'), 'shown while held').toBe('false');
    await fire(showButton(), 'pointerup');
    await fire(showButton(), 'click');

    for (const b of boxes()) expect(b.getAttribute('data-masked')).toBe('true');
    expect(document.activeElement).toBe(boxes()[2]);
    await typeIntoFocused('9');
    expect(set).toHaveBeenLastCalledWith(['1', '2', '9', '']);
  });

  it('a touch that is cancelled, or a pointer that leaves the control while held, gives the focus back too', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '3', ''], set: () => {} }));
    await mousePressAwayFromBox(3);
    await fire(showButton(), 'pointercancel');
    expect(document.activeElement).toBe(boxes()[3]);

    await act(async () => { boxes()[3].blur(); });
    await fire(showButton(), 'pointerdown');
    await fire(showButton(), 'pointerout');
    expect(document.activeElement).toBe(boxes()[3]);
  });

  it('a pointer that only passes over the control, with the focus on the body, takes nothing', async () => {
    await mount(createElement(PinDigits, { value: ['', '', '', ''], set: () => {} }));
    await act(async () => { boxes()[0].focus(); boxes()[0].blur(); });
    await fire(showButton(), 'pointerover');
    await fire(showButton(), 'pointerout');
    expect(document.activeElement, 'nothing was pressed, so nothing moved').toBe(document.body);
  });

  it('focus that has gone to another control since the press is left where it is', async () => {
    await mount(createElement('div', null,
      createElement(PinDigits, { value: ['1', '', '', ''], set: () => {} }),
      createElement('button', { id: 'elsewhere' }, 'elsewhere'),
    ));
    await mousePressAwayFromBox(1);
    const other = host.querySelector<HTMLButtonElement>('#elsewhere')!;
    await act(async () => { other.focus(); });
    await fire(showButton(), 'pointerup');
    expect(document.activeElement).toBe(other);
  });
});

// PA3 (the stranger's S17): after a keyboard hold the focus went back to the LAST box focused, not the first empty one,
// so a row read "x x _ x" and Continue stayed grey. The release returns to the first empty box when there is one.
const key = async (el: Element, type: 'keydown' | 'keyup', k: string) => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })); });
};

function Row({ onValue }: { onValue: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>(['', '', '', '']);
  return createElement(PinDigits, { value, set: (v: string[]) => { setValue(v); onValue(v); }, autoFocus: true });
}

describe('Hold to show on one row while typing in another (the verifier\'s palook.mjs path, PA5F)', () => {
  it('pressing the first row\'s eye while the focus is in the Confirm row: the release goes back to the Confirm row', async () => {
    let second: string[] = [];
    const Two = () => {
      const [a, setA] = useState<string[]>(['1', '2', '3', '4']);
      const [b, setB] = useState<string[]>(['', '', '', '']);
      return createElement('div', null,
        createElement(PinDigits, { value: a, set: setA }),
        createElement(PinDigits, { value: b, set: (v: string[]) => { setB(v); second = v; } }),
      );
    };
    await mount(createElement(Two));
    const all = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
    const eyes = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-pin-show]'));
    await act(async () => { all()[4].focus(); });
    // A real mouse press: the pointer goes down while the focus is still in the box, then the press takes it to the body.
    await fire(eyes()[0], 'pointerdown');
    await act(async () => { all()[4].blur(); });
    expect(document.activeElement).toBe(document.body);
    await fire(eyes()[0], 'pointerup');

    expect(document.activeElement, 'the first empty box of the Confirm row').toBe(all()[4]);
    for (const d of ['5', '6', '7', '8']) await typeIntoFocused(d);
    expect(second).toEqual(['5', '6', '7', '8']);
  });
});

describe('Hold to show, let go with the keyboard: the typing goes on in the first empty box (PA3)', () => {
  it('type 2, Tab to the eye, hold Space, release, type 2: all four boxes are filled', async () => {
    let last: string[] = [];
    await mount(createElement(Row, { onValue: (v: string[]) => { last = v; } }));
    await typeIntoFocused('1');
    await typeIntoFocused('2');
    expect(document.activeElement).toBe(boxes()[2]);

    await act(async () => { showButton().focus(); });
    await key(showButton(), 'keydown', ' ');
    await key(showButton(), 'keyup', ' ');
    expect(document.activeElement, 'the first empty box').toBe(boxes()[2]);

    await typeIntoFocused('3');
    await typeIntoFocused('4');
    expect(last).toEqual(['1', '2', '3', '4']);
  });

  it('with a gap in the row, the release goes to the gap, not to the last box focused', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '', '4'], set: () => {} }));
    await act(async () => { boxes()[3].focus(); });
    await act(async () => { showButton().focus(); });
    await key(showButton(), 'keydown', ' ');
    await key(showButton(), 'keyup', ' ');
    expect(document.activeElement).toBe(boxes()[2]);
  });

  it('with a full row, the release goes back to the box the person came from', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '3', '4'], set: () => {} }));
    await act(async () => { boxes()[1].focus(); });
    await act(async () => { showButton().focus(); });
    await key(showButton(), 'keydown', ' ');
    await key(showButton(), 'keyup', ' ');
    expect(document.activeElement).toBe(boxes()[1]);
  });
});
