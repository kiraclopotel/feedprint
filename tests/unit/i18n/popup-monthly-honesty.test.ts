// Q48 (wiring W53): popup monthly honesty.
//
// (a) The popup showed only the daily counter, so a worker-monthly-capped
// account wore the green "Active" pill and a healthy daily count while
// every call 429'd. It now shows the monthly share and the period-scoped
// pause lines from the textCapReached / mediaMonthlyCapReached markers.
// (b) The daily cap formula matched Math.min, not the enforcing gate: the
// legacy dailyCap=0 "no user cap" sentinel rendered "0 of 0 checks" while
// AI ran at the full tier cap.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

// The two panels that read the caps and print them: the home tab carries the meta line, the licence
// tab the cap itself. Both are their own file since PLAN-2026-09-16 item 10.3, and Popup.tsx is the
// shell now, holding none of this text. Read together so the scan does not care which panel a line
// sits in, only that the product still does it.
const POPUP_PATHS = ['src/ui/popup/panels/HomeTab.tsx', 'src/ui/popup/panels/KeysTab.tsx'];
const popup = POPUP_PATHS.map((p) => readFileSync(join(process.cwd(), p), 'utf8')).join('\n');

describe('Q48b — popup daily cap uses the enforcing gate formula (source-lock)', () => {
  it('treats dailyCap <= 0 as the no-user-cap sentinel (tier ceiling applies)', () => {
    const block = popup.match(/const dailyCap = tier === 'free'[\s\S]{0,300}?;/)?.[0] ?? '';
    expect(block).toContain('settings.dailyCap > 0');
    expect(block).toContain('? Math.min(settings.dailyCap, tierDailyCap)');
    expect(block).toContain(': tierDailyCap');
  });
});

describe('Q48a — popup monthly state (source-lock)', () => {
  it('reads the period-scoped pause marker', () => {
    expect(popup).toContain('chrome.storage.local.get([TEXT_CAP_STORAGE_KEY])');
  });

  it('renders the monthly share and the pause lines', () => {
    expect(popup).toContain('t.metaMonthly(monthlyPct)');
    expect(popup).toContain('t.pausedTextMonthly : t.pausedTextDaily');
  });

  it('monthly share uses the same cap function as the enforcing gate', () => {
    expect(popup).toContain('effectiveMonthlyTokenCap(tier, settings.monthlyUsdCapOverride');
  });
});

describe('strings EN/RO parity', () => {
  it('both languages carry the three new strings, periods distinct', () => {
    for (const lang of ['en', 'ro'] as const) {
      const s = POPUP_STRINGS[lang];
      expect(s.metaMonthly(40).length).toBeGreaterThan(0);
      expect(s.pausedTextDaily.length).toBeGreaterThan(0);
      expect(s.pausedTextMonthly.length).toBeGreaterThan(0);
      expect(s.pausedTextDaily).not.toBe(s.pausedTextMonthly);
    }
  });
});
