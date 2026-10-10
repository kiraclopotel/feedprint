/** @vitest-environment jsdom */
// The Issues tab is open to everyone, so what it says has to make sense to the person who owns the
// install. The timings block names a flag and the pipeline's stage ids, and only a developer key
// turns timing capture on, so it shows only where capture is on. The other lines a person meets
// there, and the backup and salvage messages, carry no flag, field or script names.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let CAPTURE_ON = false;

vi.mock('../../../../../src/storage/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/storage/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: vi.fn(async (name: string) => (name === 'captureV2Metrics' ? CAPTURE_ON : actual.isFeatureEnabled(name as never))),
  };
});

import { OperationalEventsPanel } from '../../../../../src/ui/dashboard/components/OperationalEventsPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type PanelProps = NonNullable<Parameters<typeof OperationalEventsPanel>[0]>;
const Panel = OperationalEventsPanel as (props: PanelProps) => ReturnType<typeof OperationalEventsPanel>;

const DEVELOPER_WORDS = /captureV2Metrics|combined_call|max_tokens|schemaVersion|scripts\/|tier is FREE|nivelul GRATUIT|plan GRATUITO/;

let host: HTMLDivElement;
let root: Root;

async function openIssues(captureOn: boolean): Promise<HTMLDivElement> {
  CAPTURE_ON = captureOn;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: { local: { get: () => Promise.resolve({}), set: () => Promise.resolve() } },
  };
  await act(async () => {
    root.render(createElement(I18nProvider, {
      lang: 'en',
      children: createElement(Panel, {
        fetchBuckets: (() => Promise.resolve([])) as PanelProps['fetchBuckets'],
        fetchSelectorHealth: (() => Promise.resolve(null)) as unknown as PanelProps['fetchSelectorHealth'],
        integrity: null,
      }),
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return host;
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
});

describe('the timings block', () => {
  it('is not drawn when timing capture is off', async () => {
    const el = await openIssues(false);
    expect(el.querySelector('[data-fw-perf-timings]')).toBeNull();
    expect(el.textContent ?? '').not.toContain('captureV2Metrics');
  });

  it('is drawn when timing capture is on', async () => {
    const el = await openIssues(true);
    expect(el.querySelector('[data-fw-perf-timings]')).not.toBeNull();
  });
});

describe.each(UI_LANGUAGES)('%s: the lines a person meets carry no developer words', (lang) => {
  const t = DASHBOARD_STRINGS[lang];
  it('the AI-off line, the cut-short count, the backup check and the too-large file', () => {
    for (const line of [t.opsAiOff, t.opsGroqTruncated(2), t.restoreMissingSchemaVersion, t.salvageTooLarge('a.json', 90)]) {
      expect(line).not.toMatch(DEVELOPER_WORDS);
    }
  });
});
