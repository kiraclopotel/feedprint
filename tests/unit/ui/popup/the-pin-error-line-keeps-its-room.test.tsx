/** @vitest-environment jsdom */
// L3 (the look owner's row of 19:38; STANDARD St Error, T Help, S). On a wrong PIN "Incorrect PIN" was inserted and the
// panel's top jumped 12 px, then back when it cleared; on Change PIN and Off's Set PIN, "The two PINs do not match."
// was inserted and the Save button dropped as the fourth digit landed. The lines were right; the room was not kept.
//
// Now every error line of a PIN screen sits inside a slot that is already there (.pin-err-slot), so the line appears
// without moving anything; the line itself is one class (.pin-err) and the legend over each PIN row is one class
// (.pin-legend), with no inline size or colour. The StatusLine stays conditional, so what a screen reader hears does
// not change. jsdom has no layout: the pixel readings are in run/maker2/evidence/L3/ (photos and y readings).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';

import { act } from 'react';

import { installStorage, unmount, mount, host, settle, t, typePin } from '../../../helpers/popup-walk';
import { ChangePinPanel, PinOverlay, PinRecoveryForm, SetPinPanel } from '../../../../src/ui/popup/controls';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    verifyPin: vi.fn(async () => false),
    pinLockRemainingMs: vi.fn(async () => 0),
  };
});

beforeEach(() => { installStorage(); });
afterEach(async () => { await unmount(); });

const slot = () => host.querySelector<HTMLElement>('.pin-err-slot');
const alerts = () => Array.from(host.querySelectorAll<HTMLElement>('[role="alert"]'));

function legendsAreOneClass(expected: number): void {
  const legends = Array.from(host.querySelectorAll<HTMLElement>('fieldset > legend'));
  expect(legends.length).toBe(expected);
  for (const l of legends) {
    expect(l.className, 'the legend over a PIN row is one class').toBe('pin-legend');
    expect(l.getAttribute('style'), 'and carries no inline size or colour').toBeNull();
  }
}

function theLineAppearedInTheSlotThatWasThere(before: HTMLElement | null, text: string): void {
  expect(before, 'the slot is there before the line').not.toBeNull();
  expect(slot(), 'and it is the same element afterwards').toBe(before);
  const line = Array.from(before!.querySelectorAll<HTMLElement>('[role="alert"]')).find((a) => a.textContent === text);
  expect(line, `the line "${text}" is inside the slot`).toBeTruthy();
  expect(line!.className).toBe('pin-err');
  expect(line!.getAttribute('style'), 'no inline size or colour on the line').toBeNull();
}

describe('the PIN screens hold still: the error line keeps its room', () => {
  it('the wrong-PIN prompt: the slot is there at rest, and "Incorrect PIN" appears inside it', async () => {
    await mount(createElement(PinOverlay, { onSuccess: () => {}, onCancel: () => {} }));
    const before = slot();
    expect(before, 'the slot is there with no error').not.toBeNull();
    expect(alerts().length, 'and nothing is announced yet').toBe(0);
    await typePin(0, '9999');
    theLineAppearedInTheSlotThatWasThere(before, t.pinIncorrect);
  });

  it('Change PIN: the slot is there at rest, and the mismatch appears inside it', async () => {
    await mount(createElement(ChangePinPanel, { onDone: () => {} }));
    legendsAreOneClass(3);
    const before = slot();
    expect(before).not.toBeNull();
    expect(alerts().length).toBe(0);
    await typePin(0, '1234');
    await typePin(1, '5678');
    await typePin(2, '5679');
    await settle();
    theLineAppearedInTheSlotThatWasThere(before, t.offPinMismatch);
  });

  it('Set PIN (Off and Receipts Settings): the slot is there at rest, and the mismatch appears inside it', async () => {
    await mount(createElement(SetPinPanel, { onDone: () => {} }));
    legendsAreOneClass(2);
    const before = slot();
    expect(before).not.toBeNull();
    expect(alerts().length).toBe(0);
    await typePin(0, '1234');
    await typePin(1, '4321');
    await settle();
    theLineAppearedInTheSlotThatWasThere(before, t.offPinMismatch);
  });

  it('the recovery form has its slot and its legends as one class', async () => {
    installStorage({ fw_pin_recovery: 'a-stored-hash' });   // a recovery phrase exists, so the form shows its fields
    await mount(createElement(PinRecoveryForm, { onSuccess: () => {}, onCancel: () => {} }));
    await settle();
    legendsAreOneClass(2);
    expect(slot(), 'the slot is there with no error').not.toBeNull();
    expect(alerts().length).toBe(0);
  });
});

// L3 rework (the look owner's remedy of 21:40). The kept room puts the Save button 25 px lower at rest, below the popup's
// 600 px edge, so when the confirm row's fourth digit lands the Save button is brought into view. jsdom has no layout and
// no scrollIntoView; the photos in run/maker2/evidence/L3/ show the whole button inside 600 px.
describe('the Save button comes into view when the confirm row is complete', () => {
  let scroll: ReturnType<typeof vi.fn>;
  let scrolled: Element[];
  beforeEach(() => {
    scrolled = [];
    scroll = vi.fn(function (this: Element) { scrolled.push(this); });
    Element.prototype.scrollIntoView = scroll as unknown as Element['scrollIntoView'];
  });
  afterEach(() => { delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView; });

  // Types `digits` into the boxes of one row from box `from` on (typePin always fills all four).
  async function typeBoxes(group: number, digits: string, from = 0): Promise<void> {
    const boxes = Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box')).slice(group * 4, group * 4 + 4);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    for (let i = 0; i < digits.length; i++) {
      await act(async () => { setter.call(boxes[from + i], digits[i]); boxes[from + i].dispatchEvent(new Event('input', { bubbles: true })); });
    }
    await settle();
  }
  const saveButton = () => host.querySelector<HTMLElement>('button.pop-cta');

  it('Change PIN: not before the fourth digit of the confirm row, then once, on the Save button, block nearest', async () => {
    await mount(createElement(ChangePinPanel, { onDone: () => {} }));
    await typePin(0, '1234');
    await typePin(1, '5678');
    await typeBoxes(2, '567');
    expect(scroll, 'three digits of the confirm row bring nothing into view').not.toHaveBeenCalled();
    await typeBoxes(2, '8', 3);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrolled[0], 'and it is the Save button that is brought into view').toBe(saveButton());
  });

  it('Set PIN (Off and Receipts Settings): not before the fourth digit of the confirm row, then once, on the Save button', async () => {
    await mount(createElement(SetPinPanel, { onDone: () => {} }));
    await typePin(0, '1234');
    await typeBoxes(1, '432');
    expect(scroll).not.toHaveBeenCalled();
    await typeBoxes(1, '1', 3);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    expect(scrolled[0]).toBe(saveButton());
  });
});
