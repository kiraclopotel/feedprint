// @vitest-environment jsdom
//
// A panel cannot be opened on paper (the export sweep's paper read, 12 Oct 2026). A shut panel printed shut: no code beside the link
// for a reader who has the file on paper, no criteria and AI instructions, no cautious reading. Before print the panels that carry
// evidence now open, the codes drawn first (the toggle event comes too late for the print layout), and after print each goes back as
// the reader had it. The per-record rows are left shut on purpose; the print rule leaves a passed row out unless it was opened.

import { beforeEach, describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, READING_SCRIPT, type ExportMetadata } from '../../../src/forensics/html-export';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import { QR_LIB_SOURCE } from '../../../src/forensics/qrcode-vendor';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import type { ForensicRecord } from '../../../src/types/forensic';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

function records(): ForensicRecord[] {
  return [1, 2, 3].map((n) => ({
    id: `fr-${n}`, timestamp: `2026-09-10T10:0${n}:00.000Z`, platform: 'twitter', originalText: `text ${n}`, originalHash: `hash-${n}`,
    originalLength: 6, neutralizedText: '', author: '@person', postUrl: `https://x.com/person/status/10${n}`, techniques: [], overallScore: 0,
    userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `ih-${n}`, signature: 'sig', publicKeyFingerprint: 'fp16',
    chainPosition: n, verdict: 'pass', kind: 'post',
  }) as unknown as ForensicRecord);
}

let html = '';
function mount(list: ForensicRecord[] = records()): void {
  html = buildForensicHtmlExport(list, { ...META, methodology: buildMethodologyBlock('1.2.3') });
  const payload = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1];
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(payload);
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="application/json"'));
  (window as unknown as { FWN?: unknown }).FWN = new Function(`${EXPORT_NUMBERS_INLINE_SOURCE}; return FWN;`)();
  (window as unknown as { qrcode?: unknown }).qrcode = new Function(`${QR_LIB_SOURCE}; return qrcode;`)();
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  new Function(READING_SCRIPT)();
}

const panels = (sel: string): HTMLDetailsElement[] => Array.from(document.querySelectorAll<HTMLDetailsElement>(sel));
const before = (): void => { window.dispatchEvent(new Event('beforeprint')); };
const after = (): void => { window.dispatchEvent(new Event('afterprint')); };

beforeEach(() => {
  document.body.innerHTML = '';
  delete (window as unknown as { __FW_EXPORT__?: unknown }).__FW_EXPORT__;
  delete (window as unknown as { __FW_FEED__?: unknown }).__FW_FEED__;
  mount();
});

describe('before print the panels that carry evidence open', () => {
  it('the page has one code panel per record with a link, shut, with nothing drawn in it', () => {
    const qr = panels('details.fw-qr');
    expect(qr.length).toBe(3);
    for (const d of qr) {
      expect(d.open).toBe(false);
      expect(d.querySelector('.fw-qr-holder')!.children.length).toBe(0);
    }
  });

  it('opens every code panel and draws its code and its address, without waiting for the toggle event', () => {
    before();
    for (const d of panels('details.fw-qr')) {
      expect(d.open).toBe(true);
      const holder = d.querySelector('.fw-qr-holder')!;
      expect(holder.querySelector('svg'), 'the code').not.toBeNull();
      expect(holder.querySelector('.fw-qr-url')!.textContent).toMatch(/^https:\/\/x\.com\/person\/status\/10\d$/);
    }
  });

  it('opens the criteria and AI instructions, their prompts, and the interpretation', () => {
    expect(panels('details.fw-interpretation').length).toBe(1);
    before();
    for (const d of panels('details.fw-interpretation,details.fw-methodology,details.fw-mth-prompt')) expect(d.open, d.className).toBe(true);
    expect(html.includes('class="fw-methodology"'), 'the page carries the methodology panel').toBe(true);
    expect(panels('details.fw-methodology').length).toBe(1);
  });

  it('leaves the per-record verification rows as they were', () => {
    document.getElementById('fw-results')!.innerHTML = '<details class="fw-record fw-pass"><summary>row</summary></details>';
    before();
    expect((document.querySelector('#fw-results details') as HTMLDetailsElement).open).toBe(false);
  });
});

describe('"Show original wording" opens with the other evidence panels', () => {
  const softened = (): ForensicRecord[] => [{ ...records()[0], id: 'fr-s', neutralizedText: 'a calm version', originalText: 'the original wording' } as ForensicRecord];

  it('prints open, with the original words in it, and goes back after print', () => {
    mount(softened());
    const orig = panels('details.fw-orig-details');
    expect(orig.length, 'a softened card carries the panel').toBe(1);
    expect(orig[0].open).toBe(false);
    before();
    expect(orig[0].open).toBe(true);
    expect(orig[0].querySelector('.fw-orig')!.textContent).toBe('the original wording');
    after();
    expect(orig[0].open).toBe(false);
  });

  it('stays open if the reader had opened it on screen', () => {
    mount(softened());
    const orig = panels('details.fw-orig-details')[0];
    orig.open = true;
    before();
    after();
    expect(orig.open).toBe(true);
  });
});

describe('the hint to click a number is for a screen', () => {
  it('stands in its own span inside the note under the table, so paper can leave it out', () => {
    const hint = document.querySelector('.fw-numbers-note .fw-numbers-hint');
    expect(hint, 'the hint has its own element').not.toBeNull();
    expect(hint!.textContent).toBe(I18N.en.rdNumbersHint);
    // The count sentence beside it is still there, outside the span.
    expect(document.querySelector('.fw-numbers-note')!.textContent!.replace(I18N.en.rdNumbersHint, '').trim().length).toBeGreaterThan(10);
  });
});

describe('after print each panel goes back as the reader had it', () => {
  it('shuts what print opened and keeps what the reader opened on screen', () => {
    const [first, second, third] = panels('details.fw-qr');
    second.open = true;
    const interp = panels('details.fw-interpretation')[0];
    before();
    expect([first.open, second.open, third.open, interp.open]).toEqual([true, true, true, true]);
    after();
    expect([first.open, second.open, third.open, interp.open]).toEqual([false, true, false, false]);
    expect(panels('details.fw-methodology')[0].open).toBe(false);
  });

  it('a second print opens them again, and the code is drawn once', () => {
    before(); after(); before();
    for (const d of panels('details.fw-qr')) expect(d.querySelectorAll('svg').length).toBe(1);
    expect(panels('details.fw-qr').every((d) => d.open)).toBe(true);
  });
});
