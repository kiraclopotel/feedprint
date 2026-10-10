// FeelingWise — Pre-LLM signal extractors (emoji-pile + repetition).
//
// Two structural manipulation patterns the harm-floor regex layer doesn't
// capture: (1) emoji density and (2) repeated-token / repeated-character /
// repeated-phrase emphasis tactics. Both are general patterns, not single-case
// regex hacks, so they belong in the pre-LLM signal layer per
// `feedback_no_regex_patches_for_long_tail_failures.md`.
//
// Output contract: each function returns either null (no signal) or a small
// {weight, evidence} object the harm-floor enrichment can stamp into the
// per-comment harm_floor record. Weights sit in the same 0-100 scoring band
// as harm-floor's keyword/structural categories so they compose naturally.

/** Pre-LLM signal output. null means the signal did not fire. */
export interface PreLlmSignal {
  /** 0-100 weight contributed to the harm-floor score. */
  weight: number;
  /** ≤80-char snippet describing what fired, for forensic + prompt context. */
  evidence: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Emoji-pile density
//
// Catches manipulation patterns like "🔪🔪🔪🔪🔪 die" or "❤️❤️❤️❤️❤️❤️❤️"
// where the emoji-run is the emphasis vector. Two-condition fire so the
// signal catches both short-text emoji-stacks AND long-cluster emphasis:
//   density = cluster_count × longest_cluster_length / text_length > 0.15
//   OR longest_cluster ≥ 5
// ─────────────────────────────────────────────────────────────────────────────

// Emoji codepoint detection. Covers both \p{Emoji_Presentation} (codepoints
// that default to emoji rendering) AND \p{Extended_Pictographic} (anything
// the Unicode emoji spec lists as a pictograph — incl. ❤ / ⚠ / ☠ which
// default to text presentation but render as emoji when followed by VS16).
// Single-codepoint test; modifiers/selectors handled separately.
const EMOJI_PRESENTATION_RE = /\p{Extended_Pictographic}/u;

/** Cluster threshold parameters. Tuned for child-feed comments (typically ≤140 chars). */
const EMOJI_MIN_CLUSTER_LEN = 3;     // run of ≥3 to count as a cluster
const EMOJI_LONG_CLUSTER = 5;        // cluster of ≥5 fires on its own
const EMOJI_DENSITY_THRESHOLD = 0.15;

/**
 * Detect emoji-pile manipulation. Scans the text for adjacent emoji runs
 * (clusters), counts only clusters of length ≥3, and fires when either the
 * density crosses 0.15 OR a single cluster reaches 5+ emojis.
 *
 * Multi-codepoint emoji (ZWJ flags, variation-selectors on hearts/warnings)
 * are counted by their base character — the run "❤️❤️❤️" matches as 3
 * adjacent emoji presentations regardless of the variation selectors between.
 *
 * Returns null when no qualifying cluster is present (the common case).
 */
export function detectEmojiPile(text: string): PreLlmSignal | null {
  if (!text || text.length === 0) return null;

  // Walk char-by-char (using Array.from to iterate by codepoint) and find
  // runs of emoji-presentation characters. Variation selectors (U+FE0F),
  // skin-tone modifiers (U+1F3FB-U+1F3FF), and ZWJ (U+200D) are treated as
  // part of the surrounding emoji run, NOT as their own characters and NOT
  // as cluster-breakers.
  const codepoints = Array.from(text);
  const clusters: number[] = [];
  let currentRun = 0;
  for (const cp of codepoints) {
    if (EMOJI_PRESENTATION_RE.test(cp)) {
      currentRun++;
      continue;
    }
    // Variation selector / ZWJ / skin tone — extend the previous run if any.
    // U+200D ZWJ (joins emojis into one rendered glyph, e.g. family / pride flag)
    // U+FE0F VS16 (variation-selector that forces emoji-presentation rendering)
    // U+1F3FB-U+1F3FF skin-tone modifiers
    const cpCode = cp.codePointAt(0) ?? 0;
    const isModifier =
      cpCode === 0x200D ||
      cpCode === 0xFE0F ||
      (cpCode >= 0x1F3FB && cpCode <= 0x1F3FF);
    if (isModifier && currentRun > 0) continue;
    if (currentRun >= EMOJI_MIN_CLUSTER_LEN) clusters.push(currentRun);
    currentRun = 0;
  }
  if (currentRun >= EMOJI_MIN_CLUSTER_LEN) clusters.push(currentRun);

  if (clusters.length === 0) return null;

  const longestCluster = Math.max(...clusters);
  const clusterCount = clusters.length;
  const density = (clusterCount * longestCluster) / Math.max(text.length, 1);

  const longTrigger = longestCluster >= EMOJI_LONG_CLUSTER;
  const densityTrigger = density > EMOJI_DENSITY_THRESHOLD;
  if (!longTrigger && !densityTrigger) return null;

  // Weight scaled by which trigger fired. Long-cluster fires harder because
  // a 7-emoji knife pile is a stronger pre-LLM hint than a 3-emoji repeat.
  let weight = 0;
  if (longTrigger) weight = Math.min(20, 10 + (longestCluster - EMOJI_LONG_CLUSTER) * 2);
  else weight = 10;

  return {
    weight,
    evidence: `emoji cluster x${clusterCount}, longest=${longestCluster}, density=${density.toFixed(2)}`.slice(0, 80),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Repetition runs
//
// Catches three repetition tactics:
//   • token repetition: "DIE DIE DIE", "go go go go go"
//   • character repetition: "noooooo", "WHYYYYYY", "killlllll"
//   • phrase repetition (2-3 token phrases): "kill them all kill them all"
//
// Fires when ≥3 consecutive identical tokens OR ≥5 consecutive identical
// chars OR ≥2 consecutive identical 2-3-token phrases are present. Repetition
// as emphasis tactic — neutral content still fires (e.g. "I like it I like
// it I like it" is repetition-as-emphasis even though it's positive
// sentiment). The signal is structural, not a bad-content classifier.
// ─────────────────────────────────────────────────────────────────────────────

const REPETITION_MIN_TOKEN_RUN = 3;
const REPETITION_MIN_CHAR_RUN = 5;
const REPETITION_MIN_PHRASE_RUN = 2;

/**
 * Detect repetition-as-emphasis. Walks token / char / phrase axes and returns
 * the strongest hit found. Returns null when nothing crosses the thresholds.
 *
 * Multi-axis OR: any one of token / char / phrase repetition is enough; the
 * weight reflects which axis fired hardest. We do NOT sum across axes — a
 * single tactic should give a single weight contribution.
 */
export function detectRepetition(text: string): PreLlmSignal | null {
  if (!text || text.length === 0) return null;

  // ── Token-level repetition ──
  // Split on whitespace, lowercase, strip leading/trailing punctuation per
  // token so "die!" and "die," both compare equal to "die".
  const tokens = text
    .split(/\s+/)
    .map(t => t.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(t => t.length > 0);
  let maxTokenRun = 1;
  let tokenRunWord = '';
  let currentTokenRun = 1;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1] && tokens[i].length > 0) {
      currentTokenRun++;
      if (currentTokenRun > maxTokenRun) {
        maxTokenRun = currentTokenRun;
        tokenRunWord = tokens[i];
      }
    } else {
      currentTokenRun = 1;
    }
  }

  // ── Char-level repetition within a single token ──
  // "noooooo" / "WHYYYYYY". Scan each token's chars for the longest run.
  let maxCharRun = 1;
  let charRunChar = '';
  for (const tok of tokens) {
    let runLen = 1;
    for (let i = 1; i < tok.length; i++) {
      if (tok[i] === tok[i - 1]) {
        runLen++;
        if (runLen > maxCharRun) {
          maxCharRun = runLen;
          charRunChar = tok[i];
        }
      } else {
        runLen = 1;
      }
    }
  }

  // ── Phrase-level repetition (2-3 consecutive tokens repeated back-to-back) ──
  // "kill them all kill them all" or "ha ha ha ha ha" (which also fires token-
  // level, but a 2-token phrase pattern would catch "go go go go" if tokens
  // were "go" only — handled by token-level). Phrase here is the multi-token
  // ngram axis: catches "I like it I like it I like it" (n=3 phrase, 3 reps).
  let maxPhraseRun = 1; // measured as repetitions of the same ngram
  let phraseRunText = '';
  for (let n = 2; n <= 3; n++) {
    if (tokens.length < n * 2) continue;
    for (let i = 0; i + n * 2 <= tokens.length; i++) {
      const a = tokens.slice(i, i + n).join(' ');
      const b = tokens.slice(i + n, i + 2 * n).join(' ');
      if (a !== b || a.length === 0) continue;
      // Found a back-to-back repeat. Extend forward to count total reps.
      let reps = 2;
      let j = i + 2 * n;
      while (j + n <= tokens.length && tokens.slice(j, j + n).join(' ') === a) {
        reps++;
        j += n;
      }
      if (reps > maxPhraseRun) {
        maxPhraseRun = reps;
        phraseRunText = a;
      }
    }
  }

  // ── Aggregate decision ──
  const tokenTrigger = maxTokenRun >= REPETITION_MIN_TOKEN_RUN;
  const charTrigger = maxCharRun >= REPETITION_MIN_CHAR_RUN;
  const phraseTrigger = maxPhraseRun >= REPETITION_MIN_PHRASE_RUN;

  if (!tokenTrigger && !charTrigger && !phraseTrigger) return null;

  // Weight: strongest single axis. Token wins on tie because token-rep is the
  // most explicit (e.g. "DIE DIE DIE" is unambiguous), char-rep is noisier
  // ("goooood" is positive emphasis), phrase-rep is the rarest but strongest
  // when present.
  let weight = 0;
  let evidence = '';
  if (phraseTrigger) {
    weight = Math.min(15, 8 + (maxPhraseRun - REPETITION_MIN_PHRASE_RUN) * 3);
    evidence = `phrase repeated ${maxPhraseRun}x: "${phraseRunText}"`.slice(0, 80);
  }
  if (tokenTrigger) {
    const w = Math.min(15, 8 + (maxTokenRun - REPETITION_MIN_TOKEN_RUN) * 2);
    if (w > weight) {
      weight = w;
      evidence = `token "${tokenRunWord}" repeated ${maxTokenRun}x`.slice(0, 80);
    }
  }
  if (charTrigger) {
    const w = Math.min(10, 5 + (maxCharRun - REPETITION_MIN_CHAR_RUN));
    if (w > weight) {
      weight = w;
      evidence = `char "${charRunChar}" repeated ${maxCharRun}x`.slice(0, 80);
    }
  }

  return { weight, evidence };
}
