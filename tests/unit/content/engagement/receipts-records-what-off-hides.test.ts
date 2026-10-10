/** @vitest-environment jsdom */
// Both apps on one page: Receipts reads an item and its record keeps it, whatever Off hides and in either order.
// Off hides with styles only (Block this sets display:none on the box, picker.ts hideBox; the page parts are style
// tags) and never removes a node, and Receipts' readers take the text with textContent and no visibility test, so
// which script runs first does not decide what is recorded. Run here both ways on one X page: Off's Block this hides
// a post and then Receipts reads it, and Receipts reads it and then Off hides it. The record is written by the
// logger the post path calls (result-apply.ts), with the store and the signature stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 1, prevRecordHash: 'prev-hash-stub' })),
}));
vi.mock('../../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../../src/forensics/hasher', () => ({
  sha256: vi.fn(async (s: string) => `hash-of:${s}`),
}));
vi.mock('../../../../src/storage/context-guard', () => ({ isContextAlive: () => true }));

import { shapeFor, startPickedBlocks } from '../../../../src/content/engagement/picker';
import { RECORDER_RUNS_ATTR, RECEIPTS_RUNS } from '../../../../src/content/engagement/recorder-runs';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { logForensicEvent } from '../../../../src/forensics/logger';
import { addRecord } from '../../../../src/forensics/store';
import { RECORDER_STAMP } from '../../../../src/products/off/stand-down';
import { _setProductForTesting } from '../../../../src/product';
import type { FWSettings } from '../../../../src/storage/settings';
import type { AnalysisResult } from '../../../../src/types/analysis';

const BODY = 'a post the reader picked away in Off';

function page(): HTMLElement {
  document.body.innerHTML = `
    <main role="main"><section>
      <div data-testid="cellInnerDiv">
        <article role="article" data-testid="tweet">
          <a data-testid="User-Name" href="/someone" role="link"><span>Someone</span></a>
          <div data-testid="tweetText" lang="en" dir="ltr">${BODY}</div>
        </article>
      </div>
      <div data-testid="cellInnerDiv"><article role="article" data-testid="tweet"><div data-testid="tweetText">another</div></article></div>
    </section></main>`;
  // Receipts' stamp, as content/index.ts writes it: the families it runs, then the stamp.
  document.documentElement.setAttribute(RECORDER_RUNS_ATTR, RECEIPTS_RUNS.join(' '));
  document.documentElement.setAttribute(RECORDER_STAMP, 'true');
  return document.querySelector<HTMLElement>('[data-testid="cellInnerDiv"]')!;
}

/** Off's Block this, with the pick made from the box the way the picker makes it. */
function offHides(box: HTMLElement): () => void {
  _setProductForTesting('off');
  const shape = shapeFor(box)!;
  const settings = { pickedBlocks: [{ id: 'p1', platform: 'twitter', createdAt: '2026-10-07T00:00:00Z', label: 'a post', ...shape }] } as unknown as FWSettings;
  return startPickedBlocks('twitter', settings);
}

/** Receipts reads the page and writes the item's record. */
async function receiptsRecords(): Promise<string[]> {
  _setProductForTesting('receipts');
  const posts = new TwitterAdapter().extractPosts(document.querySelectorAll('article[role="article"]'));
  for (const post of posts) {
    await logForensicEvent({
      originalText: post.text,
      neutralizedText: '',
      analysis: { postId: post.id, techniques: [], overallScore: 0, overallConfidence: 1, isManipulative: false, processingTimeMs: 0, action: 'pass' } as unknown as AnalysisResult,
      mode: 'adult',
      platform: 'twitter',
      aiSource: 'rules',
    });
  }
  return posts.map(p => p.text);
}

const recorded = () => vi.mocked(addRecord).mock.calls.map(c => JSON.stringify(c[0]));

beforeEach(() => {
  vi.mocked(addRecord).mockClear();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  // Block this leaves boxes under 24 px alone (picker.ts guard); jsdom lays nothing out, so every box gets a post's size.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 500, bottom: 200, width: 500, height: 200, toJSON: () => ({}) } as DOMRect);
  vi.stubGlobal('chrome', {
    storage: { onChanged: { addListener: () => {}, removeListener: () => {} }, local: { get: async () => ({}), set: async () => {} } },
    runtime: { getManifest: () => ({ version: '2.5.18' }), sendMessage: async () => undefined },
  });
});
afterEach(() => {
  _setProductForTesting(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute(RECORDER_STAMP);
  document.documentElement.removeAttribute(RECORDER_RUNS_ATTR);
});

describe('both apps on one page: the record holds what Off hides', () => {
  it('Off hides the post first, Receipts still reads it and records it', async () => {
    const box = page();
    const stop = offHides(box);
    expect(box.style.display, 'Off hid the box').toBe('none');
    expect(box.isConnected, 'and left it in the page').toBe(true);
    expect(await receiptsRecords()).toContain(BODY);
    expect(recorded().some(r => r.includes(`hash-of:${BODY}`))).toBe(true);
    stop();
  });

  it('Receipts reads the post first, then Off hides it, and the record is the same', async () => {
    const box = page();
    expect(await receiptsRecords()).toContain(BODY);
    const stop = offHides(box);
    expect(box.style.display).toBe('none');
    expect(recorded().some(r => r.includes(`hash-of:${BODY}`))).toBe(true);
    stop();
  });
});
