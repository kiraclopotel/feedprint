/** @vitest-environment jsdom */
// The bottom row's contact menu (src/ui/popup/HomeFoot.tsx) is a plain disclosure: a button that shows two links.
// Escape closes it and puts the focus back on the button; a Tab away closes it too, so it never stays open behind the
// focus (the head's fresh check of the popup, 9 Oct 2026).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ContactMenu } from '../../../../src/ui/popup/HomeFoot';
import { I18nProvider } from '../../../../src/i18n/react';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let outside: HTMLButtonElement;
beforeEach(async () => {
  container = document.createElement('div');
  document.body.appendChild(container);
  outside = document.createElement('button');
  outside.textContent = 'elsewhere';
  document.body.appendChild(outside);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(ContactMenu, { reportHref: 'mailto:a@example.org', makerHref: 'mailto:b@example.org' }),
    }));
  });
});
afterEach(() => { act(() => root.unmount()); container.remove(); outside.remove(); });

const button = () => container.querySelector<HTMLButtonElement>('.contact button')!;
const menu = () => container.querySelector<HTMLElement>('.contact-menu')!;
const links = () => Array.from(menu().querySelectorAll<HTMLAnchorElement>('a'));
async function open() {
  button().focus();
  await act(async () => { button().click(); });
  expect(menu().hidden, 'the menu opened').toBe(false);
}

describe('the contact menu', () => {
  it('is a disclosure: the button says whether it is open and which links it shows, with no menu roles', async () => {
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().getAttribute('aria-controls')).toBe(menu().id);
    await open();
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[role="menu"], [role="menuitem"]')).toBeNull();
  });

  it('Escape closes it and gives the focus back to the button', async () => {
    await open();
    links()[1].focus();
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(menu().hidden).toBe(true);
    expect(document.activeElement).toBe(button());
  });

  it('a Tab from one link to the other keeps it open', async () => {
    await open();
    links()[0].focus();
    await act(async () => { links()[1].focus(); });
    expect(menu().hidden).toBe(false);
  });

  it('a Tab away from it closes it', async () => {
    await open();
    links()[1].focus();
    await act(async () => { outside.focus(); });
    expect(menu().hidden).toBe(true);
  });
});
