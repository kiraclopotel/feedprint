// Unit tests for the deterministic coded-harm catcher, focused on the
// self-harm-encouragement category added 2026-05-31. The category closes a hard
// child-safety gap: the comment BATCH path runs no L1 cascade, so before this
// rule directed self-harm encouragement ("kys", "kill yourself") was caught ONLY
// if the Groq classifier ran AND succeeded. It MUST fire on directed
// encouragement, MUST NOT fire on first-person distress disclosure or benign
// idioms (over-flagging is the product's primary failure mode).

import { describe, it, expect } from 'vitest';
import { detectCodedHarm } from '../../../src/core/coded-harm-catcher';

describe('coded-harm catcher — self-harm-encouragement', () => {
  it('fires on directed self-harm imperatives at a second person', () => {
    const positives = [
      'kys',
      'just kys already',
      'kill yourself',
      'go kill yourself loser',
      'kill urself',
      'rope yourself',
      'neck yourself',
      'hang yourself',
      'off yourself',
      'end yourself',
      'end your life',
      'slit your wrists',
      'slit ur wrists',
      'go drink bleach',
      'drink some bleach',
    ];
    for (const text of positives) {
      expect(detectCodedHarm(text)?.category, text).toBe('self-harm-encouragement');
    }
  });

  it('intentionally does NOT flag letter-spaced / monogram forms (D-2 — ambiguous with benign initials)', () => {
    // D-2: a separator-collapsing pass for "k y s" / "k.y.s" was prototyped and
    // reverted — its only effect is on the one token short enough to reassemble
    // ("kys"), which is indistinguishable from benign three-letter monograms and
    // initialisms. Per VISION "when in doubt, PASS" (over-flagging is the primary
    // failure), these stay UNFLAGGED at the deterministic layer (the AI path
    // handles a directed spaced insult as shame-attack when running). This test
    // locks the decision: re-adding a collapse that flags any of these is a
    // trust regression.
    const ambiguousOrBenign = [
      'k y s',
      'k.y.s',
      'K.Y.S.',
      'K. Y. S. Patel, MD',
      'Knoxville Youth Symphony (K.Y.S.) auditions are open',
      'press K Y S to continue',
      'my initials are k y s',
    ];
    for (const text of ambiguousOrBenign) {
      const hit = detectCodedHarm(text);
      if (hit?.category === 'self-harm-encouragement') {
        throw new Error(`unsafe re-flag of ambiguous/benign monogram: "${text}" matched ${hit.pattern}`);
      }
    }
  });

  it('does NOT fire on NEGATED / supportive self-harm references (real external FP)', () => {
    // Surfaced by the OpenAI moderation eval set: a supportive anti-suicide
    // message must never be flagged as self-harm encouragement.
    const supportive = [
      "Don't kill yourself. Don't hurt anyone either, seek psychological help.",
      'please don\'t kill yourself, things get better',
      'do not kill yourself, call a helpline',
      'never tell someone to kill themselves',
    ];
    for (const text of supportive) {
      const hit = detectCodedHarm(text);
      if (hit?.category === 'self-harm-encouragement') {
        throw new Error(`false positive on supportive text: "${text}" matched ${hit.pattern}`);
      }
    }
  });

  it('does NOT fire on first-person distress disclosure (a cry for help, not directed harm)', () => {
    const distress = [
      'I want to kill myself',
      "I feel like ending it all",
      'sometimes I just want to die',
      'I could kill myself for forgetting that',
    ];
    for (const text of distress) {
      const hit = detectCodedHarm(text);
      expect(hit?.category, text).not.toBe('self-harm-encouragement');
    }
  });

  it('does NOT fire on benign idioms, gaming, or figurative language', () => {
    const benign = [
      'this boss is so hard I keep dying',
      'go die in the lava level, it is brutal',  // gaming "go die" — must NOT fire (go-die pattern deliberately excluded)
      "I'm dying laughing at this",
      'that joke killed me',
      'kill the lights when you leave',
      'my plant died because I forgot to water it',
      'the comedian absolutely killed it tonight',
      'you should end this toxic relationship',  // "end" + second person but not "yourself"/"your life"
    ];
    for (const text of benign) {
      const hit = detectCodedHarm(text);
      // The only acceptable self-harm match here would be a true directed
      // imperative; none of these are.
      if (hit?.category === 'self-harm-encouragement') {
        throw new Error(`false positive on benign text: "${text}" matched ${hit.pattern}`);
      }
    }
  });

  it('fires on directed, explicit sexual solicitation (predator behavior)', () => {
    const positives = [
      'send nudes',
      'send me your nudes',
      'send me some nudes',
      'send ur nudes',
      'send me a naked pic',
      'send me some nude pics',
      'send me a naked photo',
      'send me naked selfies',
      'send a nude video',
      'dick pic',
      'send a dick pic',
      'show me your tits',
      'show me ur boobs',
      'show me your pussy',
      'show me your dick',
      'hmu for nudes',
      'dm me for nudes',
      'hit me up to fuck',
    ];
    for (const text of positives) {
      expect(detectCodedHarm(text)?.category, text).toBe('sexual-solicitation');
    }
  });

  it('does NOT fire on benign uses of the same words (0-FP discipline)', () => {
    const benign = [
      'send me pics of your dog',
      'send me a picture of the sunset',
      'show me your homework when it is done',
      'show me your best work',
      'can you show me your screen',
      'dm me for the recipe',
      'hit me up for the meeting tomorrow',
      'the naked truth about politics',
      'visible to the naked eye',
      'I sent my photos to the printer',
      'he took a nude-colored paint to the wall',
      'send help, I am stuck on this level',
      // Adversarial collisions surfaced by code review — these MUST NOT fire.
      'check out my booty pics from leg day',          // fitness "booty pics"
      'love your nude pics, that nude palette is gorgeous', // makeup "nude pics"
      'dm me to smash some ranked games tonight',       // gaming "to smash"
      'hmu to smash this dungeon',                      // gaming "to smash"
      'hmu for sex ed notes from class',                // bare "sex"
      'dm me, the sex of the puppy is a surprise',      // bare "sex"
      'send me a naked photo of the tree without leaves', // "naked photo" of non-person
      'send me your nude lipstick recommendation',      // makeup "nude"
    ];
    for (const text of benign) {
      const hit = detectCodedHarm(text);
      if (hit?.category === 'sexual-solicitation') {
        throw new Error(`false positive on benign text: "${text}" matched ${hit.pattern}`);
      }
    }
  });

  it('fires on unambiguous pornographic act-jargon (D-4 sexual-explicit insurance)', () => {
    const positives = [
      'cumshot',
      'cum shot',
      'she was deepthroating in the clip',
      'the felching scene was disgusting',
    ];
    for (const text of positives) {
      expect(detectCodedHarm(text)?.category, text).toBe('sexual-explicit');
    }
  });

  it('does NOT fire sexual-explicit on benign homonyms (0-FP discipline, code-reviewer set)', () => {
    const benign = [
      'Deep Throat was the Watergate source that Woodward met in a garage', // historical
      'I love a slice of cream pie for dessert',                            // dessert (not "creampie")
      'the gangbanger was arrested by police last night',                  // gang member, not the porn term
      'a fist fight broke out at the game',                                 // boxing/fight, not "fisting"
      'she gave a great performance at the deep end of the pool',          // "deep" + unrelated
      'shop quoted me $120 for a rim job on all four wheels',              // auto wheel detailing (dropped token)
      'best bukkake udon I have ever had in Tokyo',                        // Japanese noodle dish (dropped token)
      'Senator Felch represented the district for years',                  // surname (verb-form-only match)
    ];
    for (const text of benign) {
      const hit = detectCodedHarm(text);
      if (hit?.category === 'sexual-explicit') {
        throw new Error(`false positive on benign text: "${text}" matched ${hit.pattern}`);
      }
    }
  });

  it('returns null on empty / whitespace input', () => {
    expect(detectCodedHarm('')).toBeNull();
    expect(detectCodedHarm('   ')).toBeNull();
  });

  it('still detects the pre-existing categories (regression guard)', () => {
    expect(detectCodedHarm('petrol bomb thrown at the crowd')?.category).toBe('violence-narration');
    expect(detectCodedHarm('their crime rate is disproportionate')?.category).toBe('coded-scapegoating');
    expect(detectCodedHarm('100% win rate, never lost once')?.category).toBe('clickbait-fomo');
  });
});

describe('coded-harm catcher — doxxing', () => {
  it('fires on the directed "dox" imperative and on exposing a private locator', () => {
    const positives = [
      'dox him',
      'dox this clown',
      "let's doxx her",
      'doxxing them now',
      'post his home address',
      'post her address so everyone finds her',
      'drop their real name and where they live',
      'leak his phone number',
    ];
    for (const text of positives) {
      expect(detectCodedHarm(text)?.category, text).toBe('doxxing');
    }
  });

  it('does NOT fire on condemning, describing, or reporting doxxing (0-FP discipline)', () => {
    const notDoxxing = [
      "don't dox them, it's illegal",                       // preceding negation
      'doxxing is a serious problem these days',            // topic, gerund-as-subject
      'she got doxxed last week and it was awful',          // past-tense report (sympathetic)
      'posting his home address is nasty work',             // condemnation (real chain example)
      'they posted his address online, which is doxxing',   // past-tense report
      'we should never post someone\'s home address',       // negation + "someone's" (not his/her/their)
    ];
    for (const text of notDoxxing) {
      const hit = detectCodedHarm(text);
      if (hit?.category === 'doxxing') {
        throw new Error(`false positive on non-doxxing text: "${text}" matched ${hit.pattern}`);
      }
    }
  });

  it('does NOT fire on self-disclosure or business contact (0-FP discipline)', () => {
    const benign = [
      "here's my email if you want to reach me",            // self-share, and "email" is excluded
      'contact us at support@example.org for help',        // business contact
      'my address is 12 Oak Street, the party is Saturday', // self-share ("my", not his/her/their)
      'our phone number is on the website',                 // business ("our")
      'I posted my own address by mistake, deleting now',   // self ("my own")
    ];
    for (const text of benign) {
      const hit = detectCodedHarm(text);
      if (hit?.category === 'doxxing') {
        throw new Error(`false positive on benign text: "${text}" matched ${hit.pattern}`);
      }
    }
  });
});
