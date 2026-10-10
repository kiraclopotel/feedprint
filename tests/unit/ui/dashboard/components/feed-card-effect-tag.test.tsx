// @vitest-environment jsdom
// PLAN-2026-09-15 item 1 on the dashboard: an Activity card for a record whose
// decision block carries DESCRIPTOR-V1 names the effect in the export's words;
// never the group (RESULTS-3.md); nothing without the reading.

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class FakeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

function rec(decision?: unknown): ForensicRecord {
  return {
    id: 'r-1', timestamp: '2026-09-15T06:00:00.000Z', platform: 'twitter', originalText: 'a post', originalHash: 'h',
    originalLength: 6, neutralizedText: '', author: '@a', postUrl: '', overallScore: 6, userAgeCategory: 'adult',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'ih', verdict: 'flagged', kind: 'post',
    techniques: [{ name: 'anger-trigger', severity: 6, confidence: 0.9 }], decision,
  } as unknown as ForensicRecord;
}

let host: HTMLDivElement;
let root: Root;
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

async function render(record: ForensicRecord): Promise<string> {
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedCard, { record } as React.ComponentProps<typeof FeedCard>) }));
  });
  return host.textContent ?? '';
}

describe('feed card effect tag', () => {
  it('names the effect and not the group', async () => {
    const text = await render(rec({
      judge: { id: 'judge-v1', hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', provider: 'groq' },
      reading: { charged: true, family: 'hostile', severity: 6, effect: 'recruit', intent: 'react' },
      descriptor: null,
      descriptorV1: { id: 'descriptor-v1', hash: 'h', model: 'm', effect: 'group-hostility', target: 'group', group: 'jews-israelis' },
      rails: [], household: { mode: 'adult', reader: 'default', topicRule: null, mask: false },
      row: 'J7', action: 'mark', applied: 'mark', rewrite: null, note: null,
    }));
    expect(text).toContain(DASHBOARD_STRINGS.en.feedEffectLabels['group-hostility']);
    expect(text).not.toMatch(/Jews|Israel/);
  });

  it('shows nothing for a record without the reading', async () => {
    const text = await render(rec(undefined));
    for (const label of Object.values(DASHBOARD_STRINGS.en.feedEffectLabels)) expect(text).not.toContain(label);
  });

  it('every interface language names every effect the product can receive', () => {
    for (const lang of Object.keys(DASHBOARD_STRINGS) as Array<keyof typeof DASHBOARD_STRINGS>) {
      expect(Object.keys(DASHBOARD_STRINGS[lang].feedEffectLabels).sort(), lang).toEqual(Object.keys(DASHBOARD_STRINGS.en.feedEffectLabels).sort());
    }
  });
});
