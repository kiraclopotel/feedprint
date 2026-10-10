/** @vitest-environment jsdom */
// PA unit 5 (S14 rows P1 and P2, out/stranger/PIN-SCREENS.md). After the hold-to-show control was released, focus
// stayed on it, so the next digits typed were lost (both products). Focus now goes back to the PIN box the person
// came from. The control also says what it does: "Hold to show", as its label and its tooltip.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';

import { installStorage, unmount, mount, host, t } from '../../../helpers/popup-walk';
import { PinDigits } from '../../../../src/ui/popup/controls';
import { EN } from '../../../../src/i18n/popup/en';
import { ES } from '../../../../src/i18n/popup/es';
import { PT_BR } from '../../../../src/i18n/popup/pt-br';
import { RO } from '../../../../src/i18n/popup/ro';

beforeEach(() => { installStorage({}); });
afterEach(async () => { await unmount(); });

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
const showButton = () => host.querySelector<HTMLButtonElement>('button[data-pin-show]')!;
const fire = async (el: Element, type: string) => { await act(async () => { el.dispatchEvent(new Event(type, { bubbles: true })); }); };
const key = async (el: Element, type: 'keydown' | 'keyup', k: string) => {
  await act(async () => { el.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true })); });
};

/** The person is in box `i`, then presses the control with a mouse: the press takes the focus off the box and a mouse press leaves it on the page body, not on the control (PA5F). */
async function focusBoxThenPress(i: number) {
  await act(async () => { boxes()[i].focus(); });
  await act(async () => { boxes()[i].blur(); });
  expect(document.activeElement).toBe(document.body);
  await fire(showButton(), 'pointerdown');
}

/** Types one digit into whichever element has the focus, the way the keyboard does. */
async function typeIntoFocused(digit: string) {
  const el = document.activeElement as HTMLInputElement;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, digit);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('after the hold-to-show control is released, typing goes on in the box', () => {
  it('a pointer release gives the focus back to the box the person came from, and the next digit lands there', async () => {
    const set = vi.fn();
    await mount(createElement(PinDigits, { value: ['1', '', '', ''], set }));
    await focusBoxThenPress(1);
    await fire(showButton(), 'pointerup');

    expect(document.activeElement).toBe(boxes()[1]);
    await typeIntoFocused('7');
    expect(set).toHaveBeenLastCalledWith(['1', '7', '', '']);
  });

  it('a keyboard release (Space up) does the same', async () => {
    const set = vi.fn();
    await mount(createElement(PinDigits, { value: ['1', '2', '', ''], set }));
    await act(async () => { boxes()[2].focus(); });
    await act(async () => { showButton().focus(); });
    await key(showButton(), 'keydown', ' ');
    await key(showButton(), 'keyup', ' ');

    expect(document.activeElement).toBe(boxes()[2]);
    await typeIntoFocused('9');
    expect(set).toHaveBeenLastCalledWith(['1', '2', '9', '']);
  });

  it('leaving the control while it is held also hides the digits and gives the focus back', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '3', ''], set: () => {} }));
    await focusBoxThenPress(3);
    await fire(showButton(), 'pointerout');

    for (const b of boxes()) expect(b.getAttribute('data-masked')).toBe('true');
    expect(document.activeElement).toBe(boxes()[3]);
  });

  it('a pointer that only passes over the control does not take the focus from where it is', async () => {
    await mount(createElement(PinDigits, { value: ['', '', '', ''], set: () => {} }));
    await act(async () => { boxes()[0].focus(); });
    await fire(showButton(), 'pointerover');
    await fire(showButton(), 'pointerout');
    expect(document.activeElement).toBe(boxes()[0]);
  });
});

describe('the control says what it does', () => {
  it('its label and its tooltip are "Hold to show"', async () => {
    await mount(createElement(PinDigits, { value: ['', '', '', ''], set: () => {} }));
    expect(t.pinShowHold).toBe('Hold to show');
    expect(showButton().getAttribute('aria-label')).toBe(t.pinShowHold);
    expect(showButton().getAttribute('title')).toBe(t.pinShowHold);
  });

  it('every popup language has the words, and none is the bare "show"', () => {
    for (const [name, s] of Object.entries({ EN, ES, PT_BR, RO })) {
      expect(typeof s.pinShowHold, name).toBe('string');
      expect(s.pinShowHold.length, name).toBeGreaterThan(s.show.length);
      expect(s.pinShowHold, name).not.toContain('—');
    }
  });
});
