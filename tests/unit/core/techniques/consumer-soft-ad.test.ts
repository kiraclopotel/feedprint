import { describe, it, expect } from 'vitest';
import { consumerRapidFrameClassifier } from '../../../../src/core/techniques/consumer-rapid-frame';

// Fix 5: soft-solicitation ads (no hard urgency words) must be caught, WITHOUT
// over-blocking innocent sentences that share the verbs. Over-blocking is the
// PRIMARY failure — the control set is the gate; if any control fires, the
// pattern is too loose and must not ship.

const fire = (text: string): boolean =>
  consumerRapidFrameClassifier.classify({ text } as Parameters<typeof consumerRapidFrameClassifier.classify>[0]).present;

describe('consumer-rapid-frame — soft-solicitation ad detection', () => {
  it('catches the G4Skins-class ad (the live miss)', () => {
    expect(fire('Chicken Pass on G4Skins! Head over and grab discounts and free cases to build up your inventory! You won’t want to miss this!')).toBe(true);
  });

  it.each([
    'Grab your free skins and coins now!',
    'Build up your inventory with free crates and rewards.',
    'Claim your free spins and grab the discounts before everyone else.',
  ])('catches soft ad: %s', (t) => {
    expect(fire(t)).toBe(true);
  });

  // CONTROL SET — these MUST stay clean (no commercial/loot noun = no fire).
  it.each([
    'grab a coffee with me later?',
    'I finally have some free time tomorrow',
    'head over to my place after work',
    'the museum had free entry today, so nice',
    'can you grab the deals section of the newspaper for me',
    'I love building up my savings every month',
    'we should grab dinner this weekend',
    'free at last, work is finally done',
  ])('does NOT fire on innocent control: %s', (t) => {
    expect(fire(t)).toBe(false);
  });
});
