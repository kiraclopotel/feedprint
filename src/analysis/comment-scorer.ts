// FeelingWise - Comment scorer & ranker
// Pre-AI scoring: ranks raw comments by relevance, filters spam/bots,
// flags sarcasm. Runs BEFORE Prompt 3 (AI rewriter).

export interface RawComment {
  text: string;
  likes: number;
  replies: number;
  isPinned: boolean;
  isCreatorReply: boolean;
  isHighlighted: boolean;
  authorHandle: string;
  timestamp: string;
  /**
   * per-comment DOM WeakRef when
   * the extractor captured it. Currently TikTok-only; other platforms
   * leave undefined. Consumers fall back to container-level WeakRef when
   * absent. Optional preserves back-compat with extractors that haven't
   * been updated.
   */
  domRef?: WeakRef<HTMLElement>;
  /**
   * Platform-native comment identifier when the extractor could capture
   * one. For YouTube this is the `lc=<id>` token from the timestamp's
   * permalink anchor; combined with the video id (carried by
   * `parentVideoId` on the forensic record) it produces a deep-link URL
   * that scrolls the user to the exact comment on the platform.
   * Closes Inventory Part 7 #4 for YT specifically. Other platforms
   * leave undefined; the dashboard's view-original falls back to the
   * canonical video URL in that case.
   */
  commentId?: string;
}

export interface ScoredComment {
  raw: RawComment;
  scores: {
    relevance: number;
    popularity: number;
    creatorSignal: number;
    consensus: number;
    noise: number;
    sarcasm: number;
  };
  composite: number;
  flags: string[];
}

export interface CommentBatch {
  all: ScoredComment[];
  top: ScoredComment[];
  confidence: 'low' | 'medium' | 'normal';
  usableCount: number;
  sarcasmRate: number;
}

// --- Noise detection ---

const NOISE_PATTERNS: { pattern: RegExp; weight: number; flag: string }[] = [
  // Self-promotion (English)
  { pattern: /check out my|subscribe to my|follow me|link in bio/i, weight: 0.4, flag: 'noise:self-promo' },
  // Self-promotion (Romanian)
  { pattern: /abonați-vă la|urmăriți-mă|link în bio|verificați canalul meu/i, weight: 0.4, flag: 'noise:self-promo-ro' },
  // Timestamp-only: "2:34" or "2:34 LOL"
  { pattern: /^\d{1,2}:\d{2}(\s+\w{1,5})?$/i, weight: 0.5, flag: 'noise:timestamp-only' },
  // Emoji-only
  { pattern: /^[\p{Emoji}\p{Emoji_Presentation}\p{Emoji_Modifier}\p{Emoji_Component}\s]+$/u, weight: 0.5, flag: 'noise:emoji-only' },
  // "First!" / "Who's watching in 20XX?"
  { pattern: /^first!?$|who'?s watching in \d{4}/i, weight: 0.4, flag: 'noise:first-watching' },
  // Tag-only: just "@username"
  { pattern: /^@\w+\s*$/, weight: 0.4, flag: 'noise:tag-only' },
  // sub4sub, f4f, follow4follow
  { pattern: /sub4sub|f4f|follow4follow/i, weight: 0.5, flag: 'noise:engagement-bait' },
  // Free v-bucks / robux / gift card spam
  { pattern: /free\s*(v-?bucks|robux|gift\s*card)/i, weight: 0.5, flag: 'noise:spam' },
];

function scoreNoise(text: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  for (const { pattern, weight, flag } of NOISE_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      flags.push(flag);
    }
  }

  // Under 10 characters (if not already caught by other patterns)
  if (text.trim().length < 10 && flags.length === 0) {
    score += 0.3;
    flags.push('noise:short');
  }

  return { score: Math.min(score, 1), flags };
}

// --- Sarcasm detection ---

const SARCASM_PATTERNS: { pattern: RegExp; weight: number; flag: string }[] = [
  // Scare quotes around short phrase
  { pattern: /"[^"]{1,25}"/, weight: 0.30, flag: 'sarcasm:scare-quotes' },
  // Also single curly/smart quotes
  { pattern: /\u2018[^\u2019]{1,25}\u2019|'[^']{1,25}'/, weight: 0.30, flag: 'sarcasm:scare-quotes' },
  // Trailing ellipsis after short statement (< 60 chars before ellipsis)
  { pattern: /^.{1,60}\.{3}\s*$/, weight: 0.25, flag: 'sarcasm:trailing-ellipsis' },
  // Multiple ALL CAPS words (2+)
  { pattern: /\b[A-Z]{2,}\b.*\b[A-Z]{2,}\b/, weight: 0.25, flag: 'sarcasm:all-caps' },
  // Eye-roll, clown, skull emoji
  { pattern: /🙄|🤡|💀/, weight: 0.30, flag: 'sarcasm:emoji' },
  // English sarcasm starters
  { pattern: /\b(sure|right|obviously|totally|oh really|yeah right|wow just wow)\b/i, weight: 0.35, flag: 'sarcasm:starter-en' },
  // Romanian sarcasm starters
  { pattern: /\b(sigur|evident|bineînțeles)\b|normal că|da,?\s*sigur|cum să nu/i, weight: 0.35, flag: 'sarcasm:starter-ro' },
  // Explicit /s tag
  { pattern: /\/s\b/, weight: 0.50, flag: 'sarcasm:explicit-tag' },
  // Excessive exclamation (3+)
  { pattern: /!{3,}/, weight: 0.20, flag: 'sarcasm:excessive-exclamation' },
  // Contradictory safety advice
  { pattern: /totally safe|go ahead|best idea ever|what could go wrong/i, weight: 0.40, flag: 'sarcasm:contradictory-safety' },
];

function scoreSarcasm(text: string): { score: number; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  for (const { pattern, weight, flag } of SARCASM_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      if (!flags.includes(flag)) flags.push(flag);
    }
  }

  score = Math.min(score, 1);

  if (score > 0.5) {
    flags.push('probable-sarcasm');
  } else if (score >= 0.3) {
    flags.push('possible-sarcasm');
  }

  return { score, flags };
}

// --- Relevance (word-count heuristic) ---

function scoreRelevance(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 3) return 0.2;
  if (wordCount <= 7) return 0.5;
  if (wordCount <= 19) return 0.7;
  return 0.85;
}

// --- Popularity (normalized) ---

function scorePopularity(likes: number, maxLikes: number): number {
  if (maxLikes === 0) return 0.5;
  return likes / maxLikes;
}

// --- Creator signal ---

function scoreCreatorSignal(comment: RawComment): number {
  let score = 0;
  if (comment.isPinned) score += 0.50;
  if (comment.isCreatorReply) score += 0.35;
  if (comment.isHighlighted) score += 0.15;
  return Math.min(score, 1);
}

// --- Consensus (word overlap) ---

function extractSignificantWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .split(/\s+/)
      .filter(w => w.replace(/[^\w]/g, '').length > 3)
      .map(w => w.replace(/[^\w]/g, ''))
  );
}

function scoreConsensus(comment: RawComment, allComments: RawComment[]): number {
  if (allComments.length <= 1) return 0.5;

  const myWords = extractSignificantWords(comment.text);
  if (myWords.size === 0) return 0;

  const others = allComments.filter(c => c !== comment);
  let matchingComments = 0;

  for (const other of others) {
    const otherWords = extractSignificantWords(other.text);
    let shared = 0;
    for (const word of myWords) {
      if (otherWords.has(word)) shared++;
      if (shared >= 2) break;
    }
    if (shared >= 2) matchingComments++;
  }

  return matchingComments / (allComments.length - 1);
}

// --- Composite scoring ---

function scoreComment(comment: RawComment, maxLikes: number, allComments: RawComment[]): ScoredComment {
  const noiseResult = scoreNoise(comment.text);
  const sarcasmResult = scoreSarcasm(comment.text);
  const relevance = scoreRelevance(comment.text);
  const popularity = scorePopularity(comment.likes, maxLikes);
  const creatorSignal = scoreCreatorSignal(comment);
  const consensus = scoreConsensus(comment, allComments);

  const rawComposite =
    relevance * 0.40 +
    popularity * 0.25 +
    creatorSignal * 0.15 +
    consensus * 0.10 -
    noiseResult.score * 0.10;

  const composite = Math.max(0, Math.min(1, rawComposite));

  return {
    raw: comment,
    scores: {
      relevance,
      popularity,
      creatorSignal,
      consensus,
      noise: noiseResult.score,
      sarcasm: sarcasmResult.score,
    },
    composite,
    flags: [...noiseResult.flags, ...sarcasmResult.flags],
  };
}

// --- Batch ranking ---

export function scoreAndRankComments(comments: RawComment[], topN: number = 15): CommentBatch {
  if (comments.length === 0) {
    return { all: [], top: [], confidence: 'low', usableCount: 0, sarcasmRate: 0 };
  }

  const maxLikes = Math.max(...comments.map(c => c.likes));

  const all = comments
    .map(c => scoreComment(c, maxLikes, comments))
    .sort((a, b) => b.composite - a.composite);

  const top = all.slice(0, topN);

  const usableCount = all.filter(s => s.scores.noise < 0.4).length;
  const sarcasmCount = all.filter(s => s.scores.sarcasm > 0.5).length;

  let confidence: 'low' | 'medium' | 'normal';
  if (usableCount < 8) confidence = 'low';
  else if (usableCount < 15) confidence = 'medium';
  else confidence = 'normal';

  return {
    all,
    top,
    confidence,
    usableCount,
    sarcasmRate: sarcasmCount / comments.length,
  };
}
