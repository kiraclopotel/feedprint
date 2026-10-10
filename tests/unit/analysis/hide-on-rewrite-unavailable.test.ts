// hideOnRewriteUnavailable, since 2026-09-07: a confirmed flag whose rewrite
// is unavailable is folded in Child only. In Teen and Adult it stays a visible
// mark: a rewrite failure never becomes a hide (docs/design/
// POLICY-TABLE-2026-09-07.md, invariant 2). The former toggle and the strict-
// language implication are gone with their reason: swearing is masked in place
// and needs no rewrite.

import { describe, it, expect } from 'vitest';
import { hideOnRewriteUnavailable } from '../../../src/analysis/pipeline';

describe('hideOnRewriteUnavailable', () => {
  it('off in teen and adult: the flag stays a visible mark', () => {
    expect(hideOnRewriteUnavailable('teen')).toBe(false);
    expect(hideOnRewriteUnavailable('adult')).toBe(false);
  });

  it('on in Child: the fail-closed fold until the table chooses the Child cell', () => {
    expect(hideOnRewriteUnavailable('child')).toBe(true);
  });

  it('takes the mode alone: no toggle and no strict-language implication remain', () => {
    expect(hideOnRewriteUnavailable.length).toBe(1);
  });
});
