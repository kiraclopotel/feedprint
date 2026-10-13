/** @vitest-environment jsdom */
//
// While the Describe page is open the keyboard stays on it. The page is opaque over the whole home, so Tab must not reach the
// tab strip, the day figure, "Open your record", the "Describe this page" button, the footer, or the tab panel that holds
// the page (a Tab stop of its own). The header stays in view above the page and keeps working. Every way out of the page,
// the way back, Escape and an unmount while it is open, gives all of it back.
//
// jsdom moves no focus and does not apply `inert`, so the test asks the question a browser answers: which focusable
// elements have no inert ancestor and a tab index of 0 or more.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DescribePage } from '../../../../src/ui/popup/DescribePage';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = POPUP_STRINGS.en;

let popup: HTMLDivElement;
let slot: HTMLDivElement;
let root: Root;

// The popup's own order: header, tab strip, a tab panel (itself a Tab stop) holding the home, then the footer. Static nodes, so
// they outlive the React root that only mounts the Describe page, as the home's elements outlive the page in the real popup.
beforeEach(() => {
  popup = document.createElement('div');
  popup.className = 'fw-popup';
  popup.innerHTML = `
    <div class="pop-header"><button id="settings">Settings</button></div>
    <div class="pop-tabbar"><button id="tab-home">Home</button><button id="tab-licence">Licence</button></div>
    <div id="panel" role="tabpanel" tabindex="0">
      <button id="figure" class="pop-hero">0</button>
      <button id="record" class="pop-cta">Open your record</button>
      <div id="slot"></div>
      <div class="foot home-foot"><button id="theme">Theme</button><a id="privacy" href="#privacy">Privacy</a></div>
    </div>`;
  document.body.appendChild(popup);
  slot = popup.querySelector<HTMLDivElement>('#slot')!;
  root = createRoot(slot);
});

afterEach(() => {
  act(() => root.unmount());
  popup.remove();
});

async function show(): Promise<void> {
  await act(async () => {
    root.render(createElement(I18nProvider, { lang: 'en', children: createElement(DescribePage, { tabId: async () => 7 }) }));
  });
}

const button = (label: string): HTMLButtonElement => {
  const found = Array.from(popup.querySelectorAll('button')).find((b) => b.textContent === label);
  if (!found) throw new Error(`no button "${label}"`);
  return found;
};

/** What Tab can land on, by id or by the page's own button names. */
function reachable(): string[] {
  return Array.from(popup.querySelectorAll<HTMLElement>('button, a[href], [tabindex]'))
    .filter((el) => !el.closest('[inert]') && el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled)
    .map((el) => el.id || el.textContent || '');
}

describe('with the page open', () => {
  it('Tab reaches the header and the page, and nothing under the page', async () => {
    await show();
    expect(reachable()).toContain(t.describeTitle);
    await act(async () => { button(t.describeTitle).click(); });
    const now = reachable();
    expect(now).toContain('settings');
    expect(now).toContain(t.back);
    for (const behind of ['tab-home', 'tab-licence', 'panel', 'figure', 'record', 'theme', 'privacy']) {
      expect(now, behind).not.toContain(behind);
    }
    // The button that opened the page is under it too: only its own choices are reachable.
    expect(now.filter((name) => name === t.describeTitle)).toHaveLength(0);
    expect(popup.querySelector('.fw-subpage')!.closest('[inert]')).toBeNull();
  });

  it('the way back gives everything back, and the focus returns to the button that opened the page', async () => {
    await show();
    const opener = button(t.describeTitle);
    await act(async () => { opener.click(); });
    await act(async () => { button(t.back).click(); });
    expect(popup.querySelectorAll('[inert]')).toHaveLength(0);
    expect(popup.querySelector('#panel')!.getAttribute('tabindex')).toBe('0');
    expect(reachable()).toEqual(expect.arrayContaining(['tab-home', 'tab-licence', 'panel', 'figure', 'record', 'theme', 'privacy', t.describeTitle]));
    expect(document.activeElement).toBe(opener);
  });

  it('Escape gives everything back', async () => {
    await show();
    await act(async () => { button(t.describeTitle).click(); });
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(popup.querySelectorAll('[inert]')).toHaveLength(0);
    expect(popup.querySelector('#panel')!.getAttribute('tabindex')).toBe('0');
  });

  it('leaving the home while the page is open (an unmount) gives everything back', async () => {
    await show();
    await act(async () => { button(t.describeTitle).click(); });
    expect(popup.querySelectorAll('[inert]').length).toBeGreaterThan(0);
    act(() => root.unmount());
    expect(popup.querySelectorAll('[inert]')).toHaveLength(0);
    expect(popup.querySelector('#panel')!.getAttribute('tabindex')).toBe('0');
    root = createRoot(slot);
  });

  it('keeps what something else had made inert, inert, and opens again the same way', async () => {
    popup.querySelector('#figure')!.setAttribute('inert', '');
    await show();
    for (let round = 0; round < 2; round++) {
      await act(async () => { button(t.describeTitle).click(); });
      expect(reachable()).not.toContain('record');
      await act(async () => { button(t.back).click(); });
      expect(reachable()).toContain('record');
    }
    expect(popup.querySelector('#figure')!.hasAttribute('inert')).toBe(true);
    expect(popup.querySelectorAll('[inert]')).toHaveLength(1);
  });
});
