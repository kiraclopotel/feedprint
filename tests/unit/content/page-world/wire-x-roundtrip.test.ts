// @vitest-environment jsdom
//
// Wire-X round-trip integration test.
//
// Exercises the full content-script-side chain WITHOUT mocking the parser:
// CustomEvent -> relay listener -> parseXPayload (real impl) -> PostContent[]
// -> the wire store.
//
// The contract changed on 2026-09-14 (PLAN-2026-09-14 item 4): the relay no
// longer dispatches into the pipeline, so the round-trip ends at the wire
// store rather than at an onPost spy. The parsed items themselves are still
// asserted field by field, because they are what fills a record.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installPageWorldRelay, receiveWirePayload } from '../../../../src/content/page-world/relay';
import { clearWireStore, wireFieldsFor } from '../../../../src/content/page-world/wire-store';
import permalinkFixture from '../../../fixtures/wire/x/tweet-detail-permalink.json';

describe('Wire-X round-trip: CustomEvent -> relay -> real parser -> wire store', () => {
  let dispose: (() => void) | null = null;

  beforeEach(() => {
    clearWireStore();
  });

  afterEach(() => {
    dispose?.();
    dispose = null;
    clearWireStore();
  });

  it('produces 2 PostContents (root + reply) with every canonical-payload-hashable field', () => {
    const captured = receiveWirePayload(
      'twitter',
      'https://x.com/i/api/graphql/abc/TweetDetail?variables=...',
      permalinkFixture,
      { pathname: '/example_origin/status/9100000000000000001' },
    );

    expect(captured).toHaveLength(2);

    // Field presence — canonical-payload hashes these for chain integrity.
    // Missing any of them produces a record the verifier rejects.
    for (const p of captured) {
      expect(p.id).toBeTruthy();
      expect(p.text).toBeTruthy();
      expect(p.author).toBeTruthy();
      expect(p.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(p.platform).toBe('twitter');
      expect(p.sourceUrl).toMatch(/^https:\/\/x\.com\//);
      expect(p.platform_specific?.platform).toBe('twitter');
    }

    // Tree-position correctness. Per X-permalink convention the focused
    // tweet is the root (depth=0); replies in the conversation module
    // become depth-1 top-comments with parent_id pointing at the root.
    const root = captured.find((p) => p.depth === 0);
    const reply = captured.find((p) => p.depth === 1);
    expect(root).toBeDefined();
    expect(reply).toBeDefined();
    expect(root!.id).toBe('9100000000000000001');
    expect(root!.author).toBe('example_origin');
    expect(reply!.id).toBe('9100000000000000002');
    expect(reply!.author).toBe('replier1');
    expect(reply!.parent_id).toBe(root!.id);
    expect(reply!.parentVideoId).toBe(root!.id);

    // surfaceKind drives the encounter assembler's PlatformSurface
    // discriminator at flush time; feedSource is what the record carries.
    expect(root!.platform_specific).toMatchObject({
      surfaceKind: 'twitter-permalink',
    });
    expect(root!.feedSource).toBe('permalink');

    // Both items are in the store under the identity the DOM adapter uses
    // for an X item: the bare rest_id.
    expect(wireFieldsFor('twitter', '9100000000000000001')).toBeDefined();
    expect(wireFieldsFor('twitter', '9100000000000000002')).toBeDefined();
  });

  it('a Facebook payload does not reach the X parser', async () => {
    dispose = installPageWorldRelay();

    document.dispatchEvent(
      new CustomEvent('fw:platform-payload', {
        detail: {
          platform: 'facebook',
          url: 'https://facebook.com/api/graphql/',
          body: { data: { stub: true } },
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 0));

    // The stub body carries no story node, so the Facebook parser files
    // nothing, and no X item can appear under a Facebook payload.
    expect(wireFieldsFor('twitter', '9100000000000000001')).toBeUndefined();
  });
});
