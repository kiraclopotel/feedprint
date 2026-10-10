// FeelingWise — content identity: the name two strangers give the same served item.
//
// WHY THIS EXISTS. A signed record can be a signed lie. The chain proves nothing
// was altered after signing; it proves nothing about whether the observation ever
// happened. Cryptography cannot close that, because a fabrication happens BEFORE
// the signature. The only answer is corroboration: an observation earns weight in
// proportion to how many unrelated observers recorded the same item being served,
// and manufacturing becomes expensive in proportion to how many independent
// installs a forger would have to control.
// (docs/history/2026-09/INFORMATION-FIREWALL-2026-09-08.md section 14.)
//
// Corroboration needs one thing, and until this file nothing provided it:
//
//   The same served item, seen by two people who have never met, must produce
//   the same content identity in both records.
//
// WHAT WAS WRONG. `contentIdentity()` in export-numbers.ts returns `originalHash`,
// which logger.ts computes as a raw `sha256(originalText)` with no normalisation.
// Byte-exact. Two observers agree only when two DOM extractions produce identical
// bytes. Measured against eight ways real extractions of one post differ, ONE of
// eight agreed (docs/research/third-instrument-2026-09-21/DECISION.md section 4).
// That is not theoretical: 9.3 percent of items end in a truncation marker and
// 36.8 percent of them on Facebook (docs/README.md findings table).
//
// THE SHAPE, and it is the reason this is cheap. The identity is DERIVED, never
// stored. `originalText` is already inside the canonical payload and therefore
// already covered by the record's signature (canonical-payload.ts), so any reader
// holding a verified record can recompute this and get the same answer. That buys
// three things a stored field could not:
//   • no schema version bump, and no risk to a single existing signature;
//   • it applies retroactively to every record ever written;
//   • a second implementer needs only this rule and the signed text, not our code.
//
// THE RULE THAT DECIDES EVERY JUDGEMENT CALL BELOW: a false merge is worse than a
// false split. Two different items collapsing into one identity MANUFACTURES
// corroboration that never happened, which is precisely the fabrication this whole
// mechanism exists to resist. Two records of one item failing to meet costs us a
// little evidence and lies to nobody. So normalisation removes only what a text
// extractor can add or drop on its own, and never touches content.
//
// See docs/research/third-instrument-2026-09-21/DECISION.md for the measurement
// and verifier/FORMAT.md for the normative statement a second implementer reads.

import { sha256 } from './hasher';
import type { ForensicRecord } from '../types/forensic';

/**
 * The version tag every identity carries, inline, as `fw-ci-1:<64 hex>`.
 *
 * It is in the string itself and not in a sibling field on purpose. Identities
 * travel: into a table, a CSV column, someone else's database. A bare hex digest
 * from rule v1 and one from a future v2 would compare equal-or-not with no way to
 * know the two were computed by different rules, and a silent false NON-match is
 * how a corroboration count quietly becomes wrong. Prefixed, the comparison is
 * either right or obviously impossible.
 */
export const CONTENT_IDENTITY_VERSION = 'fw-ci-1';

/** Invisible characters a text extractor inserts or drops with no content meaning. */
const FORMAT_NOISE = /[​﻿­᠎]/g;

/**
 * Horizontal whitespace that is a plain space wearing a different code point.
 * `&nbsp;` in markup is the common source; the typographic spaces come from
 * pasted text and from platforms that justify with them.
 */
const HORIZONTAL_SPACE = /[\t   -   　]/g;

/**
 * Put text into the one form every implementer must hash.
 *
 * Applied, in order:
 *   1. Unicode NFC. Two extractions of one string differ in composed against
 *      decomposed form depending on the platform and the operating system, and
 *      NFC is the form the web standardises on.
 *   2. Line endings to `\n`. CRLF and lone CR are transport, not content.
 *   3. Format noise dropped: zero-width space, byte-order mark, soft hyphen,
 *      Mongolian vowel separator.
 *   4. Horizontal whitespace unified to one plain space, then runs collapsed.
 *   5. Each line trimmed, runs of blank lines collapsed to one, ends trimmed.
 *
 * DELIBERATELY NOT DONE, each one because it would risk a false merge:
 *   • Case is never folded. "Shot" and "SHOT" are different text.
 *   • Punctuation is never unified. A curly and a straight quote usually differ
 *     because the two posts differ, not because the two extractions do.
 *   • U+200D ZERO WIDTH JOINER and U+200C ZERO WIDTH NON-JOINER are KEPT. They
 *     look like noise and are not: the joiner is what makes one family emoji out
 *     of three people, and both are letter-shaping characters in Arabic, Persian
 *     and the Indic scripts. Dropping them would merge texts that differ, and it
 *     would do it hardest in the languages with the least representation here.
 *     The price is stated in `identityLimits` below and it is the right price.
 *   • Emoji are never folded to a base form, for the same reason.
 *   • Nothing is truncated, padded, or lower-bounded. Length is reported instead,
 *     so a caller can decide what is too short to mean anything.
 */
export function normaliseForIdentity(text: string): string {
  const unified = text
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(FORMAT_NOISE, '')
    .replace(HORIZONTAL_SPACE, ' ')
    .replace(/ {2,}/g, ' ');

  return unified
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The identity of a piece of served text: `fw-ci-1:<sha-256 of the normal form>`.
 *
 * Deterministic, needs no network, and is computable by anyone holding the signed
 * `originalText`. Two observers of one item agree here or the item does not
 * corroborate.
 */
export async function contentIdentity(text: string): Promise<string> {
  return `${CONTENT_IDENTITY_VERSION}:${await sha256(normaliseForIdentity(text))}`;
}

/**
 * Whether this record's text may be compared with another observer's at all.
 *
 * This is the half of the problem normalisation must NOT solve. A caption cut at
 * "Show more" is genuinely less text than the same caption read whole, and the
 * cut point moves with the viewport, so two observers of one post hold two
 * different strings and are right to. Normalising them into agreement would be a
 * false merge of the worst kind, because it would be systematic.
 *
 *   'comparable'  the page carried the item's whole text
 *                 (`textCapture` 'whole' or 'folded' — 'folded' means the screen
 *                  showed less but the DOM held all of it, which is what we hash)
 *   'incomparable' the page carried part of it ('cut'), or the text came from the
 *                 platform's own payload rather than the screen ('platform'), in
 *                 which case it may corroborate other 'platform' captures but not
 *                 what a person's screen showed
 *   'unknown'     the record predates `textCapture` (before 2026-09-05). Absent
 *                 is NOT 'whole' (docs/design/TEXT-CAPTURE-2026-09-05.md line 49),
 *                 and guessing here would silently quote history as evidence.
 *
 * Almost every historical record answers 'unknown', and that is the honest
 * answer rather than a defect in this function.
 */
export function identityComparability(
  record: Pick<ForensicRecord, 'textCapture'>,
): 'comparable' | 'incomparable' | 'unknown' {
  const capture = record.textCapture;
  if (capture === undefined) return 'unknown';
  if (capture === 'whole' || capture === 'folded') return 'comparable';
  return 'incomparable';
}

/**
 * What this rule does not do, in a form a caller can act on rather than a comment
 * it will not read. Returned beside an identity so a corroboration count can state
 * its own limits instead of being quoted without them.
 *
 * `length` is the normal form's length in code points, not UTF-16 units, because
 * a caller thresholding "too short to mean anything" is counting characters a
 * person would recognise. Two different people posting the same single emoji DO
 * produce the same identity: that is content addressing working as defined, and it
 * is why a corroboration claim on very short text is weak evidence.
 */
export function identityLimits(text: string): {
  length: number;
  carriesJoiners: boolean;
} {
  const normal = normaliseForIdentity(text);
  return {
    length: Array.from(normal).length,
    // A text containing joiners is one where a text extractor that drops them
    // produces a different identity, and this rule deliberately will not repair
    // that. A caller comparing such items should expect a lower match rate.
    carriesJoiners: /[‌‍]/.test(normal),
  };
}
