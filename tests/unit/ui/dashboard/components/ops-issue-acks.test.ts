// Wiring audit 13 Sep, D2-34: cleared issue cards compare against rolling
// counters, so a baseline is kept across days and follows its counter down.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { rebaseAcks } from '../../../../../src/ui/dashboard/components/OperationalEventsPanel';

describe('rebaseAcks', () => {
  it('lowers a baseline to a counter that fell as old events rolled out', () => {
    const acks = { cap: 10, truncated: 4 };
    const next = rebaseAcks(acks, [{ key: 'cap', measure: 3 }, { key: 'truncated', measure: 6 }]);
    expect(next).toEqual({ cap: 3, truncated: 4 });
  });

  it('returns the same object when nothing fell, so no write happens', () => {
    const acks = { cap: 3 };
    expect(rebaseAcks(acks, [{ key: 'cap', measure: 5 }, { key: 'chain-broken' }])).toBe(acks);
  });

  it('after a rebase, a rise is new events and shows the card again', () => {
    const acks = rebaseAcks({ cap: 10 }, [{ key: 'cap', measure: 3 }]);
    const visible = (measure: number) => measure > (acks.cap ?? -1);
    expect(visible(3)).toBe(false);
    expect(visible(4)).toBe(true);
  });
});

describe('acks are not dropped at the day flip', () => {
  it('the panel reads stored acks without a date check and writes none', () => {
    const src = readFileSync('src/ui/dashboard/components/OperationalEventsPanel.tsx', 'utf8');
    expect(src).toContain('if (stored?.acks) setIssueAcks(stored.acks);');
    expect(src).not.toContain("stored?.date === new Date().toISOString().slice(0, 10)");
    expect(src).not.toMatch(/\[ISSUE_ACKS_KEY\]: \{ date:/);
  });
});
