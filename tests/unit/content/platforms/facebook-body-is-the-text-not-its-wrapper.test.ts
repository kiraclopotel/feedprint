// @vitest-environment jsdom
//
// With no story message, the reader takes the longest dir=auto box in the post as its body. A
// wrapper around the words and a link preview is longer than the words alone, so it was chosen,
// and a rewrite could not land in it without deleting the preview's picture. The body is the text
// box inside such a wrapper, and stays the wrapper only when nothing inside it holds words.
// Two-sided: the wrapper case, the plain case that must not change, and the case with no text
// box inside.

import { beforeEach, describe, expect, it } from 'vitest';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { injectIntoElement } from '../../../../src/content/injector';
import type { AnalysisResult } from '../../../../src/types/analysis';

const POST_WORDS = 'A hostile original post with plenty of words in it.';
const HEADLINE = 'Story headline that adds more words to the wrapper than the post has';

const neutralized = {
  rewrittenText: 'a calm replacement',
  analysis: {
    postId: 'p1',
    techniques: [{ technique: 'fear-appeal', present: true, confidence: 0.9, severity: 6, evidence: [] }],
    overallScore: 6, overallConfidence: 0.9, isManipulative: true, processingTimeMs: 0,
    primaryTechnique: 'fear-appeal', explanation: 'x',
  } as AnalysisResult,
  aiSource: 'cloud',
} as never;

function bodyOf(inner: string): { body: HTMLElement; text: string; article: HTMLElement } {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'www.facebook.com', pathname: '/', search: '', href: 'https://www.facebook.com/' },
    writable: true,
    configurable: true,
  });
  document.body.innerHTML = `
    <div role="article" aria-posinset="1">
      <div data-ad-rendering-role="profile_name"><a role="link" href="/somebody">Somebody</a></div>
      ${inner}
    </div>`;
  const article = document.querySelector<HTMLElement>('[role="article"]')!;
  const post = new FacebookAdapter().extractPosts(document.querySelectorAll('[role="article"]')).find((p) => p.kind === 'post');
  const body = post?.domRef.deref();
  if (!body) throw new Error('no post record');
  return { body, text: post!.text, article };
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('the body of a Facebook post with no story message', () => {
  it('is the text box inside a wrapper that also holds a link preview with a picture', () => {
    const { body, text, article } = bodyOf(`
      <div dir="auto">
        <div dir="auto">${POST_WORDS}</div>
        <a href="https://example.test/story"><img src="preview.jpg" alt="Preview"><div>${HEADLINE}</div></a>
      </div>`);

    expect(text).toBe(POST_WORDS);
    expect(body.querySelector('img')).toBeNull();

    expect(injectIntoElement(body, neutralized, 'teen')).toBe(true);

    expect(body.textContent).toContain('a calm replacement');
    expect(article.querySelector('img[alt="Preview"]')).not.toBeNull();
  });

  it('is still the longest text box when nothing around it holds media', () => {
    const { body, text } = bodyOf(`
      <div dir="auto">${POST_WORDS} <img alt="😀" src="e.svg" height="16" width="16"></div>
      <div dir="auto">Public group and something short</div>`);

    expect(text).toContain(POST_WORDS);
    expect(body.querySelector('img')).not.toBeNull();
  });

  it('stays the wrapper when it holds the words directly and no text box sits inside it', () => {
    const { body, article } = bodyOf(`
      <div dir="auto">${POST_WORDS}<img src="photo.jpg" alt="A photo"></div>
      <div dir="auto">Public group and something short</div>`);

    expect(body.querySelector('img')).not.toBeNull();
    // The writer refuses this box, so the photo stays and the post is left as written.
    expect(injectIntoElement(body, neutralized, 'teen')).toBe(false);
    expect(article.querySelector('img[alt="A photo"]')).not.toBeNull();
  });
});
