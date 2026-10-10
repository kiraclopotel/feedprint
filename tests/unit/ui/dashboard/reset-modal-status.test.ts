// Reset-chain modal status line + outcome classification (known-issues M40
// UI half + M58 truth rules).
//
// The pre-fix modal used one boolean for BOTH "wrong PIN" and "reset
// failed", so a service-worker reset crash rendered "Wrong PIN" to a parent
// who had typed the correct PIN (M40). M58 adds: a lost response channel is
// UNKNOWN, not failed; a committed reset with failed auxiliary wipes is
// PARTIAL and must name the lagging parts. Locks: all error states map to
// DISTINCT strings in both languages; the classifier names exactly the
// false flags.

import { describe, it, expect } from 'vitest';
import {
  resetModalStatusLine,
  incompleteResetParts,
  resetPartLabel,
  type ResetCleanupFlags,
} from '../../../../src/ui/dashboard/reset-modal-status';
import { DASHBOARD_STRINGS } from '../../../../src/i18n/dashboard-strings';

describe('resetModalStatusLine', () => {
  for (const lang of ['en', 'ro'] as const) {
    const t = DASHBOARD_STRINGS[lang];

    it(`[${lang}] wrong-pin, reset-failed, and reset-unknown render pairwise DISTINCT non-empty messages`, () => {
      const wrongPin = resetModalStatusLine('wrong-pin', false, t);
      const resetFailed = resetModalStatusLine('reset-failed', false, t);
      const resetUnknown = resetModalStatusLine('reset-unknown', false, t);
      expect(wrongPin).toBe(t.wrongPin);
      expect(resetFailed).toBe(t.resetFailed);
      expect(resetUnknown).toBe(t.resetUnknown);
      for (const s of [wrongPin, resetFailed, resetUnknown]) {
        expect(s.length).toBeGreaterThan(0);
      }
      expect(new Set([wrongPin, resetFailed, resetUnknown]).size).toBe(3);
    });

    it(`[${lang}] unknown wording claims no outcome (must not say the reset failed as fact)`, () => {
      // M58(c): a lost channel may follow a COMMITTED reset. The unknown
      // string asks the parent to check, and is not the failed string.
      expect(t.resetUnknown).not.toBe(t.resetFailed);
      expect(t.resetPartial.length).toBeGreaterThan(0);
    });

    it(`[${lang}] error states win over busy; busy shows resetting; idle shows nothing`, () => {
      expect(resetModalStatusLine('reset-failed', true, t)).toBe(t.resetFailed);
      expect(resetModalStatusLine('reset-unknown', true, t)).toBe(t.resetUnknown);
      expect(resetModalStatusLine(null, true, t)).toBe(t.resetting);
      expect(resetModalStatusLine(null, false, t)).toBe('');
    });
  }
});

describe('incompleteResetParts', () => {
  const allClear: ResetCleanupFlags = {
    scanLogCleared: true,
    authorProfilesCleared: true,
    verdictsCleared: true,
    diagnosticsCleared: true,
    usageStatsCleared: true,
    parentFeedbackCleared: true,
    chainAnchorsCleared: true,
  };

  it('clean full success returns no parts', () => {
    expect(incompleteResetParts(allClear)).toEqual([]);
  });

  it('a failed anchor clear is named by its stable flag key (the M58(a) scenario)', () => {
    // DASH-4: this used to return hardcoded English display text
    // ('chain anchors'); it now returns the stable, locale-agnostic flag key
    // so the render site can localize it via resetPartLabel().
    expect(incompleteResetParts({ ...allClear, chainAnchorsCleared: false }))
      .toEqual(['chainAnchorsCleared']);
  });

  it('multiple failed wipes are all named by key', () => {
    const parts = incompleteResetParts({
      ...allClear,
      scanLogCleared: false,
      parentFeedbackCleared: false,
    });
    expect(parts).toContain('scanLogCleared');
    expect(parts).toContain('parentFeedbackCleared');
    expect(parts).toHaveLength(2);
  });
});

// DASH-4 (2026-07-13 dashboard-ui audit): the partial-reset parenthetical
// mixed hardcoded English cleanup-part names into an otherwise-localized
// RO sentence (`t.resetPartial`). An RO-locale parent hitting the M58
// partial-reset path saw a Romanian sentence followed by English words in
// parentheses. Locks: every part key resolves to a non-empty, language-
// distinct label in both EN and RO, and the RO labels carry no leftover
// English text.
describe('resetPartLabel (DASH-4 — cleanup-part i18n parity)', () => {
  const allClear: ResetCleanupFlags = {
    scanLogCleared: true,
    authorProfilesCleared: true,
    verdictsCleared: true,
    diagnosticsCleared: true,
    usageStatsCleared: true,
    parentFeedbackCleared: true,
    chainAnchorsCleared: true,
  };
  const allKeys = Object.keys(allClear) as Array<keyof ResetCleanupFlags>;

  for (const lang of ['en', 'ro'] as const) {
    const t = DASHBOARD_STRINGS[lang];

    it(`[${lang}] every cleanup-part key resolves to a non-empty label`, () => {
      for (const key of allKeys) {
        expect(resetPartLabel(key, t).length).toBeGreaterThan(0);
      }
    });

    it(`[${lang}] all seven part labels are pairwise distinct`, () => {
      const labels = allKeys.map((key) => resetPartLabel(key, t));
      expect(new Set(labels).size).toBe(allKeys.length);
    });
  }

  it('EN and RO produce different text for every part (RO is actually translated, not copied)', () => {
    for (const key of allKeys) {
      expect(resetPartLabel(key, DASHBOARD_STRINGS.en))
        .not.toBe(resetPartLabel(key, DASHBOARD_STRINGS.ro));
    }
  });

  it('the assembled RO partial-reset sentence contains no English part names', () => {
    const parts = incompleteResetParts({ ...allClear, scanLogCleared: false, chainAnchorsCleared: false });
    const t = DASHBOARD_STRINGS.ro;
    const sentence = `${t.resetPartial} (${parts.map((k) => resetPartLabel(k, t)).join(', ')})`;
    expect(sentence).not.toContain('scan log');
    expect(sentence).not.toContain('chain anchors');
    expect(sentence).toContain('jurnal de scanare');
    expect(sentence).toContain('ancore ale lanțului');
  });
});
