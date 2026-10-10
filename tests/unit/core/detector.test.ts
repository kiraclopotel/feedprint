import { describe, it, expect } from 'vitest';
import { detect } from '../../../src/core/detector';

describe('detector', () => {
  it('returns 20 technique results for any input', () => {
    // Phase 1 (9) + Phase 2 youth-specific (4) + Phase 3 combined-stack +
    // 6 harm categories (7) + the separate `combined` aggregator = 21.
    const results = detect('Hello world');
    expect(results).toHaveLength(21);
    const names = results.map(r => r.technique);
    expect(names).toContain('fear-appeal');
    expect(names).toContain('shame-attack');
    expect(names).toContain('anger-trigger');
    expect(names).toContain('false-urgency');
    expect(names).toContain('bandwagon');
    expect(names).toContain('scapegoating');
    expect(names).toContain('fomo');
    expect(names).toContain('toxic-positivity');
    expect(names).toContain('misleading-format');
    expect(names).toContain('combined');
    // Phase 2 — youth-specific.
    expect(names).toContain('body-comparison-priming');
    expect(names).toContain('parasocial-coercion');
    expect(names).toContain('consumer-rapid-frame');
    expect(names).toContain('hyperreal-trauma-bait');
    // Phase 3 — combined-stack + 5 harm categories.
    expect(names).toContain('combined-stack');
    expect(names).toContain('sexual');
    expect(names).toContain('violence-graphic');
    expect(names).toContain('self-harm');
    expect(names).toContain('drug-promotion');
    expect(names).toContain('unsafe-health-experiment');
    expect(names).toContain('extreme-toxicity');
  });

  it('returns all not-present for benign text', () => {
    const results = detect('I had a lovely breakfast this morning');
    const present = results.filter(r => r.present);
    expect(present).toHaveLength(0);
  });

  it('detects shame-attack and misleading-format in test tweet', () => {
    const results = detect(
      "You're DISGUSTING if you don't have a beach body by summer. NO EXCUSES."
    );
    const present = results.filter(r => r.present);
    const names = present.map(r => r.technique);
    expect(names).toContain('shame-attack');
    expect(names).toContain('misleading-format');
  });

  // A skipped case stood here until 2026-09-16 (PLAN-2026-09-16 item 7.1). It predated DEC-008,
  // which fires `combined` only on three distinct techniques at severity 5 or more with independent
  // evidence; its fixture could not meet that bar without brittle regex tuning. The rule it meant to
  // cover is tested directly in tests/unit/core/techniques/combined.test.ts and end to end through the pipeline, so
  // the case was carrying its own rationale and nothing else.

  it('combined does not trigger with fewer than 3 techniques', () => {
    const results = detect(
      "You're DISGUSTING if you don't have a beach body by summer. NO EXCUSES."
    );
    const combined = results.find(r => r.technique === 'combined')!;
    expect(combined.present).toBe(false);
  });

  it('returns results with correct shape', () => {
    const results = detect('test text');
    for (const r of results) {
      expect(r).toHaveProperty('technique');
      expect(r).toHaveProperty('present');
      expect(r).toHaveProperty('confidence');
      expect(r).toHaveProperty('severity');
      expect(r).toHaveProperty('evidence');
      expect(typeof r.present).toBe('boolean');
      expect(typeof r.confidence).toBe('number');
      expect(typeof r.severity).toBe('number');
      expect(Array.isArray(r.evidence)).toBe(true);
    }
  });

  it('runs fast enough for typical tweet-length text to stay on the hot path', () => {
    // A single timed call against a 5 ms wall clock made this the flakiest
    // test in the suite: it failed twice in one session on an otherwise green
    // run, purely from scheduling noise on a loaded machine, and a test that
    // cries wolf gets ignored right when it matters.
    //
    // What the guard is actually for is that `detect` stays a cheap
    // synchronous regex pass rather than quietly growing into something the
    // content script cannot afford per post. Amortising over many runs and
    // taking the MEDIAN measures that property and is immune to one unlucky
    // slice; the bound is per-call, so it still catches a real regression.
    const text = 'This is a normal tweet about my day, nothing special happening here.';
    detect(text); // warm-up: exclude first-call JIT and regex compilation

    const RUNS = 200;
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) {
      const start = performance.now();
      detect(text);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(RUNS / 2)];

    expect(median).toBeLessThan(5);
  });
});
