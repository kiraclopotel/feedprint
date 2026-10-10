// @vitest-environment jsdom
//
// §CT-26g.3.6 — Cross-platform edit-marker capture.
//
// Per VISION §1.1 chain-mirror: kid saw the BEFORE-edit version. The chain
// must record honestly when a comment was later edited so recipients (judge
// / counselor / parent) understand the chain captures observation, not
// guarantee of original wording.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { InstagramAdapter } from '../../../../src/content/platforms/instagram';
import { YoutubeAdapter } from '../../../../src/content/platforms/youtube';
import { FacebookAdapter } from '../../../../src/content/platforms/facebook';
import { buildBatchPromptV3 } from '../../../../src/ai/prompts-v2';
import { buildEncounterForFlushBatch } from '../../../../src/content/record/encounter-builder';
import type { PostContent } from '../../../../src/types/post';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href),
    writable: true,
    configurable: true,
  });
}

function mount(html: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  return wrap;
}

describe('§CT-26g.3.6 — edit-marker per platform', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  afterEach(() => { document.body.innerHTML = ''; });

  it('Instagram: detects "Edited" marker on a comment li', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <a href="/poster/" role="link">poster</a>
        <span dir="auto">long enough caption to clear the threshold</span>
        <ul>
          <li><span dir="auto">caption skip</span></li>
          <li>
            <a href="/u/" role="link"><span>u</span></a>
            <span>this comment was edited</span>
            <span>Edited</span>
          </li>
        </ul>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const c = posts.find((p) => p.kind === 'top-comment');
    if (c?.platform_specific?.platform === 'instagram') {
      expect(c.platform_specific.isEdited).toBe(true);
    }
  });

  it('Instagram: detects RO "Editat" marker', () => {
    setLocation('https://www.instagram.com/p/ABC/');
    const root = mount(`
      <article>
        <a href="/poster/" role="link">poster</a>
        <span dir="auto">long enough caption to clear the threshold</span>
        <ul>
          <li><span dir="auto">caption skip</span></li>
          <li>
            <a href="/u/" role="link"><span>u</span></a>
            <span>romanian edited comment</span>
            <span>Editat</span>
          </li>
        </ul>
      </article>
    `);
    const posts = new InstagramAdapter().extractPosts(root.childNodes);
    const c = posts.find((p) => p.kind === 'top-comment');
    if (c?.platform_specific?.platform === 'instagram') {
      expect(c.platform_specific.isEdited).toBe(true);
    }
  });

  it('YouTube: detects "(edited)" inline marker', () => {
    setLocation('https://www.youtube.com/watch?v=abc');
    const root = mount(`
      <ytd-comment-renderer id="cmt-1">
        <div id="content-text">comment that was edited</div>
        <div id="author-text">@u</div>
        <span>(edited)</span>
      </ytd-comment-renderer>
    `);
    const posts = new YoutubeAdapter().extractPosts(root.childNodes);
    if (posts[0]?.platform_specific?.platform === 'youtube') {
      expect(posts[0].platform_specific.isEdited).toBe(true);
    }
  });

  // The body used to read "romanian edited comment text", and this case passed
  // on the English word "edited" inside it rather than on the span it names:
  // the signals were being handed the comment's BODY element, so the span was
  // never in what they read (2026-09-19). Body cleaned of every searched word,
  // so only the marker can satisfy it.
  it('Facebook: detects "Editat" RO marker', () => {
    setLocation('https://www.facebook.com/SomePage/posts/123');
    const root = mount(`
      <div role="article">
        <div data-ad-rendering-role="story_message">
          <div dir="auto">post body long enough for threshold</div>
        </div>
        <div role="article" aria-label="Comentariu adăugat de Maria">
          <a href="/maria" role="link">Maria</a>
          <div dir="auto">un comentariu obisnuit, fara cuvantul cautat</div>
          <span>Editat</span>
        </div>
      </div>
    `);
    const posts = new FacebookAdapter().extractPosts(root.childNodes);
    const c = posts.find((p) => p.kind === 'top-comment');
    if (c?.platform_specific?.platform === 'facebook') {
      expect(c.platform_specific.isEdited).toBe(true);
    }
  });

  it('plumbs is_edited through to Encounter.children + emits [EDITED] in prompt', () => {
    const child: PostContent = {
      id: 'fb-c1',
      text: 'comment that was edited',
      author: '@user',
      timestamp: '2026-05-05T00:00:00Z',
      platform: 'facebook',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'top-comment',
      depth: 1,
      parent_id: 'fb-post-1',
      parentVideoId: 'fb-post-1',
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-permalink',
        metrics: { likes: 5 },
        isVerified: false,
        isAuthor: false,
        isEdited: true,
      },
    };
    const enc = buildEncounterForFlushBatch([child], 'post body', 'English');
    expect(enc.children[0].is_edited).toBe(true);

    const { user } = buildBatchPromptV3(enc);
    expect(user).toContain('[EDITED]');
  });

  it('does NOT emit [EDITED] when no edit-marker present', () => {
    const child: PostContent = {
      id: 'fb-c1',
      text: 'never-edited comment',
      author: '@user',
      timestamp: '2026-05-05T00:00:00Z',
      platform: 'facebook',
      domRef: new WeakRef({} as HTMLElement),
      kind: 'top-comment',
      depth: 1,
      parent_id: 'fb-post-1',
      parentVideoId: 'fb-post-1',
      platform_specific: {
        platform: 'facebook',
        surfaceKind: 'facebook-permalink',
        metrics: { likes: 5 },
        isVerified: false,
        isAuthor: false,
        isEdited: false,
      },
    };
    const enc = buildEncounterForFlushBatch([child], 'post body', 'English');
    expect(enc.children[0].is_edited).toBeFalsy();

    const { user } = buildBatchPromptV3(enc);
    expect(user).not.toContain('[EDITED]');
  });
});
