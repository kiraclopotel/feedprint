/** @vitest-environment jsdom */
//
// The export's feed renders its card tree in pages (2026-09-03). The owner's
// consolidated export, over 100,000 records, rendered every card on load and
// the page died before the feed finished. Locks: a set past the page size
// renders one page plus a "show more" button that names what is left; each
// press appends the next page in the same order; nothing is dropped; a small
// set renders whole with no button. The glance counts above the feed stay
// whole-set.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildForensicHtmlExport,
  FEED_SCRIPT,
  I18N,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { TREE_READ_TIMEOUT_MS } from '../../helpers/spawn-timeout';

// The large case builds and renders 900 records in jsdom; on a busy machine it passes the 5 s default.
vi.setConfig({ testTimeout: TREE_READ_TIMEOUT_MS });

function rec(i: number): ForensicRecord {
  return {
    id: `r-${i}`,
    timestamp: new Date(Date.UTC(2026, 6, 1, 10, 0, i)).toISOString(),
    platform: 'tiktok',
    originalText: `post ${i}`,
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
    chainPosition: i,
    kind: 'post',
    verdict: 'pass',
  } as ForensicRecord;
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

function renderFeed(records: ForensicRecord[]): HTMLElement {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
});

describe('export feed paging', () => {
  // THE CONTROL COUNTED THREADS while the page header counts RECORDS. A thread
  // is one top-level node and many records, so on the 2026-09-08 file "N more
  // not shown yet" read 4,691 beside a header reading "Records included:
  // 5,962" — understating what was still hidden by 1.27x, in the same unit the
  // reader had just been given.
  it('the button counts records, not the threads that hold them', () => {
    // 300 threads, each with two comments: 900 records, 300 top-level nodes.
    const records: ForensicRecord[] = [];
    for (let i = 0; i < 300; i++) {
      records.push(rec(i));
      records.push({ ...rec(1000 + i * 2), kind: 'top-comment' as const, parentRecordId: rec(i).id, commentDepth: 1 });
      records.push({ ...rec(1000 + i * 2 + 1), kind: 'top-comment' as const, parentRecordId: rec(i).id, commentDepth: 1 });
    }
    const feed = renderFeed(records);
    const more = feed.querySelector<HTMLButtonElement>('.fw-feed-more')!;
    expect(more).not.toBeNull();
    // 250 threads rendered, 50 threads left — but 150 RECORDS left, and that is
    // the number the reader is given.
    expect(more.textContent).toContain('150 records not shown yet');
    // The thread count and the record count are both shown and are different,
    // which is the whole point: one button used to give only the first.
    expect(more.textContent).toContain('Show the next 50');
    expect(more.textContent).toContain('150 in the next page');
  });

  // PAPER HAS NO BUTTON. The print rule hides every button that acts, so a printed feed of the first page ended on its last card with
  // nothing to say that 370 records were not on it. The file's own words for what is left stand beside the button as a line that is
  // hidden on screen and shown on paper.
  it('a line for paper stands beside the button with the same count, follows each press, and goes with the button', () => {
    const feed = renderFeed(Array.from({ length: 620 }, (_, i) => rec(i)));
    const more = feed.querySelector<HTMLButtonElement>('.fw-feed-more')!;
    const note = more.nextElementSibling as HTMLElement;
    expect(note.className).toBe('fw-print-note');
    expect(note.textContent).toBe(I18N.en.feedRemainingRecords.replace('{n}', '370'));
    more.click();
    expect(note.textContent).toBe(I18N.en.feedRemainingRecords.replace('{n}', '120'));
    more.click();
    expect(feed.querySelector('.fw-print-note')).toBeNull();
  });

  it('a small set has neither the button nor the line', () => {
    const feed = renderFeed(Array.from({ length: 12 }, (_, i) => rec(i)));
    expect(feed.querySelector('.fw-print-note')).toBeNull();
  });

  it('a small set renders whole, with no button', () => {
    const feed = renderFeed(Array.from({ length: 12 }, (_, i) => rec(i)));
    expect(feed.querySelectorAll(':scope > .fw-item')).toHaveLength(12);
    expect(feed.querySelector('.fw-feed-more')).toBeNull();
  });

  it('a large set renders one page and a button naming what is left; presses append in order', () => {
    const n = 620;
    const feed = renderFeed(Array.from({ length: n }, (_, i) => rec(i)));
    expect(feed.querySelectorAll(':scope > .fw-item')).toHaveLength(250);
    const more = feed.querySelector<HTMLButtonElement>('.fw-feed-more')!;
    expect(more).not.toBeNull();
    expect(more.textContent).toContain(I18N.en.feedShowMore.replace('{n}', '250'));
    expect(more.textContent).toContain(I18N.en.feedRemainingRecords.replace('{n}', '370'));
    // The glance row counted the whole set, not the page.
    expect(feed.textContent).toContain(`${n}`);

    more.click();
    expect(feed.querySelectorAll(':scope > .fw-item')).toHaveLength(500);
    expect(more.textContent).toContain(I18N.en.feedShowMore.replace('{n}', '120'));

    more.click();
    expect(feed.querySelectorAll(':scope > .fw-item')).toHaveLength(n);
    expect(feed.querySelector('.fw-feed-more')).toBeNull();

    // Nothing dropped, nothing reordered: every record appears once, and the
    // sequence across the three pages runs one way (the feed's own order),
    // with no page boundary breaking it.
    const nums = Array.from(feed.querySelectorAll(':scope > .fw-item .fw-item-text'))
      .map((e) => Number(/post (\d+)/.exec(e.textContent ?? '')?.[1]));
    expect(nums).toHaveLength(n);
    expect(new Set(nums).size).toBe(n);
    const step = Math.sign(nums[1] - nums[0]);
    for (let i = 1; i < nums.length; i++) expect(Math.sign(nums[i] - nums[i - 1])).toBe(step);
  });
});

// THREE CARD SHAPES WERE NEVER STAMPED. The feed's own docblock says it "stamps
// every card with its record's verdict", and the marker line, the room summary
// and a reconstructed node each returned before the stamp — so they carried no
// verdict at all, not even the unchecked class, while every content card around
// them did. A chain marker that failed its signature rendered as an ordinary
// grey line, and a chain marker is exactly the kind of record someone would
// want to edit.
describe('export feed — every card carries its own verdict', () => {
  function renderWithVerdicts(records: ForensicRecord[], byId: Record<string, unknown>): HTMLElement {
    const feed = renderFeed(records);
    (window as unknown as { __FW_VERDICTS__: unknown }).__FW_VERDICTS__ = { byId };
    document.dispatchEvent(new Event('fw-verified'));
    return feed;
  }

  it('a room summary and a chain marker show their own failure', () => {
    const post = { ...rec(1), id: 'p1', parentVideoId: 'g1' } as ForensicRecord;
    const room = { ...rec(2), id: 'e1', kind: 'environment' as const, parentVideoId: 'g1',
      environment: { label: 'healthy-discussion', sampled: 3 } } as unknown as ForensicRecord;
    const marker = { ...rec(3), id: 'm1', kind: 'heartbeat-marker' as const,
      resetReason: 'heartbeat: recorder alive' } as unknown as ForensicRecord;
    const feed = renderWithVerdicts([post, room, marker], {
      p1: { cls: 'pass', icon: 'ok ', label: 'verified' },
      e1: { cls: 'fail', icon: 'x ', label: 'BROKEN' },
      m1: { cls: 'fail', icon: 'x ', label: 'BROKEN' },
    });
    expect(feed.querySelector('.fw-room')?.textContent).toContain('BROKEN');
    expect(feed.querySelector('.fw-marker')?.textContent).toContain('BROKEN');
    expect(feed.querySelectorAll('.fw-item-fail').length).toBe(2);
  });
});
