// @vitest-environment jsdom
//
// A tester on a licensed install, 2026-09-18: the Issues tab goes blank and
// there is no way back. That last half is the diagnosis. A blank panel with a
// tab strip above it is a panel with nothing in it; a blank panel with NO tab
// strip is a React tree that unmounted, which is what happens when a render
// throws and no boundary catches it. The dashboard had no error boundary
// anywhere in src/ui, so this was true of all eight tabs from the first one.
//
// What the reader is told matters as much as that it is caught. The fallback
// says the record has not been touched, because "something went wrong" on a
// product whose entire claim is an intact record reads as "your record is
// gone" to the person holding it, and because it is true: nothing a panel
// renders writes to the chain.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TabPanel } from '../../../../../src/ui/dashboard/components/TabPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import type { TabId } from '../../../../../src/ui/dashboard/components/TabBtn';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let consoleSpy: ReturnType<typeof vi.spyOn>;

/** The tab strip stands OUTSIDE the boundary, exactly as Dashboard.tsx has it. */
async function mount(
  child: React.ReactNode,
  id: TabId = 'operational',
  lang: (typeof UI_LANGUAGES)[number] = 'en',
): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(I18nProvider, {
      lang,
      children: [
        React.createElement('button', { key: 'strip', role: 'tab' }, 'Issues'),
        React.createElement(TabPanel, { key: 'panel', id, children: child }),
      ],
    }));
  });
}

function Boom(): never {
  throw new Error('cannot read counters of undefined');
}

function Fine() {
  return React.createElement('p', null, 'the panel drew');
}

const button = (label: string) =>
  Array.from(host.querySelectorAll('button')).find((b) => b.textContent === label) as HTMLButtonElement;

beforeEach(() => {
  // React prints the caught error itself; the assertion below is that OUR
  // handler also ran, not that React stayed quiet.
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  consoleSpy.mockRestore();
});

describe('one bad panel does not take the dashboard', () => {
  // The defect itself, kept as a case rather than as a sentence in a comment.
  // Without a boundary the throw is not contained to the panel: React unmounts
  // the WHOLE root, so the tab strip beside it goes too and the reader is left
  // with an empty page and nothing to press. This is what the tester saw, and
  // it is the reason the fix is a boundary and not a guard on one panel's data.
  it('is what an unguarded throw really does: the whole tree, strip and all', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    try {
      await act(async () => {
        root.render(React.createElement(I18nProvider, {
          lang: 'en',
          children: [
            React.createElement('button', { key: 'strip', role: 'tab' }, 'Issues'),
            React.createElement(Boom, { key: 'panel' }),
          ],
        }));
      });
    } catch { /* the throw reaches the caller, which is the point */ }

    expect(host.querySelector('[role="tab"]'), 'the way back went with it').toBeNull();
    expect(host.textContent, 'a blank page').toBe('');
  });

  it('catches the throw and leaves the tab strip standing', async () => {
    await mount(React.createElement(Boom));
    expect(host.querySelector('[role="tab"]'), 'the reader still has a way back').toBeTruthy();
    expect(host.textContent).toContain(DASHBOARD_STRINGS.en.tabCrashTitle);
  });

  it('tells the reader their record was not touched', async () => {
    await mount(React.createElement(Boom));
    const body = DASHBOARD_STRINGS.en.tabCrashBody;
    expect(body.toLowerCase(), 'the sentence is about the record, not about an error').toContain('record');
    expect(host.textContent).toContain(body);
  });

  it('names what went wrong, so a tester’s report can carry it', async () => {
    await mount(React.createElement(Boom));
    expect(host.textContent).toContain('cannot read counters of undefined');
    expect(host.textContent, 'and the tab, so the report says which one').toContain('operational');
    // The console keeps the stack, which is the only place it survives.
    const ours = consoleSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('[fw] dashboard panel failed'));
    expect(ours, 'the failure is never swallowed silently').toBe(true);
  });

  it('holds the sentence in every interface language', async () => {
    for (const lang of UI_LANGUAGES) {
      await mount(React.createElement(Boom), 'operational', lang);
      expect(host.textContent, `${lang} has the title`).toContain(DASHBOARD_STRINGS[lang].tabCrashTitle);
      expect(host.textContent, `${lang} has the button`).toContain(DASHBOARD_STRINGS[lang].tabCrashRetry);
      await act(async () => root.unmount());
      host.remove();
    }
    // The afterEach unmounts once more; give it something to unmount.
    await mount(React.createElement(Fine), 'overview');
  });

  // The control. A boundary that reached its verdict by never rendering its
  // children would pass every case above and ship a dashboard of empty tabs.
  it('draws an ordinary panel untouched, with the id the tab strip points at', async () => {
    await mount(React.createElement(Fine), 'overview');
    expect(host.textContent).toContain('the panel drew');
    expect(host.textContent).not.toContain(DASHBOARD_STRINGS.en.tabCrashTitle);

    const panel = host.querySelector('#dash-panel-overview');
    expect(panel, 'TabBtn aria-controls has pointed at this id since the a11y pass').toBeTruthy();
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe('dash-tab-overview');
  });

  // Try again must actually retry. A button that re-renders the same failed
  // subtree looks like a fix and is not one, so the child is rebuilt.
  it('retries the panel rather than re-showing the failure', async () => {
    // Driven by a flag this test owns, not by a "first draw only" counter:
    // React re-renders a failed subtree once on its own while recovering, so a
    // self-clearing counter is spent before the boundary has caught anything
    // and the test would pass without the retry doing a thing.
    let conditionStillThere = true;
    function Flaky() {
      if (conditionStillThere) throw new Error('while the condition was there');
      return React.createElement('p', null, 'the panel drew');
    }
    await mount(React.createElement(Flaky));
    expect(host.textContent).toContain(DASHBOARD_STRINGS.en.tabCrashTitle);

    conditionStillThere = false;
    await act(async () => { button(DASHBOARD_STRINGS.en.tabCrashRetry).click(); });
    expect(host.textContent, 'the second attempt is a real one').toContain('the panel drew');
    expect(host.textContent).not.toContain(DASHBOARD_STRINGS.en.tabCrashTitle);
  });

  // And the other half of that: pressing Try again while the condition is
  // still there must show the failure again, not an empty panel.
  it('shows the failure again when the condition has not gone', async () => {
    await mount(React.createElement(Boom));
    await act(async () => { button(DASHBOARD_STRINGS.en.tabCrashRetry).click(); });
    expect(host.textContent).toContain(DASHBOARD_STRINGS.en.tabCrashTitle);
    expect(host.querySelector('[role="tab"]'), 'and the way back is still there').toBeTruthy();
  });
});
