// @vitest-environment jsdom
//
// Area A4 — the green shield had a scope it never stated.
//
// `integrity` describes the CURRENT chain only. Archived months are verified
// by a separate on-demand walk that is null until the parent presses Verify,
// and its result rendered in a table further down the page, never reaching the
// banner. So a parent could read "Record verified" in green while an archived
// month, quite possibly the one that matters, was broken and unexamined.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { ChainBanner, formatStorage } from '../../../../../src/ui/dashboard/components/ChainBanner';
import type { IntegrityResult } from '../../../../../src/forensics/chain-integrity';

const verified = (n = 10): IntegrityResult => ({
  valid: true, chainLength: n, preChainCount: 0, preRekeyCount: 0,
  perRecord: new Map(Array.from({ length: n }, (_, i) => [`r${i}`, 'verified' as const])),
});

function render(props: Partial<React.ComponentProps<typeof ChainBanner>>): string {
  return renderToStaticMarkup(
    <ChainBanner
      records={[]}
      integrity={verified()}
      fingerprint="ff"
      anchorCreatedAt={null}
      {...props}
    />,
  );
}

describe('chain banner scope', () => {
  it('claims the whole record only when there is nothing else to check', () => {
    const html = render({ archivedMonthCount: 0 });
    expect(html).toContain('Record verified');
    expect(html).not.toContain('not included');
  });

  it('narrows its claim when archived months exist and have not been checked', () => {
    const html = render({ archivedMonthCount: 3, archivesVerified: false });
    expect(html).toContain('Current chain verified');
    expect(html).not.toContain('>Record verified<');
    expect(html).toContain('3 archived months are not included');
  });

  it('says it in the singular for one month', () => {
    const html = render({ archivedMonthCount: 1, archivesVerified: false });
    expect(html).toContain('1 archived month is not included');
  });

  it('claims the whole record again once the archives have been walked', () => {
    const html = render({ archivedMonthCount: 3, archivesVerified: true });
    expect(html).toContain('Record verified');
    expect(html).not.toContain('not included');
  });
});

// Wiring audit 13 Sep, D2-36: the figure was 4 KB times the record count, which
// gzipped records are far below. It is now the browser's own measurement, and a
// dash until there is one.
describe('the storage figure is measured, never computed from the record count', () => {
  it('shows a dash before the browser has answered, whatever the record count', () => {
    const html = render({ integrity: verified(10) });
    expect(html).not.toContain('40 KB');
    expect(html).toContain('—');
  });

  it('formats a measurement', () => {
    expect(formatStorage(null)).toBe('—');
    expect(formatStorage(512)).toBe('1 KB');
    expect(formatStorage(300 * 1024)).toBe('300 KB');
    expect(formatStorage(5.25 * 1024 * 1024)).toBe('5.3 MB');
    expect(formatStorage(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});

// D2-35: Verify and Export act on what was read; with an unreadable store
// they stay disabled.
describe('the actions on an unreadable store', () => {
  it('disables Verify and Export when the store could not be read, even with records in hand', () => {
    const html = renderToStaticMarkup(
      <ChainBanner records={[{ id: 'r1' } as never]} integrity={verified()} fingerprint="ff" anchorCreatedAt={null}
        readFailed onVerify={() => undefined} onExport={() => undefined} />,
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2);
  });

  it('enables them on a readable store with records', () => {
    const html = renderToStaticMarkup(
      <ChainBanner records={[{ id: 'r1' } as never]} integrity={verified()} fingerprint="ff" anchorCreatedAt={null}
        onVerify={() => undefined} onExport={() => undefined} />,
    );
    expect(html).not.toContain('disabled=""');
  });
});

describe('an unreadable store is not an empty one', () => {
  it('says the record could not be read, and outranks a verified state', () => {
    // getRecords() catches an IDB failure and returns []. Every reader then
    // rendered exactly what a genuinely quiet day renders. A parent could not
    // tell "your child saw nothing worrying" from "this extension could not
    // open its own database".
    const html = render({ readFailed: true });
    expect(html).toContain('could not be read');
    expect(html).toContain('nothing was looked at');
    expect(html).not.toContain('Record verified');
  });

  it('leaves the normal states alone when the read succeeded', () => {
    expect(render({ readFailed: false })).toContain('Record verified');
  });
});

describe('the failing record is named the way every other number names it', () => {
  // The title printed `brokenAt`, which is an index into the loaded slice, over
  // a reason sentence naming the record's chainPosition. On a chain whose first
  // loaded record sits at 100 that read "Entry #0 failed verification" above
  // "Integrity hash mismatch at position 100": two numbers for one record, and
  // #0 is not a number anything else in the product uses (the feed prints
  // chainPosition, as #105). Seen 2026-09-17 on the dashboard probe's screen.
  const broken = (over: Partial<IntegrityResult> = {}): IntegrityResult => ({
    valid: false,
    brokenAt: 0,
    brokenAtPosition: 100,
    brokenKind: 'tampered',
    reason: 'Integrity hash mismatch at position 100: record content was modified after signing.',
    chainLength: 6,
    preChainCount: 0,
    preRekeyCount: 0,
    perRecord: new Map([['r0', 'broken' as const]]),
    ...over,
  });

  it('names the position, not the index into the loaded slice', () => {
    const html = render({ integrity: broken() });
    expect(html).toContain('Entry #100 failed verification');
    expect(html).not.toContain('Entry #0 failed verification');
  });

  it('falls back to the plain broken title when no position can be derived', () => {
    const html = render({ integrity: broken({ brokenAtPosition: undefined }) });
    expect(html).not.toContain('Entry #');
    expect(html).toContain('Record broken');
  });
});

