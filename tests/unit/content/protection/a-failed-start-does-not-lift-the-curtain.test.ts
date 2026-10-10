/** @vitest-environment jsdom */
//
// Two ways a child ended up looking at something the parent had closed.
//
// THE CURTAIN. The document-start shield holds a child's page dark until the
// interceptor's synchronous initial scan has run, and `signalContentShieldReady`
// is how that scan says so. The content script called it from its INIT FATAL
// catch, where nothing had run at all: no interceptor, no engagement control,
// no `childProtection.setMode`, so the protection manager was still sitting at
// its 'adult' default as well. The curtain came down at once and the child had
// the full uncovered feed, unmuted, for the rest of that page load, with
// nothing on screen saying anything was wrong.
//
// The shield already says what should happen to a boot that did not finish.
// Its read-error path reads: "The 5s safety timeout above remains the sole
// release authority for a persistent read failure, so a flaky/erroring boot
// never drops the curtain early." A fatal init is that case; it had simply
// been routed around the rule.
//
// THE SCHEDULE. `core/quiet-hours.ts` states that a window's days name the day
// it STARTS on, and says why it states it: "Getting this backwards would
// silently move a whole school-night block by a day." It was stated there and
// nowhere the parent choosing the days could see it. The shipped default is
// 22:00 to 07:00 on all seven days, so a parent who unticks the weekend to
// mean "school nights" gets Sunday 22:00 to Monday 07:00 completely open, the
// night they most meant to close, and Friday night closed, which they did not
// ask for. Nine hours, every week, no skill needed to find it.
//
// Found 2026-09-19 by a read-only scan of the child-safety promise. The engine
// is right and is not touched; the screen now says what it does.

import { describe, expect, it } from 'vitest';
import { isWithinQuietHours } from '../../../../src/core/quiet-hours';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { readSource } from '../../../helpers/read-source';

const SUNDAY = 0, FRIDAY = 5, SATURDAY = 6, MONDAY = 1;
/** The shipped default window: 22:00 to 07:00. */
const SCHOOL_NIGHTS = [{ days: [MONDAY, 2, 3, 4, FRIDAY], startMin: 22 * 60, endMin: 7 * 60 }];

const at = (day: number, hh: number, mm = 0): Date => {
  // 2026-09-20 is a Sunday, so day offsets land on the weekday they name.
  const d = new Date(2026, 8, 20 + day, hh, mm, 0);
  expect(d.getDay(), 'the fixture lands on the day it means').toBe(day % 7);
  return d;
};

describe('a failed start does not lift the curtain (2026-09-19)', () => {
  it('INIT FATAL no longer tells the page the shields are ready', () => {
    const src = readSource('src/content/index.ts');
    const fatal = src.indexOf("console.error('[FeelingWise] INIT FATAL:', err);");
    expect(fatal, 'the fatal handler is where this expects it').toBeGreaterThan(0);
    // The whole catch block, back to its brace.
    const block = src.slice(src.lastIndexOf('} catch (err) {', fatal), fatal);
    expect(block, 'nothing in the fatal path claims the scan ran')
      .not.toContain('signalContentShieldReady()');
  });

  it('the shield still holds its own release authority on a boot that did not finish', () => {
    // The rule the fix puts this path back under. If this sentence goes, the
    // fatal path silently loses its cover again.
    const shield = readSource('src/content/protection/document-start-shield.ts');
    expect(shield).toContain('sole release authority');
  });

  describe('the schedule the screen describes', () => {
    it('unticking the weekend really does leave Sunday night open', () => {
      // Stated as a measurement of the engine, not a complaint about it. This
      // is the behaviour the note on screen now warns about.
      expect(isWithinQuietHours(SCHOOL_NIGHTS, at(SUNDAY, 23))).toBe(false);
      expect(isWithinQuietHours(SCHOOL_NIGHTS, at(MONDAY + 7, 2)), 'and Monday 02:00 with it').toBe(false);
    });

    it('and really does close Friday night, which was not asked for', () => {
      expect(isWithinQuietHours(SCHOOL_NIGHTS, at(FRIDAY, 23))).toBe(true);
      expect(isWithinQuietHours(SCHOOL_NIGHTS, at(SATURDAY, 2))).toBe(true);
    });

    it('a school night in the middle of the week is closed, or the engine is wrong', () => {
      expect(isWithinQuietHours(SCHOOL_NIGHTS, at(MONDAY, 23))).toBe(true);
      expect(isWithinQuietHours(SCHOOL_NIGHTS, at(2, 6, 30))).toBe(true);
      expect(isWithinQuietHours(SCHOOL_NIGHTS, at(2, 8))).toBe(false);
    });

    it('every language warns the parent, and names the night that bites', () => {
      for (const [lang, t] of Object.entries(POPUP_STRINGS)) {
        const note = (t as unknown as { quietEditOvernightNote: string }).quietEditOvernightNote;
        expect(typeof note, lang).toBe('string');
        expect(note.length, `${lang} is a sentence`).toBeGreaterThan(40);
        expect(note, `${lang}`).not.toContain('—');
      }
    });

    it('the editor shows it for an overnight window and not for a daytime one', () => {
      const src = readSource('src/ui/popup/QuietHoursEditor.tsx');
      expect(src).toContain('win.startMin > win.endMin && (');
      expect(src).toContain('t.quietEditOvernightNote');
    });
  });
});
