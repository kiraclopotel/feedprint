/**
 * Tests for src/core/dehumanization-filter.ts — pre-LLM safety gate
 * that prevents the rewriter from receiving content where it would
 * preserve dehumanization vocabulary.
 *
 * The seed case (idx 0 below) is from a 2026-05-15 forensic chain,
 * where Groq 8b rewrote "Exterminat those rats right in there hole..."
 * as "Those rats should be exterminated in their hole and covered with
 * dirt." — preserving every dehumanization element. This filter ensures
 * such content is routed to action='hide' before the rewriter sees it.
 */

import { describe, it, expect } from 'vitest';
import { detectDehumanization } from '../../../src/core/dehumanization-filter';

describe('detectDehumanization — should TRIGGER', () => {
  it('catches the canonical 2026-05-15 forensic-chain case (rats + exterminate + dirt)', () => {
    const text =
      'Exterminat those rats right in there hole and throw some dirt over it the way they do to others all over the world. Rightfully deserved.';
    const r = detectDehumanization(text);
    expect(r.triggered).toBe(true);
    expect(r.matches.length).toBeGreaterThan(0);
    expect(r.primaryEvidence.length).toBeGreaterThan(0);
  });

  it('catches "exterminate the cockroaches" (action + target, pattern B)', () => {
    const r = detectDehumanization('We must exterminate the cockroaches living among us.');
    expect(r.triggered).toBe(true);
    expect(r.matches[0].pattern).toBe('B');
  });

  it('catches "vermin should be eradicated" (target + action, pattern A)', () => {
    const r = detectDehumanization('Those vermin should be eradicated from our society.');
    expect(r.triggered).toBe(true);
    // Either pattern A or B can fire — both are valid catches.
    expect(['A', 'B']).toContain(r.matches[0].pattern);
  });

  it('catches "X are parasites" (identity + are + target, pattern C)', () => {
    const r = detectDehumanization('Communists are parasites that drain our nation.');
    expect(r.triggered).toBe(true);
    expect(r.matches.some((m) => m.pattern === 'C')).toBe(true);
  });

  it('catches "they are vermin" (generic pronoun + are + target, pattern C)', () => {
    const r = detectDehumanization('I keep saying it — they are vermin and nothing more.');
    expect(r.triggered).toBe(true);
    expect(r.matches.some((m) => m.pattern === 'C')).toBe(true);
  });

  it('catches "burn them all" + dehumanizing target', () => {
    const r = detectDehumanization('Just burn them all, every last one of those parasites.');
    expect(r.triggered).toBe(true);
  });

  it('catches "gas the rats" (extreme action verb + target)', () => {
    const r = detectDehumanization('Time to gas the rats and be done with it.');
    expect(r.triggered).toBe(true);
  });

  it('catches "wipe them out" + dehumanizing target', () => {
    const r = detectDehumanization('Wipe them out — every single one of those subhumans.');
    expect(r.triggered).toBe(true);
  });

  it('catches "Jews are vermin" (named group + are + target)', () => {
    const r = detectDehumanization('Jews are vermin.');
    expect(r.triggered).toBe(true);
  });

  it('triggers on a real assertion surrounded by contractions (D-7 apostrophe bug)', () => {
    // Contraction / possessive apostrophes (It's, they're, John's) must NOT be
    // counted as quote delimiters. An odd count of them used to flip a genuine
    // dehumanization assertion into a falsely-"quoted" span via isQuotedSpan,
    // silently disabling the gate — a real genocide-coded assertion shown to
    // the child unsoftened.
    const r = detectDehumanization(
      "It's obvious by now — communists are parasites and they're ruining everything.",
    );
    expect(r.triggered).toBe(true);
  });
});

describe('detectDehumanization — should NOT TRIGGER', () => {
  it('does not trigger on standalone pest content (target without dehumanization context)', () => {
    const r = detectDehumanization('Got rats in my basement again, gonna call pest control.');
    expect(r.triggered).toBe(false);
  });

  it('does not trigger on standalone action verb (no dehumanizing target)', () => {
    const r = detectDehumanization('We need to eliminate inefficiencies in our process.');
    expect(r.triggered).toBe(false);
  });

  it('does not trigger on a single token in isolation', () => {
    expect(detectDehumanization('rats').triggered).toBe(false);
    expect(detectDehumanization('exterminate').triggered).toBe(false);
    expect(detectDehumanization('parasites').triggered).toBe(false);
  });

  it('does not trigger on benign casual text', () => {
    const r = detectDehumanization('I love this game, the visuals are amazing.');
    expect(r.triggered).toBe(false);
  });

  it('does not trigger on news-style reporting (no quoted-span carveout — see note)', () => {
    // Note: actual news reporting that uses dehumanization vocabulary is rare;
    // when it does (e.g., quoting a politician), the quoted-span gate kicks
    // in. This test verifies that descriptive prose without action+target
    // co-occurrence does not trigger.
    const r = detectDehumanization('The city continues its rodent control program in subway stations.');
    expect(r.triggered).toBe(false);
  });

  it('does not trigger when the dehumanization span is inside a quote frame', () => {
    // The quoted-span detector should suppress the match because the
    // dehumanization phrase falls between quote characters — the post is
    // reporting what someone else said, not asserting it.
    const text = 'The senator was widely condemned for saying "we should exterminate those vermin" at the rally.';
    const r = detectDehumanization(text);
    // Quote frame should suppress — the speaker is reporting condemnation.
    expect(r.triggered).toBe(false);
  });
});

describe('detectDehumanization — 2026-05-27 identity-context guard', () => {
  // The 2026-05-26 forensic-chain export surfaced a clean false positive:
  // a Wisconsin raccoon-rabies pest-control news story matched the
  // dehumanization filter because an ambiguous target (e.g., "rats" or
  // "dogs") co-occurred with an elimination verb. The fix splits targets
  // into HUMAN_TARGETS (unambiguous slurs — fire as before) and
  // AMBIGUOUS_TARGETS (animal / pest / medical — require an identity-
  // group cue OR a genocide-coded action verb).

  it('does NOT trigger on pest-control content (rats + eliminate, no identity)', () => {
    const r = detectDehumanization(
      'This program does not just target raccoon rabies. It is already permanently eliminating rats from urban areas in three counties.',
    );
    expect(r.triggered).toBe(false);
  });

  it('does NOT trigger on pest-control content (cockroaches + kill, no identity)', () => {
    // Note: the EN profession noun "exterminator(s)" is demoted from the
    // genocide-coded register (D1 guards below); the verb stem
    // "exterminat\w*" (exterminate / exterminated) stays genocide-coded
    // and fires without identity context.
    const r = detectDehumanization(
      'The pest control crew killed every cockroach in the kitchen yesterday and left no infestation behind.',
    );
    expect(r.triggered).toBe(false);
  });

  it('does NOT trigger on medical content (cancer + eliminate, no identity)', () => {
    const r = detectDehumanization(
      'New chemotherapy protocols are eliminating advanced cancer cases at a higher rate than ever.',
    );
    expect(r.triggered).toBe(false);
  });

  it('does NOT trigger on plague-history content (no identity)', () => {
    const r = detectDehumanization(
      'The medieval plague killed almost a third of Europe within a single decade.',
    );
    expect(r.triggered).toBe(false);
  });

  it('STILL triggers on genocide-coded verb + ambiguous target even without identity (gas + rats)', () => {
    // "gas" is in GENOCIDE_CODED_ACTIONS — its Holocaust association
    // makes it a strong dehumanization tell regardless of explicit
    // identity context. Preserved from the original test suite.
    const r = detectDehumanization('Time to gas the rats and be done with it.');
    expect(r.triggered).toBe(true);
  });

  it('STILL triggers on ambiguous target with explicit identity-group cue (them + those + ambiguous target + non-genocide action)', () => {
    // dogs is AMBIGUOUS, kill is OTHER (non-genocide). The match fires
    // because identity-group cues (`those`, `them`) appear within the
    // 150-char window, signaling out-group framing.
    const r = detectDehumanization(
      'Those dogs are taking over our neighborhood — we need to kill them all before they multiply.',
    );
    expect(r.triggered).toBe(true);
  });

  it('STILL triggers on human-coded target alone (subhumans + kill, no identity)', () => {
    // subhumans is in HUMAN_TARGETS — the word itself is the slur.
    // No identity-group cue required.
    const r = detectDehumanization(
      'These subhumans should be killed before they spread further.',
    );
    expect(r.triggered).toBe(true);
  });
});

describe('detectDehumanization — 2026-08-04 D1 false-positive guards', () => {
  // Fresh-eyes audit D1: three benign-content classes were reaching the
  // sev9 HIDE path and writing forensic records. Each guard below is
  // deliberately narrow; the adjacent STILL-triggers cases pin the
  // true-positive boundary the guard must not cross.

  it('does NOT trigger on "exterminator" as pest-control profession (no identity context)', () => {
    // "exterminator" reaches GENOCIDE_ACTION_TEST through the
    // exterminat/extermin verb stems. Demoted to a non-genocide action:
    // an AMBIGUOUS target then needs an identity-group cue, like any
    // other non-genocide verb.
    const r = detectDehumanization('The exterminator finally got rid of the rats in our basement.');
    expect(r.triggered).toBe(false);
  });

  it('STILL triggers on "exterminator" + ambiguous target with identity context', () => {
    const r = detectDehumanization(
      'Those immigrants are everywhere. Someone should send the exterminator after these rats.',
    );
    expect(r.triggered).toBe(true);
  });

  it('STILL triggers on the exterminate verb stem without identity context', () => {
    expect(detectDehumanization('We must exterminate the cockroaches living among us.').triggered).toBe(true);
    expect(detectDehumanization('Those rats will be exterminated, mark my words.').triggered).toBe(true);
  });

  it('does NOT trigger when the only identity cue near a pest target is an anaphoric pronoun', () => {
    // "them" corefers with the mice themselves — a bare pronoun cannot
    // signal an out-group, so it no longer satisfies the identity-context
    // guard for AMBIGUOUS targets.
    const r = detectDehumanization('These mice keep chewing the wires, we need to kill them.');
    expect(r.triggered).toBe(false);
  });

  it('STILL triggers on ambiguous target + non-genocide action with a non-pronoun cue', () => {
    const r = detectDehumanization(
      'Those dogs are taking over our neighborhood — we need to kill them all before they multiply.',
    );
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger Pattern C on pronoun + everyday animal (they are pigs — farm content)', () => {
    const r = detectDehumanization('Look at them rolling in the mud, they are pigs after all.');
    expect(r.triggered).toBe(false);
  });

  it('does NOT trigger Pattern C on generic gender cohort + refuse noun (men are trash)', () => {
    const r = detectDehumanization('honestly men are trash, all of them');
    expect(r.triggered).toBe(false);
  });

  it('STILL triggers Pattern C on pronoun subject + genocide-register target (they are vermin)', () => {
    const r = detectDehumanization('They are vermin.');
    expect(r.triggered).toBe(true);
  });

  it('STILL triggers Pattern C on a named out-group + everyday animal (immigrants are pigs)', () => {
    const r = detectDehumanization('Immigrants are pigs.');
    expect(r.triggered).toBe(true);
  });

  it('STILL triggers Pattern C on gender cohort + genocide-register target (women are vermin)', () => {
    const r = detectDehumanization('Women are vermin.');
    expect(r.triggered).toBe(true);
  });

  it('STILL triggers Pattern C on cross-sentence coreference (named out-group rescues the pronoun)', () => {
    const r = detectDehumanization('Those immigrants moved in next door. They are pigs.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT let two weak cohorts rescue each other (men are trash / women are trash)', () => {
    const r = detectDehumanization('Men are trash. Women are trash too.');
    expect(r.triggered).toBe(false);
  });

  it('does NOT let the weak subject rescue itself through the context window', () => {
    const r = detectDehumanization('honestly men are trash, all of them');
    expect(r.triggered).toBe(false);
  });
});

describe('detectDehumanization — Romanian coverage', () => {
  it('catches RO ethnic-target dehumanization (țiganii sunt șobolani)', () => {
    // Pattern C with RO identity-group + RO to-be verb + RO target.
    const r = detectDehumanization('țiganii sunt șobolani și trebuie scoși din societate.');
    expect(r.triggered).toBe(true);
  });

  it('catches RO Pattern A — exterminat + șobolani with identity context', () => {
    const r = detectDehumanization('Trebuie exterminat acești șobolani din societatea noastră, ei sunt o problemă.');
    expect(r.triggered).toBe(true);
  });

  it('catches RO diacritic-less variant — soareci + omorât with identity (ei)', () => {
    // Common online: Romanians often type without diacritics. The
    // diacritic-less form `soareci` / `sobolani` is in the vocab so it
    // matches the same way as the diacritic form.
    const r = detectDehumanization('Acei sobolani trebuie omorâți, ei nu apartin acestei societati.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger on RO pest-control content (sobolani + ucid, no identity)', () => {
    const r = detectDehumanization('Compania de deratizare a ucis toți șobolanii din subsolul casei mele.');
    expect(r.triggered).toBe(false);
  });
});

describe('detectDehumanization — Spanish coverage', () => {
  it('catches ES Pattern C (los inmigrantes son ratas)', () => {
    const r = detectDehumanization('Los inmigrantes son ratas que invaden nuestro país.');
    expect(r.triggered).toBe(true);
  });

  it('catches ES Pattern A (exterminar las cucarachas, with esos\\s+\\w+s)', () => {
    const r = detectDehumanization('Hay que exterminar a esos parásitos antes de que aumenten.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger on ES pest-control content', () => {
    const r = detectDehumanization('La empresa de control de plagas mató todas las cucarachas en la cocina.');
    expect(r.triggered).toBe(false);
  });
});

describe('detectDehumanization — French coverage', () => {
  it('catches FR Pattern C (ils sont des rats)', () => {
    const r = detectDehumanization('Ces immigrés sont des rats qui doivent partir.');
    expect(r.triggered).toBe(true);
  });

  it('catches FR Pattern A (exterminer with identity ceux)', () => {
    const r = detectDehumanization('Il faut exterminer ces parasites — ceux qui ne nous ressemblent pas.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger on FR pest-control (literal cafards, no identity)', () => {
    const r = detectDehumanization("L'exterminateur a tué tous les cafards de la cuisine hier soir.");
    // FR "exterminateur" → matches `extermin[\p{L}]*` → genocide-coded.
    // Cockroaches AMBIGUOUS + genocide-coded action → fires regardless.
    // Documented limitation: the D1 profession-noun demotion is anchored
    // on the EN spelling "exterminator(s)" only; extending it to FR
    // needs its own FP evidence before loosening a hide gate.
    expect(r.triggered).toBe(true);
  });
});

describe('detectDehumanization — German coverage', () => {
  it('catches DE Pattern C (Juden sind Ungeziefer — Nazi-era construction)', () => {
    const r = detectDehumanization('Diese Juden sind Ungeziefer in unserer Gesellschaft.');
    expect(r.triggered).toBe(true);
  });

  it('catches DE Pattern A (ausrotten + Ratten with identity diese)', () => {
    const r = detectDehumanization('Wir müssen diese Ratten ausrotten, sie zerstören alles.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger on DE pest-control', () => {
    const r = detectDehumanization('Der Kammerjäger hat alle Ratten im Keller getötet.');
    expect(r.triggered).toBe(false);
  });
});

describe('detectDehumanization — Italian coverage', () => {
  it('catches IT Pattern C (gli zingari sono parassiti)', () => {
    const r = detectDehumanization('Gli zingari sono parassiti che vivono alle nostre spalle.');
    expect(r.triggered).toBe(true);
  });

  it('catches IT Pattern A (sterminare + ratti with identity loro)', () => {
    const r = detectDehumanization('Bisogna sterminare quei ratti — loro non meritano stare qui.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger on IT pest-control', () => {
    const r = detectDehumanization('La ditta di disinfestazione ha ucciso tutti i topi nel magazzino.');
    expect(r.triggered).toBe(false);
  });
});

describe('detectDehumanization — Portuguese coverage', () => {
  it('catches PT Pattern C (esses imigrantes são ratos)', () => {
    const r = detectDehumanization('Esses imigrantes são ratos que invadem o nosso país.');
    expect(r.triggered).toBe(true);
  });

  it('catches PT Pattern A (exterminar with identity context)', () => {
    const r = detectDehumanization('Precisamos exterminar essas baratas — eles destruem tudo.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger on PT pest-control', () => {
    const r = detectDehumanization('A empresa de dedetização matou todos os ratos do depósito.');
    expect(r.triggered).toBe(false);
  });
});

describe('detectDehumanization — cross-language identity-group regression', () => {
  it('still fires on EN with new multilingual TO_BE list intact', () => {
    const r = detectDehumanization('They are vermin.');
    expect(r.triggered).toBe(true);
    expect(r.matches.some((m) => m.pattern === 'C')).toBe(true);
  });

  it('handles diacritic-bearing identity-group correctly (Unicode boundary)', () => {
    // The Romanian word "musulmanii" (the muslims) ends in `ii`. With the
    // old ASCII `\b` boundary, the match would have ended at the first
    // non-word boundary inside the word — potentially false-matching a
    // prefix. With Unicode boundaries this anchors cleanly.
    const r = detectDehumanization('Musulmanii sunt paraziți, după mine.');
    expect(r.triggered).toBe(true);
  });

  it('does NOT trigger on benign multilingual prose', () => {
    expect(detectDehumanization('Câinele meu este foarte drăguț.').triggered).toBe(false); // RO: my dog is very cute
    expect(detectDehumanization('Mi gato es muy bonito.').triggered).toBe(false);          // ES
    expect(detectDehumanization('Mon chien est gentil.').triggered).toBe(false);           // FR
    expect(detectDehumanization('Mein Hund ist nett.').triggered).toBe(false);             // DE
    expect(detectDehumanization('Il mio cane è gentile.').triggered).toBe(false);          // IT
    expect(detectDehumanization('O meu cão é fofo.').triggered).toBe(false);               // PT
  });
});

describe('detectDehumanization — output shape', () => {
  it('returns evidence under 120 chars', () => {
    const longText =
      'Some very long preamble that does not contain anything relevant to dehumanization at all, just words and words and more words, until we finally get to the part that says we should exterminate those rats, and then keeps going with more irrelevant content.';
    const r = detectDehumanization(longText);
    expect(r.triggered).toBe(true);
    expect(r.primaryEvidence.length).toBeLessThanOrEqual(120);
  });

  it('classifies each match with a pattern letter (A / B / C)', () => {
    const r = detectDehumanization('Communists are parasites that we should eradicate.');
    expect(r.triggered).toBe(true);
    for (const m of r.matches) {
      expect(['A', 'B', 'C']).toContain(m.pattern);
    }
  });
});
