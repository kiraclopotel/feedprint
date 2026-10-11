// A rewrite that still carries the attack is not shown (11 Oct 2026, the Tester's full test).
//
// The calmer rewrite is the promise, and nothing asked whether the attack was still in it. The Tester's made-up X post
// "@anyhandle you are a pathetic little nobody and everyone at your school knows it. Do us all a favour and disappear."
// came back as "I think you are a pathetic little nobody and everyone at your school knows it. I suggest you disappear."
// with the green done dot; a fear-selling post came back as "I want to share this information"; a Relaxed rewrite read
// "I suggest you consider leaving". Two checks on what the rewrite KEEPS, so neither needs a list of insults: half or more
// of the original's four-word runs word for word, and a call to share or to remove the person that survives.

import { describe, it, expect } from 'vitest';
import { keptRunFraction, rewriteKeepsTheAttack } from '../../../src/analysis/rewrite-keeps-attack';
import { validateRewrite } from '../../../src/analysis/comment-rewriter';

const MENTION = '@anyhandle you are a pathetic little nobody and everyone at your school knows it. Do us all a favour and disappear.';
const FEAR = 'Doctors will never tell you this, but the water in your kitchen is slowly poisoning your children. Share this before it gets deleted.';

describe('what the Tester saw is caught', () => {
  it('the insult behind an "I think" is the original again (kept whole)', () => {
    const rewrite = 'I think you are a pathetic little nobody and everyone at your school knows it. I suggest you disappear.';
    expect(keptRunFraction(MENTION, rewrite)).toBeGreaterThanOrEqual(0.5);
    expect(rewriteKeepsTheAttack(MENTION, rewrite)).toBe('kept-whole');
  });

  it('the call to share that came through in the first person', () => {
    const rewrite = 'I believe the water in my kitchen may be harmful to my children. I want to share this information.';
    expect(rewriteKeepsTheAttack(FEAR, rewrite)).toBe('call-to-share-kept');
  });

  it('the call to go that came through softened', () => {
    const rewrite = "I don't think you are a significant presence. I suggest you consider leaving.";
    expect(rewriteKeepsTheAttack(MENTION, rewrite)).toBe('call-to-remove-kept');
  });
});

describe('a rewrite that does what it was asked is left alone', () => {
  it.each([
    ['Anyone who still backs this plan is a fool, and the rest of us are tired of carrying people who cannot think.',
      'I think anyone who still backs this plan is mistaken, and I am tired of the argument going nowhere.'],
    ['Imagine being 30 and still living with your parents. Absolute failure, no wonder nobody dates you.',
      'I think living with your parents at thirty can be hard, and that is fine.'],
    [MENTION, 'I strongly disagree with what @anyhandle posted, and I would like to hear the reasons.'],
    [FEAR, 'Someone has posted that the tap water at home may be unsafe; the local water board publishes its test results.'],
    ['They hate you, they hate your country, and they are coming for everything you love. Are you angry yet?',
      'They dislike me and my country.'],
  ])('%s', (original, rewrite) => {
    expect(rewriteKeepsTheAttack(original, rewrite)).toBeNull();
  });

  it('a call in the rewrite that the original never made is not the original\'s call', () => {
    expect(rewriteKeepsTheAttack('You are such a loser and everybody here knows it, honestly.', 'I would not share this with anyone, but I disagree.')).toBeNull();
  });

  it('a short original has no runs to keep, and an empty side is not a verdict', () => {
    expect(keptRunFraction('you are trash lol', 'you are trash lol really')).toBe(0);
    expect(rewriteKeepsTheAttack('', 'anything at all here')).toBeNull();
    expect(rewriteKeepsTheAttack('anything at all here and there', '')).toBeNull();
  });
});

describe('the words of the call, in the four languages', () => {
  it.each([
    ['Comparte esto antes de que lo borren, la gente tiene que saberlo ya mismo.', 'Pido a todos que compartan esto con calma.', 'call-to-share-kept'],
    ['Compartilhe isso antes que apaguem, todo mundo precisa saber disso agora mesmo.', 'Eu gostaria que você compartilhasse isso.', 'call-to-share-kept'],
    ['Partajează asta înainte să o șteargă, toată lumea trebuie să afle imediat.', 'Aș vrea să partajezi asta cu prietenii.', 'call-to-share-kept'],
    ['Eres un inútil y todos lo saben, así que desaparece de aquí de una vez.', 'Creo que sería mejor que desaparezcas.', 'call-to-remove-kept'],
    ['Eres un inútil y todos lo saben, así que cállate de una vez por todas.', 'Te pido que te cállate un momento.', 'call-to-remove-kept'],
    ['Ești un ratat și toată lumea știe, așa că pleacă de aici odată pentru totdeauna.', 'Cred că ar fi bine să pleacă.', 'call-to-remove-kept'],
  ])('%s', (original, rewrite, expected) => {
    expect(rewriteKeepsTheAttack(original, rewrite)).toBe(expected);
  });
});

describe('a comment rewrite goes through the same check', () => {
  it('is invalid, with the reason attack-kept, when the rewrite keeps the attack', () => {
    const original = 'You are a pathetic little nobody and everyone in this thread knows it, so do us all a favour and disappear.';
    const rewrite = 'I think you are a pathetic little nobody and everyone in this thread knows it. I suggest you disappear.';
    const verdict = validateRewrite(rewrite, original);
    expect(verdict.valid).toBe(false);
    expect(verdict.reason).toBe('attack-kept');
    expect(verdict.detail).toBe('kept-whole');
  });

  it('stays valid for a real softening', () => {
    const original = 'You are a pathetic little nobody and everyone in this thread knows it, so do us all a favour and disappear.';
    expect(validateRewrite('I disagree with this person and find their tone unhelpful here.', original).valid).toBe(true);
  });
});
