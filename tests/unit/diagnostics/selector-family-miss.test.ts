// @vitest-environment jsdom
//
// Q31 — selector-family miss diagnostics. A zero-match sweep for an enabled
// feature must record ONE selector-health miss per (label, pathname), so
// platform DOM rotations stop failing silently without flooding the
// counters on the sub-second sweep cadence. Since 2026-09-03 the miss is a
// counter only: no console.warn, because Chrome lists content-script
// warnings under the extension's Errors button and the owner read them as
// breakage.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/diagnostics/selector-health', () => ({
  recordSelectorMiss: vi.fn(),
  recordSelectorHit: vi.fn(),
}));

import {
  noteSelectorFamilySweep,
  __resetSelectorFamilyMissStateForTest,
} from '../../../src/content/engagement/selector-family-miss';
import { recordSelectorMiss, recordSelectorHit } from '../../../src/diagnostics/selector-health';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  __resetSelectorFamilyMissStateForTest();
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  history.replaceState({}, '', '/watch');
});

describe('noteSelectorFamilySweep', () => {
  it('records one miss per label+path, not per sweep tick', () => {
    noteSelectorFamilySweep('youtube.engagement-metrics', 0);
    noteSelectorFamilySweep('youtube.engagement-metrics', 0);
    noteSelectorFamilySweep('youtube.engagement-metrics', 0);
    expect(recordSelectorMiss).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a hit clears the throttle so a later rotation reports again', () => {
    noteSelectorFamilySweep('label', 0);
    noteSelectorFamilySweep('label', 5);
    noteSelectorFamilySweep('label', 0);
    expect(recordSelectorMiss).toHaveBeenCalledTimes(2);
  });

  it('a new pathname reports again', () => {
    noteSelectorFamilySweep('label', 0);
    history.replaceState({}, '', '/shorts/x');
    noteSelectorFamilySweep('label', 0);
    expect(recordSelectorMiss).toHaveBeenCalledTimes(2);
  });

  // ── W88 instrument honesty ────────────────────────────────────────────
  // Owner diagnostics 2026-08-18 read "0 primary / 100% miss" for the
  // youtube.engagement-metrics + youtube.action-buttons families while a
  // live /watch probe showed the selectors matching. Root cause: this
  // instrument recorded ONLY misses — a family that matched on every sweep
  // still showed zero primary hits, so the health surface could never
  // distinguish "healthy family" from "family that never ran". A sweep with
  // matches now records one primary hit per (label, pathname), same
  // throttle shape as the miss side.

  it('matches above zero record one primary hit per label+path, not per sweep tick', () => {
    noteSelectorFamilySweep('label', 3);
    noteSelectorFamilySweep('label', 5);
    noteSelectorFamilySweep('label', 2);
    expect(recordSelectorHit).toHaveBeenCalledTimes(1);
    expect(recordSelectorHit).toHaveBeenCalledWith('label', 0);
    expect(recordSelectorMiss).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a hit on a new pathname records again', () => {
    noteSelectorFamilySweep('label', 3);
    history.replaceState({}, '', '/shorts/x');
    noteSelectorFamilySweep('label', 3);
    expect(recordSelectorHit).toHaveBeenCalledTimes(2);
  });

  it('a miss clears the hit throttle so recovery on the same path reports again', () => {
    noteSelectorFamilySweep('label', 3);
    noteSelectorFamilySweep('label', 0);
    noteSelectorFamilySweep('label', 4);
    expect(recordSelectorHit).toHaveBeenCalledTimes(2);
    expect(recordSelectorMiss).toHaveBeenCalledTimes(1);
  });
});
