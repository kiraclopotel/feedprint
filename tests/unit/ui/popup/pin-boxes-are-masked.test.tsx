/** @vitest-environment jsdom */
// PA unit 1 (S-2, the owner's decision of 30 Sep 02:12). The four PIN digits showed in the clear, large, on
// screens that say the PIN is for a shared computer; the license key beside it is masked. Every PIN box, in both
// products, now shows discs (the number pad keyboard stays: inputMode numeric), with a control that shows the
// digits only while it is held, so a person can check what they typed without leaving it on screen.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';

import { installStorage, unmount, mount, host, settle, click, button, modeButton, t } from '../../../helpers/popup-walk';
import { ChangePinPanel, PinDigits, PinOverlay, PinRecoveryForm, SetPinPanel } from '../../../../src/ui/popup/controls';
import { SetupWizard } from '../../../../src/ui/popup/Popup';
import { _setProductForTesting } from '../../../../src/product';

vi.mock('../../../../src/ai/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/ai/client')>();
  return { ...actual, probeProxy: vi.fn(async () => 'ok') };
});

beforeEach(() => { installStorage({ fw_pin_recovery: 'pbkdf2$1$00$00' }); });
afterEach(async () => { await unmount(); _setProductForTesting(null); });

const boxes = () => Array.from(host.querySelectorAll<HTMLInputElement>('input.pin-box'));
const showButtons = () => Array.from(host.querySelectorAll<HTMLButtonElement>('button[data-pin-show]'));
const fire = async (el: Element, type: string) => { await act(async () => { el.dispatchEvent(new Event(type, { bubbles: true })); }); };

describe('every PIN box shows discs, not digits', () => {
  it('a row of PinDigits: masked, number pad kept, and the show control reveals only while held', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '3', '4'], set: () => {} }));
    expect(boxes()).toHaveLength(4);
    for (const b of boxes()) {
      expect(b.getAttribute('data-masked'), 'discs by default').toBe('true');
      expect(b.getAttribute('inputmode'), 'the number pad stays').toBe('numeric');
    }
    expect(showButtons()).toHaveLength(1);
    expect(showButtons()[0].getAttribute('aria-label')).toBe(t.pinShowHold);
    expect(showButtons()[0].getAttribute('title')).toBe(t.pinShowHold);

    await fire(showButtons()[0], 'pointerdown');
    for (const b of boxes()) expect(b.getAttribute('data-masked'), 'held: shown').toBe('false');
    await fire(showButtons()[0], 'pointerup');
    for (const b of boxes()) expect(b.getAttribute('data-masked'), 'released: hidden again').toBe('true');
  });

  it('leaving the control while held hides the digits again', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '3', '4'], set: () => {} }));
    await fire(showButtons()[0], 'pointerdown');
    // React's onPointerLeave listens for the pointer going out of the element (pointerout with no related target).
    await fire(showButtons()[0], 'pointerout');
    for (const b of boxes()) expect(b.getAttribute('data-masked')).toBe('true');
  });

  it('the keyboard can hold it too: Space down shows, Space up hides', async () => {
    await mount(createElement(PinDigits, { value: ['1', '2', '3', '4'], set: () => {} }));
    const btn = showButtons()[0];
    await act(async () => { btn.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); });
    for (const b of boxes()) expect(b.getAttribute('data-masked')).toBe('false');
    await act(async () => { btn.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true })); });
    for (const b of boxes()) expect(b.getAttribute('data-masked')).toBe('true');
  });

  it.each(['receipts', 'off'] as const)('every PIN screen in %s masks every box', async (product) => {
    _setProductForTesting(product);
    const screens: Array<[string, () => ReturnType<typeof createElement>]> = [
      ['the lock', () => createElement(PinOverlay, { onSuccess: () => {}, onCancel: () => {} })],
      ['Change PIN', () => createElement(ChangePinPanel, { onDone: () => {} })],
      ['Set PIN', () => createElement(SetPinPanel, { onDone: () => {} })],
      ['the recovery form', () => createElement(PinRecoveryForm, { onSuccess: () => {}, onCancel: () => {} })],
    ];
    for (const [name, make] of screens) {
      await mount(make());
      await settle();
      expect(boxes().length, name).toBeGreaterThanOrEqual(4);
      for (const b of boxes()) expect(b.getAttribute('data-masked'), name).toBe('true');
      expect(showButtons().length, `${name}: one show control per row`).toBe(boxes().length / 4);
      await unmount();
    }
  });

  it('the setup PIN screen masks both rows', async () => {
    await mount(createElement(SetupWizard, { onComplete: () => {} }));
    await click(button(t.beginSetup));
    await click(modeButton(t.modeChild));
    await click(host.querySelector<HTMLElement>('[data-testid="setup-continue"]')!);
    expect(boxes()).toHaveLength(8);
    for (const b of boxes()) expect(b.getAttribute('data-masked')).toBe('true');
    expect(showButtons()).toHaveLength(2);
  });
});
