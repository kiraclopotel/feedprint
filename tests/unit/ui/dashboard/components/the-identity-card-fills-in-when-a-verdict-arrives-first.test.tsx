/** @vitest-environment jsdom */
// The Issues tab reads the chain once when it opens, for the record-identity
// card. The dashboard's own verdict can arrive while that read is still out;
// the card must still fill in when the read lands, not stay on "Loading" for
// as long as the tab is open.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { IntegrityResult } from '../../../../../src/forensics/chain-integrity';

let answerRead: (read: { records: ForensicRecord[]; unreadable: [] }) => void = () => {};

vi.mock('../../../../../src/forensics/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/forensics/store')>();
  return {
    ...actual,
    getRecordsDetailed: vi.fn(() => new Promise((resolve) => { answerRead = resolve; })),
  };
});

import { OperationalEventsPanel } from '../../../../../src/ui/dashboard/components/OperationalEventsPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = DASHBOARD_STRINGS.en;

type PanelProps = NonNullable<Parameters<typeof OperationalEventsPanel>[0]>;
const Panel = OperationalEventsPanel as (props: PanelProps) => ReturnType<typeof OperationalEventsPanel>;

const VERDICT = { valid: true, chainLength: 0, preChainCount: 0, preRekeyCount: 0 } as IntegrityResult;

let host: HTMLDivElement;
let root: Root;

function render(integrity: IntegrityResult | null): Promise<void> {
  return act(async () => {
    root.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(Panel, {
        fetchBuckets: (() => Promise.resolve([])) as PanelProps['fetchBuckets'],
        fetchSelectorHealth: (() => Promise.resolve(null)) as unknown as PanelProps['fetchSelectorHealth'],
        integrity,
      }),
    }));
  });
}

function identityCard(): HTMLElement {
  const heading = Array.from(host.querySelectorAll('h3')).find((h) => h.textContent === t.opsIdentityTitle);
  if (!heading?.parentElement) throw new Error('no record identity card');
  return heading.parentElement;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
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

describe('the record identity card', () => {
  it('fills in when the dashboard verdict arrives before the chain read does', async () => {
    await render(null);
    await render(VERDICT);

    await act(async () => { answerRead({ records: [], unreadable: [] }); });
    await act(async () => { await Promise.resolve(); });

    expect(identityCard().textContent).toContain(t.opsIdentityNoRecords);
    expect(identityCard().textContent).not.toContain(t.opsLoadingShort);
  });
});
