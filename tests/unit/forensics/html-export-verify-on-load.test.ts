/** @vitest-environment jsdom */
//
// Evidence-gap register item 16 (2026-09-06): the readable feed used to render
// with no check at all, and verification waited on a button most readers never
// pressed. Now the verifier runs when the page opens, publishes one verdict per
// record, and the feed says "not yet checked" until then and stamps every card
// after, including cards drawn later by the "show more" button. Locks: the
// feed's behavior in jsdom against a published verdict set, and the verifier's
// on-load run, publication and yield by source.

import { describe, it, expect } from 'vitest';
import {
  buildForensicHtmlExport,
  FEED_SCRIPT,
  I18N,
  VERIFIER_CORE_FNS_SOURCE,
  type ExportMetadata,
} from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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


function rec(i: number): ForensicRecord {
  return {
    id: `r-${i}`,
    timestamp: new Date(Date.UTC(2026, 6, 1, 10, 0, i)).toISOString(),
    platform: 'tiktok',
    originalText: `post ${i}`,
    originalHash: 'h',
    originalLength: 6,
    neutralizedText: '',
    author: '@user',
    postUrl: '',
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp',
    chainPosition: i,
    kind: 'post',
    verdict: 'pass',
  } as ForensicRecord;
}

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'fp16',
  locale: 'en',
};

type Verdicts = { state: string; byId: Record<string, { cls: string; label: string; icon: string }> };
const w = window as unknown as { __FW_EXPORT__: unknown; __FW_VERDICTS__?: Verdicts };

function renderFeed(records: ForensicRecord[]): HTMLElement {
  const html = buildForensicHtmlExport(records, META);
  const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
  w.__FW_EXPORT__ = JSON.parse(m![1]);
  delete w.__FW_VERDICTS__;
  document.body.innerHTML = '<div id="fw-feed"></div>';
  new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
  return document.getElementById('fw-feed') as HTMLElement;
}

function publish(byId: Verdicts['byId'], state = 'verified'): void {
  w.__FW_VERDICTS__ = { state, byId };
  document.dispatchEvent(new CustomEvent('fw-verified'));
}

describe('the feed before and after the on-load verification', () => {
  it('says not yet checked, then stamps every card and drops the line', () => {
    const feed = renderFeed([rec(0), rec(1), rec(2)]);
    const line = feed.querySelector('.fw-feed-unchecked');
    expect(line?.textContent).toBe(I18N.en.feedUnchecked);
    const cards = feed.querySelectorAll('article.fw-item');
    expect(cards).toHaveLength(3);
    cards.forEach(c => {
      expect(c.classList.contains('fw-item-unchecked')).toBe(true);
      expect(c.querySelector('.fw-item-verdict')).toBeNull();
    });

    publish({
      'r-0': { cls: 'pass', label: 'signature verified', icon: '✓ ' },
      'r-1': { cls: 'fail', label: 'failed verification', icon: '✗ ' },
      'r-2': { cls: 'warn', label: 'signature not verified', icon: '⚠ ' },
    });

    expect(feed.querySelector('.fw-feed-unchecked')).toBeNull();
    const byId = (id: string) => [...feed.querySelectorAll('article.fw-item')].find(a => a.querySelector('.fw-item-serial')?.textContent === `#${id.slice(2)}`)!;
    const c0 = byId('r-0'), c1 = byId('r-1'), c2 = byId('r-2');
    expect(c0.classList.contains('fw-item-pass')).toBe(true);
    expect(c0.querySelector('.fw-item-verdict')?.textContent).toBe('✓ signature verified');
    expect(c1.classList.contains('fw-item-fail')).toBe(true);
    expect(c1.querySelector('.fw-item-verdict-fail')?.textContent).toBe('✗ failed verification');
    expect(c2.classList.contains('fw-item-warn')).toBe(true);
    // The verdict line sits right under the head, before the body.
    expect(c0.children[0].classList.contains('fw-item-head')).toBe(true);
    expect(c0.children[1].classList.contains('fw-item-verdict')).toBe(true);
    // A re-run replaces, never duplicates.
    publish({ 'r-0': { cls: 'warn', label: 'signature not verified', icon: '⚠ ' } });
    expect(c0.querySelectorAll('.fw-item-verdict')).toHaveLength(1);
    expect(c0.classList.contains('fw-item-warn')).toBe(true);
    expect(c0.classList.contains('fw-item-pass')).toBe(false);
  });

  it('a page drawn after the verdicts arrived is stamped as it renders', () => {
    const records = Array.from({ length: 260 }, (_, i) => rec(i));
    const feed = renderFeed(records);
    expect(feed.querySelectorAll('article.fw-item')).toHaveLength(250);
    const byId: Verdicts['byId'] = {};
    for (const r of records) byId[r.id] = { cls: 'pass', label: 'signature verified', icon: '✓ ' };
    publish(byId);
    (feed.querySelector('button.fw-feed-more') as HTMLButtonElement).click();
    const cards = feed.querySelectorAll('article.fw-item');
    expect(cards).toHaveLength(260);
    expect(feed.querySelectorAll('article.fw-item-pass')).toHaveLength(260);
    expect(feed.querySelectorAll('.fw-item-verdict')).toHaveLength(260);
  });

  it('a record the verifier did not name stays unchecked', () => {
    const feed = renderFeed([rec(0), rec(1)]);
    publish({ 'r-0': { cls: 'pass', label: 'signature verified', icon: '✓ ' } });
    expect(feed.querySelectorAll('article.fw-item-pass')).toHaveLength(1);
    expect(feed.querySelectorAll('article.fw-item-unchecked')).toHaveLength(1);
  });
});

describe('the verifier runs on load and publishes (source lock)', () => {
  const src = exportSource();
  const script = src.slice(src.indexOf('const VERIFIER_SCRIPT_TEMPLATE = `'), src.indexOf('export const FEED_SCRIPT'));

  it('runs once the button is wired, when Web Crypto exists, and re-enables the button as a re-run', () => {
    expect(script).toContain("if(btn)btn.addEventListener('click',runVerification);");
    expect(script).toContain('if(btn&&window.crypto&&window.crypto.subtle) runVerification();');
    expect(script).toContain('btn.disabled=false;');
  });

  it('publishes one verdict per record id and announces it, after yielding through the loop', () => {
    expect(script).toContain('window.__FW_VERDICTS__={state:state,byId:byId};');
    expect(script).toContain("document.dispatchEvent(new CustomEvent('fw-verified'))");
    expect(script).toContain('var done=await Promise.all(batch);');
    expect(script).toContain('if(Date.now()-lastYield>50){ await new Promise(function(r){setTimeout(r,0);}); lastYield=Date.now(); }');
    // The results list and the feed read the same function.
    expect(script).toContain('function verdictView(pr,i18n)');
    expect(script.match(/verdictView\(/g)?.length).toBe(3);
    expect(VERIFIER_CORE_FNS_SOURCE).not.toContain('verdictView');
  });

  // PLAN-2026-09-14 item 6: the reference list is one line per record, its
  // detail built on first open, drawn 500 lines at a time. A full card per
  // record doubled the page (89,147 nodes on 10,000 records; 7,491 after, and
  // verification finished in 1.8 s instead of 2.8 s warm, measured 2026-09-15).
  it('renders one collapsed line per record, builds detail on open, and pages', () => {
    expect(script).toContain("var card=el('details',{'class':'fw-record fw-'+view.cls});");
    expect(script).toContain("if(card.open&&!card.__fwBuilt){card.__fwBuilt=true;recordDetail(card,r,pr);}");
    expect(script).toContain('var RESULTS_PAGE=500');
    expect(script).not.toContain("var card=el('div',{'class':'fw-record");
  });

  it('every interface language carries the not-yet-checked line', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      expect(I18N[locale].feedUnchecked.length).toBeGreaterThan(20);
    }
  });
});
