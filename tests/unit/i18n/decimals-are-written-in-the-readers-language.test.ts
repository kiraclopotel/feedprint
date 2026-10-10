// Romanian, Spanish and Portuguese write twelve and a half as "12,5". A line that drops a number into its text as it
// comes prints "12.5", an English decimal inside the reader's own sentence, and the reader stops trusting the figure.
// Every dashboard line is rendered here with 12.5 for each number it takes, and none may show a digit, a point and a
// digit.
//
// The argument types are read from the table's own type file, so a line added later is covered without editing this
// test. The last check keeps the number of lines it cannot fill small, so the sweep cannot quietly go hollow.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { repoPath } from '../../helpers/repo-root';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { dashboardWords } from '../../../src/ui/dashboard/dashboard-words';

const DOTTED_DECIMAL = /\d\.\d/;
const COMMA_LANGUAGES = ['ro', 'es', 'pt-BR'] as const;

// Whole by construction: a clock hour is an index from 0 to 23, and every gap in seconds is rounded where it is measured
// (activity-drill.ts, ForensicsTab.tsx), so 12.5 would test a value no caller can pass.
const WHOLE = new Set(['hour', 'seconds']);

function sampleFor(type: string, name: string): unknown {
  const t = type.trim();
  if ((t === 'number' || t === 'number | null') && WHOLE.has(name)) return 12;
  if (t === 'number' || t === 'number | null') return 12.5;
  if (t === 'string' || t === 'string | null' || t === 'string | number' || t === 'number | string') return 'x';
  if (t === 'boolean') return true;
  if (t === 'FeedBehaviorLens') return 'parent';
  if (t === 'UsageFrame') return 'day';
  const literal = /^'([^']+)'/.exec(t);
  if (literal) return literal[1];
  return undefined;
}

/** Each one-line function of the table type, with a sample argument list, or null when an argument cannot be filled. */
function signatures(): Map<string, unknown[] | null> {
  const src = readFileSync(repoPath('src/i18n/dashboard/types.ts'), 'utf8');
  const out = new Map<string, unknown[] | null>();
  for (const m of src.matchAll(/^ {2}([A-Za-z0-9]+)\??: \((.*)\) => string;$/gm)) {
    const params = m[2].trim() === '' ? [] : m[2].split(/,(?![^(]*\))/);
    const args = params.map((p) => {
      const m2 = /^\s*([A-Za-z0-9_]+)\??:\s*(.*)$/.exec(p);
      return m2 ? sampleFor(m2[2], m2[1]) : undefined;
    });
    out.set(m[1], args.some((a) => a === undefined) ? null : args);
  }
  return out;
}

function render(value: unknown, args: unknown[] | null | undefined): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'function' && args) {
    const r = (value as (...a: unknown[]) => unknown)(...args);
    return typeof r === 'string' ? r : null;
  }
  return null;
}

describe.each(COMMA_LANGUAGES)('%s writes its decimals with a comma', (lang) => {
  it('no dashboard line shows 12.5 where it means twelve and a half', () => {
    const sigs = signatures();
    const table = DASHBOARD_STRINGS[lang] as unknown as Record<string, unknown>;
    const hits: string[] = [];
    for (const [key, value] of Object.entries(table)) {
      const text = render(value, sigs.get(key));
      if (text !== null && DOTTED_DECIMAL.test(text)) hits.push(`${key}: ${text.slice(0, 90)}`);
    }
    expect(hits).toEqual([]);
  });

  it('the dashboard-only words hold no dotted decimal either', () => {
    const words = dashboardWords(lang) as unknown as Record<string, unknown>;
    const hits = Object.entries(words)
      .filter(([, v]) => typeof v === 'string' && DOTTED_DECIMAL.test(v))
      .map(([k]) => k);
    expect(hits).toEqual([]);
  });
});

describe('the sweep is not hollow', () => {
  it('fills nearly every line of the table type', () => {
    const sigs = signatures();
    const unfilled = [...sigs].filter(([, a]) => a === null).map(([k]) => k);
    expect(sigs.size).toBeGreaterThan(250);
    expect(unfilled.length).toBeLessThan(12);
  });
});
