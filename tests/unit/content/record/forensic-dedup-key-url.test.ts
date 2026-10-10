// GEMS.md gem 80 — "74 posts captured twice within a minute" (recount 11).
//
// forensicDedupKey keyed on platform+id+text. The id is not always stable
// across two captures of the same real item: a virtualizer remount, or an
// adapter falling back to crypto.randomUUID() on a partial read, mints a new
// id each time while the platform's own permalink (PostContent.sourceUrl)
// does not. Two captures of the same post within a minute then produced two
// different keys and two signed records for one real event (63 of 74 in the
// same session, per the real export this gem was found in).
//
// The fix keys on the URL when the post has one, keeping text alongside it
// rather than the URL alone: Instagram's own comment walker falls back to the
// PARENT post's URL when it has no per-comment link
// (_walkCommentsContainer's `sourceUrl = cLink?.href || fallbackParentPostUrl`
// in instagram.ts), so two different real comments under the same post can
// share a sourceUrl — text is what still tells them apart.

import { describe, it, expect, beforeEach } from 'vitest';
import { forensicDedupKey, shouldLogForensic, _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';

beforeEach(() => {
  _resetForensicDedupForTesting();
});

describe('forensicDedupKey keys on the URL when the post has one', () => {
  it('two captures of one URL within a minute keep one record, even with a churned id', () => {
    const first = { platform: 'twitter', id: crypto.randomUUID(), text: 'a post worth keeping', sourceUrl: 'https://x.com/someone/status/123' };
    const second = { platform: 'twitter', id: crypto.randomUUID(), text: 'a post worth keeping', sourceUrl: 'https://x.com/someone/status/123' };
    expect(first.id).not.toBe(second.id); // the churn this fault is about

    expect(shouldLogForensic(forensicDedupKey(first))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(second))).toBe(false);
  });

  it('two different URLs keep two records', () => {
    const first = { platform: 'twitter', id: 'a', text: 'same words either way', sourceUrl: 'https://x.com/someone/status/123' };
    const second = { platform: 'twitter', id: 'b', text: 'same words either way', sourceUrl: 'https://x.com/someone/status/456' };

    expect(shouldLogForensic(forensicDedupKey(first))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(second))).toBe(true);
  });

  it('a post with no URL behaves as it does today (keys on platform+id+text)', () => {
    const first = { platform: 'tiktok', id: 'tk-vid-1', text: '' };
    const second = { platform: 'tiktok', id: 'tk-vid-2', text: '' };
    // No sourceUrl field at all — the exact shape every pre-existing caller uses.
    expect(shouldLogForensic(forensicDedupKey(first))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(second))).toBe(true); // distinct id, not collapsed

    const repeat = { platform: 'tiktok', id: 'tk-vid-1', text: '' };
    expect(shouldLogForensic(forensicDedupKey(repeat))).toBe(false); // same id, still deduped

    // An empty sourceUrl is "no URL", same as the field being absent.
    const emptyUrl = { platform: 'tiktok', id: 'tk-vid-3', text: 'x', sourceUrl: '' };
    expect(forensicDedupKey(emptyUrl)).toBe(forensicDedupKey({ platform: 'tiktok', id: 'tk-vid-3', text: 'x' }));
  });

  it('two different comments sharing a fallback parent URL are not conflated', () => {
    // The Instagram shape this fix must not break: two real, different
    // comments under one post, neither with its own /c/ link, both falling
    // back to the same parent postUrl.
    const commentA = { platform: 'instagram', id: 'ig-cmt-POST1-0', text: 'first commenter says one thing', sourceUrl: 'https://www.instagram.com/p/POST1/' };
    const commentB = { platform: 'instagram', id: 'ig-cmt-POST1-1', text: 'second commenter says something else', sourceUrl: 'https://www.instagram.com/p/POST1/' };

    expect(shouldLogForensic(forensicDedupKey(commentA))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(commentB))).toBe(true);
  });

  it('the same words from two accounts under one post, sharing the parent URL, are two records (a pile-on)', () => {
    // Neither comment has a link of its own, so both carry the PARENT's URL
    // and no anchorUrl. The URL is then not the comment's own address, so the
    // id stays in the key and tells the two accounts apart.
    const parentUrl = 'https://www.instagram.com/p/POST1/';
    const fromFirst = { platform: 'instagram', id: 'ig-cmt-POST1-0', author: '@first_account', text: 'the same line, word for word', sourceUrl: parentUrl, kind: 'top-comment' as const };
    const fromSecond = { platform: 'instagram', id: 'ig-cmt-POST1-1', author: '@second_account', text: 'the same line, word for word', sourceUrl: parentUrl, kind: 'top-comment' as const };

    expect(forensicDedupKey(fromFirst)).not.toBe(forensicDedupKey(fromSecond));
    expect(shouldLogForensic(forensicDedupKey(fromFirst))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(fromSecond))).toBe(true);
  });

  it('a comment with its own permalink keeps one key when its id churns', () => {
    const permalink = 'https://www.instagram.com/p/POST1/c/998877/';
    const first = { platform: 'instagram', id: crypto.randomUUID(), text: 'a comment worth keeping', sourceUrl: permalink, anchorUrl: permalink, kind: 'top-comment' as const };
    const second = { ...first, id: crypto.randomUUID() };
    expect(first.id).not.toBe(second.id);

    expect(shouldLogForensic(forensicDedupKey(first))).toBe(true);
    expect(shouldLogForensic(forensicDedupKey(second))).toBe(false);
  });
});
