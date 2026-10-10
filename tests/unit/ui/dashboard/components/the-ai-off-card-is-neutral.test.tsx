/** @vitest-environment jsdom */
// On the free plan the AI reading is not on offer, so the Issues tab says
// nothing about it: a card saying it is off read first as a fault and then as
// an upsell. Real faults keep their red, among them a paid tier whose calls
// were refused as free.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let TIER: 'free' | 'family' = 'free';

vi.mock('../../../../../src/storage/license', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/storage/license')>();
  return { ...actual, getLicense: vi.fn(async () => ({ ...actual.FREE_LICENSE, tier: TIER })) };
});

import { OperationalEventsPanel } from '../../../../../src/ui/dashboard/components/OperationalEventsPanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { PRODUCT_NAME, dashboardWords } from '../../../../../src/ui/dashboard/dashboard-words';
import type { OperationalEventBucket } from '../../../../../src/forensics/chain-debug-stats';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const t = DASHBOARD_STRINGS.en;

type PanelProps = NonNullable<Parameters<typeof OperationalEventsPanel>[0]>;
const Panel = OperationalEventsPanel as (props: PanelProps) => ReturnType<typeof OperationalEventsPanel>;

let host: HTMLDivElement;
let root: Root;

const HOUR_MS = 60 * 60 * 1000;

function bucket(partial: Partial<OperationalEventBucket> = {}): OperationalEventBucket {
  const start = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
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

async function openIssues(tier: 'free' | 'family', buckets: OperationalEventBucket[] = []): Promise<void> {
  TIER = tier;
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
        fetchBuckets: (() => Promise.resolve(buckets)) as PanelProps['fetchBuckets'],
        fetchSelectorHealth: (() => Promise.resolve(null)) as unknown as PanelProps['fetchSelectorHealth'],
        integrity: null,
      }),
    }));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

afterEach(async () => {
  await act(async () => { root.unmount(); });
  host.remove();
  vi.restoreAllMocks();
});

function cardTitled(title: string): HTMLElement {
  const heading = Array.from(host.querySelectorAll('h3')).find((h) => h.textContent?.includes(title));
  if (!heading?.parentElement) throw new Error(`no card titled "${title}"`);
  return heading.parentElement;
}

// A free install is told nothing about the AI reading (ai-wording.ts): no card
// saying it is off, no AI line, no allowance, no AI health. A card about
// something the person cannot have read as a fault, and then as an upsell.
describe('a free install meets no AI wording on the Issues tab', () => {
  it('shows no AI-off card, no AI line, no account allowance and no AI health', async () => {
    await openIssues('free', [bucket({ capExhausted: { daily: 0, monthly: 0, tierFree: 2 } })]);
    const text = host.textContent ?? '';
    expect(text).not.toContain(t.opsAiOff);
    expect(text).not.toContain(t.opsAiHealthTitle);
    expect(text).not.toContain(t.opsYourAccount);
    expect(text).not.toContain(t.opsLlmFailures(0));
    // What a person sees without opening the support fold says nothing about the AI.
    const shown = host.cloneNode(true) as HTMLElement;
    shown.querySelectorAll('details').forEach((d) => d.remove());
    expect(shown.textContent ?? '').not.toMatch(/\bAI\b/);
    expect(text).toContain(dashboardWords('en').opsIntroNoAi(PRODUCT_NAME));
  });

  it('a paid tier still has its AI health and the full opening line', async () => {
    await openIssues('family');
    const text = host.textContent ?? '';
    expect(text).toContain(t.opsAiHealthTitle);
    expect(text).toContain(t.opsIntro);
  });
});

describe('a real fault keeps its red', () => {
  it('the tier-mismatch card, a paid tier whose calls were refused as free, is still red', async () => {
    await openIssues('family', [bucket({ capExhausted: { daily: 0, monthly: 0, tierFree: 3 } })]);
    const card = cardTitled(t.opsCardTierMismatchTitle(3));

    expect(card.getAttribute('style') ?? '').toContain('--fw-red');
    expect((card.querySelector('h3') as HTMLElement).getAttribute('style') ?? '').toContain('--fw-red');
  });
});
