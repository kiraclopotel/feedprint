// Does a rewrite still carry what made the original a problem?  (11 Oct 2026, the Tester's full test)
//
// The calmer rewrite is the product's central promise, and the judge's own checks ask whether it is well written, whether it
// speaks about the post, whether it keeps swearing. None asks whether the attack is still there. Seen on a made-up post:
//
//   "@anyhandle you are a pathetic little nobody and everyone at your school knows it. Do us all a favour and disappear."
//   became "I think you are a pathetic little nobody and everyone at your school knows it. I suggest you disappear."
//
// with the green "done" dot; a fear-selling post became "I want to share this information" (the call to share kept); a
// Relaxed rewrite of the first one read "I suggest you consider leaving". The words of the insult, or the call it ended
// on, had gone through a first-person prefix and come out the other side.
//
// Two checks, both about what the rewrite KEEPS of the original, so neither needs a list of insults:
//   - kept whole: half or more of the original's four-word runs are still there word for word. A rewrite that quotes the
//     sentence it was meant to replace has not replaced it. Originals under eight words are too short to have runs.
//   - the call kept: the original ended on a call to spread it ("share this before it gets deleted") or to remove the
//     person ("do us all a favour and disappear"), and the rewrite still carries a word of that call.
// A rewrite that fails either goes the way a rewrite the judge rejects goes: the person sees the post with its mark, or
// a severe hostile one hidden, never the rewrite. Wrongly rejecting costs the calmer text (the mark stays); wrongly
// accepting puts the attack on the page under a mark that says it was softened.
//
// Words are matched in English, Spanish, Brazilian Portuguese and Romanian, the product's four languages. Another
// language is not caught by the call check (the run check needs no words).

export type AttackKept = 'kept-whole' | 'call-to-share-kept' | 'call-to-remove-kept';

const RUN = 4;
const MIN_ORIGINAL_WORDS = 8;
const KEPT_WHOLE_FRACTION = 0.5;

function wordsOf(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'@_\s-]/gu, ' ')
    .replace(/@/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 0);
}

function runsOf(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + RUN <= words.length; i++) out.push(words.slice(i, i + RUN).join(' '));
  return out;
}

/** Share of the original's four-word runs that the rewrite repeats word for word. */
export function keptRunFraction(original: string, rewrite: string): number {
  const o = wordsOf(original);
  if (o.length < MIN_ORIGINAL_WORDS) return 0;
  const originalRuns = new Set(runsOf(o));
  if (originalRuns.size === 0) return 0;
  const rewriteRuns = new Set(runsOf(wordsOf(rewrite)));
  let kept = 0;
  for (const run of originalRuns) if (rewriteRuns.has(run)) kept++;
  return kept / originalRuns.size;
}

// Word edges that know letters beyond a-z ("pleacă", "lárgate"), which the plain \b does not.
const START = '(?<![\\p{L}\\p{N}_])';
const END = '(?![\\p{L}\\p{N}_])';
const words = (list: string): RegExp => new RegExp(`${START}(?:${list})${END}`, 'iu');

// A call to spread the post.
const SHARE = words([
  'share', 'reshare', 'repost', 'retweet', 'forward (?:this|it)', 'pass (?:this|it) on', 'send (?:this|it) (?:to|on|around)',
  'spread (?:this|the word)',
  'compart\\p{L}*', 'reenv[ií]\\p{L}*',
  'compartilh\\p{L}*',
  'partaj\\p{L}*', 'redistribuie\\p{L}*', 'dă mai departe', 'da mai departe',
].join('|'));

// A call to remove or silence the person.
const REMOVE = words([
  'disappear\\p{L}*', 'vanish', 'go away', 'get lost', 'shut up', 'shut your \\p{L}+', 'get out', 'kill yourself', 'go die', 'drop dead',
  'piss off', '(?:consider|should|better|just|please) leav(?:e|ing)', 'leave (?:us|this place|town|the country|for good|now)',
  'desaparec\\p{L}*', 'desaparez\\p{L}*', 'vete', 'lárgate', 'cállate', 'desapareç\\p{L}*', 'vai embora', 'cala a boca', 'some daqui',
  'dispari\\p{L}*', 'taci', 'pleacă', 'du-te',
].join('|'));

function callsToRemove(text: string): boolean {
  return REMOVE.test(text);
}

/**
 * What the rewrite keeps of the attack, or null when it keeps none of what this looks for.
 * Both texts are the real ones (names back in), not the letters the judge was shown.
 */
export function rewriteKeepsTheAttack(original: string, rewrite: string): AttackKept | null {
  if (!rewrite || !original) return null;
  if (keptRunFraction(original, rewrite) >= KEPT_WHOLE_FRACTION) return 'kept-whole';
  if (SHARE.test(original) && SHARE.test(rewrite)) return 'call-to-share-kept';
  if (callsToRemove(original) && callsToRemove(rewrite)) return 'call-to-remove-kept';
  return null;
}
