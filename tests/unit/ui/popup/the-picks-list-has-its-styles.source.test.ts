// Every class the "Block this" card draws has a rule in the popup sheet. An orphan sweep once read the list's
// classes as unused and took them out, and the list rendered as run-together text ("Facebook3Clear") in Off's
// popup for weeks; nothing failed until a store picture showed it.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

const CARD = readSource('src/ui/popup/PickCard.tsx');
const SHEET = readSource('src/ui/popup/popup-design.css');

const classesIn = (tsx: string): string[] => {
  const out = new Set<string>();
  for (const m of tsx.matchAll(/className="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c) out.add(c);
  return [...out];
};

describe('the picks list has its styles', () => {
  it('names the classes it draws (the read is not empty)', () => {
    expect(classesIn(CARD)).toEqual(expect.arrayContaining(['pick-card', 'pick-group', 'pick-group-hdr', 'pick-row', 'pick-label']));
  });

  it.each(['pick-actions', 'pick-tally', 'pick-group', 'pick-group-hdr', 'pick-group-n', 'pick-row', 'pick-label', 'pick-more', 'list-search'])(
    '.%s has a rule in popup-design.css',
    (cls) => {
      expect(classesIn(CARD)).toContain(cls);
      expect(SHEET).toMatch(new RegExp(`\\.${cls}[\\s{:,.]`));
    },
  );
});
