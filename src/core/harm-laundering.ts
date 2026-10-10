// The small rewriting model's worst failure: it turns a violent comment into a calm, plausible
// sentence with the violence gone, which passes every other check and ships as a reframe. Read on
// a real forensic chain:
//   "you deserve death by hanging"                      -> "deserves justice"
//   "...burned down with the 'zoo residents' inside"    -> "should be held accountable"
//   "Stab someone... murder them, flee to UK, brag"     -> "I don't think Ireland is a good place"
// A cleaned-up version reads as reasoned and persuades more, and the dehumanization filter, which
// needs a pest word and an action, misses all three. So this fires on loss, not on words: the
// original has lethal language and the rewrite has none. The caller then hides the comment.

// Only doing violence to people counts. Idioms ("killing it", "this kills me") are left to the
// caller, which runs this on comments already flagged as hostile. The boundaries are Unicode
// because JavaScript's \b knows only ASCII letters and let tokens match inside other words.
const LB = '(?<![\\p{L}\\p{N}])';
const RB = '(?![\\p{L}\\p{N}])';
// No bare die, death, dead, hang, shoot or gas: they fire on ordinary speech ("I'm dead", "hang
// out", "shot down"). 'kill' stays, since real threats need it, and a figurative "killing it"
// costs only the hide of a comment already flagged as hostile.
const HARM_RE = new RegExp(
  LB + '(?:' + [
    'kill(?:ed|ing|s)?', 'murder(?:ed|ing|s)?', 'slaughter(?:ed|ing|s)?',
    'massacre[ds]?', 'execut(?:e|ed|es|ing|ion)', 'exterminat[\\p{L}]*',
    'lynch(?:ed|ing|es)?', 'behead(?:ed|ing|s)?', 'genocide',
    'stab(?:bed|bing|s)?', 'assassinat[\\p{L}]*',
    'deserves?\\s+(?:to\\s+)?(?:die|death)',
    'put\\s+to\\s+death', 'to\\s+death',
    'death\\s+by\\s+\\p{L}+',
    'burn(?:ed|ing|t)?\\s+(?:\\p{L}+\\s+){0,3}(?:down|alive)',
    'burned?\\s+down',
    // Romanian
    'omor[\\p{L}]*', 'ucid[\\p{L}]*', 'ucis[\\p{L}]*', 's[ăa]\\s+moar[ăa]',
    'sp[âa]nzur[\\p{L}]*', 'm[ăa]cel[\\p{L}]*',
  ].join('|') + ')' + RB,
  'iu',
);

export function hasViolentHarm(text: string): boolean {
  return HARM_RE.test(text ?? '');
}

/** A rewrite that kept the violence is faithful, not laundered; other checks deal with it. */
export function detectHarmLaundering(original: string, rewritten: string): boolean {
  if (!hasViolentHarm(original)) return false;
  if (hasViolentHarm(rewritten)) return false;
  return true;
}
