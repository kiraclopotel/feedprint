// Q61 (wiring W58): the hard-hide notice + reveal buttons live in
// MARKER_STRINGS, not in hardcoded EN/RO ternaries. These were the last
// on-page UI strings outside the typed table; the interface now makes a
// missing translation a compile error, and the source-lock below fails if
// the literals ever creep back into content/index.ts.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';

const INDEX_PATH = 'src/content/post-path/result-apply.ts';

describe('hide-notice strings (Q61)', () => {
  it('both languages render the notice with and without a handle', () => {
    expect(MARKER_STRINGS.en.hideNoticeBy('@someone')).toContain('@someone');
    expect(MARKER_STRINGS.ro.hideNoticeBy('@someone')).toContain('@someone');
    expect(MARKER_STRINGS.en.hideNoticePlain.length).toBeGreaterThan(0);
    expect(MARKER_STRINGS.ro.hideNoticePlain.length).toBeGreaterThan(0);
    expect(MARKER_STRINGS.en.hideShowAnyway).not.toBe(MARKER_STRINGS.ro.hideShowAnyway);
    expect(MARKER_STRINGS.en.hideHideAgain).not.toBe(MARKER_STRINGS.ro.hideHideAgain);
  });

  it('content/index.ts reads the table, not literals (source-lock)', () => {
    const src = readFileSync(join(process.cwd(), INDEX_PATH), 'utf8');
    expect(src).toContain('MARKER_STRINGS[lang]');
    expect(src).toContain('ms.hideShowAnyway');
    expect(src).not.toContain("'show anyway'");
    expect(src).not.toContain("'arată oricum'");
  });
});
