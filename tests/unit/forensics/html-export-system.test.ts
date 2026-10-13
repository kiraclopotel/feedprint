/** @vitest-environment jsdom */
//
// The export speaks one system (12 Oct 2026, export polish U8, rows 42, 48, 49, 51, 52). Read on a built demo export in a browser:
//   - every verification row printed the internal id ('twitter') where the rest of the page says X, Facebook, TikTok;
//   - the file used 29 type sizes from 9.6 to 25.6 px, 13 of them between 12.0 and 15.7 px and a few tenths apart;
//   - the boxes of one kind had left paddings of 14, 15, 17, 18 and 19 px and at least eight different paddings in all;
//   - the big word beside the first-screen sentence was one size whatever it said: 'VERIFIED' fits, a report's or a failed
//     check's sentence does not;
//   - the 36 numbers of the 'what the feed showed' table were bare buttons ('885, toggle button'), its first header cell was
//     empty and the platform buttons had no group name.

import { describe, expect, it, beforeEach } from 'vitest';
import { buildForensicHtmlExport, READING_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import { CERT_SCRIPT, VERIFIER_SCRIPT_TEMPLATE } from '../../../src/forensics/html-export-scripts';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';
import type { ForensicRecord } from '../../../src/types/forensic';

let seq = 0;
function rec(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  seq++;
  return {
    id: `s-${seq}`, timestamp: new Date(Date.parse('2026-09-15T10:00:00Z') + seq * 60_000).toISOString(), platform: 'twitter',
    originalText: `post ${seq}`, originalHash: `h-${seq}`, originalLength: 6, neutralizedText: '', author: `@a${seq}`, postUrl: '',
    techniques: [], overallScore: 0, userAgeCategory: 'teen', aiSource: 'cloud', feedSource: 'for-you', integrityHash: `i-${seq}`,
    signature: 'sig', publicKeyFingerprint: 'fp', chainPosition: seq, kind: 'post', verdict: 'pass', ...overrides,
  } as ForensicRecord;
}
const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' }, publicKeyFingerprint: 'fp16', locale: 'en',
};
const w = window as unknown as { __FW_EXPORT__?: unknown; crypto?: unknown };

beforeEach(() => { document.body.innerHTML = ''; seq = 0; delete w.__FW_EXPORT__; });

describe('a verification row names the platform as the rest of the page does (row 42)', () => {
  it('maps the five platform ids to their names in the checker\'s row and its detail line, and leaves an unknown id as it is', () => {
    expect(VERIFIER_SCRIPT_TEMPLATE).toContain("var PN={twitter:'X',facebook:'Facebook',youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram'};");
    expect(VERIFIER_SCRIPT_TEMPLATE.split('(PN[r.platform]||r.platform)').length - 1).toBe(2);
    expect(VERIFIER_SCRIPT_TEMPLATE).not.toContain("+r.platform+");
  });
});

describe('the big word of the first screen is set smaller when it is long (row 51)', () => {
  const mountCert = (word: string): HTMLElement => {
    w.__FW_EXPORT__ = { i18n: {}, records: [], locale: 'en' };
    Object.defineProperty(window, 'crypto', { value: { subtle: {} }, configurable: true });
    document.body.innerHTML =
      '<div class="fw-brandrow"></div><h1>Title</h1><div id="fw-status"><div class="fw-chain-summary fw-pass"><h2>Result: ' + word + '</h2></div></div>';
    new Function(CERT_SCRIPT)();
    return document.querySelector('.fw-cert-word') as HTMLElement;
  };

  it('keeps VERIFIED at the large size and sets a sentence of more than twenty characters at the smaller one', () => {
    const short = mountCert('VERIFIED');
    expect(short.textContent).toBe('VERIFIED');
    expect(short.classList.contains('fw-cert-long')).toBe(false);
    document.body.innerHTML = '';
    const long = mountCert('Verified as a report of 12 of 14 records');
    expect(long.textContent).toBe('Verified as a report of 12 of 14 records');
    expect(long.classList.contains('fw-cert-long')).toBe(true);
  });

  it('sets the smaller size in the stylesheet, more specific than the word\'s own rule', () => {
    const style = buildForensicHtmlExport([rec()], META).match(/<style>([\s\S]*?)<\/style>/)![1];
    expect(style).toMatch(/\.fw-cert-word\.fw-cert-long\{font-size:1\.25rem;line-height:1\.2;letter-spacing:0;\}/);
  });
});

describe('a screen reader hears what a number counts (row 52)', () => {
  function mountReading(records: ForensicRecord[]): void {
    const html = buildForensicHtmlExport(records, META);
    w.__FW_EXPORT__ = JSON.parse(html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1]);
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="application/json"'));
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${READING_SCRIPT}`)();
  }
  const records = (): ForensicRecord[] => [rec(), rec(), rec({ platform: 'facebook' })];

  it('gives each number button a name made of the row, the column and the figure', () => {
    mountReading(records());
    const x = document.querySelector('#fw-reading-numbers tr[data-platform="twitter"] button[data-col="impressions"]') as HTMLElement;
    expect(x.getAttribute('aria-label')).toBe(`X: ${I18N.en.rdColImpressions} 2`);
    expect(x.textContent).toBe('2');
    const fb = document.querySelector('#fw-reading-numbers tr[data-platform="facebook"] button[data-col="uniquePosts"]') as HTMLElement;
    expect(fb.getAttribute('aria-label')).toBe(`Facebook: ${I18N.en.rdColUnique} 1`);
    const total = document.querySelector('#fw-reading-numbers tr[data-platform="total"] button[data-col="impressions"]') as HTMLElement;
    expect(total.getAttribute('aria-label')).toBe(`${I18N.en.rdTotal}: ${I18N.en.rdColImpressions} 3`);
    // Every number in the table is named.
    const bare = [...document.querySelectorAll('#fw-reading-numbers button.fw-num')].filter((b) => !b.getAttribute('aria-label'));
    expect(bare).toHaveLength(0);
  });

  it('names the group of platform buttons and the first column of the table with a string the file already carries', () => {
    mountReading(records());
    expect(document.getElementById('fw-reading-marks')!.getAttribute('aria-label')).toBe(I18N.en.perRecordPlatform);
    expect(document.querySelector('#fw-reading-numbers thead th')!.getAttribute('aria-label')).toBe(I18N.en.perRecordPlatform);
  });
});

describe('the stylesheet: one padding, one type scale (rows 48, 49)', () => {
  const style = buildForensicHtmlExport([rec()], META).match(/<style>([\s\S]*?)<\/style>/)![1].replace(/\/\*[\s\S]*?\*\//g, '');
  const ruleOf = (selectors: string): string => {
    const hits: string[] = [];
    for (const m of style.matchAll(/(^|[}\n])\s*([^{}@/][^{}]*)\{([^{}]*)\}/g)) {
      if (m[2].split(',').map((x) => x.trim()).join(',') === selectors) hits.push(m[3].replace(/\s+/g, ' '));
    }
    expect(hits.length, `a rule for ${selectors}`).toBeGreaterThan(0);
    return hits[hits.length - 1];
  };

  it('gives the boxes of one kind one padding and one margin, on the 4, 8, 12, 16 scale (row 49)', () => {
    const boxes = ruleOf('.fw-summary,.fw-anchors,.fw-exposure,.fw-completeness,.fw-people,.fw-methodology,.fw-chain-summary,.fwb-card');
    expect(boxes).toContain('padding:16px 20px');
    expect(boxes).toContain('margin:16px 0');
    expect(ruleOf('.fw-stat,.fw-exp-stat')).toContain('padding:12px 16px');
    expect(ruleOf('.fw-interpretation')).toContain('padding:8px 16px');
    expect(ruleOf('.fw-interpretation')).toContain('margin:16px 0');
  });

  it('defines four type steps once, in the page tokens (row 48)', () => {
    expect(style).toContain('--t1:.7rem;--t2:.8rem;--t3:.9rem;--t4:1rem;');
  });

  it('writes no size between the steps: every running-text size is one of the four tokens', () => {
    const sizes = [...style.matchAll(/font-size:\s*([^;}\s!]+)/g)].map((m) => m[1]);
    const tokens = sizes.filter((s) => /^var\(--t[1-4]\)$/.test(s));
    const others = [...new Set(sizes.filter((s) => !/^var\(--t[1-4]\)$/.test(s)))];
    expect(tokens.length, 'sizes on the scale').toBeGreaterThan(100);
    // What stays off the scale: the headings, the figures, the certificate's own sizes, the brand word and the narrow table.
    expect(others.sort()).toEqual(['.85em', '1.15rem', '1.2rem', '1.25rem', '1.5rem', '1.6rem', '14px', '15px', 'clamp(1.35rem,2.4vw,1.85rem)', 'clamp(1.5rem,2.8vw,2rem)'].sort());
    // None of the old in-between sizes is left in any rule.
    for (const old of ['.6rem', '.62rem', '.66rem', '.68rem', '.72rem', '.74rem', '.75rem', '.76rem', '.78rem', '.82rem', '.85rem', '.86rem', '.88rem', '.92rem', '.95rem', '.98rem', '1.05rem', '16px']) {
      expect(sizes, old).not.toContain(old);
    }
  });

  it('puts the page body, the card text and the small labels on named steps', () => {
    expect(ruleOf('.fw-stat span')).toContain('font-size:var(--t2)');
    expect(ruleOf('.fw-item-text')).toContain('font-size:var(--t4)'); // a post is the card's primary text (12 Oct, small commit after the Tester's read)
    expect(style).toMatch(/body\{font-family:[^}]*font-size:var\(--t4\)/);
  });
});
