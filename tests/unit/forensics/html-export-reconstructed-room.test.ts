/** @vitest-environment jsdom */
//
// #1 — reconstructed grouping header for orphan comments.
//
// On TikTok, FW records the comments under a video far more often than it
// records the video itself. A comment carries `parentVideoId` (+ roomAuthor /
// roomCaption / roomUrl), but the video may never be recorded as its own root.
// Pre-fix those comments floated at the top of the export with no parent —
// exactly the "starts with comments, no posts" shape observed in a real chain.
//
// This test executes the SAME feed-render script the recipient's browser runs
// (FEED_SCRIPT) and pins:
//   • orphan comments with a parentVideoId group under a `.fw-recon` header
//   • the header is labelled "reconstructed" (never mistaken for evidence)
//   • NOTHING synthetic leaks into the signed payload (data.records intact)
//   • a comment whose video WAS recorded still nests under the real record
//   • a comment with no parentVideoId at all still floats (unchanged behavior)

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
    id: 'r-1',
    timestamp: '2026-05-30T12:00:00Z',
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
    ...overrides,
  };
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

/** Build the export, mount its embedded payload + render script in jsdom, run it. */
function renderFeed(records: ForensicRecord[]): { feed: HTMLElement; payloadRecords: unknown[] } {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(
    /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/,
  );
  const payload = JSON.parse(m![1]);
  // mirror what the export's bootstrap <script> does
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = payload;
  document.body.innerHTML = '<div id="fw-exposure"></div><div id="fw-feed"></div>';
  // execute the exact recipient-side render
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return {
    feed: document.getElementById('fw-feed') as HTMLElement,
    payloadRecords: payload.records,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('reconstructed grouping header (#1)', () => {
  it('groups orphan comments (parentVideoId, no recorded video) under a reconstructed header', () => {
    const records = [
      rec({
        id: 'c-1',
        kind: 'comment',
        parentVideoId: 'vid-777',
        roomAuthor: '@creator',
        roomCaption: 'the original caption',
        roomUrl: 'https://www.tiktok.com/@creator/video/777',
        author: '@alice',
        originalText: 'first orphan comment',
      }),
      rec({
        id: 'c-2',
        kind: 'comment',
        parentVideoId: 'vid-777',
        author: '@bob',
        originalText: 'second orphan comment',
      }),
    ];
    const { feed } = renderFeed(records);

    const recon = feed.querySelectorAll('.fw-recon');
    expect(recon).toHaveLength(1);
    // badge present and labelled as reconstructed
    const badge = recon[0].querySelector('.fw-recon-badge');
    expect(badge?.textContent).toMatch(/reconstructed/i);
    // both comments live UNDER the reconstructed header, not at top level
    const children = recon[0].querySelectorAll('.fw-children .fw-item');
    expect(children).toHaveLength(2);
    // the recovered room link comes from the comment's own roomUrl
    const link = recon[0].querySelector('a.fw-source-link') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toBe('https://www.tiktok.com/@creator/video/777');
    // no orphan comment rendered as a direct top-level item
    const topLevelItems = Array.from(feed.children).filter((c) =>
      c.classList.contains('fw-item'),
    );
    expect(topLevelItems).toHaveLength(0);
  });

  it('NEVER leaks a synthetic record into the signed payload', () => {
    const records = [
      rec({ id: 'c-1', kind: 'comment', parentVideoId: 'vid-1', author: '@a' }),
    ];
    const { payloadRecords } = renderFeed(records);
    expect(payloadRecords).toHaveLength(1);
    expect((payloadRecords[0] as ForensicRecord).id).toBe('c-1');
    expect(
      payloadRecords.some((r) => String((r as { id: string }).id).startsWith('fw-recon-')),
    ).toBe(false);
  });

  it('still nests a comment under its REAL video record when one exists', () => {
    const records = [
      rec({
        id: 'v-1',
        kind: 'video',
        parentVideoId: 'vid-9',
        author: '@creator',
        postUrl: 'https://www.tiktok.com/@creator/video/9',
        originalText: 'the video caption',
      }),
      rec({ id: 'c-1', kind: 'comment', parentVideoId: 'vid-9', author: '@a', originalText: 'under real video' }),
    ];
    const { feed } = renderFeed(records);
    expect(feed.querySelectorAll('.fw-recon')).toHaveLength(0);
    // the real video root carries the comment as a child
    const roots = feed.querySelectorAll(':scope > .fw-item');
    expect(roots).toHaveLength(1);
    expect(roots[0].querySelectorAll('.fw-children .fw-item')).toHaveLength(1);
  });

  it('leaves a comment with no parentVideoId floating (unchanged behavior)', () => {
    const records = [
      rec({ id: 'c-1', kind: 'comment', author: '@a', originalText: 'truly parentless' }),
    ];
    const { feed } = renderFeed(records);
    expect(feed.querySelectorAll('.fw-recon')).toHaveLength(0);
    expect(feed.querySelectorAll(':scope > .fw-item')).toHaveLength(1);
  });
});

describe('per-comment deep-link in the export (#3a render)', () => {
  it('links to the comment anchor (not the post) when anchorUrl is present', () => {
    const records = [
      rec({
        id: 'p-1',
        kind: 'post',
        platform: 'twitter',
        postUrl: 'https://x.com/u/status/100',
        anchorUrl: 'https://x.com/u/status/100/reply/555',
        originalText: 'a flagged reply',
      }),
    ];
    const { feed } = renderFeed(records);
    const link = feed.querySelector('a.fw-source-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://x.com/u/status/100/reply/555');
    expect(link.textContent).toMatch(/exact comment/i);
  });

  it('falls back to the post URL + "original post" label when no anchorUrl', () => {
    const records = [
      rec({
        id: 'p-1',
        kind: 'post',
        platform: 'twitter',
        postUrl: 'https://x.com/u/status/100',
        originalText: 'a post',
      }),
    ];
    const { feed } = renderFeed(records);
    const link = feed.querySelector('a.fw-source-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://x.com/u/status/100');
    expect(link.textContent).toMatch(/original post/i);
  });

  it('ignores a hostile non-http anchorUrl and falls back to the post URL', () => {
    const records = [
      rec({
        id: 'p-1',
        kind: 'post',
        platform: 'twitter',
        postUrl: 'https://x.com/u/status/100',
        anchorUrl: 'javascript:alert(1)',
        originalText: 'a post',
      }),
    ];
    const { feed } = renderFeed(records);
    const link = feed.querySelector('a.fw-source-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://x.com/u/status/100');
  });
});
