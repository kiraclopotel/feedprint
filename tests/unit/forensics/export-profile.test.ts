/** @vitest-environment jsdom */
//
// The export names its maker (forensics/profile.ts).
//
// Owner, 14 Sep 2026: an export read as if nobody owned it. Page one said "no
// name" and the page said "this device". A receipt handed to a stranger has to
// say whose it is, in the sender's own chosen word, and which machine made it
// in the facts Chrome actually exposes. What Chrome does not expose (the OS
// account name) is never claimed.

import { describe, it, expect } from 'vitest';
import {
  collectMachineFacts, machineLine, normalizeProfileName, profileNameSlug, PROFILE_NAME_MAX,
} from '../../../src/forensics/profile';
import {
  buildForensicHtmlExport, attachSignedManifest, extractProvenanceRows, type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

function rec(i: number): ForensicRecord {
  return {
    id: `r-${i}`, timestamp: `2026-07-01T10:00:0${i}.000Z`, platform: 'facebook', originalText: `post ${i}`, originalHash: 'h',
    originalLength: 6, neutralizedText: '', author: `author-${i}`, postUrl: `https://x/${i}`, techniques: [], overallScore: 0, userAgeCategory: 'adult',
    aiSource: 'cloud', feedSource: 'for-you', integrityHash: 'deadbeef', signature: 'sig', publicKeyFingerprint: 'fp',
    chainPosition: i, kind: 'post', verdict: 'pass', sourceContainer: 'Chess Move of the Day',
  } as ForensicRecord;
}

const BASE: ExportMetadata = {
  fwVersion: 'V-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};

const MACHINE = { platform: 'Windows', browser: 'Chrome 130', language: 'en-GB', timeZone: 'Europe/Bucharest' };

function textOf(html: string, prov: string): string | null {
  const m = new RegExp(`<(?:dd|p) data-fw-prov="${prov}">([\\s\\S]*?)</(?:dd|p)>`).exec(html);
  return m ? m[1].replace(/<[^>]*>/g, '') : null;
}

describe('the chosen name', () => {
  it('is trimmed, collapsed and capped; empty is null', () => {
    expect(normalizeProfileName('  Jordan   P. ')).toBe('Jordan P.');
    expect(normalizeProfileName('')).toBeNull();
    expect(normalizeProfileName('   ')).toBeNull();
    expect(normalizeProfileName(42)).toBeNull();
    expect(normalizeProfileName('x'.repeat(200))!.length).toBe(PROFILE_NAME_MAX);
  });

  it('becomes a filename part with only letters, digits and dashes', () => {
    expect(profileNameSlug('Ștefan Vodă / 2026')).toBe('stefan-voda-2026');
    expect(profileNameSlug('***')).toBeNull();
    expect(profileNameSlug(null)).toBeNull();
  });
});

describe('the machine facts', () => {
  it('reads what Chrome exposes and nothing else', () => {
    const facts = collectMachineFacts({
      userAgentData: { platform: 'Windows', brands: [{ brand: 'Not A Brand', version: '99' }, { brand: 'Google Chrome', version: '130' }, { brand: 'Chromium', version: '130' }] },
      language: 'en-GB',
    } as never);
    expect(facts.platform).toBe('Windows');
    expect(facts.browser).toBe('Chrome 130');
    expect(facts.language).toBe('en-GB');
    expect(typeof facts.timeZone === 'string' || facts.timeZone === null).toBe(true);
    // No field an extension cannot read.
    expect(Object.keys(facts).sort()).toEqual(['browser', 'language', 'platform', 'timeZone']);
  });

  it('falls back to the user agent string, and to null when there is nothing', () => {
    const ua = collectMachineFacts({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36', language: 'pt-BR' } as never);
    expect(ua.platform).toBe('macOS');
    expect(ua.browser).toBe('Chrome 128');
    const none = collectMachineFacts({} as never);
    expect(none.platform).toBeNull();
    expect(none.browser).toBeNull();
    expect(none.language).toBeNull();
  });

  it('prints as one comma line, skipping what is missing', () => {
    expect(machineLine(MACHINE)).toBe('Windows, Chrome 130, en-GB, Europe/Bucharest');
    expect(machineLine({ platform: 'Linux', browser: null, language: null, timeZone: 'UTC' })).toBe('Linux, UTC');
    expect(machineLine({ platform: null, browser: null, language: null, timeZone: null })).toBe('');
  });
});

describe('page one', () => {
  it('names the maker by the chosen name, says it is a chosen name, and names the machine', () => {
    const html = buildForensicHtmlExport([rec(0), rec(1)], { ...BASE, profile: { name: 'Jordan', ...MACHINE } });
    expect(textOf(html, 'madeBy')).toContain('Jordan');
    expect(textOf(html, 'madeBy')).toContain('a name chosen by the person who made this file');
    expect(textOf(html, 'machine')).toBe('Windows, Chrome 130, en-GB, Europe/Bucharest');
    // The disclosure sentence stops saying "no name" once there is one.
    expect(textOf(html, 'discloses')).toContain('This file names you as Jordan, a name you chose.');
    expect(textOf(html, 'discloses')).not.toContain('This file carries no name');
  });

  it('with no name, still names the machine and says the file carries no name', () => {
    const html = buildForensicHtmlExport([rec(0)], { ...BASE, profile: { name: null, ...MACHINE } });
    expect(textOf(html, 'madeBy')).toBeNull();
    expect(textOf(html, 'machine')).toBe('Windows, Chrome 130, en-GB, Europe/Bucharest');
    expect(textOf(html, 'discloses')).toContain('This file carries no name');
  });

  it('says the browser reported nothing rather than inventing a machine', () => {
    const html = buildForensicHtmlExport([rec(0)], { ...BASE, profile: { name: null, platform: null, browser: null, language: null, timeZone: null } });
    expect(textOf(html, 'machine')).toBe('not reported by the browser');
  });

  it('is silent when no profile was supplied, so older callers and fixtures render as before', () => {
    const html = buildForensicHtmlExport([rec(0)], BASE);
    expect(html).not.toContain('data-fw-prov="madeBy"');
    expect(html).not.toContain('data-fw-prov="machine"');
  });

  it('escapes the name and carries it in the payload', () => {
    const html = buildForensicHtmlExport([rec(0)], { ...BASE, profile: { name: '<b>x</b> & y', ...MACHINE } });
    expect(textOf(html, 'madeBy')).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)!;
    const data = JSON.parse(m[1]) as { profile?: { name: string | null; platform: string | null } };
    expect(data.profile?.name).toBe('<b>x</b> & y');
    expect(data.profile?.platform).toBe('Windows');
  });

  it('is signed: the maker and machine rows are among the provenance rows the manifest digests', async () => {
    const html = await attachSignedManifest(
      buildForensicHtmlExport([rec(0)], { ...BASE, profile: { name: 'Jordan', ...MACHINE } }),
      async () => 'sig',
    );
    const rows = extractProvenanceRows(html);
    const keys = rows.map(r => r[0]);
    expect(keys).toContain('madeBy');
    expect(keys).toContain('machine');
    expect(rows.find(r => r[0] === 'madeBy')![1]).toContain('Jordan');
  });

  it('speaks the other three interface languages', () => {
    for (const [locale, made] of [['ro', 'Făcut de'], ['es', 'Hecho por'], ['pt-BR', 'Feito por']] as const) {
      const html = buildForensicHtmlExport([rec(0)], { ...BASE, locale, profile: { name: 'Jordan', ...MACHINE } });
      expect(html).toContain(made);
      expect(html).toContain('Jordan');
    }
  });
});
