/** @vitest-environment jsdom */
// PA unit 3 (S-4). The Forgot PIN screen's "Recovery phrase" field was the browser's white default input with a
// thick ring, the loudest thing on the dark panel. It now takes the product's input class (key-input, which the
// popup sheet styles), in both products, and keeps its monospace, upper-case entry.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';

import { installStorage, unmount, mount, host, settle, t } from '../../../helpers/popup-walk';
import { PinRecoveryForm } from '../../../../src/ui/popup/controls';
import { _setProductForTesting } from '../../../../src/product';

beforeEach(() => { installStorage({ fw_pin_recovery: 'pbkdf2$1$00$00' }); });
afterEach(async () => { await unmount(); _setProductForTesting(null); });

describe.each(['receipts', 'off'] as const)('the recovery phrase field in %s', (product) => {
  it('has the key-input class and keeps its monospace, upper-case entry', async () => {
    _setProductForTesting(product);
    await mount(createElement(PinRecoveryForm, { onSuccess: () => {}, onCancel: () => {} }));
    await settle();
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${t.pinRecoveryPhraseLabel}"]`);
    expect(input, 'the field is there').not.toBeNull();
    expect(input!.className.split(/\s+/)).toContain('key-input');
    expect(input!.style.fontFamily).toBe('monospace');
    expect(input!.style.textTransform).toBe('uppercase');
  });
});
