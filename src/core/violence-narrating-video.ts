// A video whose caption narrates harm done to someone ("A young man was beaten and forced to
// perform a dance", "his legs are definitely gone") had its caption reframed while the video kept
// playing: violence-graphic matches threats and gore by the poster, not harm narrated as done to
// someone else. This fixed gate runs before the AI, and the caller hides the post as
// 'violence-graphic', which already folds the media.
//
// Precision comes first, since over-blocking is the worse failure. Tier 1 is unambiguous harm to a
// person and always fires: a "PUBG dance" in the same caption must not excuse "beaten and forced
// to perform". Tier 2 words also belong to sport, games, medicine, cooking and the gym ("beaten",
// "legs gone"), so a word from those fields holds it back. The caller only runs this on videos.

const LB = '(?<![\\p{L}\\p{N}])';
const RB = '(?![\\p{L}\\p{N}])';

const TIER1 = new RegExp(
  LB + '(?:' + [
    'forced\\s+to\\s+(?:perform|dance|fight|strip|kneel|beg)',
    'beaten\\s+(?:up\\s+)?and\\s+forced',
    'beaten\\s+to\\s+death',
    'physical(?:ly)?\\s+abuse[d]?',
    'tortur(?:e|ed|ing)', 'brutaliz(?:e|ed|ing)',
    'maimed', 'mauled', 'bludgeon(?:ed|ing)?',
    'mutilat(?:e|ed|ing)', 'dismember(?:ed|ing)?',
    'decapitat(?:e|ed|ing)', 'disembowel(?:ed|ing)?',
    'gang[\\s-]?raped?', 'lynch(?:ed|ing)',
    // A death shown or narrated as it happens (a Facebook video of a failed resuscitation, its caption naming it, was
    // left unmarked in the Tester's full test, 12 Oct 2026). Only phrasings that put the death in front of the viewer:
    // a bare "died" or "hospital" is news or grief, and stays with the AI and with the news words below.
    'failed\\s+(?:cpr|resuscitation)', 'resuscitation\\s+fail(?:s|ed)',
    '(?:dies|died|dying|death|killed)\\s+(?:on|live\\s+on)\\s+(?:camera|video|tape|livestream)',
    'death\\s+caught\\s+on\\s+(?:camera|video|tape)', 'caught\\s+on\\s+(?:camera|video|tape)\\s+(?:dying|as\\s+(?:he|she|they)\\s+die[sd]?)',
    'moment\\s+(?:he|she|they|the\\s+(?:man|woman|boy|girl|child|baby))\\s+(?:dies|died|was\\s+killed)',
    'takes?\\s+(?:his|her|their)\\s+last\\s+breath', 'dying\\s+(?:man|woman|person|child|baby|boy|girl|victim)s?',
    // Two assault verbs in a row ("kicking and stomping") are unambiguous, where one alone is not
    // ("kicking off the season").
    '(?:punch|kick|stomp|beat)(?:ed|ing)?[\\s,]+(?:and\\s+)?(?:punch|kick|stomp|beat)(?:ed|ing)?',
  ].join('|') + ')' + RB,
  'iu',
);

const TIER2 = new RegExp(
  LB + '(?:' + [
    'beaten', 'assaulted?', 'stabbed?', 'slashed?',
    'killed', 'murdered',
    // Up to two words in between: "legs are definitely gone".
    '(?:legs?|limbs?|arms?|hands?|fingers?|head)\\s+(?:(?:are|is|were|was)\\s+)?(?:\\p{L}+\\s+){0,2}(?:'
      + 'gone|crushed|severed|mangled|chopped\\s+off|ripped\\s+off|torn\\s+off|broken\\s+off)',
    'broken\\s+bones?', 'serious\\s+injur(?:y|ies)', 'severe\\s+injur(?:y|ies)',
    'fatal\\s+(?:crash|stabbing|shooting|attack|beating|fall|accident)', 'dead\\s+bod(?:y|ies)', 'lifeless\\s+bod(?:y|ies)',
  ].join('|') + ')' + RB,
  'iu',
);

// All or nothing: there is no score to lower before the AI runs. News wording counts too, since a
// report is not glorification.
const SUPPRESS = new RegExp(
  '(?:' + [
    // gaming
    'boss|respawn|\\braid\\b|elden\\s*ring|fortnite|valorant|minecraft|\\bnpc\\b|gameplay|\\bquest\\b|\\bxp\\b|video\\s*game|speedrun',
    // sports
    'match|tackle|\\bgoal\\b|league|championship|boxing|\\bmma\\b|\\bufc\\b|wrestling|referee|tournament|sparring|playoff',
    // medical / recovery
    'surgery|recovery|hospital|\\bacl\\b|physio|rehab|patient|diagnos|stitches|healing',
    // fitness ("legs gone after leg day")
    'leg\\s*day|\\bgym\\b|workout|marathon|cardio|after\\s+(?:that|the|my)\\s+(?:run|ride|workout|gym|leg|set)',
    // culinary
    'beaten\\s+egg|beat\\s+the\\s+(?:eggs?|butter|batter|mixture|cream)|whisk|recipe|fluffy|\\bbake',
    // news
    'according\\s+to|police\\s+(?:said|report)|authorities|reportedly|alleged(?:ly)?|investigation\\s+(?:found|said)',
  ].join('|') + ')',
  'iu',
);

export interface ViolenceNarratingResult {
  triggered: boolean;
  evidence: string;
}

/** The caller must check post.kind === 'video' and a child or teen mode before hiding. */
export function detectViolenceNarratingVideo(text: string): ViolenceNarratingResult {
  const t = text ?? '';
  const t1 = t.match(TIER1);
  if (t1) return { triggered: true, evidence: clip(t1[0]) };
  const t2 = t.match(TIER2);
  if (t2 && !SUPPRESS.test(t)) return { triggered: true, evidence: clip(t2[0]) };
  return { triggered: false, evidence: '' };
}

function clip(s: string, max = 80): string {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v.length <= max ? v : v.slice(0, max - 1) + '…';
}
