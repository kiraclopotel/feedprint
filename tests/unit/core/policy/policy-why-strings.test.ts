// The why behind every action, in every language.
//
// docs/design/HIDE-NOTICE-2026-09-07.md section 3: the on-page notice and the
// export card draw one sentence fragment per policy row from a single table.
// This test locks three things: every row the policy table can return has a
// fragment in every shipped language; the string layer's row list and the
// table's row list are the same list; and no fragment leaks a severity number,
// a technique name or a model, because the sentence names the condition, never
// the instrument.

import { describe, it, expect } from 'vitest';
import { MARKER_STRINGS } from '../../../../src/i18n/marker-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';
import { POLICY_ROWS, decide } from '../../../../src/core/policy/table';

const tableRowIds = POLICY_ROWS.map((r) => r.id);

describe('policy why strings', () => {
  it('every language has a fragment for every row the table can return', () => {
    for (const lang of UI_LANGUAGES) {
      const why = MARKER_STRINGS[lang].whyByRow;
      for (const id of tableRowIds) {
        expect(why[id as keyof typeof why], `${lang} lacks a fragment for row ${id}`).toBeTruthy();
      }
      expect(why.T1, `${lang} lacks the household topic rule fragment`).toBeTruthy();
    }
  });

  it('the string layer lists exactly the rows the table has, plus T1', () => {
    const stringRows = Object.keys(MARKER_STRINGS.en.whyByRow).sort();
    const expected = [...tableRowIds, 'T1'].sort();
    expect(stringRows).toEqual(expected);
  });

  it('T1 is the row decide() returns for a household topic rule', () => {
    const d = decide(
      { judge: { charged: false, family: 'none', severity: 0 }, descriptor: { target: 'nobody', topic: 'politics', protect: 'none', graphic: false, swearing: false }, rails: [] },
      { mode: 'adult', topicRules: { politics: 'hide' }, swearing: 'show' },
    );
    expect(d.row).toBe('T1');
  });

  it('no fragment names a number, a technique id or a model', () => {
    for (const lang of UI_LANGUAGES) {
      for (const [id, text] of Object.entries(MARKER_STRINGS[lang].whyByRow)) {
        expect(text, `${lang} ${id}`).not.toMatch(/\d/);
        expect(text, `${lang} ${id}`).not.toMatch(/gpt|groq|llama|judge-v|-bait|-stack|fomo/i);
        expect(text, `${lang} ${id}`).not.toMatch(/FeelingWise/);
      }
      const ms = MARKER_STRINGS[lang];
      expect(ms.hidCommentLine('x')).toContain('x');
    }
  });
});
