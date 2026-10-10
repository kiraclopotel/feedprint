// @vitest-environment jsdom
//
// Dashboard load-failure honesty. A failed load — IDB corruption, quota, the
// signing-metadata handshake not acknowledged — used to land on records=[] and
// render the first-run welcome ("Nothing recorded yet"): a parent whose
// evidence store could not be READ was told the record was EMPTY. These lock
// the rule the store module states in getRecords(): a failed read is not an
// empty chain, and no surface may render it as one. The popup already has a
// loadFailed/retry shell; the dashboard follows the same idiom.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { feedEmptyKind } from '../../../../../src/ui/dashboard/components/activity-filters';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';

describe('feedEmptyKind', () => {
  it('a failed read outranks everything — never the welcome, never "no matches"', () => {
    // With nothing read, neither "nothing recorded yet" nor "no records match"
    // is a statement the feed can honestly make.
    expect(feedEmptyKind(false, true)).toBe('load-failed');
    expect(feedEmptyKind(true, true)).toBe('load-failed');
  });

  it('welcome only when the store was actually read and is genuinely empty', () => {
    expect(feedEmptyKind(false, false)).toBe('welcome');
  });

  it('an active narrowing renders the filtered-empty body, not the welcome', () => {
    expect(feedEmptyKind(true, false)).toBe('filtered');
  });
});

// Source scan (same pattern as i18n.test.ts / public-copy-claims.test.ts):
// the wiring that keeps the classification honest must stay in place.
// The load() catch lives in the shell; its path is a constant so a
// decomposition step re-points one line.
const DASHBOARD_SHELL = 'src/ui/dashboard/Dashboard.tsx';

describe('Dashboard load-failure wiring', () => {
  const dashboardSource = readFileSync(join(process.cwd(), DASHBOARD_SHELL), 'utf8');

  it('the load() catch flags the failure instead of landing on the welcome state', () => {
    expect(dashboardSource).toContain('setLoadFailed(true)');
  });

  // That the feed renders the failure copy with a working retry action (and
  // never the welcome) is a behavior test on the mounted tab:
  // tests/unit/ui/dashboard/components/activity-tab-render.test.ts.
});

describe('load-failure strings', () => {
  it('exist in both languages and are actually translated', () => {
    for (const key of ['loadFailedTitle', 'loadFailedBody', 'retry'] as const) {
      expect(DASHBOARD_STRINGS.en[key].length, `en.${key}`).toBeGreaterThan(0);
      expect(DASHBOARD_STRINGS.ro[key].length, `ro.${key}`).toBeGreaterThan(0);
      expect(DASHBOARD_STRINGS.ro[key], `ro.${key} untranslated`).not.toBe(DASHBOARD_STRINGS.en[key]);
    }
  });
});
