// Violence-narrating video gate — precision calibration. The MUST-HIDE set are
// the real cases found (2026-06-04) + synthetics; the MUST-PASS set are the
// sports/gaming/medical/culinary/fitness/news collisions that must NOT be hidden
// (over-blocking is VISION's PRIMARY failure). This test IS the calibration: if
// a benign case trips, tighten the SUPPRESS anchors, not the markers.

import { describe, it, expect } from 'vitest';
import { detectViolenceNarratingVideo } from '../../../src/core/violence-narrating-video';

describe('violence-narrating video — MUST HIDE', () => {
  const hide = [
    // the two real cases from a live feed
    'A young man in China was beaten and forced to perform a PUBG dance',
    'If that guy faces the structural components, his legs are definitely gone',
    // synthetic narration variants
    'Man brutally beaten and forced to dance for a crowd',
    'Worker loses both arms in machine, his limbs are gone',
    'Disturbing footage: woman tortured by gang in broad daylight',
    'He was bludgeoned until he stopped moving',
    // adjacent assault verbs (real case: "CRAZY VIOLENT BUM ... punching, kicking")
    'CRAZY VIOLENT BUM: this is how he started punching, kicking the man',
  ];
  for (const t of hide) {
    it(`hides: ${t.slice(0, 50)}`, () => {
      expect(detectViolenceNarratingVideo(t).triggered).toBe(true);
    });
  }
});

describe('violence-narrating video — MUST PASS (no over-block)', () => {
  const pass = [
    // sports
    'We beat them 3-0, what a match',
    'Brutal injury-time winner in the championship',
    'He got destroyed in the boxing ring last night',
    'The team got beaten badly, terrible league form',
    // gaming
    'I killed the final boss after 30 tries',
    'This raid boss beaten me every single time',
    'That level destroyed me, had to respawn',
    // medical / recovery
    'My ACL surgery recovery is going well, leg was wrecked',
    'Broken bones healing nicely after the hospital visit',
    // fitness / figurative fatigue
    'My legs are gone after that run honestly',
    'Legs gone after leg day at the gym',
    // culinary
    'Beat the eggs until fluffy, then bake',
    'Beaten egg whites are the secret to this recipe',
    // news/journalism (reporting, not glorifying)
    'According to police, the suspect was beaten during the arrest',
    // single assault verb in benign/idiomatic use (must not trip the collocation)
    'Kicking off the new season with a bang',
    'He keeps punching above his weight in this league',
    // benign / cute
    'My dog destroyed his new toy in 5 minutes lol',
  ];
  for (const t of pass) {
    it(`passes: ${t.slice(0, 50)}`, () => {
      expect(detectViolenceNarratingVideo(t).triggered).toBe(false);
    });
  }
});
