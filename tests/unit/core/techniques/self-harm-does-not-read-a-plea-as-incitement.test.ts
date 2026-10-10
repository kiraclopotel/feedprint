// Telling someone not to kill themselves uses the same words as telling them to, so the self-harm
// classifier must read the prohibition in front of the words and still catch an attack that only
// looks like a plea ("don't bother, just kys").

import { describe, it, expect } from 'vitest';
import { selfHarmClassifier } from '../../../../src/core/techniques/self-harm';

const fires = (text: string): boolean => selfHarmClassifier.classify({ text }).present;

describe('self-harm does not read a plea as incitement', () => {
  const PLEAS: readonly string[] = [
    // In the adversarial benign set, and at the head of a longer reply in the OpenAI moderation set.
    "Don't kill yourself. Don't hurt anyone either, seek psychological help if you need it.",
    "Don't kill yourself. Don't hurt anyone either, if you're truly a sadist. Seek psychological help if you plan on causing physical harm to anyone - that would be inexcusable, and ruin not just others' lives but also your own.",
    "please don't kill yourself, things get better",
    'do not kill yourself, call a helpline',
    "don't ever kill yourself over a game",
    "you shouldn't kill yourself over this",
    'never kill yourself for someone else',
    "don't you dare kill yourself",
    'dont kys bro, talk to me',
    "don't go kill yourself over a breakup",
    'you should not kill yourself',
    'don’t kill yourself, you matter',
    'don´t kill yourself, you matter',
    "please don't do it, you don't deserve to die",
    // Portuguese keeps the verb under negation, so these reach the patterns.
    'você não vai se matar, vai ficar tudo bem',
    'nao vai se matar por causa disso',
    'nunca mate-se por ninguém',
    'não corte os pulsos, fala comigo',
    'não se joga da ponte, por favor',
    // Spanish and Romanian change the verb under negation; these lock that they stay clear.
    'no te mates, por favor, busca ayuda',
    'por favor no te suicides',
    'nu te omorî, cere ajutor',
    'nu te sinucide, te rog',
  ];
  it.each(PLEAS)('leaves %s alone', (text) => {
    expect(fires(text)).toBe(false);
  });

  const ATTACKS: readonly string[] = [
    'you should kill yourself',
    'go kill yourself',
    'kill yourself',
    'nobody would stop you if you kill yourself',
    "why don't you just kill yourself",
    "why don't just kill yourself",
    "i don't care, kill yourself",
    "don't bother, just kys",
    "don't hesitate to kill yourself",
    "Don't kill yourself. jk kill yourself",
    'd0n’t k1ll y0urself. jk k1ll y0urself',
    'por que você não vai se matar?',
    'se mate logo, ninguem vai sentir sua falta',
    'mate-se, voce nao serve pra nada',
    'vai se matar, otario',
    'matate ya, nadie te va a extranar',
    'suicidate de una vez, el mundo estaria mejor sin ti',
    'omoară-te',
    'sinucide-te',
    'du-te să mori',
    // No prohibition turns a statement into a plea: 'nunca', 'jamás' or 'jamais' before 'nadie' or
    // 'ninguém' says "nobody will ever miss you", and a bare 'não' in front can only mean "No".
    'nunca nadie te va a extrañar',
    'jamás nadie te extrañará',
    'nunca ninguém vai sentir sua falta',
    'jamais ninguém vai sentir sua falta',
    'nao ninguem vai sentir sua falta kkk',
    'não o mundo seria melhor sem você',
  ];
  it.each(ATTACKS)('still catches %s', (text) => {
    expect(fires(text)).toBe(true);
  });
});
