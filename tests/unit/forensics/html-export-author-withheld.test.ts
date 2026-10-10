/** @vitest-environment jsdom */
//
// A record whose author the recorder refused must say so in the file a
// recipient opens, in the language the file was written in.
//
// The value of the export is that a stranger can read what happened without
// trusting the person who made it. A row with no author and the page's own
// address, printed like any other, invites exactly the wrong reading: an
// ordinary post by an account called "unknown". The file now prints the plain
// sentence instead, and the printed word comes from the record's own
// authorCapture, which is inside the signature.

import { describe, it, expect } from 'vitest';
import { buildForensicHtmlExport, FEED_SCRIPT, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { I18N as EXPORT_I18N } from '../../../src/i18n/export-strings';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'r-withheld',
    timestamp: '2026-09-17T10:00:00Z',
    platform: 'twitter',
    originalText: 'a post the recorder read while the slot was being reused',
    originalHash: 'h',
    originalLength: 56,
    neutralizedText: '',
    author: 'unknown',
    postUrl: 'https://x.com/home',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: 1,
    kind: 'post',
    verdict: 'pass',
    ...overrides,
  } as ForensicRecord;
}

const META = (locale: ExportMetadata['locale']): ExportMetadata => ({
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale,
});

function renderFeed(records: ForensicRecord[], locale: ExportMetadata['locale'] = 'en'): HTMLElement {
  const html = buildForensicHtmlExport(records, META(locale));
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(m![1]);
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

describe('the export says when an author was refused', () => {
  it.each(['en', 'ro', 'es', 'pt-BR'] as const)('%s: the reading view prints the sentence and the label', locale => {
    const feed = renderFeed([rec({ authorCapture: 'withheld' })], locale);
    const strings = EXPORT_I18N[locale];

    expect(feed.textContent).toContain(strings.feedAuthorWithheldWhy);
    expect(feed.querySelector('.fw-item-author')?.textContent).toBe(strings.feedAuthorWithheld);
    // The handle the recorder refused is nowhere on the item.
    expect(feed.textContent).not.toContain('unknown');
  });

  it('prints nothing of the kind on a record whose author the page gave', () => {
    const feed = renderFeed([rec({ author: '@someone' })]);
    expect(feed.textContent).not.toContain(EXPORT_I18N.en.feedAuthorWithheldWhy);
    expect(feed.querySelector('.fw-item-author')?.textContent).toBe('@someone');
  });

  it('the word the file prints comes from the record, so it travels with the signature', () => {
    // The same record, once with the admission and once without, must produce
    // two different files. If the sentence were derived from "the author is
    // empty" instead, a stripped field would print the same page and the
    // reader could not tell a refusal from a failed read.
    const withAdmission = buildForensicHtmlExport([rec({ authorCapture: 'withheld' })], META('en'));
    const without = buildForensicHtmlExport([rec()], META('en'));
    expect(withAdmission).not.toBe(without);
    expect(withAdmission).toContain('"authorCapture":"withheld"');
    // Read the record payload, not the whole file: since 2026-09-17 the
    // embedded checker also carries the field NAME, in the key list it uses to
    // tell an unknown field from a missing one, and a whole-file search would
    // find that instead of the record.
    const payloadOf = (html: string): string =>
      html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1];
    expect(payloadOf(without)).not.toContain('authorCapture');
    expect(payloadOf(withAdmission)).toContain('"authorCapture":"withheld"');
  });
});
