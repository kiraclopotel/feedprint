// The free popup painted its whole unlocked body before asking whether to lock.
//
// `locked` started at `false`, which is an answer and the wrong one. The load
// effect called `reload()` first, and that sets `settings`, which ends the
// loading branch, so the switch grid, the mode segments and the rules editor
// all committed and became interactive. Only afterwards did it read settings
// again and wait on `isPinGraceActive()` before deciding. A child had the
// unlocked popup for the length of that decision.
//
// The paid popup does not do this: it stays on its main screen and navigates
// only on success.
//
// Two more holes in the same six lines. `getSettings().catch(() => null)` left
// the popup open for good on a thrown read, not briefly. And since the
// fail-closed snapshot reports `parentPin: ''` whether or not a PIN is set
// (M324), an unreadable snapshot also read as "no PIN, nothing to lock".
//
// Found 2026-09-19 by a read-only scan of the child-safety promise, verified
// against the state, the effect and the render branch.
//
// This is a source read: the decision lives in an effect over two awaits, and
// what matters is the order of the three lines, which no render can show.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../helpers/read-source';

const popup = (): string => readSource('src/products/off/popup/OffPopup.tsx');

describe('the free popup decides before it paints (2026-09-19)', () => {
  it('undecided is its own state, not open', () => {
    expect(popup()).toContain('useState<boolean | null>(null)');
  });

  it('nothing renders until both the settings and the lock are known', () => {
    expect(popup(), 'the loading branch holds for either').toContain('if (!settings || locked === null) {');
  });

  it('the lock is decided before the settings are published', () => {
    const src = popup();
    const decided = src.indexOf('setLocked(true);');
    const published = src.indexOf('await reload();', decided);
    expect(decided, 'the decision is in the load effect').toBeGreaterThan(0);
    expect(published, 'and reload follows it').toBeGreaterThan(decided);
  });

  it('a read it could not make locks, rather than opening', () => {
    const src = popup();
    expect(src).toContain('if (s === null || parentPinUnknown(s)) {');
    // The old shape: a thrown read fell through every branch and left the
    // popup open for the rest of its life.
    expect(src).not.toContain("const s = await getSettings().catch(() => null);\n      if (s?.parentPin) {");
  });

  it('a real install with no PIN still opens, or this locks a parent out', () => {
    // The other side. Turning "unknown" into "locked" is only safe while
    // "known and absent" stays open.
    expect(popup()).toContain('setLocked(false);');
  });
});
