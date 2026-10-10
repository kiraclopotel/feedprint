// @vitest-environment jsdom
//
// M186's open half, closed: chain-height-witness.ts states a loss on the chain
// the person is looking at BECAUSE it looks empty, so this banner is the only
// place the fact can reach them. The scope tested here mirrors the belt-and-
// braces rule in the witness itself: no `stated` field, nothing rendered; a
// `stated` field with `heldArchivedRecords: null` must say the count was never
// taken, never print a zero.

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { ChainLossBanner } from '../../../../../src/ui/dashboard/components/ChainLossBanner';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ChainHeightWitness } from '../../../../../src/forensics/chain-height-witness';

const t = DASHBOARD_STRINGS.en;

function render(witness: ChainHeightWitness | null, onOpenBackup?: () => void): string {
  return renderToStaticMarkup(
    <I18nProvider lang="en">
      <ChainLossBanner witness={witness} onOpenBackup={onOpenBackup} />
    </I18nProvider>,
  );
}

function witnessWithStated(stated: ChainHeightWitness['stated']): ChainHeightWitness {
  return { v: 1, highestNextPosition: 0, seenAtISO: '2026-09-18T00:00:00.000Z', stated };
}

describe('ChainLossBanner: no stated loss, nothing rendered', () => {
  it('a null witness (fresh install, or storage unreadable) renders nothing', () => {
    expect(render(null)).toBe('');
  });

  it('a witness with no stated loss renders nothing', () => {
    expect(render({ v: 1, highestNextPosition: 40, seenAtISO: '2026-09-18T00:00:00.000Z' })).toBe('');
  });
});

describe('ChainLossBanner: a stated loss', () => {
  it('states the date and the chain positions held, and carries role="alert"', () => {
    const html = render(witnessWithStated({
      atISO: '2026-09-17T10:15:30.000Z',
      heldPositions: 1200,
      heldArchivedMonths: 0,
      heldArchivedRecords: 0,
    }));
    expect(html).toContain('role="alert"');
    expect(html).toContain(t.lossBannerHeading);
    expect(html).toContain('2026-09-17 10:15:30');
    expect(html).toContain('1200');
    // No archives were part of this loss: the archive sentence is absent, not zeroed.
    expect(html).not.toContain(t.lossBannerHeldArchivesUncounted(0));
  });

  it('states archived months with their record count when the count was taken', () => {
    const html = render(witnessWithStated({
      atISO: '2026-09-17T10:15:30.000Z',
      heldPositions: 0,
      heldArchivedMonths: 3,
      heldArchivedRecords: 42000,
    }));
    expect(html).toContain(t.lossBannerHeldArchivesCounted(3, 42000));
    // Not `not.toContain('0 records')`: "42000 records" ends in "0 records",
    // so that assertion failed on a correct render. What must never appear is
    // the uncounted sentence beside a counted one.
    expect(html).not.toContain(t.lossBannerHeldArchivesUncounted(3));
  });

  it('says the count was never taken rather than printing a zero', () => {
    const html = render(witnessWithStated({
      atISO: '2026-09-17T10:15:30.000Z',
      heldPositions: 0,
      heldArchivedMonths: 5,
      heldArchivedRecords: null,
    }));
    expect(html).toContain(t.lossBannerHeldArchivesUncounted(5));
    expect(html).not.toContain(t.lossBannerHeldArchivesCounted(5, 0));
  });

  it('always says the loss cannot be recovered from the extension and that the current chain began after it', () => {
    const html = render(witnessWithStated({
      atISO: '2026-09-17T10:15:30.000Z',
      heldPositions: 10,
      heldArchivedMonths: 0,
      heldArchivedRecords: 0,
    }));
    expect(html).toContain(t.lossBannerNoRecovery);
    expect(html).toContain(t.lossBannerBackupOnly);
    expect(html).toContain(t.lossBannerNewChainStarted);
  });

  it('renders the backup action as a real button only when a handler is supplied', () => {
    const withHandler = render(witnessWithStated({
      atISO: '2026-09-17T10:15:30.000Z', heldPositions: 10, heldArchivedMonths: 0, heldArchivedRecords: 0,
    }), () => {});
    expect(withHandler).toContain('<button');
    expect(withHandler).toContain(t.lossBannerOpenBackup);

    const withoutHandler = render(witnessWithStated({
      atISO: '2026-09-17T10:15:30.000Z', heldPositions: 10, heldArchivedMonths: 0, heldArchivedRecords: 0,
    }));
    expect(withoutHandler).not.toContain('<button');
  });

  it('has no dismiss control: the loss stays on the page until it is fixed', () => {
    const html = render(witnessWithStated({
      atISO: '2026-09-17T10:15:30.000Z', heldPositions: 10, heldArchivedMonths: 0, heldArchivedRecords: 0,
    }));
    expect(html.toLowerCase()).not.toContain('dismiss');
  });
});
