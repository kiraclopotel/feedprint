/** @vitest-environment jsdom */
//
// Opening the Issues tab blanked the whole dashboard.
//
// The panel's loading and error screens returned above an effect declared a few
// hundred lines below them, so the number of hooks depended on the state: the
// first render returned early and never reached that effect, the render after
// the buckets arrived did, and React threw "rendered more hooks than during the
// previous render" (error #310) and unmounted the tree. The page went black and
// the only way out was a reload.
//
// Nothing caught it. The panel's own tests render through renderToString, one
// pass each, so they never cross the loading-to-loaded boundary; the walk does
// not open that tab. The dashboard probe did catch it, in its page-error log,
// on 2026-09-17.
//
// This test is the boundary: mount with nothing, let the fetch resolve, and
// require the panel to still be there.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { OperationalEventsPanel } from '../../../../../src/ui/dashboard/components/OperationalEventsPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import type { OperationalEventBucket } from '../../../../../src/forensics/chain-debug-stats';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR_MS = 60 * 60 * 1000;

function bucket(start: number, partial: Partial<OperationalEventBucket> = {}): OperationalEventBucket {
  return {
    bucketStartMs: start,
    bucketEndMs: start + HOUR_MS,
    capExhausted: { daily: 0, monthly: 0, tierFree: 0 },
    llmFailure: {},
    batchTruncated: 0,
    scanPurged: 0,
    total: 0,
    seen: 0,
    ...partial,
  };
}

type PanelProps = NonNullable<Parameters<typeof OperationalEventsPanel>[0]>;
const Panel = OperationalEventsPanel as (props: PanelProps) => ReturnType<typeof OperationalEventsPanel>;

let host: HTMLDivElement;
let root: Root;
let errors: unknown[];

beforeEach(() => {
  errors = [];
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host, {
    // React reports a render-phase throw here before it unmounts the tree,
    // which is exactly the shape of the defect.
    onUncaughtError: (e: unknown) => { errors.push(e); },
  } as Parameters<typeof createRoot>[1]);
  // chrome.storage is read when acknowledgements are rebased.
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
      },
    },
  };
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
});

describe('the Issues panel survives its own loading state', () => {
  it('mounts empty, takes its buckets, and is still on the page', async () => {
    const buckets = [bucket(Date.now() - HOUR_MS, { total: 2, batchTruncated: 2 })];

    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(Panel, {
          // No initialBuckets: this is the real path, which starts loading.
          fetchBuckets: (() => Promise.resolve(buckets)) as PanelProps['fetchBuckets'],
          fetchSelectorHealth: (() => Promise.resolve(null)) as unknown as PanelProps['fetchSelectorHealth'],
          integrity: null,
        }),
      }));
    });
    // Let every mount effect settle, which is the render that used to throw.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(errors).toEqual([]);
    // A blank host is what the crash left behind, so emptiness is the failure.
    expect(host.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });

  it('a failing read shows its own message and does not take the page with it', async () => {
    await act(async () => {
      root.render(createElement(I18nProvider, {
        lang: 'en',
        children: createElement(Panel, {
          fetchBuckets: (() => Promise.reject(new Error('the store could not be read'))) as PanelProps['fetchBuckets'],
          fetchSelectorHealth: (() => Promise.resolve(null)) as unknown as PanelProps['fetchSelectorHealth'],
          integrity: null,
        }),
      }));
    });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    expect(errors).toEqual([]);
    expect(host.textContent ?? '').toContain('the store could not be read');
  });
});
