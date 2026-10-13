// A name-calling at the reader paired with an order to vanish is a rule of its own (12 Oct 2026, the Tester's full test:
// Strict, the child level, showed the bullying lines of a made-up feed as written because it reads nothing outside, and the
// free rules kept only the claim-and-order shape). The insult alone stays with the AI; only the pair fires.

import { describe, it, expect } from 'vitest';
import { detectCodedHarm, codedHarmVerdictFields } from '../../../src/core/coded-harm-catcher';

describe('a name-calling at the reader with an order to vanish', () => {
  it('fires on the Tester\'s line, with or without the @name', () => {
    const lines = [
      '@anyhandle you are a pathetic little nobody and everyone at your school knows it. Do us all a favour and disappear.',
      'you are a pathetic little nobody and everyone at your school knows it. Do us all a favour and disappear.',
      'Do us all a favor and delete your account, you are such a loser',
      "you're a total idiot, go away forever",
      'u r a waste of space. just disappear',
      'you are a worthless clown and nobody would miss you',
    ];
    for (const text of lines) {
      const hit = detectCodedHarm(text);
      expect(hit?.category, text).toBe('shaming-harassment');
      expect(hit?.pattern, text).toMatch(/^insult-and-vanish|nobody-likes-you/);
    }
  });

  it('fires in Spanish, Portuguese and Romanian', () => {
    const lines = [
      'Eres un idiota, desaparece',
      'eres una basura. Largate de aqui',
      'Você é um perdedor, apaga a tua conta',
      'voce e um idiota. Some daqui',
      'Ești un prost, dispari',
      'esti un ratat, sterge-ti contul',
    ];
    for (const text of lines) {
      expect(detectCodedHarm(text)?.category, text).toBe('shaming-harassment');
    }
  });

  it('is called by its name: the shame attack, severity 8, hidden', () => {
    const hit = detectCodedHarm('you are a loser, disappear');
    expect(hit && codedHarmVerdictFields(hit)).toEqual({ technique: 'shame-attack', severity: 8, hideTier: true });
  });

  it('stays quiet on a negation, a compliment, a plain insult and a plain order', () => {
    const quiet = [
      'you are not a loser, go away and rest',
      "you're not a failure, just go away for the weekend and recharge",
      'you are a legend, go away with that trophy',
      'you are an idiot',
      'You are such a clown lol',
      'just disappear into the crowd and take the shot',
      'delete your account on the old site first, then register here',
      'He is a loser and I hope he goes away',
      'they are idiots, go away from them',
      'Eres un genio, desaparece un rato y descansa',
      'você é um gênio, some daqui e descansa',
      'Ești un geniu, dispari puțin și odihnește-te',
    ];
    for (const text of quiet) {
      const hit = detectCodedHarm(text);
      expect(/insult-and-vanish/.test(hit?.pattern ?? ''), text).toBe(false);
    }
  });

  it('does not touch the older shaming rules', () => {
    expect(detectCodedHarm('Nobody at school likes you, just delete your account')?.pattern).toBe('nobody-likes-you-go-away');
  });
});
