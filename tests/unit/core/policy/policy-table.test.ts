// The policy table (src/core/policy/table.ts): every cell of the design pinned by a fixture,
// and the seven invariants of docs/design/POLICY-TABLE-2026-09-07.md section 4 as tests.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  actionRank, decide, POLICY_ROWS, verdictFor,
  type Action, type Household, type Reading,
} from '../../../../src/core/policy/table';
import type { Mode } from '../../../../src/types/mode';
import { repoPath } from '../../../helpers/repo-root';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(repoPath('tests', 'fixtures', 'calibration', 'policy-table-v1.json'), 'utf8')) as {
  cases: Array<{ row: string; reading: Reading; expect: Record<Mode, Action> }>;
};
const MODES: Mode[] = ['child', 'teen', 'adult'];
const plain = (mode: Mode): Household => ({ mode, topicRules: {}, swearing: 'show' });

describe('policy table: the cells', () => {
  for (const c of fixture.cases) {
    for (const mode of MODES) {
      it(`${c.row} in ${mode} -> ${c.expect[mode]}`, () => {
        const d = decide(c.reading, plain(mode));
        expect(d.row).toBe(c.row);
        expect(d.action).toBe(c.expect[mode]);
      });
    }
  }

  it('pins one case per row and one row per case', () => {
    const rows = POLICY_ROWS.map((r) => r.id).sort();
    const cased = [...new Set(fixture.cases.map((c) => c.row))].sort();
    expect(cased).toEqual(rows);
  });
});

describe('policy table: the invariants', () => {
  it('1. exactly one row fires and the record names it', () => {
    for (const c of fixture.cases) {
      const d = decide(c.reading, plain('teen'));
      expect(POLICY_ROWS.some((r) => r.id === d.row) || d.row === 'T1').toBe(true);
      expect(d.reason.length).toBeGreaterThan(0);
    }
  });

  it('3. a rail is never lowered by a topic rule', () => {
    const r: Reading = { judge: null, descriptor: { target: 'nobody', topic: 'news', protect: 'none', graphic: false, swearing: false }, rails: ['sponsored'] };
    // A topic rule to hide cannot lower a rail; a rail's own cell stands even when the rule says less.
    const d = decide(r, { mode: 'adult', topicRules: { news: 'hide' }, swearing: 'show' });
    expect(d.row).toBe('R4');
    expect(d.action).toBe('collapse');
  });

  it('4. a topic rule raises the action, names the household, and writes no severity', () => {
    const r: Reading = { judge: { charged: false, family: 'none', severity: 0 }, descriptor: { target: 'public', topic: 'politics', protect: 'none', graphic: false, swearing: false }, rails: [] };
    const d = decide(r, { mode: 'adult', topicRules: { politics: 'hide' }, swearing: 'show' });
    expect(d).toMatchObject({ row: 'T1', action: 'hide', reason: 'topic:politics household' });
    // and it never lowers what the table already said
    const strong: Reading = { ...r, judge: { charged: true, family: 'hostile', severity: 9 } };
    const e = decide(strong, { mode: 'adult', topicRules: { politics: 'collapse' }, swearing: 'show' });
    expect(e.row).toBe('J1');
    expect(e.action).toBe('hide');
  });

  it('5. child never shows more than teen, and teen never more than adult, row by row', () => {
    for (const c of fixture.cases) {
      const child = actionRank(decide(c.reading, plain('child')).action);
      const teen = actionRank(decide(c.reading, plain('teen')).action);
      const adult = actionRank(decide(c.reading, plain('adult')).action);
      expect(child).toBeGreaterThanOrEqual(teen);
      expect(teen).toBeGreaterThanOrEqual(adult);
    }
  });

  it('6. a not-charged item with no protect, no rail and no topic rule is allowed in every mode', () => {
    const r: Reading = { judge: { charged: false, family: 'none', severity: 0 }, descriptor: { target: 'thing', topic: 'animals', protect: 'none', graphic: false, swearing: true }, rails: [] };
    for (const mode of MODES) {
      const d = decide(r, plain(mode));
      expect(d.row).toBe('D1');
      expect(d.action).toBe('allow');
    }
  });

  it('swearing is a mask on a visible action, never a row, never a flag', () => {
    const r: Reading = { judge: { charged: false, family: 'none', severity: 0 }, descriptor: { target: 'thing', topic: 'animals', protect: 'none', graphic: false, swearing: true }, rails: [] };
    const d = decide(r, { mode: 'teen', topicRules: {}, swearing: 'mask' });
    expect(d).toMatchObject({ row: 'D1', action: 'allow', mask: true });
    expect(verdictFor(d.action)).toBe('pass');
    const hidden = decide({ ...r, rails: ['blocklist'] }, { mode: 'teen', topicRules: {}, swearing: 'mask' });
    expect(hidden.mask).toBe(false);
  });

  it('the judge alone, with no descriptor, still decides on severity', () => {
    const r: Reading = { judge: { charged: true, family: 'hostile', severity: 5 }, descriptor: null, rails: [] };
    expect(decide(r, plain('teen'))).toMatchObject({ row: 'J7', action: 'mark' });
  });

  it('a descriptor without target (Stage 1 closed on that field) decides J7 in the 4 to 6 band, never J3 or J4', () => {
    const r: Reading = {
      judge: { charged: true, family: 'hostile', severity: 5 },
      descriptor: { topic: 'other', protect: 'none', graphic: false, swearing: false },
      rails: [],
    };
    for (const mode of MODES) expect(decide(r, plain(mode))).toMatchObject({ row: 'J7', action: 'mark' });
  });

  it('verdictFor keeps the export counts meaning what they meant', () => {
    expect(verdictFor('allow')).toBe('pass');
    expect(verdictFor('mask')).toBe('masked');
    expect(verdictFor('record')).toBe('pass');
    expect(verdictFor('mark')).toBe('flagged');
    expect(verdictFor('soften')).toBe('flagged');
    expect(verdictFor('collapse')).toBe('flagged-hidden');
    expect(verdictFor('hide')).toBe('flagged-hidden');
  });
});
