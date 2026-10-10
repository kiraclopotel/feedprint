/** @vitest-environment jsdom */
// The figures the Issues all-clear and the export's certificate head print, read on records whose answer is known in
// advance. The certificate repeats facts the file states further down, so it is held to the same sets: every record for
// the count, and only the feed's items for the sites and the dates, as the summary's own date range counts them. Its seal
// repeats the heading the checker draws, which the checker writes from words it carries as code (FIXED); the seal tests
// draw that heading as the checker does and edit the file's word table to say the opposite.

import { describe, it, expect } from 'vitest';
import { allClearFigures, bucketizeOperationalEvents } from '../../../../src/forensics/chain-debug-stats';
import { buildForensicHtmlExport, I18N, type ExportMetadata } from '../../../../src/forensics/html-export';
import { CERT_SCRIPT } from '../../../../src/forensics/html-export-scripts';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../../src/types/forensic';

const HOUR = 3_600_000;
const END = Date.parse('2026-10-09T12:00:00Z');

let seq = 0;
function rec(at: string, extra: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `r-${seq}`, timestamp: at, platform: 'facebook', originalText: `item ${seq}`, originalHash: `h-${seq}`,
    originalLength: 6, neutralizedText: '', author: '', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'rules', feedSource: 'unknown', verdict: 'pass', kind: 'post',
    integrityHash: `ih-${seq}`, signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq, ...extra,
  } as unknown as ForensicRecord;
}
const hourIn = (h: number, minute = 10): string => new Date(END - 24 * HOUR + h * HOUR + minute * 60_000).toISOString();
const as = (fields: Record<string, unknown>): Partial<ForensicRecord> => fields as Partial<ForensicRecord>;

describe('the Issues all-clear figures', () => {
  it('count, of the hours with feed items, those with nothing missed, and the comment batches cut short', () => {
    const records = [
      rec(hourIn(3), as({ verdict: 'cancelled-batch-truncated' })),
      rec(hourIn(3, 40), as({ verdict: 'cancelled-batch-truncated' })),
      rec(hourIn(3, 50), as({ verdict: 'skipped', skipReason: 'cap-exhausted' })),
      rec(hourIn(10), as({ verdict: 'cancelled-post-llm-failure', failureKind: 'network' })),
      ...[0, 5, 11, 17, 23].map((h) => rec(hourIn(h))),
      // Outside the day, so not in it.
      rec(new Date(END - 30 * HOUR).toISOString(), as({ verdict: 'cancelled-batch-truncated' })),
    ];
    // Hours 0, 3, 5, 10, 11, 17 and 23 had feed items; 3 and 10 had something missed. The other 17 hours had nothing to
    // check, so they are neither clean nor missed.
    const figures = allClearFigures(bucketizeOperationalEvents(records, HOUR, END, 24 * HOUR));
    expect(figures).toEqual({ cleanHours: 5, activeHours: 7, cutShort: 2 });
  });

  it('never call a day clean when the browser was not on a feed', () => {
    const idleDay = bucketizeOperationalEvents([rec(hourIn(4), as({ kind: 'heartbeat-marker' }))], HOUR, END, 24 * HOUR);
    expect(allClearFigures(idleDay)).toEqual({ cleanHours: 0, activeHours: 0, cutShort: 0 });
    expect(allClearFigures([])).toEqual({ cleanHours: 0, activeHours: 0, cutShort: 0 });
  });
});

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

/** Builds the export, lays its body out without its scripts, and runs only the certificate script, after edit(data). */
function certOf(records: ForensicRecord[], edit: (data: { i18n: Record<string, string> }) => void = () => undefined): HTMLElement {
  const html = buildForensicHtmlExport(records, META);
  const data = JSON.parse(html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1]);
  document.body.innerHTML = html.match(/<body[^>]*>([\s\S]*)<\/body>/)![1].replace(/<script[\s\S]*?<\/script>/g, '');
  edit(data);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = data;
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${CERT_SCRIPT}`)();
  return document.querySelector('.fw-cert') as HTMLElement;
}

function facts(cert: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  cert.querySelectorAll('.fw-cert-facts > div').forEach((d) => { out[d.querySelector('span')!.textContent!] = d.querySelector('b')!.textContent!; });
  return out;
}

describe('the export certificate head', () => {
  it('counts every record, as the summary row does, and only the feed items for sites and dates', () => {
    const f = facts(certOf([
      rec('2026-09-20T09:00:00Z', as({ kind: 'reset-marker', platform: 'tiktok' })),
      rec('2026-10-01T09:00:00Z'),
      rec('2026-10-03T09:00:00Z'),
      rec('2026-10-05T09:00:00Z', { platform: 'youtube' }),
      rec('2026-10-07T09:00:00Z', as({ kind: 'environment', platform: 'instagram' })),
    ]));
    const t = I18N.en;
    expect(f[t.summaryRecordCount]).toBe('5');
    expect(f[t.certSites]).toBe('2');
    expect(f[t.exposureDateRange]).toBe('Oct 1, 2026 – Oct 5, 2026');
  });
});

function drawBanner(cls: string, heading: string): void {
  const status = document.getElementById('fw-status')!;
  status.innerHTML = '';
  const b = document.createElement('div');
  b.className = `fw-chain-summary ${cls}`;
  const h = document.createElement('h2');
  h.textContent = heading;
  b.appendChild(h);
  status.appendChild(b);
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const afterColon = (s: string): string => s.slice(s.indexOf(':') + 1).trim();

describe('the export certificate seal', () => {
  const t = I18N.en;
  const records = [rec('2026-10-01T09:00:00Z'), rec('2026-10-02T09:00:00Z')];
  // Someone edits the file's word table so that every outcome would read VERIFIED.
  const tamper = (data: { i18n: Record<string, string> }): void => {
    data.i18n.chainBroken = 'Signature and integrity check: VERIFIED';
    data.i18n.chainPartial = 'Signature and integrity check: VERIFIED';
    data.i18n.verifyingLabel = 'VERIFIED';
  };
  const word = (cert: HTMLElement): string => cert.querySelector('.fw-cert-word')!.textContent ?? '';
  const sealClass = (cert: HTMLElement): string => (cert.querySelector('.fw-cert-seal') as HTMLElement).className;

  it('says nothing before the checker starts, then what the checker says while it checks', async () => {
    const cert = certOf(records, tamper);
    expect(word(cert)).toBe('');
    document.getElementById('fw-status')!.textContent = t.verifyingLabel;
    await tick();
    expect(word(cert)).toBe(t.verifyingLabel);
    expect(sealClass(cert)).toBe('fw-cert-seal');
  });

  it('gives each outcome the checker\'s own word, whatever the file\'s word table was edited to say', async () => {
    const cert = certOf(records, tamper);
    for (const [cls, heading, seal] of [
      ['fw-pass', t.chainVerified, 'ok'],
      ['fw-warn', t.chainPartial, 'warn'],
      ['fw-fail', `${t.chainBroken} ${t.chainBrokenAtRecord}5`, 'fail'],
    ] as const) {
      drawBanner(cls, heading);
      await tick();
      expect(sealClass(cert)).toBe(`fw-cert-seal ${seal}`);
      expect(word(cert)).toBe(afterColon(heading));
    }
    expect(word(cert)).toBe('FAILED at record #5');
  });

  it('keeps the qualifier of a report, as the checker\'s heading gives it', async () => {
    const cert = certOf(records, tamper);
    drawBanner('fw-pass', t.chainVerifiedSelection.replace('{x}', '59').replace('{y}', '386'));
    await tick();
    expect(word(cert)).toBe('VERIFIED, as a report of 59 of 386 records');
  });

  it('goes back to the checking words when the reader checks again', async () => {
    const cert = certOf(records, tamper);
    drawBanner('fw-fail', t.chainBroken);
    await tick();
    document.getElementById('fw-status')!.textContent = t.verifyingLabel;
    await tick();
    expect(sealClass(cert)).toBe('fw-cert-seal');
    expect(word(cert)).toBe(t.verifyingLabel);
  });

  it('is hidden where the browser has no Web Crypto, since the checker cannot run there', () => {
    const subtle = Object.getOwnPropertyDescriptor(window.crypto, 'subtle');
    Object.defineProperty(window.crypto, 'subtle', { value: undefined, configurable: true });
    try {
      const cert = certOf(records, tamper);
      expect((cert.querySelector('.fw-cert-seal') as HTMLElement).style.display).toBe('none');
    } finally {
      if (subtle) Object.defineProperty(window.crypto, 'subtle', subtle);
      else delete (window.crypto as unknown as { subtle?: unknown }).subtle;
    }
  });
});
