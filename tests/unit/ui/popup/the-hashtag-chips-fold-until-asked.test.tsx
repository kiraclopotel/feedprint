/** @vitest-environment jsdom */
// The default hashtag list is 36 chips, and they sat open in Settings above the Reels, ads and break switches, so a
// person scrolled past all of them to reach those. The chips now sit in a fold that starts closed and says how many
// there are; adding a tag opens it so the new chip is seen; an empty list shows its own note and no fold.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { installChromeStorageStub } from '../../../helpers/chrome-storage';
import { getSettings, type FWSettings } from '../../../../src/storage/settings';
import { DEFAULT_AI_BLOCKLIST_HASHTAGS } from '../../../../src/storage/block-ai-defaults';
import { BlockAiHashtagEditor } from '../../../../src/ui/popup/BlockAiHashtagEditor';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function withHashtags(hashtags: string[]): Promise<FWSettings> {
  installChromeStorageStub({ initial: {} });
  const s = await getSettings();
  return {
    ...s,
    features: { ...(s.features ?? {}), 'block-ai-content': { enabled: true, value: { hashtags } } },
  } as FWSettings;
}

async function render(settings: FWSettings): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(BlockAiHashtagEditor, { settings, onChange: vi.fn(async () => undefined) }));
  });
  return host;
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe('the hashtag chips', () => {
  it('start in a closed fold that says how many there are', async () => {
    const el = await render(await withHashtags([...DEFAULT_AI_BLOCKLIST_HASHTAGS]));
    const fold = el.querySelector<HTMLDetailsElement>('details[data-fw-hashtag-list]');
    expect(fold).not.toBeNull();
    expect(fold!.open).toBe(false);
    expect(fold!.querySelector('summary')?.textContent).toBe(POPUP_STRINGS.en.hashtagsShowList(DEFAULT_AI_BLOCKLIST_HASHTAGS.length));
    expect(fold!.querySelectorAll('button[aria-label]').length).toBe(DEFAULT_AI_BLOCKLIST_HASHTAGS.length);
  });

  it('open once a tag is added', async () => {
    const el = await render(await withHashtags(['aiart']));
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, 'midjourney');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(el.querySelector<HTMLDetailsElement>('details[data-fw-hashtag-list]')!.open).toBe(true);
  });

  it('an empty list shows its note and no fold', async () => {
    const el = await render(await withHashtags([]));
    expect(el.querySelector('details[data-fw-hashtag-list]')).toBeNull();
    expect(el.textContent).toContain(POPUP_STRINGS.en.hashtagsEmpty);
  });
});
