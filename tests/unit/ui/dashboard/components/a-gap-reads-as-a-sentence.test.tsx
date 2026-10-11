/** @vitest-environment jsdom */
// The timeline's "recording was off" card printed its signed line as it is stored, "[gap-marker @ ...]
// reason=context-invalidated platform=unknown count=0 unit=records ...", which a person reads as a fault. It says a
// sentence in the reader's clock now, in four languages, and the line itself waits behind Copy diagnostics. The lines
// here come from gapMarkerText, the function that writes them on the chain.

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FeedCard } from '../../../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { gapMarkerText } from '../../../../../src/forensics/gap-marker';
import { readGapMarkerLine } from '../../../../../src/ui/dashboard/gap-marker-line';
import { formatTimeLocal } from '../../../../../src/ui/shared/format-time';
import type { GapMarkerInput, GapReason } from '../../../../../src/types/gap-marker';
import type { ForensicRecord } from '../../../../../src/types/forensic';

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

// Keyed by GapReason, so a reason added to the type and not here fails to compile.
const EVERY_REASON: Record<GapReason, true> = {
  'retry-overflow': true, 'retry-exhausted': true, 'delivery-quarantined': true, 'backlog-overflow': true,
  'backlog-hidden': true, 'recorder-down': true, 'churn-breaker': true, 'heap-valve': true,
  'context-invalidated': true, 'chain-lost': true, 'key-replaced': true,
};

const sentenceIn = (html: string): string => {
  const m = /data-testid="gap-sentence">([^<]*)</.exec(html);
  if (!m) throw new Error('no gap sentence rendered');
  return m[1].replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
};

function gapRecord(input: GapMarkerInput, line?: string): ForensicRecord {
  const text = line ?? gapMarkerText(input, input.toISO, false);
  return {
    id: 'gap-1', timestamp: input.toISO, platform: 'twitter', kind: 'gap-marker',
    originalText: text, originalHash: 'h', originalLength: text.length, neutralizedText: '', author: '',
    postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'adult', aiSource: 'rules', feedSource: 'unknown',
    integrityHash: 'ih', signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: 7,
  } as unknown as ForensicRecord;
}

const render = (record: ForensicRecord, lang: typeof LANGS[number]) => renderToStaticMarkup(
  React.createElement(I18nProvider, { lang, children: React.createElement(FeedCard, { record }) }),
);

const RELOAD: GapMarkerInput = {
  reason: 'context-invalidated', platform: 'unknown', count: 0, unit: 'records',
  fromISO: '2026-10-10T02:20:00.000Z', toISO: '2026-10-10T02:20:00.000Z',
};

describe('a gap marker on the timeline', () => {
  it('says the reload as a sentence with the local time, and never prints its signed line', () => {
    for (const lang of LANGS) {
      const html = render(gapRecord(RELOAD), lang);
      const t = DASHBOARD_STRINGS[lang];
      const at = formatTimeLocal(RELOAD.fromISO, lang);
      expect(html, lang).toContain(t.feedGapSentence({ reason: 'context-invalidated', count: 0, from: at, to: at, site: null }));
      expect(html, lang).toContain(at);
      expect(html, lang).not.toContain('reason=');
      expect(html, lang).not.toContain('[gap-marker');
      expect(html, lang).toContain(t.opsCopyDiagnostics);
    }
  });

  it('says a span with both times, and names the site and the count', () => {
    const lost: GapMarkerInput = { reason: 'retry-exhausted', platform: 'facebook', count: 3, unit: 'records', fromISO: '2026-10-10T02:00:00.000Z', toISO: '2026-10-10T02:30:00.000Z' };
    const html = render(gapRecord(lost), 'en');
    expect(html).toContain(`3 entries could not be saved between ${formatTimeLocal(lost.fromISO, 'en')} and ${formatTimeLocal(lost.toISO, 'en')} on Facebook.`);
  });

  it('says every reason as a plain sentence in every language, with no code word and no em dash', () => {
    const reasons = Object.keys(EVERY_REASON) as GapReason[];
    expect(reasons).toHaveLength(11);
    for (const reason of reasons) {
      const input: GapMarkerInput = {
        reason, platform: 'facebook', count: 2, unit: 'records',
        fromISO: '2026-10-10T02:00:00.000Z', toISO: '2026-10-10T02:30:00.000Z',
      };
      for (const lang of LANGS) {
        const said = sentenceIn(render(gapRecord(input), lang));
        const where = `${reason} ${lang}`;
        expect(said, where).toMatch(/^\S.*\.$/);
        expect(said, where).not.toContain(reason);
        expect(said, where).not.toMatch(/=|\[|heap|churn|backlog|valve|heartbeat|gap-marker/i);
        expect(said, where).not.toContain('—');
        expect(said, where).not.toBe(DASHBOARD_STRINGS[lang].feedGapHeading(reason));
        expect(said, where).toContain(formatTimeLocal(input.fromISO, lang));
      }
    }
  });

  it('heads each stop by its own cause, and only a recorder that was not running says recording was off', () => {
    const reasons = Object.keys(EVERY_REASON) as GapReason[];
    for (const lang of LANGS) {
      const t = DASHBOARD_STRINGS[lang];
      const off = t.feedGapHeading('recorder-down');
      for (const reason of reasons) {
        const input: GapMarkerInput = { reason, platform: 'facebook', count: 3, unit: 'records', fromISO: RELOAD.fromISO, toISO: RELOAD.toISO };
        const html = render(gapRecord(input), lang);
        const heading = t.feedGapHeading(reason);
        expect(html, `${reason} ${lang}`).toContain(`>${heading}<`);
        // No reason code reaches the heading, whatever its case ("S-A" is Romanian, not a code).
        for (const code of reasons) expect(heading.toLowerCase(), `${reason} ${lang}`).not.toContain(code);
        // A reason that fell to the catch-all would read as "a stop in recording" with no cause.
        expect(heading, `${reason} ${lang}: its own heading, not the catch-all`).not.toBe(t.feedGapHeading(''));
        if (reason !== 'recorder-down') expect(heading, `${reason} ${lang}`).not.toBe(off);
      }
      expect(t.feedGapHeading('retry-exhausted'), lang).not.toBe(t.feedGapHeading('context-invalidated'));
    }
  });

  it('says plainly what a reload cost, and that the open tabs recorded nothing more until reloaded', () => {
    const said = sentenceIn(render(gapRecord(RELOAD), 'en'));
    const at = formatTimeLocal(RELOAD.fromISO, 'en');
    expect(said).toBe(`The extension was reloaded or updated at ${at}. In tabs that were already open, posts seen but not yet saved were lost; how many is not known. Those tabs recorded nothing more until they were reloaded.`);
  });

  it('says a sentence for a line that does not read back, not the card heading again', () => {
    for (const lang of LANGS) {
      const said = sentenceIn(render(gapRecord(RELOAD, 'not a marker line at all'), lang));
      expect(said, lang).toBe(DASHBOARD_STRINGS[lang].feedGapSentence({ reason: '', count: 0, from: null, to: null, site: null }));
      expect(said, lang).not.toBe(DASHBOARD_STRINGS[lang].feedGapHeading(''));
      expect(said, lang).toMatch(/^\S.*\.$/);
    }
  });

  it('leaves out a time it cannot read rather than printing it', () => {
    const bad = '[gap-marker @ 2026-10-10T02:20:00.000Z] reason=recorder-down platform=unknown count=0 unit=records from=yesterday to=2026-10-10T02:20:00.000Z';
    for (const lang of LANGS) {
      const said = sentenceIn(render(gapRecord(RELOAD, bad), lang));
      expect(said, lang).not.toContain('yesterday');
      expect(said, lang).toBe(DASHBOARD_STRINGS[lang].feedGapSentence({ reason: 'recorder-down', count: 0, from: null, to: null, site: null }));
    }
  });

  it('says "a la" before one o’clock in Spanish and "a las" before the other hours', () => {
    const es = DASHBOARD_STRINGS.es.feedGapSentence;
    expect(es({ reason: 'recorder-down', count: 0, from: '01:20', to: '01:20', site: null })).toContain('a la 01:20.');
    expect(es({ reason: 'recorder-down', count: 0, from: '05:20', to: '05:20', site: null })).toContain('a las 05:20.');
    expect(es({ reason: 'recorder-down', count: 0, from: '01:20', to: '13:05', site: null })).toContain('entre la 01:20 y las 13:05.');
  });

  it('reads every part back from the line the chain stores, and an older line without from and to', () => {
    expect(readGapMarkerLine(gapMarkerText(RELOAD, RELOAD.toISO, false))).toEqual({
      reason: 'context-invalidated', platform: 'unknown', count: 0, fromISO: RELOAD.fromISO, toISO: RELOAD.toISO,
    });
    expect(readGapMarkerLine('[gap-marker @ 2026-09-06T10:00:00.000Z] reason=recorder-down platform=unknown count=0 unit=records'))
      .toEqual({ reason: 'recorder-down', platform: 'unknown', count: 0, fromISO: '2026-09-06T10:00:00.000Z', toISO: '2026-09-06T10:00:00.000Z' });
    expect(readGapMarkerLine('a post that happens to mention reason=x')).toBeNull();
  });
});
