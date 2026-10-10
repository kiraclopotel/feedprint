// @vitest-environment jsdom
//
// One item, two capture paths, one record.
//
// PLAN-2026-09-14 item 4: a wire-captured item "must never create a second
// record for an item the DOM already captured". The guarantee this tree gives
// is stronger than a race: the wire path has no way to emit at all. It files
// what the platform said into the wire store, and the DOM item's own record
// picks those fields up at the onPostDetected chokepoint. So there is one
// record because there is one writer.
//
// This file pins both halves:
//   1. the two paths meet on the same content identity, and enrichment does
//      not change the identity the record gate dedups on, so the existing gate
//      still writes exactly one record for the item;
//   2. the relay has no emit path (a source lock, same idiom as
//      tests/unit/content/comment-batch/room-sensor-gate.source.test.ts), because the behavior above is
//      only a guarantee while that stays true.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { receiveWirePayload } from '../../../../src/content/page-world/relay';
import {
  clearWireStore,
  enrichPostFromWire,
  wireFieldsFor,
  wireIdentity,
} from '../../../../src/content/page-world/wire-store';
import {
  forensicDedupKey,
  shouldLogForensic,
  _resetForensicDedupForTesting,
} from '../../../../src/content/record/forensic-gate';
import type { PostContent } from '../../../../src/types/post';
import tiktokForYou from '../../../fixtures/wire/tiktok/item-list-for-you.json';

/**
 * What the TikTok DOM adapter produces for the SAME video the fixture carries:
 * the caption node on a For You card holds no text and no ad label, so the
 * record it would write on its own says "unknown surface, no paid placement,
 * no media".
 */
function domCapturedVideo(): PostContent {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return {
    id: 'tk-vid-7000000000000000002',
    text: '',
    author: 'unknown',
    timestamp: '2026-09-14T12:00:00.000Z',
    platform: 'tiktok',
    domRef: new WeakRef(el),
    kind: 'video',
    parentVideoId: 'tk-vid-7000000000000000002',
    feedSource: 'unknown',
  } as unknown as PostContent;
}

beforeEach(() => {
  clearWireStore();
  _resetForensicDedupForTesting();
  document.body.innerHTML = '';
});

describe('a DOM capture and a wire capture of the same item yield one record', () => {
  it('both paths resolve to the same content identity', () => {
    receiveWirePayload(
      'tiktok',
      'https://www.tiktok.com/api/recommend/item_list/',
      tiktokForYou,
      { pathname: '/' },
    );
    const dom = domCapturedVideo();
    expect(wireFieldsFor(dom.platform, dom.id)).toBeDefined();
    expect(wireIdentity(dom.platform, dom.id)).toBe(
      wireIdentity('tiktok', 'tk-vid-7000000000000000002'),
    );
  });

  it('the wire fills what the DOM could not read, and the record gate still writes once', () => {
    receiveWirePayload(
      'tiktok',
      'https://www.tiktok.com/api/recommend/item_list/',
      tiktokForYou,
      { pathname: '/' },
    );
    const dom = domCapturedVideo();
    const keyBefore = forensicDedupKey(dom);

    const filled = enrichPostFromWire(dom);
    expect(filled).toEqual(expect.arrayContaining(['is_sponsored', 'feedSource', 'author', 'mediaUrls']));
    expect(dom.is_sponsored).toBe(true);
    expect(dom.feedSource).toBe('for-you');
    expect(dom.author).toBe('example_brand');
    expect(dom.mediaUrls?.length).toBeGreaterThan(0);

    // This video's wire caption is empty, so enrichment leaves its text alone and the
    // identity the record gate dedups on (platform, id, text) is the same string it was.
    // (Where the wire does carry a caption and the DOM read none, the text is filled here,
    // before the gate runs: tests/unit/content/page-world/wire-caption-fill.test.ts.) One
    // item, one key, one record.
    expect(forensicDedupKey(dom)).toBe(keyBefore);
    expect(shouldLogForensic(forensicDedupKey(dom))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(dom))).toBe(false);
  });

  it('a second wire sighting of the same item does not add a second entry', () => {
    const url = 'https://www.tiktok.com/api/recommend/item_list/';
    receiveWirePayload('tiktok', url, tiktokForYou, { pathname: '/' });
    const first = wireFieldsFor('tiktok', 'tk-vid-7000000000000000001');
    receiveWirePayload('tiktok', url, tiktokForYou, { pathname: '/' });
    const second = wireFieldsFor('tiktok', 'tk-vid-7000000000000000001');
    expect(second).toEqual(first);
  });

  it('enrichment never overwrites something the DOM already read', () => {
    receiveWirePayload(
      'tiktok',
      'https://www.tiktok.com/api/recommend/item_list/',
      tiktokForYou,
      { pathname: '/' },
    );
    const dom = domCapturedVideo();
    dom.author = 'read_from_the_page';
    dom.feedSource = 'profile';
    const filled = enrichPostFromWire(dom);
    expect(filled).not.toContain('author');
    expect(filled).not.toContain('feedSource');
    expect(dom.author).toBe('read_from_the_page');
    expect(dom.feedSource).toBe('profile');
  });

  it('an item the wire never saw is left exactly as the DOM read it', () => {
    const dom = domCapturedVideo();
    const before = { ...dom };
    expect(enrichPostFromWire(dom)).toEqual([]);
    expect(dom.is_sponsored).toBe(before.is_sponsored);
    expect(dom.feedSource).toBe(before.feedSource);
  });
});

describe('the relay has no emit path — source lock', () => {
  const relaySource = readFileSync(
    join(process.cwd(), 'src/content/page-world/relay.ts'),
    'utf8',
  );
  /** The file minus its `//` comment lines: the header explains the path that
   *  was removed, and prose about a removed thing must not fail a lock on the
   *  thing itself. */
  const relayCode = relaySource
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//'))
    .join('\n');

  it('installPageWorldRelay takes no callback', () => {
    // A zero-argument installer is the shape that makes "the wire cannot
    // create a record" checkable rather than asserted.
    expect(relaySource).toContain('export function installPageWorldRelay(): () => void');
  });

  it('nothing in the relay calls a post dispatcher', () => {
    expect(relayCode).not.toContain('onPost');
    expect(relayCode).not.toContain('onPostDetected');
  });

  it('the shadow-mode flag is gone with the emit path it guarded', () => {
    expect(relayCode).not.toContain('__FW_WIRE_LIVE__');
  });
});
