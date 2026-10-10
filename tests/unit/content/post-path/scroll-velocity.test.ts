// @vitest-environment jsdom
//
// ScrollVelocityTracker — §CK Phase 2 (S1) 2026-05-03 unit tests.
//
// Verifies: pre-start zero, post-start zero before scroll, single-event
// EMA contribution, multi-event convergence, idle decay, dt-skip clamp,
// dt=0 idempotence, scroll-up symmetry. The shipped module's hot path is
// the passive scroll listener + a side-effect-free getCurrentVelocity()
// decay-on-read; both surfaces are exercised here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScrollVelocityTracker } from '../../../../src/content/post-path/scroll-velocity';

describe('ScrollVelocityTracker', () => {
  let now: number;
  let scrollY: number;
  let tracker: ScrollVelocityTracker;

  beforeEach(() => {
    now = 1_000_000;
    scrollY = 0;
    tracker = new ScrollVelocityTracker({
      nowFn: () => now,
      scrollYFn: () => scrollY,
    });
  });

  afterEach(() => {
    tracker.stop();
  });

  it('reports 0 before start()', () => {
    expect(tracker.getCurrentVelocity()).toBe(0);
  });

  it('reports 0 immediately after start (no scroll yet)', () => {
    tracker.start();
    expect(tracker.getCurrentVelocity()).toBe(0);
  });

  it('start() is idempotent (multiple calls add a single listener)', () => {
    tracker.start();
    tracker.start();
    tracker.start();
    // Single listener still wired — one event still updates state
    now += 100;
    scrollY = 200;
    window.dispatchEvent(new Event('scroll'));
    expect(tracker.getCurrentVelocity()).toBeGreaterThan(0);
  });

  it('stop() resets state and detaches the listener', () => {
    tracker.start();
    now += 100;
    scrollY = 200;
    window.dispatchEvent(new Event('scroll'));
    expect(tracker.getCurrentVelocity()).toBeGreaterThan(0);

    tracker.stop();
    expect(tracker.getCurrentVelocity()).toBe(0);

    // After stop, scroll events are no-op
    now += 100;
    scrollY = 1000;
    window.dispatchEvent(new Event('scroll'));
    expect(tracker.getCurrentVelocity()).toBe(0);
  });

  it('a single scroll event produces a non-zero velocity reading', () => {
    tracker.start();
    now += 100;
    scrollY = 200; // 200px / 100ms = 2000 px/s instant
    window.dispatchEvent(new Event('scroll'));
    // alpha = 1 - exp(-100/2000) ≈ 0.0488
    // velocityEma = 0.0488 * 2000 + 0.9512 * 0 ≈ 97.6
    const v = tracker.getCurrentVelocity();
    expect(v).toBeGreaterThan(50);
    expect(v).toBeLessThan(150);
  });

  it('sustained fast scroll converges toward instantaneous velocity', () => {
    tracker.start();
    // 50 ticks × 100ms × 100px = 1000 px/s sustained for 5s (2.5 τ)
    for (let i = 0; i < 50; i++) {
      now += 100;
      scrollY += 100;
      window.dispatchEvent(new Event('scroll'));
    }
    const v = tracker.getCurrentVelocity();
    // After 2.5 τ at 1000 px/s: EMA convergence ≈ 1000 * (1 - exp(-2.5)) ≈ 918
    expect(v).toBeGreaterThan(800);
    expect(v).toBeLessThan(1100);
  });

  it('crosses the skim band threshold (≥500 px/s) under aggressive scroll', () => {
    tracker.start();
    // 200px every 50ms = 4000 px/s instant
    for (let i = 0; i < 30; i++) {
      now += 50;
      scrollY += 200;
      window.dispatchEvent(new Event('scroll'));
    }
    expect(tracker.getCurrentVelocity()).toBeGreaterThan(500);
  });

  it('crosses the scan band threshold (100-500 px/s) under moderate scroll', () => {
    tracker.start();
    // 30px every 100ms = 300 px/s instant
    for (let i = 0; i < 50; i++) {
      now += 100;
      scrollY += 30;
      window.dispatchEvent(new Event('scroll'));
    }
    const v = tracker.getCurrentVelocity();
    expect(v).toBeGreaterThan(100);
    expect(v).toBeLessThan(500);
  });

  it('decays toward 0 after a long pause (idle decay on read)', () => {
    tracker.start();
    // Burst to high velocity
    for (let i = 0; i < 30; i++) {
      now += 50;
      scrollY += 200;
      window.dispatchEvent(new Event('scroll'));
    }
    expect(tracker.getCurrentVelocity()).toBeGreaterThan(500);

    // Long pause — 8s (4 τ) without scroll events
    now += 8_000;
    // exp(-4) ≈ 0.0183 → reported velocity ≈ 0.0183 × prior EMA
    expect(tracker.getCurrentVelocity()).toBeLessThan(50);
  });

  it('clamps pathological dt-skip events to MAX_VELOCITY', () => {
    tracker.start();
    now += 1; // 1ms
    scrollY = 1_000_000; // would be 1B px/s without clamp
    window.dispatchEvent(new Event('scroll'));
    // alpha = 1 - exp(-1/2000) ≈ 0.0005; velocityEma ≈ 0.0005 × 10_000 = 5
    // (MAX_VELOCITY = 10_000 caps the instantaneous, so the EMA stays bounded)
    expect(tracker.getCurrentVelocity()).toBeLessThan(20);
  });

  it('ignores duplicate scroll event at same tick (dt=0 = no update)', () => {
    tracker.start();
    now += 100;
    scrollY = 500;
    window.dispatchEvent(new Event('scroll'));
    const v1 = tracker.getCurrentVelocity();

    // Same now value → dt=0 → second event ignored
    scrollY = 1500;
    window.dispatchEvent(new Event('scroll'));
    const v2 = tracker.getCurrentVelocity();
    expect(v2).toBe(v1);
  });

  it('upward scroll (negative dy) produces positive velocity (absolute speed)', () => {
    tracker.start();
    now += 100;
    scrollY = 500;
    window.dispatchEvent(new Event('scroll'));

    now += 100;
    scrollY = 200; // scrolled up 300px
    window.dispatchEvent(new Event('scroll'));
    expect(tracker.getCurrentVelocity()).toBeGreaterThan(0);
  });
});
