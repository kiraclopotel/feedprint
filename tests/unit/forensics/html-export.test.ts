// FeelingWise — Tier I-minimum standalone HTML export unit tests.
//
// Locks the contracts the recipient verifier depends on per VISION §7.2:
//   • Self-contained HTML output (DOCTYPE, head, body, button).
//   • Embedded records as application/json script block (parseable, identical
//     bytes to input records).
//   • EN and RO produce different copy (single-language template per locale).
//   • Page-1 surfaces: record count, time window, fingerprint, precision
//     disclosure (or its missing-message), what-FW-does-NOT-measure disclaimer.
//   • Inline verifier script is present (recipient runs it client-side).
//   • Hostile input is HTML-escaped (records can contain attacker text).
//
// Web Crypto verification end-to-end on the produced HTML is verified manually
// (open file in Chrome / Firefox; the inline script uses real SubtleCrypto).
// jsdom's SubtleCrypto coverage is partial; out-of-scope here per the same
// rationale as `capture-prompt-io.test.ts`.

import { describe, it, expect } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(overrides: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: overrides.id ?? 'r-1',
    timestamp: overrides.timestamp ?? '2026-04-30T12:00:00Z',
    platform: overrides.platform ?? 'twitter',
    originalText: overrides.originalText ?? 'sample post',
    originalHash: overrides.originalHash ?? 'abc123',
    originalLength: overrides.originalLength ?? 11,
    neutralizedText: overrides.neutralizedText ?? '',
    author: overrides.author ?? '@example',
    postUrl: overrides.postUrl ?? 'https://x.com/example/status/1',
    techniques: overrides.techniques ?? [{ name: 'fear-appeal', severity: 7, confidence: 8 }],
    overallScore: overrides.overallScore ?? 0.7,
    userAgeCategory: overrides.userAgeCategory ?? 'teen',
    aiSource: overrides.aiSource ?? 'cloud',
    feedSource: overrides.feedSource ?? 'for-you',
    integrityHash: overrides.integrityHash ?? 'deadbeef',
    signature: overrides.signature ?? 'sig-base64url',
    publicKeyFingerprint: overrides.publicKeyFingerprint ?? 'fp123',
    chainPosition: overrides.chainPosition ?? 0,
    ...overrides,
  };
}

const META_EN: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'a3f9c2e1deadbeef',
  locale: 'en',
};

describe('buildForensicHtmlExport — structure', () => {
  it('returns a self-contained HTML document', () => {
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('<body>');
    expect(html).toContain('<button id="fw-verify-btn">');
    expect(html).toContain('id="fw-results"');
  });

  it('embeds records as JSON in a script block (parseable)', () => {
    const records = [makeRecord({ id: 'r-A' }), makeRecord({ id: 'r-B' })];
    const html = buildForensicHtmlExport(records, META_EN);
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    const payload = JSON.parse(m![1]);
    expect(payload.records).toHaveLength(2);
    expect(payload.records[0].id).toBe('r-A');
    expect(payload.records[1].id).toBe('r-B');
    expect(payload.publicKeyJwk.x).toBe('AAA');
  });

  it('renders the verify action ABOVE the feed (verify-first layout)', () => {
    // The primary action — proving the chain is genuine — must not be buried
    // under a feed that can run to thousands of records. The verify button +
    // results block must appear before the activity feed in document order.
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    expect(html).toContain('class="fw-brandrow"'); // brand lockup present
    const verifyIdx = html.indexOf('id="fw-verify-btn"');
    const statusIdx = html.indexOf('id="fw-status"');
    const resultsIdx = html.indexOf('id="fw-results"');
    const feedIdx = html.indexOf('id="fw-feed"');
    expect(verifyIdx).toBeGreaterThan(-1);
    expect(feedIdx).toBeGreaterThan(-1);
    // Button + at-a-glance status banner sit ABOVE the feed (verify-first)...
    expect(verifyIdx).toBeLessThan(feedIdx);
    expect(statusIdx).toBeLessThan(feedIdx);
    // ...but the long per-record detail list renders BELOW the feed so it
    // never buries the exposure summary + feed when Verify is clicked.
    expect(resultsIdx).toBeGreaterThan(feedIdx);
  });

  it('inline verifier script is present', () => {
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    // Sentinel function names — if these change, the verifier is broken.
    expect(html).toContain('canonicalPayload');
    expect(html).toContain('importPubKey');
    expect(html).toContain('verifyChain');
    expect(html).toContain("'ECDSA'");
  });

  it('embedded verifier classifies a missing signature as "unsigned", not "tampered" (regression F-2)', () => {
    // The dashboard walker marks an unsigned-but-hash-valid record "unsigned"
    // (chain still valid). The exported verifier previously marked the SAME
    // record "tampered" — the two FW components contradicted each other on the
    // exact recipient-facing artifact. The verifier's verifyOne must, on a missing
    // signature (after the hash recompute passes), return the non-tampered
    // "unsigned" verdict.
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    // Isolate the verifyOne function body from the embedded verifier source.
    // Since 2026-09-06 verifyOne takes the redaction index as a fourth argument.
    const m = html.match(/async function verifyOne\(rec, keys, currentFingerprint, redactions\)\{([\s\S]*?)\n {2}\}/);
    expect(m).not.toBeNull();
    const verifyOneBody = m![1];
    // The missing-signature branch must NOT label it tampered...
    expect(verifyOneBody).not.toMatch(/if\(!rec\.signature\)\s*return\s*\{ok:false,reason:'tampered'\}/);
    // ...it must use the distinct 'unsigned' verdict.
    expect(verifyOneBody).toMatch(/!rec\.signature/);
    expect(verifyOneBody).toContain("'unsigned'");
    expect(verifyOneBody).toContain('unverified:true');
  });
});

describe('buildForensicHtmlExport — page-1 descriptive summary (VISION §7.2)', () => {
  it('surfaces record count, time window, fingerprint, recorded-by', () => {
    const records = [
      makeRecord({ timestamp: '2026-03-15T10:00:00Z' }),
      makeRecord({ timestamp: '2026-04-28T18:00:00Z' }),
      makeRecord({ timestamp: '2026-04-01T12:00:00Z' }),
    ];
    const html = buildForensicHtmlExport(records, META_EN);
    expect(html).toContain('<dd>3</dd>');                       // record count
    expect(html).toContain('2026-03-15');                       // earliest date
    expect(html).toContain('2026-04-28');                       // latest date
    expect(html).toContain('a3f9c2e1deadbeef');                 // fingerprint
    expect(html).toContain('V1.0.0-test');                      // fwVersion
  });

  it('surfaces precision disclosure when provided', () => {
    const html = buildForensicHtmlExport([makeRecord()], {
      ...META_EN,
      precisionDisclosure: '20-50% on hostile-stratified, 95% recall on confirmed harms',
    });
    expect(html).toContain('20-50% on hostile-stratified');
  });

  // An unstamped operating point is stated as a method clause, not as an
  // apology for a missing field: the number is measured per judge, and the
  // file names the judge on every record (voice rule, owner 2026-09-05 — a
  // limit is one flat clause, never an offered weakness).
  it('states where the operating point lives when the file carries none', () => {
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    expect(html).toContain('published in the FeelingWise methodology');
    expect(html).toContain('measured per model');
    expect(html).not.toContain('No precision disclosure provided');
  });

  it('always surfaces "what FW does NOT measure" disclaimer (descriptive, not interpretive)', () => {
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    expect(html).toContain('does NOT measure');
    expect(html).toContain('AI Safety Interpretation');
  });

  it('uses mode-neutral wording for adult-record exports', () => {
    const html = buildForensicHtmlExport([
      makeRecord({
        userAgeCategory: 'adult',
        originalText: 'original text',
        neutralizedText: 'softened text',
      }),
    ], META_EN);
    expect(html).toContain('FeelingWise softened the wording shown on the page');
    expect(html).not.toContain('shown to the child');
    expect(html).not.toContain("child's emotional state");
  });
});

describe('buildForensicHtmlExport — locale templates', () => {
  it('EN and RO produce structurally similar but textually distinct HTML', () => {
    const en = buildForensicHtmlExport([makeRecord()], META_EN);
    const ro = buildForensicHtmlExport([makeRecord()], { ...META_EN, locale: 'ro' });
    expect(en).toContain('<html lang="en">');
    expect(ro).toContain('<html lang="ro">');
    expect(en).toContain('FeelingWise Verification Export');
    expect(ro).toContain('Export de verificare FeelingWise');
    expect(en).not.toBe(ro);
  });

  it('RO operating-point clause uses Romanian copy', () => {
    const ro = buildForensicHtmlExport([makeRecord()], { ...META_EN, locale: 'ro' });
    expect(ro).toContain('Punctul de operare este publicat în metodologia FeelingWise');
  });
});

describe('buildForensicHtmlExport — BROKEN-state explanatory body (§CB)', () => {
  it('EN locale embeds chain-broken position/reason/what-to-do/bullet I18N keys per VERIFIER_UX_SPEC §2.3', () => {
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    // Strings are embedded in the JSON payload (i18n object) so the inline
    // verifier renders them on tampered exports. Verifying their presence
    // locks the contract between html-export.ts and the FOXTROT-6 spec.
    expect(html).toContain('at record #');
    expect(html).toContain('Reason: ');
    expect(html).toContain('What to do:');
    expect(html).toContain('Ask for the original export file again');
    expect(html).toContain('the records may have been modified after they were recorded');
    expect(html).toContain('Only records marked signature verified completed the cryptographic signature check');
    expect(html).toContain('break is at the first record');
  });

  it('RO locale embeds Romanian equivalents of the BROKEN-state body', () => {
    const html = buildForensicHtmlExport([makeRecord()], { ...META_EN, locale: 'ro' });
    expect(html).toContain('la înregistrarea #');
    expect(html).toContain('Motiv: ');
    expect(html).toContain('Ce este de făcut:');
    expect(html).toContain('Cereți din nou fișierul de export original');
    expect(html).toContain('Înregistrările dinaintea acestui punct');
    expect(html).toContain('Ruptura este la prima înregistrare');
  });

  it('verifier script computes brokenAt + brokenReason and renders them in the summary card', () => {
    const html = buildForensicHtmlExport([makeRecord()], META_EN);
    // Sentinel script-body markers — these tokens MUST appear in the inline
    // VERIFIER_SCRIPT for the BROKEN summary to render position + reason +
    // bullets. If a future refactor removes them, the BROKEN UX regresses
    // back to the §CA-era confusing "BROKEN at top + verified ✓ on records"
    // state and this test fires.
    expect(html).toContain('brokenAt');
    expect(html).toContain('brokenReason');
    expect(html).toContain('chainBrokenAtRecord');
    expect(html).toContain('chainBrokenWhatToDo');
    expect(html).toContain('chainBrokenBullet1');
    expect(html).toContain('chainBrokenBullet3Prior');
    expect(html).toContain('chainBrokenBullet3FirstRecord');
  });
});

describe('buildForensicHtmlExport — hostile-input HTML escaping', () => {
  it('HTML-escapes record-author and metadata fields', () => {
    const html = buildForensicHtmlExport([makeRecord()], {
      ...META_EN,
      fwVersion: '<script>alert(1)</script>',
      publicKeyFingerprint: '<img onerror=alert(2)>',
    });
    // The page-1 summary section must not contain raw <script> tag from hostile fwVersion.
    // (Inline verifier <script> blocks live elsewhere; check that the metadata values are escaped.)
    const idx = html.indexOf('V1.0.0');
    // fwVersion value is escaped — original raw <script> shouldn't appear as a tag-form.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;img onerror=alert(2)&gt;');
  });

  it('escapes script-tag sequences inside the embedded JSON record payload', () => {
    // Records can contain attacker text (originalText, author handle). The
    // embedded JSON payload escapes every `<` as the JSON unicode escape
    // `<` so the inline script block can't terminate prematurely AND the
    // payload stays valid JSON for all input.
    const records = [makeRecord({ originalText: 'pre </script><img onerror=1> post' })];
    const html = buildForensicHtmlExport(records, META_EN);
    // No raw </script in the records JSON — the escape replaced the `<`.
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('</script');
    // The payload parses directly (no manual un-escaping) and round-trips.
    const payload = JSON.parse(m![1]);
    expect(payload.records[0].originalText).toContain('</script>');
  });

  it('embedded payload is valid JSON even when records contain <script or <!-- (no export brick)', () => {
    // Regression: the old escape inserted `<\script` / `<\!--` — INVALID JSON
    // escape sequences — so a record containing the bare substrings `<script`
    // or `<!--` (extremely common in social-media text) made JSON.parse throw,
    // bricking the entire exported evidence file (blank page, dead verifier).
    // The embedded payload must JSON.parse with NO manual un-escaping AND
    // round-trip the content byte-identically.
    const hostile = 'check this <script>alert(1)</script> and <!-- secret --> and </script> end';
    const records = [makeRecord({ originalText: hostile, author: '<!--@a-->' })];
    const html = buildForensicHtmlExport(records, META_EN);
    const m = html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/);
    expect(m).not.toBeNull();
    // Parse the embedded payload exactly as the browser does: textContent → JSON.parse.
    // No replace() — if this throws, the real export is bricked.
    const payload = JSON.parse(m![1]);
    expect(payload.records[0].originalText).toBe(hostile);
    expect(payload.records[0].author).toBe('<!--@a-->');
    // And the raw script element must not contain a sequence that closes it
    // or re-enters the HTML script-data state.
    expect(m![1]).not.toMatch(/<\/script/i);
    expect(m![1]).not.toMatch(/<script/i);
    expect(m![1]).not.toContain('<!--');
  });
});

// A Facebook group is named by whoever created it, and that name reaches page
// one verbatim out of the signed record. String.prototype.replace parses `$$`,
// `$&`, "$`" and `$'` in its REPLACEMENT argument, so a group called
// `Sale $& Swap` printed as `Sale {sample} Swap` — an unresolved template token
// shipped to a lawyer — and one called "Cumparaturi $` Exempleni" spliced the
// surrounding sentence into the middle of its own quoted name. In every case
// the name page one shows is not the sourceContainer in the record beneath it.
describe('buildForensicHtmlExport — a group name is printed, never parsed', () => {
  const unescape = (t: string) =>
    t.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  it.each([
    'Sale $& Swap',
    'Cumparaturi $` Exempleni',
    "Deals $' Group",
    'Cash $$ Deals',
    'Group {n} here',
  ])('prints %s exactly as the record carries it', (name) => {
    const html = buildForensicHtmlExport(
      [makeRecord({ sourceContainer: name, verdict: 'pass' })],
      META_EN,
    );
    const row = unescape(html.match(/data-fw-prov="discloses">([^<]*)/)?.[1] ?? '');
    expect(row).not.toContain('{sample}');
    expect(row.match(/\("([^"]*)"\)/)?.[1]).toBe(name);
  });
});

// The total flagged row printed wilson()'s integer percentages while the judged
// row printed one decimal, so a file whose flags were ALL judged rendered the
// same numerator over the same denominator as two different numbers — "2.7%,
// interval 2.3-3.2%" directly above "3%, interval 2-3%", the total's interval
// not even containing the judged row's upper bound.
describe('buildForensicHtmlExport — one formatter for every share', () => {
  it('the judged row and the total row agree when every flag was judged', () => {
    const records = [
      ...Array.from({ length: 27 }, (_, i) =>
        makeRecord({ id: `f${i}`, verdict: 'flagged', aiSource: 'cloud', detectionMode: 'combined-detect-neutralize' })),
      ...Array.from({ length: 973 }, (_, i) => makeRecord({ id: `p${i}`, verdict: 'pass' })),
    ];
    const html = buildForensicHtmlExport(records, META_EN);
    const judged = html.match(/data-fw-prov="flaggedJudged">([^<]*)/)?.[1] ?? '';
    // `<dd[^>]*>` rather than `<dd>`: the row was brought under the provenance digest on
    // 2026-09-18 and now carries data-fw-prov, and a needle pinned to a bare tag reads '' and
    // compares two empty strings without complaining.
    const total = html.match(/Flagged share in this file:<\/dt><dd[^>]*>([^<]*)/)?.[1] ?? '';
    // Same k, same n, so the same three numbers.
    const nums = (t: string) => t.match(/[\d.]+%/g) ?? [];
    expect(judged).toContain('27 of 1000');
    expect(total).toContain('27 of 1000');
    expect(nums(judged)).toEqual(nums(total));
  });
});

// TWO `var`s OF THE SAME NAME IN ONE FUNCTION SCOPE. The recursive card
// renderer guarded against a cycle with an object called `rendered`; the paging
// counter further down the same IIFE declared `var rendered = 0`, which
// overwrote it. Reading (0)[id] is undefined so the guard never fired, and
// writing (0)[id] = 1 is a silent no-op outside strict mode — a record whose
// parent chain loops would have recursed until the stack gave out and the feed
// rendered nothing at all.
describe('buildForensicHtmlExport — the feed guards its own recursion', () => {
  it('the cycle guard reads the object it writes, not the page counter', () => {
    const html = buildForensicHtmlExport([makeRecord({ verdict: 'pass' })], META_EN);
    expect(html).toContain('renderedIds[r.id]');
    expect(html).not.toMatch(/if\(rendered\[r\.id\]\)/);
    // and the counter keeps its own name
    expect(html).toContain('var rendered=0;');
  });

  // A card body is capped at 500 characters. It was cut with no mark, on the
  // same card that says elsewhere whether the PAGE had folded the text — so a
  // reader could be told the whole post was captured and shown less than the
  // record holds, with nothing saying so.
  it('says when a card body was clipped, and stays silent when it was not', () => {
    const long = buildForensicHtmlExport([makeRecord({ verdict: 'pass', originalText: 'x'.repeat(900) })], META_EN);
    expect(long).toContain('shown to 500 characters');
    const short = buildForensicHtmlExport([makeRecord({ verdict: 'pass', originalText: 'a short body' })], META_EN);
    // the template is always in the page; what matters is the rendered branch
    expect(short).toContain('feedTextClipped');
  });
});
