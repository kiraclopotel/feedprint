/** @vitest-environment jsdom */
//
// Evidence-gap register item 14 (2026-09-06, owner's yes the same day): the
// media addresses a post carried are on the record, as read. Pixels were
// never kept and, since 2.5.0, nothing captures them; the address is what a
// later copy can be matched against. This file pins the reader over a DOM,
// the stamp on the post, the field's place inside the signature, and the
// threading from every emit site to the record by source.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { MEDIA_MIN_EDGE, MEDIA_URLS_MAX, mediaFrame, mediaUrlsNow, readMediaUrls, stampMediaUrls } from '../../../../src/content/record/media-urls';
import { computeRecordIntegrityHash } from '../../../../src/forensics/canonical-payload';
import type { PostContent } from '../../../../src/types/post';
import type { ForensicRecord } from '../../../../src/types/forensic';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function sized(el: Element, w: number, h: number): void {
  (el as HTMLElement).getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) });
}

function post(html: string): { root: HTMLElement; post: PostContent } {
  document.body.innerHTML = `<article id="p">${html}<p>t</p></article>`;
  const root = document.getElementById('p') as HTMLElement;
  return { root, post: { id: 'x', platform: 'tiktok', text: 't', author: '@a', domRef: new WeakRef(root) } as unknown as PostContent };
}

describe('readMediaUrls', () => {
  it('takes the post\'s own large images and its videos, skips avatars, data URLs and duplicates, in DOM order', () => {
    const { root } = post(`
      <img id="avatar" src="https://cdn.example/avatar.jpg">
      <img id="photo" src="https://cdn.example/photo.jpg?x=1">
      <img id="dup" src="https://cdn.example/photo.jpg?x=1">
      <img id="inline" src="data:image/png;base64,AAAA">
      <video id="clip" src="https://cdn.example/clip.mp4" poster="https://cdn.example/poster.jpg"><source src="https://cdn.example/clip-alt.mp4"></video>
      <img id="nosize" src="https://cdn.example/unknown.jpg">
    `);
    sized(root.querySelector('#avatar')!, 40, 40);
    sized(root.querySelector('#photo')!, 600, 400);
    sized(root.querySelector('#dup')!, 600, 400);
    sized(root.querySelector('#inline')!, 600, 400);
    expect(readMediaUrls(root)).toEqual([
      'https://cdn.example/photo.jpg?x=1',
      'https://cdn.example/clip.mp4',
      'https://cdn.example/poster.jpg',
      'https://cdn.example/clip-alt.mp4',
    ]);
    expect(MEDIA_MIN_EDGE).toBe(120);
  });

  it('caps the list and ignores overlong addresses', () => {
    const imgs = Array.from({ length: 12 }, (_, i) => `<img id="i${i}" src="https://cdn.example/${i}.jpg">`).join('');
    const { root } = post(imgs + `<img id="long" src="https://cdn.example/${'a'.repeat(3000)}">`);
    root.querySelectorAll('img').forEach(el => sized(el, 300, 300));
    const urls = readMediaUrls(root);
    expect(urls).toHaveLength(MEDIA_URLS_MAX);
    expect(urls[0]).toBe('https://cdn.example/0.jpg');
    expect(urls.some(u => u.length > 2048)).toBe(false);
  });

  it('mediaUrlsNow re-reads the live element at record time, so a picture that loaded after detection is on the record', () => {
    const a = post('<img id="late" src="https://cdn.example/late.jpg">');
    stampMediaUrls(a.post);
    expect(a.post.mediaUrls).toBeUndefined();
    sized(a.root.querySelector('#late')!, 500, 500);
    expect(mediaUrlsNow(a.post)).toEqual(['https://cdn.example/late.jpg']);
    const gone = { ...a.post, mediaUrls: ['https://cdn.example/stamped.jpg'], domRef: { deref: () => undefined } } as unknown as PostContent;
    expect(mediaUrlsNow(gone)).toEqual(['https://cdn.example/stamped.jpg']);
  });

  it('reads from the post frame above a text-element domRef, and refuses a frame recycled for another post', () => {
    document.body.innerHTML = `<article data-testid="tweet" id="frame"><img id="photo" src="https://cdn.example/photo.jpg"><div id="text">hello world this is the tweet</div></article>`;
    sized(document.getElementById('photo')!, 600, 400);
    const textEl = document.getElementById('text') as HTMLElement;
    const p = { id: 'x', platform: 'twitter', text: 'hello world this is the tweet', author: '@a', domRef: new WeakRef(textEl) } as unknown as PostContent;
    expect(mediaFrame(p)).toBe(document.getElementById('frame'));
    expect(mediaUrlsNow(p)).toEqual(['https://cdn.example/photo.jpg']);
    stampMediaUrls(p);
    expect(p.mediaUrls).toEqual(['https://cdn.example/photo.jpg']);
    // The frame now shows a different post: refused, the stamp stands.
    textEl.textContent = 'something else entirely';
    expect(mediaFrame(p)).toBeNull();
    expect(mediaUrlsNow(p)).toEqual(['https://cdn.example/photo.jpg']);
    // A media-only post used to be "read as is", which is what this line
    // asserted until 2026-09-19. It was the defect written down as an
    // expectation: with no text there was nothing to compare, so the frame came
    // back unchecked and a recycled container handed over another post's
    // pictures. tiktok.ts emits text:'' for every music-only video, so this is
    // the ordinary path for them, not a corner.
    //
    // With no text, the post's own id is the anchor. No id, no read: the stamp
    // taken at detection stands instead, because a missing address is a gap and
    // a wrong one is the record naming somebody else's picture.
    const noAnchor = { ...p, text: '', mediaUrls: undefined } as unknown as PostContent;
    expect(mediaFrame(noAnchor), 'nothing to anchor on, so not read').toBeNull();
    expect(mediaUrlsNow(noAnchor)).toBeUndefined();
    // A detached element is refused.
    textEl.remove();
    expect(mediaFrame(p)).toBeNull();
  });

  it('stampMediaUrls sets the field only when something qualified, and never throws', () => {
    const a = post('<img id="photo" src="https://cdn.example/photo.jpg">');
    sized(a.root.querySelector('#photo')!, 500, 500);
    stampMediaUrls(a.post);
    expect(a.post.mediaUrls).toEqual(['https://cdn.example/photo.jpg']);
    const b = post('<p>text only</p>');
    stampMediaUrls(b.post);
    expect(b.post.mediaUrls).toBeUndefined();
    const gone = { ...b.post, domRef: { deref: () => undefined } } as unknown as PostContent;
    stampMediaUrls(gone);
    expect(gone.mediaUrls).toBeUndefined();
  });
});

describe('the field is inside the signature and threads to the record', () => {
  const base = {
    id: 'fr-media', timestamp: '2026-09-06T10:00:00.000Z', platform: 'tiktok', originalText: 'a clip', originalHash: 'h', originalLength: 6,
    neutralizedText: '', author: '@a', postUrl: 'https://www.tiktok.com/@a/video/1', techniques: [], overallScore: 0, userAgeCategory: 'adult',
    aiSource: 'cloud', feedSource: 'for-you', prevRecordHash: 'p', chainPosition: 3, verdict: 'pass', publicKeyFingerprint: 'fp',
  } as unknown as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;

  it('swapping an address changes the hash; absent hashes as before the field existed', async () => {
    const without = await computeRecordIntegrityHash(base);
    const explicitUndefined = await computeRecordIntegrityHash({ ...base, mediaUrls: undefined });
    expect(explicitUndefined).toBe(without);
    const one = await computeRecordIntegrityHash({ ...base, mediaUrls: ['https://cdn.example/1.mp4'] });
    const other = await computeRecordIntegrityHash({ ...base, mediaUrls: ['https://cdn.example/2.mp4'] });
    expect(one).not.toBe(without);
    expect(one).not.toBe(other);
  });

  it('every emit site passes it, the logger maps it on every retained-record path, the stamp runs beside the text-fold stamp', () => {
    const sites = ['src/content/record/forensic-emit.ts', 'src/content/post-path/result-apply.ts', 'src/content/comment-batch/flush.ts', 'src/content/comment-batch/queue.ts']
      .map(f => read(f))
      .reduce((n, src) => {
        expect(src.match(/textCapture: post\.textCapture,/g)?.length).toBe(src.match(/mediaUrls: mediaUrlsNow\(post\),/g)?.length);
        return n + (src.match(/mediaUrls: mediaUrlsNow\(post\),/g)?.length ?? 0);
      }, 0);
    // 15 since 2026-09-13: the ad-served-with-Block-Ads-off record (C7).
    // 17 since 2026-09-18: a stale batch given up after the model answered
    // (flush.ts abandonStaleBatch) and a pending bucket dropped on a route
    // change or a tab close (queue.ts statePendingCommentBatches). Both are
    // new emit sites, so queue.ts joins the list above rather than being left
    // out of the sweep that makes this test mean "every".
    // 18 since 2026-10-01: a throw in the comment flush writes one record per
    // comment it could not judge (flush.ts outer catch, B7u3 site 3b).
    expect(sites).toBe(18);
    const logger = read('src/forensics/logger.ts');
    expect(logger.match(/textCapture\?: ForensicRecord\['textCapture'\];/g)?.length).toBe(logger.match(/mediaUrls\?: ForensicRecord\['mediaUrls'\];/g)?.length);
    expect(logger.match(/textCapture: input\.textCapture,/g)?.length).toBe(logger.match(/mediaUrls: input\.mediaUrls,/g)?.length);
    // mediaUrls is destructured from the logger's input. Matched by position
    // in the list rather than as the last line of it, so appending a later
    // field (verdictOrigin, 2026-09-14) does not read as this one going
    // missing.
    expect(logger).toMatch(/\n {4}mediaUrls,\n(?: {4}\w+,\n)* {2}\} = input;/);
    const index = read('src/content/index.ts');
    expect(index).toContain('  stampTextFold(post);\n  stampMediaUrls(post);');
    expect(read('src/types/messages.ts')).toContain("mediaUrls?: ForensicRecord['mediaUrls'];");
  });
});
