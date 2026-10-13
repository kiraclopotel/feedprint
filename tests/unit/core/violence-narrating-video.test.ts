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

// A death shown or narrated as it happens (the Tester's full test, 12 Oct 2026: a Facebook video of a failed resuscitation,
// its caption naming it, was left unmarked). Phrasings that put the death in front of the viewer hide; grief, news and
// first-aid teaching stay.
describe('violence-narrating video — a death as it happens', () => {
  const hide = [
    'Failed resuscitation: a man dies in front of the crew',
    'Paramedics try CPR on the street, failed CPR after ten minutes',
    'Dies on camera after the crash, shocking footage',
    'The moment he died, caught on video',
    'Death caught on camera at the crossing',
    'A dying man begs for help while people film',
    'She takes her last breath in the ambulance',
    'Fatal stabbing at the market, footage inside',
    'Dead body found floating near the pier, video',
  ];
  for (const t of hide) {
    it(`hides: ${t.slice(0, 50)}`, () => {
      expect(detectViolenceNarratingVideo(t).triggered).toBe(true);
    });
  }

  const pass = [
    'Rest in peace grandad, he died last spring and we miss him',
    'How to do CPR: a first aid class for beginners',
    'The patient was resuscitated at the hospital and recovered',
    'According to police, the fatal crash happened at dawn',
    'My phone died in the middle of the match',
    'The battery is dying, charge it before the trip',
    'This song is dead on arrival, honestly',
    'Death Stranding gameplay: boss fight',
  ];
  for (const t of pass) {
    it(`passes: ${t.slice(0, 50)}`, () => {
      expect(detectViolenceNarratingVideo(t).triggered).toBe(false);
    });
  }
});
