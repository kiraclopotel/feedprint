/** @vitest-environment jsdom */
//
// Evidence-gap register item 20, part 3 (2026-09-06): the model's reading is
// set apart from what the software read off the page, under a heading that
// says the signature covers storage and not correctness, with the measured
// operating point stated once above the feed. Two quick wins ride along: the
// record hash on its verification card, and the backup restore remembering
// the backup's public key.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import type { ForensicRecord } from '../../../src/types/forensic';
import { readSource } from '../../helpers/read-source';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

/** The export builder is four files since 2026-09-16 (PLAN-2026-09-16 item 10.1): the builder, the
 *  scripts the page carries, the stylesheet, and the string table under i18n. A scan of "the
 *  export's source" reads all four through readSource, which refuses an emptied or re-export-only
 *  file, so a later split cannot turn this scan into an empty pass. */
const EXPORT_SOURCES = [
  'src/forensics/html-export.ts',
  'src/forensics/html-export-scripts.ts',
  'src/forensics/html-export-styles.ts',
  'src/i18n/export-strings.ts',
];
const exportSource = (): string => EXPORT_SOURCES.map((p) => readSource(p)).join(String.fromCharCode(10));


const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

function rec(i: number, over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: `r-${i}`, timestamp: `2026-07-01T10:00:0${i}.000Z`, platform: 'tiktok', originalText: `post ${i}`, originalHash: 'h',
    originalLength: 6, neutralizedText: '', author: '@user', postUrl: '', techniques: [], overallScore: 0, userAgeCategory: 'teen',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: i, kind: 'post', verdict: 'pass', ...over,
  } as ForensicRecord;
}

const META: ExportMetadata = { fwVersion: 'V', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp16', locale: 'en' };

function renderFeed(records: ForensicRecord[]): HTMLElement {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

describe('the feed sets the reading apart', () => {
  it('a flagged card carries its tags inside the reading block under the heading; a plain pass card has no block', () => {
    const feed = renderFeed([
      rec(0, { verdict: 'flagged', techniques: [{ name: 'fear-appeal', severity: 6, confidence: 0.8 }] as ForensicRecord['techniques'] }),
      rec(1),
    ]);
    const cards = [...feed.querySelectorAll('article.fw-item')];
    expect(cards).toHaveLength(2);
    const flagged = cards.find(c => c.querySelector('.fw-tags'))!;
    const block = flagged.querySelector('.fw-opinion')!;
    expect(block).not.toBeNull();
    // The heading no longer repeats inside every card (his own count: about 45% of a card's
    // height, RECORD-VIEW-BRIEF-2026-09-27.md); it is said once at the page's own intro instead.
    expect(block.querySelector('.fw-opinion-head')).toBeNull();
    expect(block.querySelector('.fw-tags')).not.toBeNull();
    // The facts stay outside the block.
    expect(block.querySelector('.fw-item-head')).toBeNull();
    expect(block.querySelector('.fw-item-text')).toBeNull();
    expect(flagged.querySelector(':scope > .fw-tags')).toBeNull();
    const plain = cards.find(c => !c.querySelector('.fw-tags'))!;
    expect(plain.querySelector('.fw-opinion')).toBeNull();
  });

  it('the method sentence appears once above the cards and names the measurement', () => {
    const feed = renderFeed([rec(0)]);
    const heads = feed.querySelectorAll('.fw-feed-opinion-head');
    expect(heads).toHaveLength(1);
    expect(heads[0].textContent).toBe(I18N.en.feedOpinionHeader);
    const notes = feed.querySelectorAll('.fw-feed-opinion-note');
    expect(notes).toHaveLength(1);
    expect(notes[0].textContent).toBe(I18N.en.feedOpinionNote);
    expect(I18N.en.feedOpinionNote).toContain('2026-09-03');
    expect(I18N.en.feedOpinionNote).toContain('above 89 percent');
    expect(I18N.en.feedOpinionNote).toContain('58.8 percent');
    expect(I18N.en.feedOpinionNote).toContain('unmeasured');
  });

  it('every interface language carries the heading, the note and the hash label', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      expect(I18N[locale].feedOpinionHeader.length).toBeGreaterThan(20);
      expect(I18N[locale].feedOpinionNote).toContain('2026-09-03');
      expect(I18N[locale].perRecordHash.length).toBeGreaterThan(3);
    }
  });
});

describe('the verification card and the two quick wins (source lock)', () => {
  const src = exportSource();

  it('the card prints the record hash and puts the classification inside the reading block', () => {
    expect(src).toContain("hashRow.appendChild(el('code',null,[r.integrityHash]));");
    expect(src).toContain("var rop=el('div',{'class':'fw-opinion'},[el('div',{'class':'fw-opinion-head'},[i18n.feedOpinionHeader])]);");
  });

  it('the backup restore remembers the backup public key before the private-key branch', () => {
    const b = read('src/forensics/backup.ts');
    const remember = b.indexOf('await rememberPublicKeys([backup.publicKeyJwk]);');
    const branch = b.indexOf('// Stage 4 — decrypt and validate the incoming key without persisting it.');
    expect(remember).toBeGreaterThan(0);
    expect(branch).toBeGreaterThan(remember);
  });

  // The restore remembered the INCOMING key and not the one it was dropping.
  // Anything still on the device signed under the outgoing key — an archived
  // month, a salvaged record, a record that arrived late through the outbox —
  // then had no key left to check against and read as an unverifiable prior
  // key in the next export. Storing a PUBLIC key proves nothing on its own; it
  // is what lets a recipient check a signature that was already made.
  it('the backup restore remembers the OUTGOING key before it replaces the identity', () => {
    const b = read('src/forensics/backup.ts');
    const remember = b.indexOf('await rememberPublicKeys([await getPublicKeyJWK()]);');
    const commit = b.indexOf('await commitSigningKeyRestore(stagedKey);');
    expect(remember).toBeGreaterThan(0);
    expect(commit).toBeGreaterThan(remember);
  });

  it('the dashboard stat is called the key in every language', () => {
    for (const [locale, t] of Object.entries(DASHBOARD_STRINGS)) {
      expect((t as { chainStatAnchor: string }).chainStatAnchor.toLowerCase(), locale).not.toMatch(/anch|ancor|ancl|âncor/);
    }
  });
});
