// M212's dashboard half: a row that did not decode is a third state (2026-09-18).
//
// A record that cannot be read is not a record that is absent, and it is not a
// record that is gone. It is a record this install could not decode today, and
// the dashboard had only two boxes to put it in. `getRecords` answered an empty
// list when any single stored row failed to decompress, so a person with three
// good records and one damaged one saw an empty feed under a banner saying the
// store could not be opened, which is not what had happened: most of their
// record was right there and readable.
//
// The reader answers with both halves now, and this is the surface. What is
// under test here is the ordering, because getting it wrong is how the fix
// would become its own overclaim: a chain walk over the rows that DID read can
// come back verified while part of the record was never looked at, and "Record
// verified" printed over that would be worse than the empty feed it replaced.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { ChainBanner } from '../../../../../src/ui/dashboard/components/ChainBanner';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import type { IntegrityResult } from '../../../../../src/forensics/chain-integrity';

const t = DASHBOARD_STRINGS.en;

function recs(n: number): ForensicRecord[] {
  return Array.from({ length: n }, (_, i) => ({ chainPosition: i } as ForensicRecord));
}

/**
 * A walk that came back clean over whatever it was given. The per-record map
 * matters: integrityVerificationState reads every entry of it and calls the
 * whole thing partial unless each one says verified, so a thinner stub silently
 * makes every case below the partial case and tests nothing.
 */
const VERIFIED = {
  valid: true,
  brokenAtPosition: null,
  chainLength: 3,
  perRecord: new Map([[0, 'verified'], [1, 'verified'], [2, 'verified']]),
} as unknown as IntegrityResult;
const BROKEN = {
  valid: false,
  brokenAtPosition: 2,
  chainLength: 3,
  perRecord: new Map([[0, 'verified'], [1, 'verified'], [2, 'broken']]),
} as unknown as IntegrityResult;

function render(over: Partial<React.ComponentProps<typeof ChainBanner>> = {}): string {
  return renderToStaticMarkup(
    <I18nProvider lang="en">
      <ChainBanner
        records={recs(3)}
        integrity={VERIFIED}
        fingerprint="abcd1234"
        anchorCreatedAt={null}
        {...over}
      />
    </I18nProvider>,
  );
}

describe('rows that did not decode', () => {
  it('says so, and says how many read and how many did not', () => {
    const html = render({ unreadableCount: 1 });
    expect(html).toContain(t.chainTitleSomeUnreadable);
    expect(html).toContain(t.chainDescSomeUnreadable(1, 3));
  });

  it('never prints the record as verified while part of it was not read', () => {
    // The walk below it came back valid, over the three rows that did read.
    const html = render({ unreadableCount: 1 });
    expect(html).not.toContain(t.chainTitleOk);
    expect(html).not.toContain(t.chainTitleOkCurrentOnly);
  });

  it('says nothing when every row read, which is the ordinary case', () => {
    const html = render({ unreadableCount: 0 });
    expect(html).not.toContain(t.chainTitleSomeUnreadable);
    expect(html).toContain(t.chainTitleOk);
  });

  it('is not the same thing as a store that would not open', () => {
    // The two have different words on purpose: one means most of the record is
    // here, the other means none of it was looked at.
    const html = render({ readFailed: true, unreadableCount: 2 });
    expect(html).toContain(t.chainTitleUnreadable);
    expect(html).not.toContain(t.chainTitleSomeUnreadable);
  });

  it('does not outrank a chain that failed to verify, because tampering is the worse fact', () => {
    const html = render({ integrity: BROKEN, unreadableCount: 1 });
    expect(html).not.toContain(t.chainTitleSomeUnreadable);
    expect(html).toContain(t.chainTitleEntryFailed(2));
  });

  it('carries the singular, because one damaged entry is the likely case', () => {
    expect(t.chainDescSomeUnreadable(1, 3)).toContain('entry is');
    expect(t.chainDescSomeUnreadable(2, 3)).toContain('entries are');
  });

  it('says a row that does not decode may also be an entry that was replaced, in all four languages', () => {
    // Verify takes the next record's own link across such a row, so it cannot tell a damaged row
    // from one put where a record was taken out, and reads both as partly verified.
    const damaged = {
      ...VERIFIED,
      damagedCount: 1,
    } as unknown as IntegrityResult;
    const html = render({ integrity: damaged, unreadableCount: 1 });
    expect(html).toContain(t.chainDescSomeUnreadable(1, 3));
    const says: Record<keyof typeof DASHBOARD_STRINGS, string> = {
      en: 'An entry that does not decode may also be one that was replaced',
      es: 'Una entrada que no se descodifica también puede ser una que se reemplazó',
      'pt-BR': 'Uma entrada que não decodifica também pode ser uma que foi substituída',
      ro: 'O înregistrare care nu se decodifică poate fi și una care a fost înlocuită',
    };
    for (const lang of Object.keys(DASHBOARD_STRINGS) as Array<keyof typeof DASHBOARD_STRINGS>) {
      expect(DASHBOARD_STRINGS[lang].chainDescSomeUnreadable(1, 3), lang).toContain(says[lang]);
    }
    expect(html).toContain(says.en);
  });

  it('tells the person the entries are not gone, in all four languages', () => {
    // The whole point of the third state: they are stored, this machine could
    // not read them today. A sentence that let a reader think they were lost
    // would be a worse error than the empty feed.
    for (const lang of ['en', 'ro', 'es', 'pt-BR'] as const) {
      const table = DASHBOARD_STRINGS[lang];
      expect(table.chainTitleSomeUnreadable.length, lang).toBeGreaterThan(10);
      expect(table.chainDescSomeUnreadable(1, 3).length, lang).toBeGreaterThan(60);
    }
  });
});

describe('the dashboard asks the reader that can answer', () => {
  it('reads with getRecordsDetailed on boot and on a recheck, not with getRecords', () => {
    const shell = readFileSync(join(process.cwd(), 'src/ui/dashboard/Dashboard.tsx'), 'utf8');
    // Two call sites: the boot read, and the recheck, which without it put the
    // page straight back to an empty feed on the next refresh.
    expect(shell.match(/getRecordsDetailed\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(shell).toContain('setUnreadableCount(');
    // The read-failure flag keeps its one meaning: the store would not open.
    expect(shell).toContain('setRecordReadFailed(read === null || lastRecordReadFailed());');
  });
});
