// Content identity: does one served item get one name from two strangers?
//
// The record's whole claim to be evidence rests on corroboration. A signed record
// proves nothing was changed after signing and nothing about whether the thing was
// ever served, so weight has to come from unrelated observers reporting the same
// item. That is impossible unless two independent DOM extractions of one post
// produce one identity.
//
// Before src/forensics/content-identity.ts they did not: the identity was a raw
// sha256 of the extracted caption, and one of eight realistic extraction variants
// agreed (docs/research/third-instrument-2026-09-21/DECISION.md section 4).
//
// The cases below are that measurement, turned into a lock. Half of them pin
// convergence. The other half pin the NON-convergence, which matters just as much:
// the rule underneath this file is that a false merge is worse than a false split,
// because a false merge manufactures corroboration that never happened.

import { describe, it, expect } from 'vitest';
import {
  CONTENT_IDENTITY_VERSION,
  contentIdentity,
  identityComparability,
  identityLimits,
  normaliseForIdentity,
} from '../../../src/forensics/content-identity';

// One plausible post. The accented character and the family emoji are not
// decoration: they are what make the unicode cases real instead of contrived.
const POST = 'Guvernul ascunde adevărul. Trezește-te 👨‍👩‍👧 înainte să fie prea târziu!';

describe('two extractions of one post arrive at one identity', () => {
  it.each([
    ['the same bytes', POST],
    ['decomposed accents instead of composed', POST.normalize('NFD')],
    ['a trailing newline the extractor added', `${POST}\n`],
    ['leading and trailing whitespace', `   ${POST}  `],
    ['a non-breaking space where a space was', POST.replace(' ', ' ')],
    ['a Windows line ending', POST.replace('!', '!\r\n')],
    ['a tab where a space was', POST.replace(' ', '\t')],
    ['two spaces where the DOM kept layout', POST.replace('. ', '.  ')],
    ['a zero-width space the extractor inserted', POST.replace('a', '​a')],
    ['a byte-order mark on the front', `﻿${POST}`],
    ['a soft hyphen inside a word', POST.replace('Guvernul', 'Guver­nul')],
  ])('agrees when the only difference is %s', async (_label, variant) => {
    expect(await contentIdentity(variant)).toBe(await contentIdentity(POST));
  });

  it('carries its rule version inline so a later rule cannot be compared with this one', async () => {
    const identity = await contentIdentity(POST);
    expect(identity.startsWith(`${CONTENT_IDENTITY_VERSION}:`)).toBe(true);
    expect(identity.slice(CONTENT_IDENTITY_VERSION.length + 1)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent, so normalising an already-normal text changes nothing', () => {
    const once = normaliseForIdentity(POST);
    expect(normaliseForIdentity(once)).toBe(once);
  });
});

// Each case here is a merge this rule must REFUSE to make. If one of these starts
// passing, someone has widened normalisation past extraction noise into content,
// and corroboration counts computed with it will overstate agreement.
describe('what must never be merged, because a false merge invents corroboration', () => {
  it.each([
    ['case', 'They are lying to you', 'THEY ARE LYING TO YOU'],
    ['curly against straight quotes', "it's over", 'it’s over'],
    ['a hyphen against an en dash', 'the 2024-2025 season', 'the 2024–2025 season'],
    ['an exclamation mark', 'Wake up', 'Wake up!'],
    ['digits', 'over 400 dead', 'over 4000 dead'],
    ['one word', 'the vote was stolen', 'the vote was not stolen'],
  ])('keeps texts apart when they differ by %s', async (_label, a, b) => {
    expect(await contentIdentity(a)).not.toBe(await contentIdentity(b));
  });

  it('keeps the emoji joiner, so one family is not merged with three people', async () => {
    const family = 'look 👨‍👩‍👧';
    const threePeople = family.replace(/‍/g, '');
    expect(await contentIdentity(family)).not.toBe(await contentIdentity(threePeople));
  });

  it('keeps the joiner in scripts where it shapes letters, not emoji', () => {
    // U+200C ZERO WIDTH NON-JOINER is a letter-shaping character in Persian and
    // the Indic scripts. Stripping it as "invisible noise" would merge different
    // words, hardest in the languages with the least representation in this corpus.
    const withJoiner = 'می‌روم';
    expect(normaliseForIdentity(withJoiner)).toContain('‌');
  });
});

// The half normalisation must not touch. A caption cut at "Show more" is less
// text, not the same text worn differently, and the cut point moves with the
// viewport. Merging these would be a systematic false merge.
describe('text the page only partly carried is not comparable at all', () => {
  it('leaves a truncated caption with its own identity', async () => {
    const cut = `${POST.slice(0, 40)}…`;
    expect(await contentIdentity(cut)).not.toBe(await contentIdentity(POST));
  });

  it.each([
    ['whole', 'comparable'],
    ['folded', 'comparable'],
    ['cut', 'incomparable'],
    ['platform', 'incomparable'],
  ] as const)('reports %s capture as %s', (capture, expected) => {
    expect(identityComparability({ textCapture: capture })).toBe(expected);
  });

  it('refuses to guess for records written before capture was recorded', () => {
    // Absent is NOT 'whole' (docs/design/TEXT-CAPTURE-2026-09-05.md). Almost every
    // historical record lands here, and saying so is the point: a corroboration
    // claim must not quietly lean on history it cannot vouch for.
    expect(identityComparability({ textCapture: undefined })).toBe('unknown');
  });
});

describe('an identity reports what it cannot promise', () => {
  it('counts length in characters a person would recognise, not UTF-16 units', () => {
    // The family emoji is one grapheme, five code points and eight UTF-16 units.
    // A caller thresholding "too short to mean anything" is counting neither of
    // the last two.
    expect(identityLimits('👨‍👩‍👧').length).toBe(5);
    expect('👨‍👩‍👧'.length).toBe(8);
  });

  it('warns when a text carries joiners an extractor might drop', () => {
    expect(identityLimits(POST).carriesJoiners).toBe(true);
    expect(identityLimits('plain words only').carriesJoiners).toBe(false);
  });

  it('measures the normal form, not the raw text', () => {
    expect(identityLimits('  two   words  ').length).toBe('two words'.length);
  });
});
