// G2: a self-harm or sexual find is called by its name. The local coded-harm check hides a directed self-harm push
// and a sexual ask, and used to label the first "shame-attack" and the second "combined" (the catch-all), so a record,
// a hide notice and the export read "Shame attack" for a self-harm find. The label now names the danger. What is hidden,
// how severe it is and whether it hides do not change: the controls below pin every other category as it was.

import { describe, it, expect } from 'vitest';
import { detectCodedHarm, codedHarmVerdictFields } from '../../../src/core/coded-harm-catcher';

// The catcher's own fixtures (tests/unit/core/coded-harm-catcher.test.ts): every text must reach the category named.
const FIND = {
  selfHarm: { category: 'self-harm-encouragement', text: 'nobody likes you, just kill yourself already' },
  solicitation: { category: 'sexual-solicitation', text: 'send me nude pics' },
  explicit: { category: 'sexual-explicit', text: 'she was deepthroating in the clip' },
  violence: { category: 'violence-narration', text: 'petrol bomb thrown at the crowd' },
  doxxing: { category: 'doxxing', text: 'post his home address' },
  scapegoating: { category: 'coded-scapegoating', text: 'their crime rate is disproportionate' },
  clickbait: { category: 'clickbait-fomo', text: '100% win rate, never lost once' },
} as const;

function fieldsOf(text: string) {
  const hit = detectCodedHarm(text);
  if (!hit) throw new Error(`the catcher did not fire on: ${text}`);
  return { hit, fields: codedHarmVerdictFields(hit) };
}

describe('the label of a coded find names the danger', () => {
  it('a directed self-harm push is called self-harm, severity 9, hidden', () => {
    const { hit, fields } = fieldsOf(FIND.selfHarm.text);
    expect(hit.category).toBe(FIND.selfHarm.category);
    expect(fields).toEqual({ technique: 'self-harm', severity: 9, hideTier: true });
  });

  it('a sexual ask is called sexual, severity 9, hidden', () => {
    const { hit, fields } = fieldsOf(FIND.solicitation.text);
    expect(hit.category).toBe(FIND.solicitation.category);
    expect(fields).toEqual({ technique: 'sexual', severity: 9, hideTier: true });
  });

  it('explicit sexual words are called sexual, severity 9, hidden', () => {
    const { hit, fields } = fieldsOf(FIND.explicit.text);
    expect(hit.category).toBe(FIND.explicit.category);
    expect(fields).toEqual({ technique: 'sexual', severity: 9, hideTier: true });
  });
});

describe('controls: every other find keeps its label, severity and hide', () => {
  it('narrated violence is called graphic violence (G7), severity 8, hidden', () => {
    expect(fieldsOf(FIND.violence.text).fields).toEqual({ technique: 'violence-graphic', severity: 8, hideTier: true });
  });
  it('doxxing keeps the catch-all label', () => {
    expect(fieldsOf(FIND.doxxing.text).fields).toEqual({ technique: 'combined', severity: 8, hideTier: true });
  });
  it('coded scapegoating does not hide', () => {
    expect(fieldsOf(FIND.scapegoating.text).fields).toEqual({ technique: 'scapegoating', severity: 6, hideTier: false });
  });
  it('clickbait does not hide', () => {
    expect(fieldsOf(FIND.clickbait.text).fields).toEqual({ technique: 'misleading-format', severity: 6, hideTier: false });
  });
});
