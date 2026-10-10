// @vitest-environment jsdom
//
// Dashboard freshness wiring (source-lock idiom, same as
// dashboard-load-failed.test.ts).
//
// Q20: the passive refresh used to replace `records` while keeping the old
// `integrity` verdict, so the green "verified" shield covered records the
// walk never saw. The refresh branch that applies a grown record set must
// also drop both integrity verdicts.
//
// Q22: the storage listener used to watch only uiLanguage; a parent flipping
// hide-engagement-metrics in the popup left an open dashboard rendering
// engagement numbers until manual reload. The listener must cover features
// and dashboardTheme too.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

// Source-read paths, hoisted so a decomposition step re-points one line. The
// shell holds load()/refresh/storage-listener wiring.
const DASHBOARD_SHELL = 'src/ui/dashboard/Dashboard.tsx';
const FEED_CARD = 'src/ui/dashboard/components/FeedCard.tsx';

const source = readSource(DASHBOARD_SHELL);

describe('Q20 — stale integrity verdict cleared on record growth', () => {
  it('the passive-refresh branch that setRecords also clears both verdicts', () => {
    const refreshBlock = source.match(
      /if \(recordTip\(recs\) === lastRecordTipRef\.current\) return;[\s\S]{0,900}/,
    )?.[0] ?? '';
    expect(refreshBlock).toContain('setRecords(recs)');
    expect(refreshBlock).toContain('setIntegrity(null)');
    expect(refreshBlock).toContain('setCrossMonth(null)');
  });
});

describe('Q25 — perf wiring', () => {
  // The search debounce (the record predicate reads the debounced value, so
  // the trust line narrows only after 150 ms) is a behavior test on the
  // mounted tab: tests/unit/ui/dashboard/components/activity-tab-render.test.ts.

  it('the Issues tab receives the existing integrity verdict as a prop', () => {
    expect(source).toContain('<OperationalTab integrity={integrity} />');
  });

  // The offsets-cache lock (recompute reuses cached offsets across scroll
  // frames; only a height change or a new row set rebuilds) is a behavior
  // test in tests/unit/ui/dashboard/components/use-virtual-scroll.test.ts.
});

describe('Q21 — attestation reaches the feed (source-lock)', () => {
  const feedCard = readSource(FEED_CARD);

  it('FeedCard renders enabledFeatures chips and the settings-read-failed note', () => {
    expect(feedCard).toContain('configSnapshot.enabledFeatures.map');
    expect(feedCard).toContain('feedProtectionsAtCapture');
    expect(feedCard).toContain("configSnapshot?.settingsReadFailed === true");
  });

  it('system markers render the compact line AFTER all hooks', () => {
    const lastHook = feedCard.lastIndexOf('React.useState');
    // W47: the triple-kind literal became the shared isSystemMarkerRecord
    // predicate (forensics/system-records.ts); the after-hooks contract is
    // unchanged.
    const markerReturn = feedCard.indexOf('if (isMarker(record))');
    expect(markerReturn).toBeGreaterThan(lastHook);
    expect(feedCard).toContain('feedMarkerPrune');
  });
});

describe('Q22 — storage listener watches the keys the dashboard renders', () => {
  it('reacts to features and dashboardTheme, not only uiLanguage', () => {
    expect(source).toMatch(
      /changes\.uiLanguage \|\| changes\.features \|\| changes\.dashboardTheme/,
    );
  });
});
