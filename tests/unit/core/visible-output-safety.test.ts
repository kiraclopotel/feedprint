// The display guard on MODEL-GENERATED rewrites (FW's own voice). Locked by
// DECISIONS 2026-07-02 (Shield/Coach/Lens): no rewrite in ANY mode may carry
// profanity, slurs, or ad-hominem insults — mode dials govern platform
// content tolerance, never FW's own output. The ad-hominem cases are from a
// real 2026-07-02 chain: records #300 ("Un.idiot" → "Cred că persoana este un
// idiot.") and #305 ("prosti" survived) — insults the input harm-floor flagged
// re-entered through the rewrite because the old guard checked profanity only.

import { describe, it, expect } from 'vitest';
import { detectUnsafeVisibleLanguage } from '../../../src/core/visible-output-safety';

describe('detectUnsafeVisibleLanguage — FW\'s own voice carries no insult', () => {
  it('rejects the real failed rewrites from the 2026-07-02 chain', () => {
    expect(detectUnsafeVisibleLanguage('Cred că persoana este un idiot.')).toBeTruthy();
    expect(detectUnsafeVisibleLanguage('Mulți oameni prosti au acte în regulă.')).toBeTruthy();
  });

  it('accepts the GOOD rewrite from the same session (defused, no insult)', () => {
    // The TikTok sticker comment reframe from that screenshot — "prost" became
    // "neînțelept" (unwise): exactly the contract.
    expect(detectUnsafeVisibleLanguage(
      'Întrebare: Cât de neînțelept ar fi să încasezi 600.000 euro și să nu plătești impozit?',
    )).toBeNull();
  });

  it('rejects the feminine Romanian insult as it rejects the masculine one', () => {
    expect(detectUnsafeVisibleLanguage('Cred că ești o idioată.')).toBeTruthy();
    expect(detectUnsafeVisibleLanguage('Taci din gură, idioato.')).toBeTruthy();
  });

  it('rejects English ad-hominem survivals', () => {
    expect(detectUnsafeVisibleLanguage('I think that person is an idiot')).toBeTruthy();
    expect(detectUnsafeVisibleLanguage('He seems stupid to me')).toBeTruthy();
  });

  it('still rejects profanity/slurs (the original guard)', () => {
    expect(detectUnsafeVisibleLanguage('this is fucking great')).toBeTruthy();
  });

  it('does not false-match embedded stems (Scunthorpe guards hold)', () => {
    // 'prostata' (prostate) is deliberately NOT matched by the enumerated
    // RO list; medical register survives.
    expect(detectUnsafeVisibleLanguage('Controlul la prostata este important.')).toBeNull();
  });

  it('passes ordinary calm rewrites', () => {
    expect(detectUnsafeVisibleLanguage('Nu sunt de acord cu această decizie.')).toBeNull();
    expect(detectUnsafeVisibleLanguage('I disagree with how this was handled.')).toBeNull();
  });
});
