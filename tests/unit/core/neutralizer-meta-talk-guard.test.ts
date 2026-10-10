// LOOP-057 — meta-talk + voice-inversion guards in neutralizer.
//
// Context: a 2026-04-20 forensic export (91 records) surfaced ~18
// rewrites (~20%) that violated the NEUTRALIZATION prompt's forbidden-phrase
// rule, opening with "This post...", "The post expresses...", "The author
// argues...", "Expressed frustration...", etc. The prompt-side rule is
// insufficient (LESSONS L-004). These tests lock the pipeline-side gates
// that reject the offending rewrites before they reach the forensic export.
//
// Also locks the voice-inversion guard: rewrites must NEVER introduce "I" /
// "my" / "we" / "our" when the original post had no first-person pronouns —
// a false admission in a legal evidence export is catastrophic.

import { describe, it, expect } from 'vitest';
import { detectMetaTalk, detectFalseSelfAdmission, detectLengthRatioBlowup } from '../../../src/core/neutralizer';

describe('detectMetaTalk — sentence-start post references', () => {
  it('flags "This post suggests ..." (an exact leak observed 2026-04-20)', () => {
    expect(detectMetaTalk('This post suggests that a 10-year ban is an appropriate response.')).toBeTruthy();
  });

  it('flags "The post expresses ..." (a second exact leak, same shape)', () => {
    expect(detectMetaTalk('The post expresses a strongly negative sentiment towards someone\'s appearance.')).toBeTruthy();
  });

  it('flags "The post criticizes ..."', () => {
    expect(detectMetaTalk("The post criticizes Germany's government for arresting people.")).toBeTruthy();
  });

  it('flags "The post states ..."', () => {
    expect(detectMetaTalk('The post states that the individual involved in the incident made a mistake.')).toBeTruthy();
  });

  it('flags "The post describes ..." (mid-sentence variant)', () => {
    expect(detectMetaTalk('the post describes a situation where a couple spent $122,000 in 8 months.')).toBeTruthy();
  });

  it('flags "The post claims ..."', () => {
    expect(detectMetaTalk('the post claims that a person who engages in playing certain games risks having their drink spiked.')).toBeTruthy();
  });

  it('flags "The post contains ..."', () => {
    expect(detectMetaTalk('This post contains sensational language, with excessive use of emojis.')).toBeTruthy();
  });

  it('flags "This video has been shared ..."', () => {
    expect(detectMetaTalk('This video has been shared by the poster in this context.')).toBeTruthy();
  });

  it('flags "This post contains a personal statement ..."', () => {
    expect(detectMetaTalk('This post contains a personal statement expressing a strong negative reaction.')).toBeTruthy();
  });
});

describe('detectMetaTalk — author / writer / poster / speaker references', () => {
  it('flags "The author argues ..."', () => {
    expect(detectMetaTalk('The author argues that a person should remain banned due to their behavior.')).toBeTruthy();
  });

  it('flags "The writer expresses ..."', () => {
    expect(detectMetaTalk("The writer expresses strong opinion and frustration with MAUschine's behavior.")).toBeTruthy();
  });

  it('flags "The writer makes ..."', () => {
    expect(detectMetaTalk("The writer makes an insult, claiming the recipient's money goes to podcasters.")).toBeTruthy();
  });

  it('flags "The poster suggests ..."', () => {
    expect(detectMetaTalk('The poster suggests sharing the video to provoke a negative reaction.')).toBeTruthy();
  });

  it('flags "The poster expresses ..."', () => {
    expect(detectMetaTalk('The poster expresses concern about censorship.')).toBeTruthy();
  });

  it('flags "The speaker suggests ..."', () => {
    expect(detectMetaTalk('The speaker suggests that tax dollars should support rehabilitation programs.')).toBeTruthy();
  });
});

describe('detectMetaTalk — adjective-prefixed author references (synthetic regression)', () => {
  // Locks a gap where "The original poster..." slipped past
  // because the EN author pattern required zero words between "(?:This|The)"
  // and the noun list. The optional `(?:\w+\s+)?` slot tolerates an adjective
  // between determiner and noun.

  it('flags "The original poster of the comment makes a point"', () => {
    expect(detectMetaTalk('The original poster of the comment makes a point about the situation.')).toBeTruthy();
  });

  it('flags "the original poster" alone — bare adjective+noun phrase', () => {
    expect(detectMetaTalk('the original poster expressed strong feelings.')).toBeTruthy();
  });

  it('flags "The unfortunate commenter ..." (different adjective)', () => {
    expect(detectMetaTalk('The unfortunate commenter made an unhelpful remark.')).toBeTruthy();
  });

  it('flags "Acea distinsă persoană ..." (RO determiner + adjective + author noun)', () => {
    expect(detectMetaTalk('Acea distinsă persoană a făcut o afirmație problematică.')).toBeTruthy();
  });

  it('does NOT flag "Acea persoană ..." with non-meta verb (bare determiner + author noun, no meta-verb proximity)', () => {
    // The RO determiner+noun pattern now requires a meta-verb (spune,
    // afirmă, susține, exprimă, etc.) within ~60 chars of the noun. "A
    // făcut o remarcă" uses the generic verb "face" which is not in the
    // meta-verb list; innocent RO rewrites paraphrasing a quoted attack
    // ("Autorul a făcut o greșeală") used to be rejected under the old
    // bare-noun pattern. The companion test "Acel autor susține..."
    // below still flags because "susține" IS a meta-verb.
    expect(detectMetaTalk('Acea persoană a făcut o remarcă negativă.')).toBeNull();
  });

  it('flags "Acea persoană spune ..." (RO bare determiner + meta-verb proximity)', () => {
    expect(detectMetaTalk('Acea persoană spune o remarcă negativă fără justificare.')).toBeTruthy();
  });

  it('flags "Acel autor ..." (RO determiner + author noun, masculine)', () => {
    expect(detectMetaTalk('Acel autor susține o poziție extremă.')).toBeTruthy();
  });

  it('does NOT flag "this is the original poster" (rewrite-vs-original parity check handles caption-like)', () => {
    // detectMetaTalk takes the rewrite + original as a pair; if the original
    // contained the same meta phrase, the caller's diff-check passes it
    // through. When the phrase appears mid-sentence (not sentence-start),
    // the EN author pattern requires "^\s*(?:This|The)" so "this is the
    // original poster" without leading "The" is not anchored.
    expect(detectMetaTalk('this is the original poster speaking directly')).toBeNull();
  });
});

describe('detectMetaTalk — passive voice openings', () => {
  it('flags "Expressed frustration ..." (Mr_memes__1 leak)', () => {
    expect(detectMetaTalk('Expressed frustration on stream by slapping an opponent, with some viewers arguing for a harsher punishment.')).toBeTruthy();
  });

  it('flags "Expressed concern ..."', () => {
    expect(detectMetaTalk('Expressed concern about censorship in multiple jurisdictions.')).toBeTruthy();
  });
});

describe('detectMetaTalk — dead-giveaway constructions', () => {
  it('flags "the post in question ..."', () => {
    expect(detectMetaTalk('the post in question is a form of humor that may be off-putting to some individuals.')).toBeTruthy();
  });

  it('flags "... in this context"', () => {
    expect(detectMetaTalk('This video has been shared by the poster in this context.')).toBeTruthy();
  });

  it('flags "according to the author ..."', () => {
    expect(detectMetaTalk('Policy is severe, according to the author of the post.')).toBeTruthy();
  });
});

describe('detectMetaTalk — clean rewrites pass through', () => {
  it('passes "Germany arrested people for expressing opinions" (direct state-of-claim)', () => {
    expect(detectMetaTalk('Germany arrested people for expressing certain opinions, highlighting a problematic aspect.')).toBeNull();
  });

  it('passes "A 10-year ban is an appropriate response ..." (direct assertion)', () => {
    expect(detectMetaTalk('A 10-year ban is an appropriate response to that behavior.')).toBeNull();
  });

  it('passes "he gave up on the situation" (third-person preserved)', () => {
    expect(detectMetaTalk('he gave up on the situation.')).toBeNull();
  });

  it('passes "Banning repeat offenders is consistent with existing policy" (policy-stated)', () => {
    expect(detectMetaTalk('Banning repeat offenders is consistent with existing esports policy.')).toBeNull();
  });

  it('passes "Some commenters argue ... though no specific reasoning is provided" (framed third-party)', () => {
    // This phrasing was the golden reframe in adult-panel fixtures — it does
    // NOT describe the post itself, so it should not be flagged.
    expect(detectMetaTalk('Some commenters argue that the named group bears responsibility, though no specific reasoning is provided.')).toBeNull();
  });

  it('passes "a 10-year ban is being discussed" (passive without meta-subject)', () => {
    expect(detectMetaTalk('a 10-year ban is being discussed for the incident.')).toBeNull();
  });

  it('passes "The game Counter-Strike has lenient rules" (legit "The game X" subject)', () => {
    expect(detectMetaTalk('The game Counter-Strike has lenient rules for this class of behavior.')).toBeNull();
  });
});

describe('detectMetaTalk — RO patterns (H6 ASCII-fold parity)', () => {
  // The /i flag covers letter case but not diacritic equivalence. Every
  // diacritic form must list its unaccented twin and vice versa.

  it('flags "Această postare descrie ..." (canonical RO)', () => {
    expect(detectMetaTalk('Această postare descrie o situație problematică.')).toBeTruthy();
  });

  it('flags "Aceasta postare descrie ..." (ASCII-fold form, no diacritic on Aceasta)', () => {
    expect(detectMetaTalk('Aceasta postare descrie o situatie problematica.')).toBeTruthy();
  });

  it('flags plural "Aceste postări sugerează ..." — diacritic form on the noun', () => {
    expect(detectMetaTalk('această postări sugerează o atitudine negativă.')).toBeTruthy();
  });

  it('flags plural "aceste postari sugereaza ..." — ASCII-fold on the noun', () => {
    expect(detectMetaTalk('această postari sugereaza o atitudine negativa.')).toBeTruthy();
  });

  it('flags "Autorul susține ..." (no-diacritic author)', () => {
    expect(detectMetaTalk('Autorul susține că măsura este necesară.')).toBeTruthy();
  });

  it('flags "Persoana exprimă frustrare ..." (ASCII-fold "Persoana")', () => {
    expect(detectMetaTalk('Persoana exprimă frustrare față de situație.')).toBeTruthy();
  });

  it('flags "Persoană exprimă frustrare ..." (canonical "Persoană" with diacritic)', () => {
    expect(detectMetaTalk('Persoană exprimă frustrare față de situație.')).toBeTruthy();
  });

  it('flags mid-text "această postări transmite ..." (diacritic plural mid-sentence)', () => {
    // Mid-text pattern requires the noun-verb unit anywhere in the rewrite,
    // not just at sentence start. Locks line 135 noun list.
    expect(detectMetaTalk('Cititorul observă că această postări transmite o stare de neliniște.')).toBeTruthy();
  });

  it('passes clean RO rewrite without meta-language', () => {
    expect(detectMetaTalk('Situația este complicată și necesită discuții suplimentare.')).toBeNull();
  });
});

describe('detectFalseSelfAdmission — third → first person flip', () => {
  it('flags flip: "bro rage-quit reality" → "I raged out in reality"', () => {
    expect(detectFalseSelfAdmission('bro rage-quit reality', 'I raged out in reality')).toBe(true);
  });

  it('flags flip: "he slapped the opponent" → "I slapped the opponent"', () => {
    expect(detectFalseSelfAdmission('he slapped the opponent during broadcast', 'I slapped the opponent during broadcast')).toBe(true);
  });

  it('flags flip: "Man said ..." → "I received ..."', () => {
    expect(detectFalseSelfAdmission(
      "Man said 'this ain't LAN' and turned it into a full prison sentence",
      'I received a decade-long ban and a full prison sentence after participating in a live broadcast incident',
    )).toBe(true);
  });

  it('flags flip introducing "my": "bro lost" → "my attempt lost"', () => {
    expect(detectFalseSelfAdmission('bro lost the match quickly', 'my attempt to win ended badly')).toBe(true);
  });

  it('flags flip introducing "we": "they argued" → "we argued"', () => {
    expect(detectFalseSelfAdmission('they argued for hours yesterday', 'we argued for hours yesterday')).toBe(true);
  });
});

describe('detectFalseSelfAdmission — legitimate first-person preserved', () => {
  it('does NOT flag when original WAS first-person: "I am frustrated" → "I disagree"', () => {
    expect(detectFalseSelfAdmission('I am very frustrated with the ban', 'I disagree with the ban')).toBe(false);
  });

  it('does NOT flag when original has "my": "my opinion" → "I believe"', () => {
    expect(detectFalseSelfAdmission('my opinion is clear', 'I believe it is clear')).toBe(false);
  });

  it('does NOT flag when original has "we": "we think" → "we believe"', () => {
    expect(detectFalseSelfAdmission('we think the ban is right', 'we believe the ban is right')).toBe(false);
  });

  it('does NOT flag when both original and rewrite stay third-person', () => {
    expect(detectFalseSelfAdmission('he lost the match', 'he did not win the match')).toBe(false);
  });

  it('does NOT false-fire on "A.I." / "I.D." / "D.I.Y." — isolated I with periods', () => {
    expect(detectFalseSelfAdmission('A.I. is evolving', 'A.I. is developing rapidly')).toBe(false);
  });

  it('does NOT false-fire on "Jimmy" / "mystery" — "my" inside a word', () => {
    expect(detectFalseSelfAdmission('Jimmy won the mystery match', 'Jimmy took first place')).toBe(false);
  });
});

describe('detectFalseSelfAdmission — RO 2nd-person → 1st-person inversion (LOOP-057 RO branch)', () => {
  // Locks the 2026-05-06 patch at neutralizer.ts:300-355,467-486 that catches
  // the catastrophic Sunteți→Sunt class observed live on FB Nicușor Dan
  // permalink. Pro-drop language detection requires verb-form matching
  // beyond pronouns; supplementary sentence-initial check is gated on
  // original-2nd-person presence to avoid 3rd-plural-ambiguous false fires.

  it('flags FB Nicușor Dan canonical: "Sunteți o mare dezamăgire" → "Sunt o dezamăgire"', () => {
    expect(detectFalseSelfAdmission(
      'Sunteți o mare dezamăgire pentru milioane de oameni',
      'Sunt o dezamăgire pentru milioane de oameni',
    )).toBe(true);
  });

  it('flags Aveți → Am (sentence-initial 1st-singular verb form via supplementary check)', () => {
    expect(detectFalseSelfAdmission(
      'Aveți o atitudine proastă față de cetățeni',
      'Am o atitudine proastă față de cetățeni',
    )).toBe(true);
  });

  it('flags Ești → Eu (1st-singular pronoun introduced)', () => {
    expect(detectFalseSelfAdmission(
      'Ești un om greu de înțeles',
      'Eu sunt un om greu de înțeles',
    )).toBe(true);
  });

  it('flags "voastră" → "noastră" when the diacritics are typed', () => {
    // A pronoun that ends in ă sits outside JavaScript's ASCII \b, so only the unaccented spelling used to match.
    expect(detectFalseSelfAdmission(
      'E vina voastră că țara arată așa',
      'E vina noastră că țara arată așa',
    )).toBe(true);
  });

  it('still flags an accusation turned into a confession when the original says "nouă" or "noastră"', () => {
    // "To us" and "our" in an accusation do not make its speaker the one accused, so they must not
    // exempt the original the way an original already in the first person is exempt.
    expect(detectFalseSelfAdmission(
      'Tu ești vinovat pentru ce ni s-a întâmplat nouă',
      'Eu sunt vinovat',
    )).toBe(true);
    expect(detectFalseSelfAdmission(
      'Tu ai distrus țara noastră',
      'Noi am distrus țara',
    )).toBe(true);
  });

  it('does NOT flag when 2nd-person voice is preserved in the rewrite', () => {
    expect(detectFalseSelfAdmission(
      'Sunteți o mare dezamăgire pentru milioane de oameni',
      'Sunteți o dezamăgire pentru mulți oameni',
    )).toBe(false);
  });

  it('does NOT false-fire on 3rd-plural existential "Sunt mulți" — original has no 2nd-person trigger', () => {
    // Gold case for the original-2nd-person gate: when the original lacks
    // 2nd-person markers, the verb-initial supplementary check is bypassed,
    // so 3rd-plural existentials like "Sunt mulți copii frumoși" do not flag.
    expect(detectFalseSelfAdmission(
      'Mulți copii sunt frumoși în această lume',
      'Sunt mulți copii frumoși în această lume',
    )).toBe(false);
  });

  // V1.5 known limitation: 1st-plural verb form "Suntem" is not in the
  // sentence-initial regex (Sunt|Am|Eram|Aș|Asi|M-am|Mi-am). The
  // catastrophic case observed live was 1st-singular ("Sunt"); 1st-plural
  // is rarer in the false-admission class. Extending the regex set is V1.5
  // polish per F-6 design doc.
  it.skip('flags Sunteți → Suntem (1st-plural admission) — V1.5: regex does not include "Suntem"', () => {
    expect(detectFalseSelfAdmission(
      'Sunteți responsabili pentru această situație',
      'Suntem responsabili pentru această situație',
    )).toBe(true);
  });
});

describe('detectLengthRatioBlowup — Tier A (long-original substantive blowup, original > 80c)', () => {
  // 2026-05-23 audit B2: TIER A threshold tightened from `original.length
  // >= 20` to `original.length > 80`. Short adversarial tweets (31-51c) need
  // expansion room for first-person defusion; previously TIER A over-rejected
  // them and forced PASS-no-rewrite (visible in a 2026-05-23 live walk
  // console: "Neutralization rejected: length ratio 1.75 > 2.0"). TIER A
  // still catches the bloat-rewrite class on LONG originals where genuine
  // expansion isn't needed.

  it('passes 31c → 78c at 2.52× — short original now exempt from TIER A (B2 softened)', () => {
    // overwolf "is a virus" rewrite. Pre-B2 this tripped TIER A; post-B2
    // it passes TIER A (original is only 31c). TIER B (>100c) doesn't
    // fire either. The rewrite survives length-ratio check. Other guards
    // (advisory / meta-talk / register / FORBIDDEN_META) still gate.
    expect(detectLengthRatioBlowup(
      'overwolf app is a virus anyways',
      "The Overwolf app has some issues, but calling it a 'virus' is an exaggeration.",
    )).toBe(false);
  });

  it('passes 51c → 89c at 1.75× — Homelander rewrite, short original (B2 softened)', () => {
    expect(detectLengthRatioBlowup(
      'Meet the legend, the first man spared by Homelander',
      'Meet the person who was spared by Homelander, a character known for his violent behavior.',
    )).toBe(false);
  });

  it('passes 32c → 55c at 1.72× — Brazilian "cursed people" short original (B2 softened)', () => {
    // The semantic content (group-blame / scapegoating signal) is lost; the
    // length ratio was a surface signal that caught it pre-B2. Now that
    // signal is no longer firing on short originals — meaning-loss class
    // is V1.5 architectural debt (semantic embedding) that needs a real
    // measurement, not a length-ratio heuristic on short tweets.
    expect(detectLengthRatioBlowup(
      'The Brazilian is a cursed people',
      'The Brazilian people have faced significant challenges.',
    )).toBe(false);
  });

  it('flags 86c → 160c at 1.86× — digital-footprint rewrite injects advisory belt', () => {
    expect(detectLengthRatioBlowup(
      'Delete 99.8% of your digital footprint on the internet.\n\nThis is a step-by-step guide:',
      'Consider taking steps to manage and control your digital presence, but be aware that completely deleting your online footprint may not be necessary or feasible.',
    )).toBe(true);
  });

  it('flags 92c → 175c at 1.90× — Tobey Maguire rewrite injects evidentiary commentary', () => {
    expect(detectLengthRatioBlowup(
      'Tobey Maguire gave an interview about Spider-Man 4.\n\n4 days later, Sony cancelled the movie.',
      'Tobey Maguire gave an interview about Spider-Man 4. Sony later cancelled the movie, but there is no evidence to suggest that the interview was the reason for the cancellation.',
    )).toBe(true);
  });
});

describe('detectLengthRatioBlowup — Tier B (extreme blowup belt preserved)', () => {
  // Belt retained from the prior gate so very-short ALL-CAPS originals stay
  // exempt from Tier A but still trip Tier B if the rewrite blows up beyond
  // 100c at >2× ratio.

  it('flags >100c rewrite at >2.0× ratio (extreme-blowup belt)', () => {
    const original = 'BAN THIS PLAYER NOW MAKE IT PERMANENT';
    const rewritten =
      'It is essential to consider a permanent ban for this player, but you should also rely on credible sources before deciding what action is appropriate.';
    expect(rewritten.length).toBeGreaterThan(100);
    expect(rewritten.length / original.length).toBeGreaterThan(2.0);
    expect(detectLengthRatioBlowup(original, rewritten)).toBe(true);
  });
});

describe('detectLengthRatioBlowup — clean rewrites pass through', () => {
  it('passes natural rewrite at 1.13× ratio (Microplastics 117c → 132c hypothetical)', () => {
    expect(detectLengthRatioBlowup(
      'Microplastics are accumulating in human brains at an alarming rate per recent studies.',
      'Microplastics are being found in human brains at an increasing rate per recent studies.',
    )).toBe(false);
  });

  it('passes very-short original ("Source", 6c → 49c translation expansion)', () => {
    // Tier A floor (original ≥20c) protects pure-translation cases. The
    // empirical ratio=8.17 case in TEST2 forensic file is intentionally
    // out-of-scope for this validator; the meta-talk + voice-inversion
    // validators run independently on these short originals.
    expect(detectLengthRatioBlowup('Source', 'Sunt de acord că jocul CS are reguli prea lenive.')).toBe(false);
  });

  it('passes ALL-CAPS short shout at 1.5× ratio (legitimate compaction-decompression)', () => {
    expect(detectLengthRatioBlowup('ACT NOW!', 'Take political action quickly.')).toBe(false);
  });

  it('passes 51c → 80c at 1.57× under the Tier A rewrite floor of 50c (boundary case)', () => {
    // Tier A demands rewrite > 50c; Tier B demands rewrite > 100c. A 50-char
    // boundary rewrite at 1.57× is a routine paraphrase and should pass.
    expect(detectLengthRatioBlowup(
      'a fifty-one character original sentence is here',
      'A fifty-one character original sentence is now here.',
    )).toBe(false);
  });
});
