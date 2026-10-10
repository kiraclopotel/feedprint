// FeelingWise — Emoji-cluster aggregator
//
// / V1.5-promoted-to-V1 (per the "predominant emotion based on emoji"
// product mandate + master-plan iteration-1 TIER A promotion). Universal
// across all 5 platforms (text-parse only — no DOM extraction). Single biggest
// psychological-context lift available at near-zero cost.
//
// Per VISION §1.2 protection-accuracy: same comment "Ok racist" reads
// differently when surrounded by 😂🤣🤡 (joke-train / sarcastic) vs 🔴⚠️💀
// (serious-attention pile-on). The classifier currently judges each comment
// in textual isolation; emoji-cluster signals provide the room-tone context
// that disambiguates borderline cases AND informs rewrite tone (calm rewrite
// of a humor-room comment must preserve playfulness; calm rewrite of a
// hostility-room comment must defuse not match-energy).
//
// Per `feedback_per_platform_metrics_aware_batch_design`: this is a
// derivative signal — the room-emotion vector is computed once per Encounter
// from the children's text. No DOM extraction. No per-platform branching.

/**
 * The six dominant emoji clusters. A comment's dominant cluster is the one
 * with the highest emoji-count from that family in the comment text.
 *
 * Naming: action-of-the-poster — what intent does this cluster convey?
 *   - humor             → playful / sarcastic / dismissive-via-laughter
 *   - hostility         → anger / threat / mockery / cruelty
 *   - spectator         → observing-without-engaging / popcorn-energy
 *   - serious-attention → alerts / urgency / "look at this carefully"
 *   - dismissive        → bored / unimpressed / shrug-off
 *   - affection         → love / care / supportive
 *   - identity          → flags / pride / religious / national markers
 */
export type EmojiCluster =
  | 'humor'
  | 'hostility'
  | 'spectator'
  | 'serious-attention'
  | 'dismissive'
  | 'affection'
  | 'identity';

// Curated emoji-to-cluster table. First-cluster-wins on overlap (an emoji
// in two clusters takes the FIRST listed assignment). Coverage targets
// ~95% of social-media emoji use; long-tail emoji are unmapped (return null).
//
// V1.5+ candidates: regional flags expansion, multi-skin-tone variants of
// the affection family, combined ZWJ sequences (👨‍👩‍👧‍👦 family / 🏳️‍🌈 pride flag).
const EMOJI_CLUSTERS: Record<EmojiCluster, readonly string[]> = {
  humor: [
    '😂', '🤣', '😏', '🤡', '😄', '😆', '🙃', '🤭', '😎', '😜', '😝',
    '🤪', '😬', '🥳', '🥴', '🤓',
  ],
  hostility: [
    '😡', '🤬', '💀', '🖕', '☠️', '😠', '👿', '😤', '😾', '🔪',
    '⚔️', '🥊', '👹', '👺',
  ],
  spectator: [
    '🍿', '👀', '🪑', '🧐', '🤨', '🍵', '☕', '🫖',
  ],
  'serious-attention': [
    '🔴', '⚠️', '❗', '‼️', '🚨', '📢', '🔔', '⛔', '🔥', '🟥',
  ],
  dismissive: [
    '🙄', '😒', '😴', '🥱', '🤷', '🫤', '😐', '😑', '🫥', '😶',
  ],
  affection: [
    '❤️', '💕', '💖', '💝', '🥰', '😍', '😘', '🤗', '🥺', '💗',
    '💓', '💞', '💟', '🌹', '🌸', '💜', '💙', '💚', '🧡', '💛',
  ],
  identity: [
    '🏳️‍🌈', '🏳️‍⚧️', '🇮🇱', '🇵🇸', '🇺🇦', '🇷🇺', '🇺🇸',
    '🇷🇴', '🇬🇧', '🇫🇷', '🇩🇪', '✝️', '☪️', '✡️', '☸️', '🕉️',
  ],
} as const;

// Inverted lookup: emoji → cluster. Built once at module load.
const EMOJI_TO_CLUSTER: Map<string, EmojiCluster> = (() => {
  const map = new Map<string, EmojiCluster>();
  for (const [cluster, emojis] of Object.entries(EMOJI_CLUSTERS)) {
    for (const emoji of emojis) {
      // First-cluster-wins on duplicate.
      if (!map.has(emoji)) {
        map.set(emoji, cluster as EmojiCluster);
      }
    }
  }
  return map;
})();

// Pre-computed list of multi-codepoint emojis (length > 1 in JS string units).
// Used in the indexOf scan to handle ZWJ sequences (🏳️‍🌈) and variation
// selectors (❤️, ⚠️, ☠️) that single-character regex matching can't reliably catch.
const MULTI_CODEPOINT_EMOJIS: ReadonlyArray<readonly [string, EmojiCluster]> = (() => {
  const result: Array<[string, EmojiCluster]> = [];
  for (const [emoji, cluster] of EMOJI_TO_CLUSTER) {
    if (emoji.length > 1) result.push([emoji, cluster]);
  }
  // Sort by length desc so longer sequences match first (e.g., 🏳️‍🌈
  // before 🏳️ would match the longer one first if both were in the table).
  result.sort((a, b) => b[0].length - a[0].length);
  return result;
})();

// Single-codepoint emoji regex. Catches \p{Emoji_Presentation} (emojis that
// render as emoji by default) — the bulk of social-media use. Multi-codepoint
// sequences are handled separately in the indexOf scan above.
const EMOJI_REGEX = /\p{Emoji_Presentation}/gu;

/**
 * Classify the dominant emoji-cluster of a single comment text. Returns null
 * when no recognized emojis are present (most comments — emojis are sparse).
 *
 * Algorithm:
 *   1. First pass: scan text for known multi-codepoint emoji sequences
 *      (ZWJ flags, variation-selected hearts/warnings) — count each occurrence
 *   2. Second pass: regex-match \p{Emoji_Presentation} for single-codepoint
 *      emojis; look up cluster
 *   3. Pick the cluster with the highest total count; tie → first-seen wins
 *      (insertion order in the Map preserves this)
 */
export function classifyCommentEmojiCluster(text: string): EmojiCluster | null {
  if (!text) return null;

  const counts = new Map<EmojiCluster, number>();

  // Pass 1: multi-codepoint emoji sequences (ZWJ + variation-selectors).
  // Uses a copy of the text so we can mark consumed regions; we replace
  // matched emojis with empty strings to avoid double-counting them in pass 2.
  let scratch = text;
  for (const [emoji, cluster] of MULTI_CODEPOINT_EMOJIS) {
    if (!scratch.includes(emoji)) continue;
    let idx = 0;
    let occurrences = 0;
    while ((idx = scratch.indexOf(emoji, idx)) !== -1) {
      occurrences++;
      idx += emoji.length;
    }
    if (occurrences > 0) {
      counts.set(cluster, (counts.get(cluster) ?? 0) + occurrences);
      // Replace all occurrences with same-length spaces to avoid pass-2
      // double-counting any single-codepoint component (e.g., 🏳️‍🌈 contains
      // 🏳 which would otherwise be matched by EMOJI_REGEX too).
      scratch = scratch.split(emoji).join(' '.repeat(emoji.length));
    }
  }

  // Pass 2: single-codepoint emoji regex on the (now multi-cp-stripped) text.
  const matches = scratch.match(EMOJI_REGEX);
  if (matches) {
    for (const match of matches) {
      const cluster = EMOJI_TO_CLUSTER.get(match);
      if (cluster) {
        counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
      }
    }
  }

  if (counts.size === 0) return null;

  // Pick cluster with highest count; first-inserted wins on tie (Map preserves
  // insertion order; scan order matches MULTI_CODEPOINT_EMOJIS sort + regex).
  let dominant: EmojiCluster | null = null;
  let max = 0;
  for (const [cluster, count] of counts) {
    if (count > max) {
      dominant = cluster;
      max = count;
    }
  }
  return dominant;
}

/**
 * Room-level emotion vector. Aggregates per-comment classifications into a
 * percentage breakdown across the comment array.
 */
export interface RoomEmotionVector {
  /** Cluster → percentage (0-100 integer). Sorted by share descending. */
  breakdown: Array<{ cluster: EmojiCluster; pct: number }>;
  /** Comments with at least one recognized emoji. */
  classifiedCount: number;
  /** Total comments inspected. */
  totalCount: number;
}

/**
 * Aggregate emoji-cluster vector across an array of comment texts.
 *
 * Returns null when fewer than 3 comments have classifiable emojis — signal
 * too thin below that threshold. The "Room emotion: 100% humor" line on a
 * single emoji-using comment would mislead the classifier into thinking the
 * room is unanimously playful; the threshold prevents that.
 */
export function aggregateRoomEmotion(commentTexts: string[]): RoomEmotionVector | null {
  const total = commentTexts.length;
  if (total === 0) return null;

  const counts = new Map<EmojiCluster, number>();
  let classified = 0;
  for (const text of commentTexts) {
    const cluster = classifyCommentEmojiCluster(text);
    if (cluster) {
      counts.set(cluster, (counts.get(cluster) ?? 0) + 1);
      classified++;
    }
  }

  // Signal threshold: at least 3 emoji-using comments. Below this, the room-
  // emotion line is suppressed (returns null) so the prompt doesn't carry a
  // misleading "Room emotion" line built on noise.
  if (classified < 3) return null;

  const breakdown: Array<{ cluster: EmojiCluster; pct: number }> = [];
  for (const [cluster, count] of counts) {
    breakdown.push({ cluster, pct: Math.round((count / classified) * 100) });
  }
  breakdown.sort((a, b) => b.pct - a.pct);

  return { breakdown, classifiedCount: classified, totalCount: total };
}

/**
 * Format a room-emotion vector as a one-line prompt addition. Empty string
 * when the vector is null or all clusters fall below the 5% reporting floor.
 *
 * Example output: `Room emotion: 67% humor / 20% hostility / 13% other`
 * The "other" bucket aggregates all clusters with < 5% share to keep the
 * line compact (max ~5 segments).
 */
export function formatRoomEmotionLine(vector: RoomEmotionVector | null): string {
  if (!vector || vector.breakdown.length === 0) return '';

  const parts: string[] = [];
  let otherPct = 0;
  for (const { cluster, pct } of vector.breakdown) {
    if (pct >= 5) {
      parts.push(`${pct}% ${cluster}`);
    } else {
      otherPct += pct;
    }
  }
  if (otherPct >= 1) {
    parts.push(`${otherPct}% other`);
  }
  if (parts.length === 0) return '';
  return `Room emotion: ${parts.join(' / ')}`;
}
