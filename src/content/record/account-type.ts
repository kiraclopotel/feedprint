// FeelingWise — account-type derivation.
//
// Answers "WHO posted this?" from signals the adapter already read off the live
// DOM — never a fabricated or forgeable label (provenance-integrity hard rule).
// Stamped once on the PostContent at `onPostDetected`, then threaded to the
// forensic record's `accountType` / `sourceContainer`.
//
// Precedence advertiser → group → page → person. Honest coverage: when no
// signal proves a type the field is omitted (the caller stamps nothing → the
// record keeps `accountType` undefined → person semantics, hash-safe).

import type { AccountType, PostContent } from '../../types/post';

export interface DerivedAccount {
  accountType?: AccountType;
  /** The Facebook group's name — present only when accountType === 'group'. */
  sourceContainer?: string;
}

export function deriveAccountType(post: PostContent): DerivedAccount {
  // advertiser — a sponsored / promoted post. Universal across all 5 platforms
  // (each adapter sets `is_sponsored` via its own DOM marker). Highest priority:
  // a sponsored group post is first an ad.
  if (post.is_sponsored === true) {
    return { accountType: 'advertiser' };
  }

  // group — Facebook only. The adapter stamps `sourceContainer` (the group
  // name) when the post carries a `/groups/<gid>/user/` origin link. Groups are
  // an FB surface in V1; IG/X/YT/TikTok never emit 'group'.
  if (post.platform === 'facebook' && post.sourceContainer) {
    return { accountType: 'group', sourceContainer: post.sourceContainer };
  }

  // page — a verified-org badge on the account (FB/IG/YT/TikTok). X "verified"
  // is Blue (paid, noisy) → X never emits 'page'.
  const isVerified = (post.platform_specific as { isVerified?: boolean } | undefined)?.isVerified;
  if (isVerified === true && post.platform !== 'twitter') {
    return { accountType: 'page' };
  }

  // 'person' is a claim about WHO posted, and it needs an author to be about.
  // When the adapter could not resolve one, nothing here proves a type, and
  // this module's own rule is that the field is then omitted — undefined
  // already carries person semantics downstream, so omitting costs no
  // information and stops the record asserting a human being it never saw.
  //
  // It was asserting one 179 times in the 2026-09-08 export: every X record
  // whose header did not resolve carried author 'unknown', a postUrl that fell
  // back to https://x.com/home with no status id, and accountType 'person'.
  // The same posts are recorded correctly elsewhere in the same file with their
  // real handle and permalink, so the label was not merely unproven, it was
  // attached to a row that could not be checked against the platform at all.
  if (!hasResolvedAuthor(post)) return {};

  return { accountType: 'person' };
}

/**
 * Did the adapter read an author off the DOM for this post? 'unknown' is the
 * adapters' explicit "header did not resolve" value, not a handle.
 */
function hasResolvedAuthor(post: PostContent): boolean {
  const author = typeof post.author === 'string' ? post.author.trim() : '';
  return author.length > 0 && author !== 'unknown';
}
