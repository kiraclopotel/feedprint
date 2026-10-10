/**
 * The model is told not to put emoji in a rewrite and sometimes does anyway, so every rewrite
 * path strips them here. Wide on purpose: stripping a symbol by mistake is better than an emoji
 * in FeelingWise's own words in front of a child. Besides the emoji blocks this takes the joiner
 * and selector that build compound emoji, the keycap mark (or "1️⃣" leaves a broken glyph), and the
 * tag characters of the England, Scotland and Wales flags. Keep the ranges in step with
 * EMOJI_PRESENCE_RE in src/content/engagement/emoji-stripper.ts, the detecting half.
 */
export function stripEmojis(text: string): string {
  const stripped = text.replace(
    /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2500}-\u{25FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu,
    '',
  );
  return stripped.replace(/\s{2,}/g, ' ').trim();
}
