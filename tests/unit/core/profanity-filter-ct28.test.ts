// Adversarial-bypass coverage: Cyrillic substitution + zero-width characters.
//
// Tests:
//   1. Cyrillic-substitution evasion blocked — `nіgga` (Cyrillic і),
//      `nіggеr` (mixed), `fаggоt` (Cyrillic а + о) all match.
//   2. Zero-width-space evasion blocked — `nig​ga` matches.
//   3. Existing leetspeak path preserved (regression check).

import { describe, it, expect } from 'vitest';
import { filterProfanity } from '../../../src/core/profanity-filter';

describe('adversarial bypass — Cyrillic substitution', () => {
  it('blocks `nіgga` (Cyrillic і U+0456 instead of Latin i)', () => {
    const r = filterProfanity('nіgga', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('blocks `nіggеr` (Cyrillic і + Cyrillic е)', () => {
    const r = filterProfanity('nіggеr', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('blocks `fаggоt` (Cyrillic а + Cyrillic о)', () => {
    const r = filterProfanity('fаggоt', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('blocks `fuсk` (Cyrillic с)', () => {
    const r = filterProfanity('fuсk you', 'child', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
  });
});

describe('adversarial bypass — zero-width characters', () => {
  it('blocks `nig\\u200Bga` (zero-width space)', () => {
    const r = filterProfanity('nig​ga', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('blocks `n\\u200Cigger` (ZWNJ at start)', () => {
    const r = filterProfanity('n‌igger', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('blocks `f\\uFEFFuck` (BOM mid-word)', () => {
    const r = filterProfanity('f﻿uck', 'child', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
  });
});

describe('regression — existing leetspeak still works', () => {
  it('matches `r3tarded` via leetspeak normalize', () => {
    const r = filterProfanity('total r3tarded move', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('matches `f4ggot` via leetspeak normalize', () => {
    const r = filterProfanity('f4ggot', 'teen', { tier: 'slurs' });
    expect(r.filtered).toBe(true);
  });

  it('matches `pussy` (no leetspeak — exact dict)', () => {
    const r = filterProfanity('pussy', 'child', { tier: 'profanity' });
    expect(r.filtered).toBe(true);
  });
});
