// @vitest-environment jsdom
// Wiring audit 13 Sep, L2: X's home feed source is read from which tab is
// selected, by position, so a Romanian ("Pentru tine") or any other interface
// language records For you and Following, not 'unknown'.

import { afterEach, describe, expect, it } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';

function home(labels: string[], selected: number, inPrimaryColumn = true): void {
  window.history.replaceState(null, '', '/home');
  const tabs = labels.map((l, i) => `<div role="tab" aria-selected="${i === selected}">${l}</div>`).join('');
  const list = `<div role="tablist">${tabs}</div>`;
  document.body.innerHTML = inPrimaryColumn ? `<main><div data-testid="primaryColumn">${list}</div></main>` : list;
}

const source = (): string => (new TwitterAdapter() as unknown as { _detectFeedSource(): string })._detectFeedSource();

afterEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState(null, '', '/');
});

describe('X home feed source', () => {
  it('reads For you and Following in Romanian, by position', () => {
    home(['Pentru tine', 'Urmăriți'], 0);
    expect(source()).toBe('for-you');
    home(['Pentru tine', 'Urmăriți'], 1);
    expect(source()).toBe('following');
  });

  it('a pinned list after Following is a feed the reader chose', () => {
    home(['Para ti', 'Siguiendo', 'Mi lista'], 2);
    expect(source()).toBe('following');
  });

  it('still reads English, and a tablist outside the primary column', () => {
    home(['For you', 'Following'], 0, false);
    expect(source()).toBe('for-you');
  });

  it('with no tab selected the source stays unknown', () => {
    home(['Pentru tine', 'Urmăriți'], -1);
    expect(source()).toBe('unknown');
  });

  it('profile, permalink and search paths are unchanged', () => {
    home(['Pentru tine', 'Urmăriți'], 0);
    window.history.replaceState(null, '', '/someone/status/1');
    expect(source()).toBe('permalink');
    window.history.replaceState(null, '', '/search');
    expect(source()).toBe('search');
  });
});
