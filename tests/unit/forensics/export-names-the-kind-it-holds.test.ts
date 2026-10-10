/** @vitest-environment jsdom */
//
// The export had two labels and five kinds.
//
// normKind was one function answering two questions: where a card sits, and
// what it is. It ended in a bare 'comment' default, so everything it did not
// name fell into it. kind 'image' fell into it. Measured on the public demo on
// 2026-09-19: the rendered badges were Post 1056 and Comment 444, over a file
// holding post 860, video 196, comment 229, top-comment 40 and image 175. So
// Comment 444 was 229 + 40 + 175, and 175 image records were shown to the
// recipient as comments, in the comment card, behind a comment avatar, beside
// a person's handle.
//
// An image record is not a comment and not a node. export-numbers.ts calls it
// "an analysis record, not a DOM node" and flag-provenance.ts calls it "a
// second reading". The counting layer already knew: it leaves image records out
// of its totals and prints a note saying how many. Only the rendering said
// otherwise, and the rendering is the part a recipient reads.
//
// The dashboard had the answer the whole time. filter-rail.ts gives Images its
// own kind and keeps it out of Comments; group-records.ts sorts image with post
// and video at root, saying the media verdict "belongs directly under the post
// header, not among the comments". Two surfaces over one record, disagreeing,
// with nothing comparing them: the seam, not the slip, is the thing to hold.
//
// A video was labelled Post for the same reason, so the export could not show a
// recipient which items were video at all. It says Video now.
//
// This file locks the mapping in both directions: what each kind is called, and
// where each kind sits.

import { describe, it, expect } from 'vitest';
import {
  buildForensicHtmlExport,
  FEED_SCRIPT,
  I18N,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(kind: string, over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq += 1;
  return {
    id: `r-${seq}`,
    timestamp: new Date(Date.parse('2026-07-01T10:00:00Z') + seq * 60_000).toISOString(),
    platform: 'twitter',
    originalText: `sample ${seq}`,
    originalHash: 'h',
    originalLength: 8,
    neutralizedText: '',
    author: '@someone',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: seq,
    kind,
    verdict: 'pass',
    ...over,
  } as unknown as ForensicRecord;
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

/** Render the feed the way the shipped page does, both scripts, in page order. */
function render(records: ForensicRecord[]): HTMLElement {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

/** Every rendered card as { label on the badge, layout class }. */
function cards(root: HTMLElement): Array<{ label: string; layout: string }> {
  return [...root.querySelectorAll('.fw-item')].map((el) => ({
    label: (el.querySelector('.fw-kind')?.textContent ?? '').trim(),
    layout: (el.className.match(/fw-item-(post|comment|reply)\b/) ?? [])[1] ?? '(none)',
  }));
}

describe('the export names the kind it holds (2026-09-19)', () => {
  it('gives every kind its own word, and never calls a picture a comment', () => {
    const root = render([
      rec('post'), rec('video'), rec('image'), rec('comment'), rec('top-comment'),
    ]);
    const byLabel = cards(root).reduce<Record<string, number>>(
      (a, c) => ({ ...a, [c.label]: (a[c.label] ?? 0) + 1 }), {},
    );

    expect(byLabel[I18N.en.feedKindPost], 'the post').toBe(1);
    expect(byLabel[I18N.en.feedKindVideo], 'the video, which used to read Post').toBe(1);
    expect(byLabel[I18N.en.feedKindImage], 'the image, which used to read Comment').toBe(1);
    // comment and top-comment are both a comment to a reader, and always were.
    expect(byLabel[I18N.en.feedKindComment], 'the two comments').toBe(2);
    expect(Object.keys(byLabel).sort(), 'four words, not two').toHaveLength(4);
  });

  it('sits an image at root, where the dashboard sits it, not among the comments', () => {
    const root = render([rec('post'), rec('video'), rec('image'), rec('comment')]);
    const layoutOf = (label: string) => cards(root).find((c) => c.label === label)?.layout;

    expect(layoutOf(I18N.en.feedKindImage), 'root, with post and video').toBe('post');
    expect(layoutOf(I18N.en.feedKindVideo)).toBe('post');
    expect(layoutOf(I18N.en.feedKindPost)).toBe('post');
    expect(layoutOf(I18N.en.feedKindComment), 'a comment still indents').toBe('comment');
  });

  it('carries the two new words in all four languages', () => {
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const strings = I18N[lang];
      expect(strings.feedKindVideo, `${lang} video`).toBeTruthy();
      expect(strings.feedKindImage, `${lang} image`).toBeTruthy();
      expect(strings.feedKindImage, `${lang} does not reuse the comment word`)
        .not.toBe(strings.feedKindComment);
      expect(strings.feedKindVideo, `${lang} does not reuse the post word`)
        .not.toBe(strings.feedKindPost);
    }
  });

  it('is a real guard: the old default would put an image among the comments', () => {
    // The defect stated as an assertion rather than as prose. If a later change
    // reintroduces a catch-all that answers both questions at once, an image
    // record lands here again and this fails with the count that says so.
    const root = render([rec('image'), rec('image'), rec('comment')]);
    const commentCards = cards(root).filter((c) => c.label === I18N.en.feedKindComment);
    expect(commentCards, 'one comment, and the two images are not in it').toHaveLength(1);
  });
});
