/** @vitest-environment jsdom */
// A post the pipeline could not judge is recorded as unjudged, and the record names a provider
// only when one answered, because a signed record naming a company that never read the text is false.
// The apply path is driven with the result the pipeline returns for a failed judgement.

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'teen', uiLanguage: 'en', dailyCap: 2000 })),
    isFeatureEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});
vi.mock('../../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
vi.mock('../../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});

import {
  _onProcessingResultForTesting as onProcessingResult,
  _setActiveAdapterForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting } from '../../../../src/diagnostics/diagnostics';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import type { PipelineResult } from '../../../../src/analysis/pipeline';
import type { PostContent } from '../../../../src/types/post';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';

function makePost(id: string, text: string): PostContent {
  const el = document.createElement('article');
  el.textContent = text;
  document.body.appendChild(el);
  return {
    id, text, author: '@someone', timestamp: '2026-09-23T08:00:00Z',
    platform: 'twitter', domRef: new WeakRef(el), kind: 'post',
  } as unknown as PostContent;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

function unjudgedRecords(): Record<string, unknown>[] {
  return vi.mocked(sendHighStakesForensicLog).mock.calls
    .map(c => c[0] as { type: string; payload: Record<string, unknown> })
    .filter(m => m.type === 'CANCEL_LOG' && m.payload.verdict === 'cancelled-post-llm-failure')
    .map(m => m.payload);
}

beforeEach(() => {
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  document.body.innerHTML = '';
});

describe('an unjudged post names the provider only when one answered', () => {
  it('no provider answered: the record names none', async () => {
    const result = {
      action: 'pass',
      passContext: { reason: 'pre-llm-ai-call-failed', failureKind: 'network' },
    } as PipelineResult;

    onProcessingResult(makePost('u1', 'a post the provider never answered about'), result);
    await settle();

    const records = unjudgedRecords();
    expect(records).toHaveLength(1);
    expect(records[0].failureKind).toBe('network');
    expect(records[0].aiProvider).toBeUndefined();
  });

  it('a judge answered with nothing usable: the record names the model and provider the server named', async () => {
    const result = {
      action: 'pass',
      passContext: {
        reason: 'pre-llm-ai-call-failed',
        aiMeta: { model: 'openai/gpt-oss-120b', provider: 'deepinfra' },
      },
    } as PipelineResult;

    onProcessingResult(makePost('u2', 'a post whose judge replied with something unreadable'), result);
    await settle();

    const records = unjudgedRecords();
    expect(records).toHaveLength(1);
    expect(records[0].aiProvider).toBe('deepinfra');
    expect(records[0].aiModel).toBe('openai/gpt-oss-120b');
  });
});
