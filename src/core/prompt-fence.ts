// Keeps post text and author handles from posing as instructions to the model: dangerous Unicode
// is stripped and the content sits inside <user-content> tags, which the system prompt says hold
// data, never instructions. That covers "ignore previous instructions", fake system markers, JSON
// meant to hijack the parser, direction-override and zero-width smuggling, and a post that closes
// the tag itself. Not covered: HTML or CSS (the model renders neither; validateNeutralization in
// neutralizer.ts checks the output) and multi-turn attacks (each post is one call).
//
// The SECURITY clause of buildJudgeDetectNeutralizeSystem in src/ai/prompts.ts names these tags.
// Change the tag constants below and that clause must change with them.

// TAB, LF and CR are kept.
const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
// Direction overrides and isolates, U+202A to U+202E and U+2066 to U+2069. Ordinary text does not
// need them.
const BIDI_OVERRIDE_RE = /[‪-‮⁦-⁩]/g;
// Zero-width characters and the byte-order mark.
const ZERO_WIDTH_RE = /[​-‍﻿]/g;
// Our own tag, so a post cannot write `</user-content>SYSTEM: ...` and step out of the fence. It
// allows the spacing and self-closing forms used to dodge an exact match (`< user-content >`,
// `<user-content/>`), and runs twice because one pass over `</</user-content>user-content>` leaves
// a closing tag behind. A space replaces it so the words on either side do not fuse.
const FENCE_TAG_RE = /<\s*\/?\s*user-content\s*\/?\s*>/gi;

/** Shared by the per-post and the batch prompt paths. */
export function stripFenceTokens(raw: string): string {
  return raw.replace(FENCE_TAG_RE, ' ').replace(FENCE_TAG_RE, ' ');
}

const SECURITY_TAG_OPEN = '<user-content>';
const SECURITY_TAG_CLOSE = '</user-content>';

/** Does not add the fence; the fence functions below do. */
export function stripDangerousUnicode(raw: string): string {
  return stripFenceTokens(
    raw
      .replace(CONTROL_CHAR_RE, '')
      .replace(BIDI_OVERRIDE_RE, '')
      .replace(ZERO_WIDTH_RE, ''),
  );
}

/**
 * Other people's text (sibling comments, room context) is data too: every line is stripped and the
 * block sits in one fence. Unfenced, a commenter could put words into the trusted part of the
 * model calls about someone else's post.
 */
export function fenceContextBlock(raw: string): string {
  const cleaned = raw
    .split('\n')
    .map(line => stripDangerousUnicode(line))
    .join('\n')
    .trim();
  return `${SECURITY_TAG_OPEN}\n${cleaned}\n${SECURITY_TAG_CLOSE}`;
}

export function fenceUserContent(raw: string): string {
  const cleaned = stripDangerousUnicode(raw);
  return `${SECURITY_TAG_OPEN}${cleaned}${SECURITY_TAG_CLOSE}`;
}

/** The same as fenceUserContent, named apart so post text can get its own limits later. */
export function fencePostText(raw: string): string {
  return fenceUserContent(raw);
}

/**
 * Cut at 80 characters: real handles are short (X allows 15, Instagram 30, Facebook 50), so a
 * longer one is almost certainly an injection attempt.
 */
export function fenceAuthorHandle(raw: string): string {
  const cleaned = stripDangerousUnicode(raw).slice(0, 80);
  return `${SECURITY_TAG_OPEN}${cleaned}${SECURITY_TAG_CLOSE}`;
}
