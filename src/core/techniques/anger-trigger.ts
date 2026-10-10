// Dehumanization, outrage bait and guilt-tripping.

import { ClassifierInput, ClassifierOutput, TechniqueClassifier } from './types';
import { PatternSet, runPatternClassifier } from './classify-helpers';

const PATTERNS: PatternSet = {
  strong: [
    /\b(traitors?|scum|vermin|parasites?|cockroach|subhuman|filth|maggots?|sewage)\b/i,
    // These nouns count only when a person is called one ("you're a rat"), in any of the four
    // languages. Alone they are ordinary words: bare "animal" fired on 0.27% of the Spanish benign
    // corpus and the same share of the Portuguese.
    /\b(?:are|is|was|were|'?re|they'?re|you'?re|he'?s|she'?s|son|eres|es|sois|son\s+unos|s[aã]o|[eé]|sunt|e[sș]ti|sunte[tț]i)\s+(?:a\s+|an\s+|the\s+|un[ao]s?\s+|uns\s+|umas?\s+|ni[sș]te\s+|nothing\s+but\s+)?(creature|puppets?|marionet\w*|animals?|rats?|snakes?|worms?|insects?|pests?|garbage)\b/i,
    /(they'?re|are) (destroy|ruin|steal|taking|corrupt)(ing)? (everything|our|your)/i,
    /\bwake up (sheeple|people|america|world)\b/i,
    /they (don'?t care|laugh at you|hate you|want you to suffer)/i,
    /\b(DYING|KILLING|MURDERED|DESTROYED)\b/,
    /you'?re (scrolling past|ignoring|doing nothing) while/i,
    /\b(installed|planted|weaponized|infiltrat\w*)\b.*\b(by|to|against|in)\b/i,
    /\bi present to you\b/i,
    /wants? to take (everything|all|what) (you|we) (have|own|built|earned)/i,
    /\b(sold? (us |you |them )?out|bought and paid for|on the payroll)\b/i,
    /\b(regime|takeover|invasion|replacement)\b.*\b(our|your|the)\b/i,
    // Romanian. Checked over 441,690 Spanish and 444,028 Portuguese benign sentences: 'criminal' is
    // an ordinary noun in three of the languages, so it sits in the moderate list, and 'marionet'
    // is usually a literal puppet, so it needs the "you are" frame above.
    /\b(tr[aă]d[aă]tor|parazit|incompeten[tț]|corup[tț]|jigodie|lichea|lepra|javr[aă]|gunoi|j[ei]gos|mizerabil|tic[aă]lo[sș]|bandit)\w*\b/i,
    // 'hoț' (thief) needs its diacritic, a deliberate loss: without it the word is `hot`, which
    // matched 'hot' and 'hotel' in every language. Same call as 'curva' in the word lists.
    /\bho[țţ](?:i|ul|ii|ilor|ule)?\b/i,
    /\b(ne|v[aă]|[îi]i) (fur[aă]|distrug|v[âa]nd|mint|manipuleaz[aă]|otr[aă]ve[sș]c|terorizea?z[aă])\w*\b/i,
  ],
  moderate: [
    /\b(outrag|infuriat|enrag|disgrac|unforgivable)\b/i,
    /\b(globalist|elitist|swamp|establishment|radical|extremist)\b/i,
    /\b(sold out|sellout|traitor to)\b/i,
    /\bcriminal\w*\b/i,
    // Romanian
    /\b(ru[sș]ine|revolt[aă]|scan?dal|abuz|arogant[aă]?|nesim[tț]i\w*|obraznic\w*|tupeu)\b/i,
    /\btrez(e[sș]te|i[tț]i)[-\s]*(te|v[aă])\b/i,
  ],
  exceptions: [
    /\b(i'?m (angry|frustrated|upset|mad))\b/i,
    /\b(editorial|opinion|commentary)\b/i,
  ],
};

export const angerTriggerClassifier: TechniqueClassifier = {
  classify(input: ClassifierInput): ClassifierOutput {
    return runPatternClassifier(input.text, 'anger-trigger', PATTERNS);
  },
};
