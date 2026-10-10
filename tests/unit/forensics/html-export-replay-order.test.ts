/** @vitest-environment jsdom */
//
// 0d parity — the HTML export's feed renders in REPLAY order, matching the
// dashboard (group-records.ts): sessions newest-first, and within a browsing
// session items appear in the order the reader actually SAW them
// (observedSequence), not the order slow AI verdicts finished writing
// (chainPosition). Presentation only: the signed payload stays untouched.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildForensicHtmlExport,
  FEED_SCRIPT,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'r-' + Math.random().toString(36).slice(2),
    timestamp: '2026-07-01T10:00:00Z',
    platform: 'tiktok',
    originalText: 'sample',
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@user',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: 0,
    kind: 'post',
    ...overrides,
  };
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function renderFeedHtml(records: ForensicRecord[]): string {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(
    /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/,
  );
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-exposure"></div><div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return (document.getElementById('fw-feed') as HTMLElement).innerHTML;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('export feed replay order (0d parity with the dashboard)', () => {
  it('within one session, seen order beats chain (completion) order', () => {
    const seenFirstWroteLate = rec({
      id: 'r-a',
      originalText: 'SEEN-FIRST-WROTE-LATE',
      observedSequence: 1,
      viewportSeenAt: '2026-07-01T10:00:00Z',
      surfaceSessionId: 's1',
      chainPosition: 5,
    });
    const seenSecondWroteEarly = rec({
      id: 'r-b',
      originalText: 'SEEN-SECOND-WROTE-EARLY',
      observedSequence: 2,
      viewportSeenAt: '2026-07-01T10:00:05Z',
      surfaceSessionId: 's1',
      chainPosition: 2,
    });
    // Old pos()-order rendered wrote-early first; replay order must not.
    const html = renderFeedHtml([seenFirstWroteLate, seenSecondWroteEarly]);
    expect(html.indexOf('SEEN-FIRST-WROTE-LATE')).toBeGreaterThan(-1);
    expect(html.indexOf('SEEN-FIRST-WROTE-LATE')).toBeLessThan(html.indexOf('SEEN-SECOND-WROTE-EARLY'));
  });

  it('the newest session renders first; seen order holds inside each session', () => {
    const y1 = rec({ id: 'r-y1', originalText: 'YESTERDAY-ONE', observedSequence: 1, viewportSeenAt: '2026-06-30T09:00:00Z', surfaceSessionId: 'old', chainPosition: 1 });
    const y2 = rec({ id: 'r-y2', originalText: 'YESTERDAY-TWO', observedSequence: 2, viewportSeenAt: '2026-06-30T09:00:10Z', surfaceSessionId: 'old', chainPosition: 2 });
    const t1 = rec({ id: 'r-t1', originalText: 'TODAY-ONE', observedSequence: 1, viewportSeenAt: '2026-07-01T09:00:00Z', surfaceSessionId: 'new', chainPosition: 3 });
    const t2 = rec({ id: 'r-t2', originalText: 'TODAY-TWO', observedSequence: 2, viewportSeenAt: '2026-07-01T09:00:10Z', surfaceSessionId: 'new', chainPosition: 4 });
    const html = renderFeedHtml([y1, y2, t1, t2]);
    const iT1 = html.indexOf('TODAY-ONE');
    const iT2 = html.indexOf('TODAY-TWO');
    const iY1 = html.indexOf('YESTERDAY-ONE');
    const iY2 = html.indexOf('YESTERDAY-TWO');
    expect(iT1).toBeLessThan(iT2);
    expect(iY1).toBeLessThan(iY2);
    expect(iT2).toBeLessThan(iY1);
  });

  it('legacy records without impression fields still render, newest-first like the dashboard', () => {
    const older = rec({ id: 'r-old', originalText: 'LEGACY-OLDER', timestamp: '2026-06-01T10:00:00Z', chainPosition: 1 });
    const newer = rec({ id: 'r-new', originalText: 'LEGACY-NEWER', timestamp: '2026-06-02T10:00:00Z', chainPosition: 2 });
    const html = renderFeedHtml([older, newer]);
    expect(html.indexOf('LEGACY-NEWER')).toBeGreaterThan(-1);
    expect(html.indexOf('LEGACY-NEWER')).toBeLessThan(html.indexOf('LEGACY-OLDER'));
  });

  it('comments under a post keep seen order, timestamp fallback for legacy', () => {
    const post = rec({ id: 'r-post', originalText: 'THE-POST', chainPosition: 0 });
    const c1 = rec({ id: 'r-c1', kind: 'comment', parentRecordId: 'r-post', originalText: 'COMMENT-SEEN-FIRST', observedSequence: 3, surfaceSessionId: 's1', viewportSeenAt: '2026-07-01T10:00:01Z', chainPosition: 9 });
    const c2 = rec({ id: 'r-c2', kind: 'comment', parentRecordId: 'r-post', originalText: 'COMMENT-SEEN-SECOND', observedSequence: 4, surfaceSessionId: 's1', viewportSeenAt: '2026-07-01T10:00:02Z', chainPosition: 7 });
    const html = renderFeedHtml([post, c1, c2]);
    expect(html.indexOf('COMMENT-SEEN-FIRST')).toBeGreaterThan(-1);
    expect(html.indexOf('COMMENT-SEEN-FIRST')).toBeLessThan(html.indexOf('COMMENT-SEEN-SECOND'));
  });
});
