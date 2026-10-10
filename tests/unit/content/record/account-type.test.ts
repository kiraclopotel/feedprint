// Unit tests for deriveAccountType — WHO posted an item, from live DOM signals.
//
// Precedence (honest coverage): advertiser → group → page → person. A platform
// that cannot prove a type does not guess it (result.accountType undefined →
// caller leaves the record field undefined → person semantics, hash-safe).

import { describe, it, expect } from 'vitest';
import { deriveAccountType } from '../../../../src/content/record/account-type';
import type { PostContent } from '../../../../src/types/post';

function post(partial: Partial<PostContent>): PostContent {
  return {
    id: 'p1',
    text: 'hello',
    author: '@someone',
    timestamp: '2026-06-23T00:00:00.000Z',
    platform: 'facebook',
    ...partial,
  } as PostContent;
}

describe('deriveAccountType', () => {
  it('returns advertiser for a sponsored post on any platform', () => {
    expect(deriveAccountType(post({ platform: 'instagram', is_sponsored: true })))
      .toEqual({ accountType: 'advertiser' });
  });

  it('advertiser wins over a Facebook group container (precedence)', () => {
    expect(
      deriveAccountType(
        post({ platform: 'facebook', is_sponsored: true, sourceContainer: 'Example Hobby Group' }),
      ),
    ).toEqual({ accountType: 'advertiser' });
  });

  it('returns group + sourceContainer for a Facebook group post', () => {
    expect(deriveAccountType(post({ platform: 'facebook', sourceContainer: 'Example Hobby Group' })))
      .toEqual({ accountType: 'group', sourceContainer: 'Example Hobby Group' });
  });

  it('never emits group off Facebook even if a container leaks in', () => {
    expect(deriveAccountType(post({ platform: 'instagram', sourceContainer: 'something' })))
      .not.toHaveProperty('accountType', 'group');
  });

  it('returns page for a verified-org account on Facebook/IG/YT/TikTok', () => {
    expect(
      deriveAccountType(
        post({ platform: 'youtube', platform_specific: { platform: 'youtube', isVerified: true } }),
      ),
    ).toEqual({ accountType: 'page' });
  });

  it('does NOT emit page on X (verified is Blue/noisy)', () => {
    expect(
      deriveAccountType(
        post({ platform: 'twitter', platform_specific: { platform: 'twitter', isVerified: true } as never }),
      ),
    ).toEqual({ accountType: 'person' });
  });

  it('returns person when nothing is provable', () => {
    expect(deriveAccountType(post({ platform: 'tiktok' }))).toEqual({ accountType: 'person' });
  });
});

// 'person' is a claim about WHO posted, and it needs an author to be about.
// Every X record whose header did not resolve carried author 'unknown', a
// postUrl that fell back to https://x.com/home with no status id, and
// accountType 'person' — 179 of them in the 2026-09-08 export, asserting a
// human being the adapter never saw. This module's own docblock already said
// the field is omitted when nothing proves a type.
describe('an unresolved author proves no type', () => {
  it.each(['unknown', '', '   '])('omits the field when author is %j', (author) => {
    expect(deriveAccountType(post({ platform: 'twitter', author }))).toEqual({});
  });

  it('omits the field when the adapter set no author at all', () => {
    const p = post({ platform: 'twitter' });
    delete (p as { author?: unknown }).author;
    expect(deriveAccountType(p)).toEqual({});
  });

  // A signal that proves a type stands on its own — a sponsored unit is an ad
  // whether or not its header resolved, because is_sponsored came from the
  // platform's own marker rather than from the author row.
  it('still names an advertiser with no resolvable author', () => {
    expect(deriveAccountType(post({ platform: 'twitter', author: 'unknown', is_sponsored: true })))
      .toEqual({ accountType: 'advertiser' });
  });

  it('still names a person when the author did resolve', () => {
    expect(deriveAccountType(post({ platform: 'twitter', author: '@real' })))
      .toEqual({ accountType: 'person' });
  });
});
