// @vitest-environment jsdom
//
// The defect a cold read of the dashboard found (2026-09-18): the SAME INSTANT
// could appear three hours apart on one page, because half the surfaces
// rendered local time and half rendered UTC, with only a bare "UTC" suffix
// between them.
//
// These checks drive the real components with one fixed instant and one fixed
// language and assert the rendered strings. The zone is pinned before the
// imports so local and UTC are nine hours apart: a surface that quietly served
// the wrong clock cannot pass by coincidence.
process.env.TZ = 'Asia/Tokyo';

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { ForensicsTab } from '../../../../../src/ui/dashboard/components/ForensicsTab';
import { FeedLogTab } from '../../../../../src/ui/dashboard/components/FeedLogTab';
import { OverviewTab } from '../../../../../src/ui/dashboard/components/OverviewTab';
import { buildUsageBuckets } from '../../../../../src/ui/dashboard/components/UsageTimePanel';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../../../src/types/forensic';

/** 14:50:44 UTC is 23:50:44 in the pinned zone. */
const AT = '2026-09-18T14:50:44.000Z';
/**
 * 17:30 UTC on Friday the 18th is 02:30 on SATURDAY the 19th in the pinned
 * zone. A surface that reads this instant on the wrong clock gets the wrong
 * day, the wrong weekday and the wrong hour at once.
 */
const LATE = '2026-09-18T17:30:00.000Z';
const UTC_TIME = '14:50:44';
/** The card face and the Feed log rows carry minutes. */
const LOCAL_TIME = '23:50';
const UTC_STAMP = '2026-09-18 14:50:44';

function makeRecord(over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'r1',
    timestamp: AT,
    platform: 'tiktok',
    originalText: 'sample text',
    originalHash: 'h',
    originalLength: 11,
    neutralizedText: '',
    author: 'creator99',
    postUrl: 'https://www.tiktok.com/@creator99/video/123',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'foryou',
    integrityHash: 'ih',
    verdict: 'pass',
    kind: 'post',
    chainPosition: 3,
    ...over,
  } as ForensicRecord;
}

function renderCard(record: ForensicRecord, lang: 'en' | 'ro'): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record }) }),
  );
}

// The ledger's rows are on the Feed log since 10 Oct 2026; the anchor stamp stayed on the Record tab.
function renderLedger(lang: 'en' | 'ro'): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang,
      children: React.createElement(FeedLogTab, {
        records: [makeRecord()],
        loadingRest: false,
        filter: { window: 'all' },
        onFilter: () => {},
        integrity: null,
      } as unknown as React.ComponentProps<typeof FeedLogTab>),
    }),
  );
}

function renderRecordTab(lang: 'en' | 'ro'): string {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, {
      lang,
      children: React.createElement(ForensicsTab, {
        records: [makeRecord()],
        integrity: null,
        anchorCreatedAt: AT,
        fingerprint: 'ff',
        archivedMonthCount: 0,
      } as unknown as React.ComponentProps<typeof ForensicsTab>),
    }),
  );
}

describe('a reading surface is on the reader\'s clock', () => {
  it('prints the card face time in local time, not the record\'s UTC time', () => {
    const html = renderCard(makeRecord(), 'en');
    expect(html).toContain(`>${LOCAL_TIME}<`);
    expect(html).not.toContain('>14:50<');
    expect(html).not.toContain(`>${UTC_TIME}<`);
  });

  it('puts the record\'s own instant on the hover, named as UTC in words', () => {
    const html = renderCard(makeRecord(), 'en');
    expect(html).toContain(DASHBOARD_STRINGS.en.utcStamp(UTC_STAMP));
  });

  it('follows the interface language, not the browser: the same card differs in RO', () => {
    // The chain-marker row carries a full date + time, which is where the
    // language shows. It used to be a bare toLocaleString().
    const marker = makeRecord({ kind: 'reset-marker', originalText: 'chain reset' });
    const en = renderCard(marker, 'en');
    const ro = renderCard(marker, 'ro');
    expect(en).toContain('Sep 18, 2026, 23:50');
    expect(ro).toContain('18 sept. 2026, 23:50');
    expect(en).not.toBe(ro);
  });
});

// The ledger's column follows the page's clock: a reader saw the header's local time beside the ledger's UTC and read
// two times. The record's sealed instant stays on the row, named as UTC in words.
describe('the ledger is on the page\'s clock, and keeps the sealed UTC instant in words', () => {
  const html = renderLedger('en');

  it('prints the Feed log row time in local time, not UTC', () => {
    expect(html).toContain(`>${LOCAL_TIME}<`);
    expect(html).not.toContain('>14:50<');
    // The row's sealed instant is on its hover, named as UTC in words.
    expect(html).toContain(DASHBOARD_STRINGS.en.utcStamp(UTC_STAMP));
  });

  it('says which clock the When column is on, once, above it', () => {
    expect(html.split(DASHBOARD_STRINGS.en.feedLogClock).length - 1).toBe(1);
  });

  it('names the clock in words on the anchor row, not with a bare suffix', () => {
    const record = renderRecordTab('en');
    expect(record).toContain(DASHBOARD_STRINGS.en.utcStamp(UTC_STAMP));
    // The shape the cold read found, glued straight onto a value.
    expect(record).not.toContain(`${UTC_STAMP} UTC<`);
  });

  it('states the clock note in the reader\'s own language', () => {
    expect(renderLedger('ro')).toContain(DASHBOARD_STRINGS.ro.feedLogClock);
  });
});

describe('the same instant, both clocks, one page', () => {
  it('renders nine hours apart and is distinguishable without arithmetic', () => {
    const card = renderCard(makeRecord(), 'en');
    const ledger = renderLedger('en');
    expect(card).toContain(LOCAL_TIME);
    expect(ledger).toContain(UTC_TIME);
    // The reader is never asked to tell them apart by the digits: the UTC one
    // always arrives wrapped in words, the local one never is.
    expect(ledger).toContain(DASHBOARD_STRINGS.en.utcStamp(UTC_STAMP));
    expect(card).not.toContain(`>${LOCAL_TIME} UTC<`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Wrong-clock CALLS, not wrong idioms.
//
// tests/repo/one-clock-per-surface.test.ts bans the hand-rolled idioms, and
// tests/unit/ui/shared/format-time.test.ts proves each formatter. Neither can
// see a surface that calls the RIGHT formatter family from the WRONG one:
// swapping formatTimeLocal for formatUtcTime at a call site passed all of them
// (found by an independent probe, 2026-09-18). The two surfaces below are the
// densest concentrations of clock calls outside the two rendered above.

describe("OverviewTab: the landing surface is on the reader's clock", () => {
  // The whole chain is exercised by one instant: computeOverview buckets by
  // LOCAL day (localDayKey), the eyebrow names that day, the column labels name
  // its weekday, and the attention row prints its hour. On the record's clock
  // every one of those is a different answer.
  const flagged = makeRecord({
    id: 'ov-1', timestamp: LATE, verdict: 'flagged', overallScore: 7,
    techniques: [{ name: 'fear-appeal', severity: 7 }],
  } as Partial<ForensicRecord>);

  function renderOverview(lang: 'en' | 'ro'): string {
    return renderToStaticMarkup(
      React.createElement(I18nProvider, {
        lang,
        children: React.createElement(OverviewTab, {
          records: [flagged],
          onDrill: () => {},
          onOpenStatistics: () => {},
        }),
      }),
    );
  }

  it('names the focus day as the LOCAL day, not the UTC one', () => {
    // 17:30 UTC Friday is 02:30 Saturday here. "September 18" would mean the
    // page had read the instant on the record's clock.
    expect(renderOverview('en')).toContain('Saturday, September 19');
  });

  it("prints the attention row time on the reader's clock", () => {
    const html = renderOverview('en');
    expect(html).toContain('02:30');
    expect(html).not.toContain('17:30');
  });

  it('follows the interface language, not the browser', () => {
    expect(renderOverview('ro')).toContain('sâmbătă, 19 septembrie');
  });

  it('writes the per-day tooltip as a date, not as a raw bucket key', () => {
    const html = renderOverview('en');
    expect(html).toContain('Sep 19, 2026');
    expect(html).not.toContain('2026-09-19:');
  });
});

describe('UsageTimePanel axis labels follow the interface language', () => {
  // buildUsageBuckets is pure and takes `lang` outright, so the cheapest
  // possible coverage of a clock call: no React, no store, one call. Its axis
  // used to read toLocaleDateString([]), which is the BROWSER's locale.
  const NOW = Date.parse('2026-09-18T14:50:44.000Z');

  it("names weekdays in the reader's language on the week frame", () => {
    const en = buildUsageBuckets([], 'week', NOW, 'en').map((b) => b.label);
    const ro = buildUsageBuckets([], 'week', NOW, 'ro').map((b) => b.label);
    expect(en).toContain('Fri');
    expect(ro).toContain('vin.');
    expect(en).not.toEqual(ro);
  });

  it("names months in the reader's language on the year frame", () => {
    const en = buildUsageBuckets([], 'year', NOW, 'en').map((b) => b.label);
    const ptBr = buildUsageBuckets([], 'year', NOW, 'pt-BR').map((b) => b.label);
    expect(en[11]).toBe('Sep');
    expect(ptBr[11]).toBe('set.');
  });
});
