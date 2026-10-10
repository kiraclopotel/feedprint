// @vitest-environment jsdom
//
// A rewritten post on X whose text is then replaced by a translation of the same post (the site's
// "Translate post"). The rewrite guard holds neither the original nor the rewrite in the element any
// more, so it leaves; the element goes back to the interceptor, which reads it as a post of its own.
// This runs the real X adapter, the real interceptor and the real guard together and shows what the
// post path is handed: the translated words as a post of their own, exactly once, with no verdict
// carried over from the original. The adapter refuses to keep the original's id when the words move
// under an unchanged status link (its identity rule, twitter.ts _coherentIdentityForArticle), so the
// translation is an anonymous post: a fresh id, no address, no author. That is what the record
// holds for it. Whether the model then flags the translation is not something a test can say; it is
// measured on the model, not here.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentInterceptor } from '../../../../src/content/post-path/dom-interceptor';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { sessionVerdictKey } from '../../../../src/content/post-path/late-verdict-cache';
import {
  injectIntoElement,
  releaseAllGuards,
  setGuardStandDownHandler,
} from '../../../../src/content/injector';
import { _resetSelectorHealthForTesting } from '../../../../src/diagnostics/selector-health';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { NeutralizedContent } from '../../../../src/types/neutralization';
import type { PostContent } from '../../../../src/types/post';

const ORIGINAL = 'you people are worthless and everyone in this thread knows it already';
const REWRITE = 'i disagree strongly with the people in this thread';
const TRANSLATION = 'voi sunteti fara valoare si toata lumea din acest fir stie deja asta';

function analysis(): AnalysisResult {
  return {
    postId: '1',
    techniques: [{ technique: 'shame-attack', present: true, confidence: 0.9, severity: 6, evidence: [] }],
    overallScore: 6,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 0,
    primaryTechnique: 'shame-attack',
    explanation: 'x',
  };
}

function rewrite(): NeutralizedContent {
  return { postId: '1', originalHash: 'h', rewrittenText: REWRITE, analysis: analysis(), aiSource: 'cloud', processingTimeMs: 1 };
}

function drawTweet(text: string): HTMLElement {
  document.body.innerHTML = `
    <article role="article" data-testid="tweet">
      <a href="/User" role="link"><span>User</span></a>
      <a href="/User/status/12345" role="link">12:00</a>
      <div data-testid="tweetText" lang="en" dir="ltr">${text}</div>
    </article>`;
  return document.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
}

let seen: PostContent[] = [];
let interceptor: ContentInterceptor;

beforeEach(() => {
  _resetSelectorHealthForTesting();
  window.history.replaceState({}, '', '/home');
  seen = [];
  interceptor = new ContentInterceptor(new TwitterAdapter(), (post) => { seen.push(post); });
  setGuardStandDownHandler((el) => interceptor.rearmElement(el));
});

afterEach(() => {
  interceptor.stop();
  releaseAllGuards();
  setGuardStandDownHandler(null);
  document.body.innerHTML = '';
});

describe('a translation of a rewritten X post', () => {
  it('reaches the post path once, as a post of its own with the translated words', async () => {
    const el = drawTweet(ORIGINAL);
    interceptor.rescanCurrentSurfaceNow();
    await settle();
    expect(seen).toHaveLength(1);
    const first = seen[0];
    expect(first.text).toBe(ORIGINAL);

    expect(injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL)).toBe(true);
    expect(el.textContent).toContain(REWRITE);

    el.replaceChildren(document.createTextNode(TRANSLATION));
    await settle();

    expect(seen).toHaveLength(2);
    const second = seen[1];
    expect(first.id).toBe('12345');
    expect(second.id).not.toBe(first.id);
    expect(second.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(second.sourceUrl).toBe('');
    expect(second.author).toBe('unknown');
    expect(second.text).toBe(TRANSLATION);
    expect(second.domRef.deref()).toBe(el);
    expect(el.hasAttribute('data-fw-neutralized')).toBe(false);
  });

  it('carries no verdict over from the original, because the verdict is keyed by the words', async () => {
    const el = drawTweet(ORIGINAL);
    interceptor.rescanCurrentSurfaceNow();
    await settle();
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);
    el.replaceChildren(document.createTextNode(TRANSLATION));
    await settle();

    expect(seen).toHaveLength(2);
    expect(sessionVerdictKey(seen[1])).not.toBe(sessionVerdictKey(seen[0]));
  });

  it('is not read a second time when the page only redraws the same post', async () => {
    const el = drawTweet(ORIGINAL);
    interceptor.rescanCurrentSurfaceNow();
    await settle();
    injectIntoElement(el, rewrite(), 'teen', false, ORIGINAL);

    el.replaceChildren(document.createTextNode(ORIGINAL));
    await settle();

    expect(seen).toHaveLength(1);
    expect(el.textContent).toContain(REWRITE);
  });
});
