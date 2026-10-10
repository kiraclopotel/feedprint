// The exposure gate: the one intervention in the pipeline that fires on a
// count rather than on a severity score.
//
// Why it exists: 95.8% of the advertising in the judged sample sits below
// severity 4, so a severity floor cannot see a campaign at all, while the
// measured record holds one source that reached the reader on 33 separate
// days through the recommended feed. Rationale and thresholds:
// docs/audits/2026-08-25-true-judgement/NARRATOR.md.
//
// Pure-function unit test, following the house pattern in
// pipeline-pass-through.test.ts: the gate logic is exported and exercised
// directly rather than driving the full pipeline through a mocked LLM.
//
// The notice memo is module state keyed by author@platform, so every test
// below uses its own author.

import { describe, it, expect } from 'vitest';
import { shouldEmitExposureNotice, exposureMarkResult } from '../../../src/analysis/pipeline';
import type { ExposurePressure } from '../../../src/forensics/author-store';
import type { PostContent } from '../../../src/types/post';

const DAY = '2026-08-26';

function post(author: string | undefined): PostContent {
  return {
    id: `post-${author ?? 'anon'}`,
    text: 'ordinary copy that no severity gate would ever flag',
    author,
    platform: 'facebook',
  } as PostContent;
}

const fired: ExposurePressure = {
  fired: true, reason: 'days', distinctDays: 33, creativeCount: 0,
};
const quiet: ExposurePressure = {
  fired: false, reason: null, distinctDays: 2, creativeCount: 1,
};

describe('exposure gate — when it fires', () => {
  it('fires for a source over the threshold', () => {
    expect(shouldEmitExposureNotice(post('@over'), fired, DAY)).toBe(true);
  });

  it('stays quiet for a source under the threshold', () => {
    expect(shouldEmitExposureNotice(post('@under'), quiet, DAY)).toBe(false);
  });

  it('stays quiet when the post has no author to count', () => {
    expect(shouldEmitExposureNotice(post(undefined), fired, DAY)).toBe(false);
  });
});

describe('exposure gate — one notice per source per day', () => {
  it('does not repeat on the next post from the same source that day', () => {
    const p = post('@repeat');
    expect(shouldEmitExposureNotice(p, fired, DAY)).toBe(true);
    expect(shouldEmitExposureNotice(p, fired, DAY)).toBe(false);
    expect(shouldEmitExposureNotice(p, fired, DAY)).toBe(false);
  });

  it('speaks again the next day', () => {
    const p = post('@nextday');
    expect(shouldEmitExposureNotice(p, fired, DAY)).toBe(true);
    expect(shouldEmitExposureNotice(p, fired, '2026-08-27')).toBe(true);
  });

  it('rate-limits per source, not globally', () => {
    expect(shouldEmitExposureNotice(post('@first'), fired, DAY)).toBe(true);
    expect(shouldEmitExposureNotice(post('@second'), fired, DAY)).toBe(true);
  });
});

describe('exposure mark result', () => {
  it('is a mark, never a rewrite and never a hide', () => {
    const r = exposureMarkResult(post('@shape'), fired, 0);
    expect(r.action).toBe('mark');
    expect(r.neutralized).toBeUndefined();
  });

  it('names repetition as the concern, not a content technique', () => {
    const r = exposureMarkResult(post('@named'), fired, 0);
    expect(r.analysis?.primaryTechnique).toBe('repeat-exposure');
    expect(r.analysis?.techniques.map(t => t.technique)).toEqual(['repeat-exposure']);
  });

  it('carries the count as its evidence, so the marker can say why', () => {
    const r = exposureMarkResult(post('@evidence'), fired, 0);
    expect(r.analysis?.techniques[0].evidence[0]).toContain('33');
  });

  it('reports the creative count when that is what crossed the line', () => {
    const creative: ExposurePressure = {
      fired: true, reason: 'creative', distinctDays: 1, creativeCount: 7,
    };
    const r = exposureMarkResult(post('@creative'), creative, 0);
    expect(r.analysis?.techniques[0].evidence[0]).toContain('7');
  });
});
