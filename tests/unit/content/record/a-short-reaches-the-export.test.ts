/** @vitest-environment jsdom */
// A Short the reader was shown is written down and shows in the export. The Short's record comes from
// the reader in platforms/yt-shorts.ts; a free install takes it through the same apply path every
// record takes (a pass, so nothing on the page changes; a video with a title is logged as a pass), and the export prints it as a video with its
// title, its channel and its address. The step between the log message and the stored record is a
// field-for-field copy (forensics/logger.ts logPassEvent), so the stored record is built here
// from the message the content script really sent.

import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  return { ...actual, sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const) };
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
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _onProcessingResultForTesting as onProcessingResult,
  _setActiveAdapterForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import { _resetDiagnosticsForTesting } from '../../../../src/diagnostics/diagnostics';
import {
  YT_SHORTS_STABLE_POLLS,
  __ytShortsArmForTest,
  __ytShortsResetForTest,
  __ytShortsTickForTest,
} from '../../../../src/content/platforms/yt-shorts';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../../src/types/forensic';
import type { PipelineResult } from '../../../../src/analysis/pipeline';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';

const TITLE = 'Ranking The Funniest Unhinged Cats #Shorts #HilariousCats';
const ID = 'Shrt00Exmpl';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function drawShort(): void {
  window.history.replaceState({}, '', `/shorts/${ID}`);
  const panel = document.createElement('yt-reel-metapanel-view-model');
  const channel = document.createElement('yt-reel-channel-bar-view-model');
  const link = document.createElement('a');
  link.setAttribute('href', '/@example_shorts');
  channel.appendChild(link);
  const titleModel = document.createElement('yt-shorts-video-title-view-model');
  const h1 = document.createElement('h1');
  h1.textContent = TITLE;
  h1.getBoundingClientRect = () =>
    ({ top: 100, bottom: 160, left: 20, right: 300, width: 280, height: 60, x: 20, y: 100, toJSON: () => ({}) }) as DOMRect;
  titleModel.appendChild(h1);
  panel.append(channel, titleModel);
  document.body.appendChild(panel);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
}

/** The record the reader hands to the post path. */
function readTheShort(): PostContent {
  const written: PostContent[] = [];
  __ytShortsArmForTest({ emitPost: (post) => { written.push(post); } });
  for (let i = 0; i < YT_SHORTS_STABLE_POLLS; i++) __ytShortsTickForTest();
  expect(written).toHaveLength(1);
  return written[0];
}

function render(records: ForensicRecord[]): HTMLElement {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
  __ytShortsResetForTest();
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setActiveAdapterForTesting({ platform: 'youtube' } as unknown as PlatformAdapter);
  vi.mocked(sendHighStakesForensicLog).mockClear();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

describe('a Short the reader was shown is in the export', () => {
  it('is logged as a video with its title, channel and address, and the export prints it', async () => {
    drawShort();
    const post = readTheShort();

    onProcessingResult(post, { action: 'pass', passContext: { reason: 'pre-llm-free-tier-no-ai' } } as unknown as PipelineResult);
    await settle();

    const sent = vi.mocked(sendHighStakesForensicLog).mock.calls.map((c) => c[0] as { type: string; payload: Record<string, unknown> });
    const logged = sent.filter((m) => m.type === 'PASS_LOG');
    expect(logged, `sent: ${JSON.stringify(sent.map((m) => m.type))}`).toHaveLength(1);
    const p = logged[0].payload;
    expect(p.platform).toBe('youtube');
    expect(p.originalText).toBe(TITLE);
    expect(p.author).toBe('@example_shorts');
    expect(p.kind).toBe('video');
    expect(p.postUrl).toBe(`https://www.youtube.com/shorts/${ID}`);

    const record = {
      id: 'fr-skp-1',
      timestamp: '2026-09-26T08:00:00.000Z',
      platform: p.platform,
      originalText: p.originalText,
      originalHash: 'h',
      originalLength: String(p.originalText).length,
      neutralizedText: '',
      author: p.author,
      postUrl: p.postUrl,
      techniques: [],
      overallScore: 0,
      userAgeCategory: 'teen',
      aiSource: p.aiSource ?? 'rules',
      feedSource: p.feedSource ?? 'unknown',
      integrityHash: 'deadbeef',
      signature: 'sig',
      publicKeyFingerprint: 'fp',
      chainPosition: 0,
      verdict: 'pass',
      kind: p.kind,
      parentVideoId: p.parentVideoId,
    } as unknown as ForensicRecord;

    const root = render([record]);
    const card = root.querySelector('.fw-item');
    expect(card, 'the Short has a card in the export').not.toBeNull();
    expect(card!.querySelector('.fw-kind')?.textContent?.trim()).toBe(I18N.en.feedKindVideo);
    expect(card!.textContent).toContain(TITLE);
    expect(card!.textContent).toContain('@example_shorts');
    expect(root.querySelector(`a[href="https://www.youtube.com/shorts/${ID}"]`)).not.toBeNull();
  });
});
