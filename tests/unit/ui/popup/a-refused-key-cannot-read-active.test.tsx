// A key the server refused must not read as an active one, anywhere on the
// popup. Found 2026-09-20 on the owner's own install: a refund had revoked his
// founder key server-side, and the popup showed, on one screen at the same
// time, the pill "Active", the line "338 AI calls today - unlimited (founder)",
// and a red card saying the server did not accept the key.
//
// The cause is a split source of truth that is correct on both sides. The TIER
// is parsed out of the key text (src/storage/license.ts, `fw-<tier>-<secret>`),
// so any well-shaped key resolves to its tier offline, which is what lets the
// extension work before the first probe answers. ACCEPTANCE comes from the
// proxy. POP-5 noticed the mismatch in 2026 and added the red card; it left the
// claim the card contradicts standing, which is the shape this repository keeps
// meeting: a true correction printed beside a false headline.
//
// Both controls below are the point of the file. A fix that simply stopped
// printing the founder line would pass the first half and fail the second.

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import { HomeTab, KeysTab } from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import type { FWSettings } from '../../../../src/storage/settings';
import type { LicenseInfo } from '../../../../src/storage/license';

const settingsStub = {
  mode: 'adult',
  dailyCap: 2000,
  totalChecksToday: 338,
  totalNeutralizedToday: 48,
  totalNeutralizedAllTime: 48,
  metricsHiddenToday: 3,
  metricsHiddenAllTime: 3,
  totalChecksAllTime: 338,
  uiLanguage: 'en',
} as unknown as FWSettings;

// A founder-tier key, the shape the refund took down.
const FOUNDER: LicenseInfo = { tier: 'dev', secret: 'handminted1' };

type Probe = 'ok' | 'revoked' | 'unknown' | null;

// An accepted key's count opens the License tab since 9 Oct 2026 (his word: a clean Home).
function renderKeyCount(license: LicenseInfo, probeResult: Probe) {
  return renderToString(createElement(I18nProvider, {
    lang: 'en',
    children: createElement(KeysTab, { settings: settingsStub, license, probeResult, onChange: async () => {} }),
  }));
}

function renderHome(license: LicenseInfo, probeResult: Probe, lang: 'en' | 'ro' = 'en') {
  return renderToString(
    createElement(I18nProvider, {
      lang,
      children: createElement(HomeTab, {
        settings: settingsStub,
        license,
        probeResult,
        onOpenDashboard: () => {},
        onOpenDashboardSection: () => {},
      }),
    }),
  );
}

function renderKeys(license: LicenseInfo, probeResult: Probe, lang: 'en' | 'ro' = 'en') {
  return renderToString(
    createElement(I18nProvider, {
      lang,
      children: createElement(KeysTab, {
        settings: settingsStub,
        license,
        probeResult,
        onChange: async () => {},
      }),
    }),
  );
}

// Since 8 Oct 2026 Home has no plan pill (his word: the key's state is said once, by the header chip). What this
// file guards stays: a refused key is never shown as working, and an accepted one is.
describe('the home panel', () => {
  it('does not show a refused founder key as working, or promise it unlimited calls', () => {
    const html = renderHome(FOUNDER, 'revoked');
    expect(html).not.toContain('class="pop-tier"');
    expect(html).not.toContain('unlimited (founder)');
    expect(html).toContain('Live Rephrase is off'); // the feature's name since 11 Oct 2026 (rename pass)
    // The honest card POP-5 added stays where it was.
    expect(html).toContain('License key not accepted');
  });

  it('still shows the unlimited count when the proxy accepted the same key', () => {
    const html = renderKeyCount(FOUNDER, 'ok');
    expect(html).toContain('unlimited (founder)');
    expect(html).not.toContain('License key not accepted');
  });

  it('assumes good before the probe has answered, which is the offline case', () => {
    // null is pre-probe and 'unknown' is a network failure. Neither is the
    // server refusing the key, and treating them as one would tell a parent
    // their licence is dead every time their wifi drops.
    for (const probe of [null, 'unknown'] as const) {
      const html = renderKeyCount(FOUNDER, probe);
      expect(html).toContain('unlimited (founder)');
      expect(html).not.toContain('License key not accepted');
    }
  });
});

describe('the licence panel', () => {
  it('does not promise an unlimited founder cap on a key the server refused', () => {
    const html = renderKeys(FOUNDER, 'revoked');
    expect(html).not.toContain('Unlimited AI calls (founder)');
    expect(html).not.toContain('no daily or monthly cap');
    expect(html).toContain('No AI calls while the key is not accepted');
  });

  it('still shows the founder cap when the key is accepted', () => {
    const html = renderKeys(FOUNDER, 'ok');
    expect(html).toContain('Unlimited AI calls (founder)');
    expect(html).not.toContain('No AI calls while the key is not accepted');
  });
});

describe('the four languages', () => {
  it('says the same thing in Romanian, so the fix is not English-only', () => {
    const home = renderHome(FOUNDER, 'revoked', 'ro');
    expect(home).not.toContain('class="pop-tier"');
    expect(home).toContain('Live Rephrase este oprit');
    expect(home).not.toContain('unlimited (founder)');
    const keys = renderKeys(FOUNDER, 'revoked', 'ro');
    expect(keys).not.toContain('Unlimited AI calls (founder)');
  });
});
