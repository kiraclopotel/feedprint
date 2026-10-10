// The Record tab's banner gives the time the record began on the record's own clock, and the stamp
// already names that clock in words ("UTC, not local time"). The sentence around it must not add a
// second "UTC" after those words.

import { describe, expect, it } from 'vitest';

import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const d = DASHBOARD_STRINGS[lang];

  it('the banner names the record clock once, and ends the stamp where the stamp ends', () => {
    const stamp = d.utcStamp('2026-10-04 21:32:10');
    const line = d.chainDescOk(320, stamp);
    expect(line).toContain(stamp);
    expect(line.match(/UTC/g)?.length).toBe(1);
    expect(line).not.toContain(`${stamp} UTC`);
  });
});
