// @vitest-environment jsdom
//
// Shared hide-marking helper (wiring Q33/Q11): every engagement hide site
// routes through markHidden so a vanished element always carries
// data-fw-block-reason naming its circuit, exactly once, with one counter
// tick per first marking.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/storage/settings', () => ({
  incrementMetricsHidden: vi.fn(() => Promise.resolve()),
}));

import {
  markHidden, unmarkHidden, countHiddenFor, BLOCK_REASON_ATTR, __flushHiddenCountForTest,
} from '../../../../src/content/engagement/mark-hidden';
import { incrementMetricsHidden } from '../../../../src/storage/settings';

beforeEach(() => {
  __flushHiddenCountForTest();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

describe('markHidden', () => {
  it('stamps marker + reason and counts once, written as one batch', () => {
    const el = document.createElement('div');
    const first = markHidden(el, { marker: 'data-fw-x', value: 'hidden', reason: 'feature:detail' });
    expect(first).toBe(true);
    expect(el.getAttribute('data-fw-x')).toBe('hidden');
    expect(el.getAttribute(BLOCK_REASON_ATTR)).toBe('feature:detail');

    const second = markHidden(el, { marker: 'data-fw-x', value: 'hidden', reason: 'feature:detail' });
    expect(second).toBe(false);

    // Hides are batched (2026-09-03): one storage write per second, not one
    // per element. Nothing is written until the window closes.
    expect(incrementMetricsHidden).not.toHaveBeenCalled();
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).toHaveBeenCalledTimes(1);
    // The per-switch tally rides the same write, keyed by the reason's
    // feature prefix.
    expect(incrementMetricsHidden).toHaveBeenCalledWith(1, { feature: 1 });
  });

  it('tallies under `feature` when given, else the reason prefix', () => {
    const a = document.createElement('div');
    markHidden(a, { marker: 'data-fw-x', value: 'hidden', reason: 'word-filter:slur', feature: 'slurs' });
    const b = document.createElement('div');
    markHidden(b, { marker: 'data-fw-x', value: 'hidden', reason: 'word-filter:word' });
    const c = document.createElement('div');
    markHidden(c, { marker: 'data-fw-x', value: 'hidden', reason: 'block-ads:feed-ad', count: 3 });
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).toHaveBeenCalledWith(5, { slurs: 1, 'word-filter': 1, 'block-ads': 3 });
  });

  it('countHiddenFor with hides=false moves the switch tally but not the total', () => {
    countHiddenFor('no-swearing', 4, false);
    countHiddenFor('block-reels');
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).toHaveBeenCalledWith(1, { 'no-swearing': 4, 'block-reels': 1 });
  });

  it('count: 0 marks without counting; count: N adds N to the batch', () => {
    const a = document.createElement('div');
    markHidden(a, { marker: 'data-fw-x', value: 'true', reason: 'r', count: 0 });
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).not.toHaveBeenCalled();

    const b = document.createElement('div');
    markHidden(b, { marker: 'data-fw-x', value: 'true', reason: 'r', count: 7 });
    const c = document.createElement('div');
    markHidden(c, { marker: 'data-fw-x', value: 'true', reason: 'r' });
    __flushHiddenCountForTest();
    expect(incrementMetricsHidden).toHaveBeenCalledTimes(1);
    expect(incrementMetricsHidden).toHaveBeenCalledWith(8, { r: 8 });
  });

  it('unmarkHidden clears marker and reason', () => {
    const el = document.createElement('div');
    markHidden(el, { marker: 'data-fw-x', value: 'hidden', reason: 'r' });
    unmarkHidden(el, 'data-fw-x');
    expect(el.getAttribute('data-fw-x')).toBeNull();
    expect(el.getAttribute(BLOCK_REASON_ATTR)).toBeNull();
  });
});

// Coverage lock: every engagement hide site must stamp a reason. Scans the
// engagement modules for direct marker writes that bypass markHidden.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ENGAGEMENT_DIR = 'src/content/engagement';

describe('no engagement hide site bypasses the reason stamp', () => {
  it('hide-marker writes go through markHidden (allowlisted exceptions only)', () => {
    const dir = join(process.cwd(), ENGAGEMENT_DIR);
    // Sites with their own reason stamp (ai-content/reels blockers) or
    // non-hide state markers (pass / rewrite-discovered / neutral states,
    // secondary same-value stamps).
    const allowed = new Set([
      'ai-content-blocker.ts', 'reels-blocker.ts', 'media-timeout.ts',
      'mark-hidden.ts',
    ]);
    const offenders: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts') || allowed.has(f)) continue;
      const src = readFileSync(join(dir, f), 'utf8');
      // A direct "set the hide marker to hidden/true" assignment outside
      // markHidden. Neutral-state writes ('pass', 'rewrite-discovered',
      // 'neutralized' via helper already) are not hides.
      const direct = src.match(/dataset\.fw\w+ = '(?:hidden|true)'/g) ?? [];
      // btn secondary stamp in facebook-engagement rides the wrapper's
      // markHidden call; allow exactly that pattern.
      const filtered = direct.filter(m => !src.includes(`btn.${m}`));
      if (filtered.length > 0) offenders.push(`${f}: ${filtered.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
