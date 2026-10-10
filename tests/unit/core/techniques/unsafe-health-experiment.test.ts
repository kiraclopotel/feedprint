import { describe, it, expect } from 'vitest';
import { unsafeHealthExperimentClassifier } from '../../../../src/core/techniques/unsafe-health-experiment';
import { aggregateSeverity } from '../../../../src/core/severity';

function classify(text: string) {
  return unsafeHealthExperimentClassifier.classify({ text });
}

describe('unsafe-health-experiment classifier', () => {
  it('detects overdose + superpower framing', () => {
    const r = classify('She overdosed on zinc and unlocked a superpower');
    expect(r.present).toBe(true);
    expect(r.severity).toBeGreaterThanOrEqual(3);
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it('detects megadose challenge framing', () => {
    const r = classify('Try taking huge amounts of vitamin D for insane focus');
    expect(r.present).toBe(true);
  });

  it('detects "overdosed on zinc" without explicit reward but still flags', () => {
    const r = classify('I overdosed on zinc and got a heightened sense of smell');
    expect(r.present).toBe(true);
  });

  it('suppresses educational / warning content', () => {
    const r = classify('Do not overdose on zinc; it can be dangerous and harmful to your health');
    expect(r.present).toBe(false);
  });

  it('passes ordinary supplement discussion', () => {
    const r = classify('I took my prescribed zinc as directed by my doctor');
    expect(r.present).toBe(false);
  });

  it('passes benign health content', () => {
    const r = classify('Zinc is an essential mineral for immune function');
    expect(r.present).toBe(false);
  });

  it('detects explicit experimentation promotion with reward framing', () => {
    const r = classify('I took 10 times the recommended dose of melatonin and got superhuman sleep powers');
    expect(r.present).toBe(true);
  });
});

describe('unsafe-health-experiment Romanian patterns', () => {
  it('detects Romanian overdose + superpower framing', () => {
    const r = classify('am făcut supradoză de zinc și am primit superputeri');
    expect(r.present).toBe(true);
    expect(r.severity).toBeGreaterThanOrEqual(3);
  });

  it('detects reflexive Romanian overdose form', () => {
    const r = classify('m-am supradozat cu zinc și am simțit că am superputeri');
    expect(r.present).toBe(true);
  });

  it('detects Romanian "take lots of X for powers" framing', () => {
    const r = classify('dacă iei doze mari de zinc îți dă superputeri');
    expect(r.present).toBe(true);
  });

  it('detects Romanian supplement challenge framing', () => {
    const r = classify('ia mult zinc ca să ai energie incredibilă');
    expect(r.present).toBe(true);
  });

  it('detects Romanian overdose-as-experiment', () => {
    const r = classify('supradoză de vitamine ca experiment pentru puteri');
    expect(r.present).toBe(true);
  });

  it('suppresses Romanian warning content to low severity', () => {
    const r = classify('nu fa supradoză de zinc, supradoza este periculoasă și dăunătoare');
    expect(r.severity).toBeLessThanOrEqual(3);
  });

  it('suppresses Romanian prescribed usage', () => {
    const r = classify('am luat zinc prescris de medic conform prospectului');
    expect(r.present).toBe(false);
  });

  it('suppresses Romanian side-effect discussion', () => {
    const r = classify('efecte adverse ale supradozei de zinc sunt periculoase');
    expect(r.present).toBe(false);
  });

  it('passes Romanian normal supplement discussion', () => {
    const r = classify('zincul este un mineral esențial pentru imunitate');
    expect(r.present).toBe(false);
  });
});

describe('unsafe-health-experiment severity', () => {
  it('a present detection aggregates to its own severity; a pass aggregates to 0', () => {
    const hit = classify('She overdosed on zinc and unlocked a superpower');
    expect(aggregateSeverity([hit])).toBe(hit.severity);
    const r = classify('I take zinc daily as recommended');
    expect(r.present).toBe(false);
    expect(aggregateSeverity([r])).toBe(0);
  });
});
