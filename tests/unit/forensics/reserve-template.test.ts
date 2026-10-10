// Capability audit 2026-09-06, P1 item 7: near-duplicate re-serves beside the
// exact hash. Every filter ships with a two-sided corpus (darking rule): pairs
// the template key MUST join (ACCEPT) and pairs it MUST keep apart (REJECT),
// so an inverted or over-eager normaliser fails here before it prints a count.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import { templateKey, computeTemplatePatterns, computeReservePatterns } from '../../../src/forensics/reserve';

const ACCEPT: Array<[string, string]> = [
  ['Day 41 of asking the council to fix our road. Still nothing.', 'Day 42 of asking the council to fix our road. Still nothing.'],
  ['Huge thanks to @maria_k for the shoutout, link in bio: https://t.co/abc123', 'Huge thanks to @jon.doe for the shoutout, link in bio: https://t.co/zz9'],
  ['ONLY 3 LEFT!!! Grab yours before midnight, code SAVE20', 'only 12 left grab yours before midnight code save20'],
  ['Breaking: 1,204 people signed in 2 hours. Sign too.', 'Breaking: 15,300 people signed in 6 hours. Sign too.'],
];

const REJECT: Array<[string, string]> = [
  ['Day 41 of asking the council to fix our road. Still nothing.', 'Day 41 of asking the council to fix our school. Still nothing.'],
  ['The match ended two to one after extra time, what a night for the club', 'The match ended two to one after extra time, what a night for the fans'],
  ['ok', 'ok'],
  ['https://example.test/one', 'https://example.test/two'],
  ['12 34 56', '78 90 11'],
];

describe('templateKey: two-sided corpus', () => {
  it.each(ACCEPT)('ACCEPT: %s == %s', (a, b) => {
    expect(templateKey(a)).not.toBe('');
    expect(templateKey(a)).toBe(templateKey(b));
  });
  it.each(REJECT)('REJECT: %s != %s', (a, b) => {
    const ka = templateKey(a);
    const kb = templateKey(b);
    // Either too short to be a template at all, or two different templates.
    expect(ka === '' || ka !== kb).toBe(true);
  });
});

let seq = 0;
function rec(text: string, ts: string, over: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r${seq}`, timestamp: ts, platform: 'twitter', originalText: text,
    originalHash: `h:${text}`, author: 'creator', techniques: [],
    ...over,
  } as ForensicRecord;
}

describe('computeTemplatePatterns', () => {
  it('joins the numbered days across sittings and reports the wordings, beside an exact count that stays zero', () => {
    const chain = [
      rec('Day 41 of asking the council to fix our road. Still nothing.', '2026-09-01T10:00:00Z'),
      rec('Day 42 of asking the council to fix our road. Still nothing.', '2026-09-02T10:00:00Z'),
      rec('Day 43 of asking the council to fix our road. Still nothing.', '2026-09-03T10:00:00Z'),
    ];
    const t = computeTemplatePatterns(chain);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ serveCount: 3, distinctDays: 3, distinctSessions: 3, variants: 3, author: 'creator' });
    expect(t[0].recordIds).toEqual(['r' + (seq - 2), 'r' + (seq - 1), 'r' + seq]);
    expect(computeReservePatterns(chain)).toHaveLength(0);
  });

  it('leaves exact repeats to the exact panel: one hash is never a template', () => {
    const text = 'Day 41 of asking the council to fix our road. Still nothing.';
    const chain = [rec(text, '2026-09-01T10:00:00Z'), rec(text, '2026-09-02T10:00:00Z')];
    expect(computeTemplatePatterns(chain)).toHaveLength(0);
    expect(computeReservePatterns(chain)).toHaveLength(1);
  });

  it('within-sitting variants are extraction noise, not a re-serve; different authors never join', () => {
    const same = [
      rec('Day 41 of asking the council to fix our road. Still nothing.', '2026-09-01T10:00:00Z'),
      rec('Day 42 of asking the council to fix our road. Still nothing.', '2026-09-01T10:05:00Z'),
    ];
    expect(computeTemplatePatterns(same)).toHaveLength(0);
    const other = [
      rec('Day 41 of asking the council to fix our road. Still nothing.', '2026-09-01T10:00:00Z', { author: 'a' }),
      rec('Day 42 of asking the council to fix our road. Still nothing.', '2026-09-02T10:00:00Z', { author: 'b' }),
    ];
    expect(computeTemplatePatterns(other)).toHaveLength(0);
  });

  it('is deterministic across input order and empty on empty input', () => {
    const a = rec('Breaking: 1,204 people signed in 2 hours. Sign too.', '2026-09-01T10:00:00Z');
    const b = rec('Breaking: 15,300 people signed in 6 hours. Sign too.', '2026-09-03T10:00:00Z');
    expect(computeTemplatePatterns([a, b])[0].recordIds).toEqual(computeTemplatePatterns([b, a])[0].recordIds);
    expect(computeTemplatePatterns([])).toEqual([]);
  });
});
