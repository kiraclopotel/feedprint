// @vitest-environment jsdom
//
// M96 hide-chip anomaly instrument: content-free discrimination between the
// traced hypotheses. Two chips over DIFFERENT statuses is the stacked-chips
// geometry (H1); two chips whose anchors share one status is the duplicate-
// container family (H2/H3); a chip over a visible unrevealed anchor is a
// genuine hide loss. Counters ride Copy Diagnostics; sweeps stay silent while
// nothing changes.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sweepHideChips,
  contentFreeHash,
  _resetHideChipProbeForTesting,
} from '../../../../src/content/probes/hide-chip-probe';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';

function chipWithAnchor(statusPath: string, hidden = true): { chip: HTMLElement; anchor: HTMLElement } {
  const chip = document.createElement('div');
  chip.setAttribute('data-fw-hide-notice', 'true');
  const anchor = document.createElement('div');
  anchor.setAttribute('data-fw-hard-hidden', 'true');
  if (hidden) anchor.style.setProperty('display', 'none', 'important');
  const link = document.createElement('a');
  link.setAttribute('href', statusPath);
  anchor.appendChild(link);
  document.body.append(chip, anchor);
  return { chip, anchor };
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetDiagnosticsForTesting();
  _resetHideChipProbeForTesting();
});

describe('hide-chip probe', () => {
  it('hashes are stable and content-free (hex, not the input)', () => {
    const h = contentFreeHash('/user/status/123');
    expect(h).toMatch(/^[0-9a-f]{8}$/);
    expect(h).toBe(contentFreeHash('/user/status/123'));
    expect(h).not.toContain('123');
  });

  it('two chips over DIFFERENT statuses count as coexist + distinct posts', () => {
    chipWithAnchor('/a/status/111');
    chipWithAnchor('/a/status/222');
    sweepHideChips();
    const c = _getDiagnosticCountersForTesting();
    expect(c.m96ChipsCoexist).toBe(1);
    expect(c.m96CoexistDistinctPosts).toBe(1);
    expect(c.m96CoexistSharedPost).toBeUndefined();
  });

  it('two chips whose anchors share one status count as shared post', () => {
    chipWithAnchor('/a/status/333');
    chipWithAnchor('/a/status/333');
    sweepHideChips();
    const c = _getDiagnosticCountersForTesting();
    expect(c.m96ChipsCoexist).toBe(1);
    expect(c.m96CoexistSharedPost).toBe(1);
    expect(c.m96CoexistDistinctPosts).toBeUndefined();
  });

  it('a chip standing over a VISIBLE unrevealed anchor counts as a hide loss', () => {
    chipWithAnchor('/a/status/444', false);
    sweepHideChips();
    expect(_getDiagnosticCountersForTesting().m96ChipOverVisibleUnrevealed).toBe(1);
  });

  it('a chip whose next sibling is not a hard-hidden container counts as an anchor mismatch', () => {
    const chip = document.createElement('div');
    chip.setAttribute('data-fw-hide-notice', 'true');
    document.body.append(chip, document.createElement('div'));
    sweepHideChips();
    expect(_getDiagnosticCountersForTesting().m96ChipAnchorMismatch).toBe(1);
  });

  it('an unchanged page is counted once, not once per sweep', () => {
    chipWithAnchor('/a/status/555');
    chipWithAnchor('/a/status/666');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    sweepHideChips();
    sweepHideChips();
    sweepHideChips();
    expect(_getDiagnosticCountersForTesting().m96ChipsCoexist).toBe(1);
    expect(info).toHaveBeenCalledTimes(1);
    info.mockRestore();
  });
});
