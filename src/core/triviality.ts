// Comments with too little in them to earn a flag of their own. They still go to the model, since
// twenty "🤣" in a row say something about a thread, but tagged so it does not flag each one. A
// comment is trivial when any of these holds:
//   1. a sticker, GIF or image placeholder with at most 3 other characters;
//   2. more than 60% of its non-space characters are emoji;
//   3. fewer than 3 words and no name in it. A capitalised mention (`@Maria`) or a capitalised
//      word after the first (`ok Maria`) counts as a name, because a short comment aimed at a
//      person may carry intent. A capital at the start does not, so `Maria!` alone is trivial.
// Irony is left to the model.

type TrivialityReason =
  | 'empty'
  | 'sticker'
  | 'emoji-dominant'
  | 'too-few-tokens'
  | 'substantive';

export interface TrivialityResult {
  trivial: boolean;
  reason: TrivialityReason;
  /** For calibrating the thresholds on real data. */
  metrics: {
    nonWhitespaceCodepoints: number;
    emojiCodepoints: number;
    emojiRatio: number;
    alphanumericTokens: number;
    hasNamedEntity: boolean;
  };
}

const EMOJI_RATIO_THRESHOLD = 0.6;

const TOKEN_COUNT_FLOOR = 3;

/** Room for a stray emoji beside a sticker, not for a word ("[Sticker] great point"). */
const STICKER_RESIDUAL_MAX = 3;

const STICKER_PLACEHOLDER_RE = /\[(sticker|gif|image|photo|autocolant|imagine)\]/gi;
const ALPHANUM_TOKEN_RE = /[\p{L}\p{N}]+/gu;
const EMOJI_RE = /\p{Extended_Pictographic}/u;

export function isTrivial(text: string): TrivialityResult {
  const trimmed = (text ?? '').trim();
  const metrics = {
    nonWhitespaceCodepoints: 0,
    emojiCodepoints: 0,
    emojiRatio: 0,
    alphanumericTokens: 0,
    hasNamedEntity: false,
  };

  if (trimmed.length === 0) {
    return { trivial: true, reason: 'empty', metrics };
  }

  if (STICKER_PLACEHOLDER_RE.test(trimmed)) {
    STICKER_PLACEHOLDER_RE.lastIndex = 0; // a /g regex keeps its position between calls
    const residual = trimmed.replace(STICKER_PLACEHOLDER_RE, '').trim();
    if (residual.length <= STICKER_RESIDUAL_MAX) {
      return { trivial: true, reason: 'sticker', metrics };
    }
  }
  STICKER_PLACEHOLDER_RE.lastIndex = 0;

  const codepoints = Array.from(trimmed).filter(cp => !/\s/.test(cp));
  metrics.nonWhitespaceCodepoints = codepoints.length;
  if (codepoints.length > 0) {
    let emoji = 0;
    for (const cp of codepoints) {
      if (EMOJI_RE.test(cp)) emoji++;
    }
    metrics.emojiCodepoints = emoji;
    metrics.emojiRatio = emoji / codepoints.length;
    if (metrics.emojiRatio > EMOJI_RATIO_THRESHOLD) {
      return { trivial: true, reason: 'emoji-dominant', metrics };
    }
  }

  const tokens = trimmed.match(ALPHANUM_TOKEN_RE) ?? [];
  metrics.alphanumericTokens = tokens.length;
  metrics.hasNamedEntity = hasNamedEntity(trimmed, tokens);

  if (tokens.length < TOKEN_COUNT_FLOOR && !metrics.hasNamedEntity) {
    return { trivial: true, reason: 'too-few-tokens', metrics };
  }

  return { trivial: false, reason: 'substantive', metrics };
}

/**
 * Simple on purpose. A false positive only sends a trivial comment to the model, which flags
 * nothing in it; a false negative silently drops a comment aimed at someone.
 */
function hasNamedEntity(text: string, tokens: string[]): boolean {
  if (/@\p{Lu}[\p{L}\d_]{1,}/u.test(text)) return true;

  for (let i = 0; i < tokens.length; i++) {
    if (i === 0) continue; // every sentence starts with a capital
    const t = tokens[i];
    if (t.length < 3) continue;
    const first = t.charAt(0);
    if (!/\p{Lu}/u.test(first)) continue;
    const rest = t.slice(1);
    if (!/\p{Ll}/u.test(rest)) continue;
    return true;
  }
  return false;
}
