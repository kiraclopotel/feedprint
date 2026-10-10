/** @vitest-environment jsdom */
//
// The rules editor as chips (ui/popup/BlocklistEditor.tsx, 2026-09-03): a rule
// typed and entered is written at once through updateFeature, a chip's remove
// button writes the list without it, and accounts lose their leading "@".

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const writes: Array<(cur: { enabled?: boolean; value?: unknown }) => unknown> = [];
vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return { ...actual, updateFeature: vi.fn(async (_id: string, fn: (cur: { enabled?: boolean; value?: unknown }) => unknown) => { writes.push(fn); }) };
});

import { BlocklistEditor } from '../../../../src/ui/popup/BlocklistEditor';
import { I18nProvider } from '../../../../src/i18n/react';
import { adultPreset } from '../../../../src/storage/presets';
import type { FWSettings } from '../../../../src/storage/settings';

function settings(words: string[], accounts: string[], hiddenByFeature: Record<string, number> = {}): FWSettings {
  const features = adultPreset();
  features['parent-blocklist'] = { enabled: true, value: { words, phrases: [], accounts } };
  return { mode: 'adult', features, uiLanguage: 'en', hiddenByFeature } as unknown as FWSettings;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); writes.length = 0; });
afterEach(() => { act(() => root.unmount()); host.remove(); });

async function render(s: FWSettings): Promise<void> {
  await act(async () => { root.render(createElement(I18nProvider, { lang: 'en', children: createElement(BlocklistEditor, { settings: s, onChange: async () => {} }) })); });
}

describe('BlocklistEditor', () => {
  it('shows the per-rule count on a chip that fired, and none on one that did not', async () => {
    await render(settings(['diet', 'quiet'], ['troll'], { 'rule:word:diet': 3, 'rule:account:troll': 1 }));
    const chips = Array.from(host.querySelectorAll('.chip'));
    const pill = (text: string) => chips.find(c => c.textContent?.includes(text))?.querySelector('.pill-n');
    expect(pill('diet')?.textContent).toBe('×3');
    expect(pill('diet')?.getAttribute('title')).toBe('Hid 3 posts or comments so far.');
    expect(pill('@troll')?.textContent).toBe('×1');
    expect(pill('quiet')).toBeNull();
  });

  it('shows each rule as a chip and writes a typed word on Enter', async () => {
    await render(settings(['diet'], ['troll']));
    const chips = Array.from(host.querySelectorAll('.chip')).map(c => c.textContent);
    expect(chips).toEqual(['diet×', '@troll×']);
    const input = host.querySelector<HTMLInputElement>('.chips input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'calories');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(writes).toHaveLength(1);
    expect(writes[0]({ enabled: true, value: { words: ['diet'], phrases: [], accounts: ['troll'] } }))
      .toEqual({ enabled: true, value: { words: ['diet', 'calories'], phrases: [], accounts: ['troll'] } });
  });

  it('the remove button writes the list without that rule; an account loses its @', async () => {
    await render(settings(['diet'], ['troll']));
    const x = host.querySelector<HTMLButtonElement>('.chip-account .chip-x')!;
    expect(x.getAttribute('aria-label')).toBe('Remove troll');
    await act(async () => { x.click(); });
    expect(writes[0]({ enabled: true, value: { words: ['diet'], phrases: [], accounts: ['troll', 'other'] } }))
      .toEqual({ enabled: true, value: { words: ['diet'], phrases: [], accounts: ['other'] } });
    const inputs = host.querySelectorAll<HTMLInputElement>('.chips input');
    const acc = inputs[2];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(acc, '@spam');
      acc.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { acc.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(writes[1]({ value: { words: [], phrases: [], accounts: [] } }))
      .toEqual({ enabled: true, value: { words: [], phrases: [], accounts: ['spam'] } });
  });

  // A stranger reading the first-run popup gave up at the word-endings sentence when it stood open,
  // so it waits behind the info button the way every switch's text does.
  it('keeps what a word catches besides itself behind the info button until it is pressed', async () => {
    await render(settings([], []));
    const text = () => host.querySelector('.rules')!.textContent ?? '';
    expect(text()).toContain('are hidden. Any language written with spaces between words.');
    expect(text()).not.toContain('four letters or more');
    const info = host.querySelector<HTMLButtonElement>('.rules .fr-info')!;
    expect(info.getAttribute('aria-label')).toBe('About this setting: My own rules');
    expect(info.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { info.click(); });
    expect(info.getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain('four letters or more');
    await act(async () => { info.click(); });
    expect(text()).not.toContain('four letters or more');
  });
});
