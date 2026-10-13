// The HTML export's "How items were identified" section (added 2026-07-02) —
// verbatim model instructions + pins + thresholds rendered as a collapsible
// block near the top. Locks: renders when a methodology block is supplied,
// absent otherwise (older callers unchanged), prompt text is HTML-escaped,
// RO locale uses RO labels while the instruction texts stay verbatim.

import { describe, it, expect } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';
import { buildMethodologyBlock } from '../../../src/forensics/methodology';
import type { ForensicRecord } from '../../../src/types/forensic';

function makeRecord(): ForensicRecord {
  return {
    id: 'r-1',
    timestamp: '2026-07-02T12:00:00Z',
    platform: 'twitter',
    originalText: 'sample post',
    originalHash: 'abc123',
    originalLength: 11,
    neutralizedText: '',
    author: '@example',
    postUrl: 'https://x.com/example/status/1',
    techniques: [{ name: 'fear-appeal', severity: 7, confidence: 8 }],
    overallScore: 7,
    userAgeCategory: 'teen',
    aiSource: 'cloud',
    feedSource: 'for-you',
    integrityHash: 'deadbeef',
    signature: 'sig',
    publicKeyFingerprint: 'fp123',
    chainPosition: 0,
  } as unknown as ForensicRecord;
}

const BASE_META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'a3f9c2e1deadbeef',
  locale: 'en',
};

describe('HTML export — methodology section', () => {
  it('renders the section with escaped verbatim prompts when supplied', () => {
    const html = buildForensicHtmlExport([makeRecord()], {
      ...BASE_META,
      methodology: buildMethodologyBlock('1.2.3'),
    });
    expect(html).toContain('How items were identified');
    expect(html).toContain('fw-methodology');
    // The batch prompt's <user-content> tag must arrive HTML-escaped —
    // raw, it would break the export document's own markup.
    expect(html).toContain('&lt;user-content&gt;');
    expect(html).not.toMatch(/<user-content>/);
    // Threshold + model pins visible.
    expect(html).toContain('openai/gpt-oss-20b');
    // Topic vocabulary line.
    expect(html).toContain('celebrity-gossip');
  });

  // 12 Oct 2026, the owner's reading of his own export: "it did not say Claude". Since 2.5.19 Claude Haiku is asked beside
  // the second model at Open behind its own consent, and each record's decision.claude says what came of it; the block
  // that answers "who identified these items" printed the three open models and left it out, and the methodology text that
  // names it existed and was never printed.
  it('names the Claude reader in the models, from the methodology text, with its conditions', () => {
    const m = buildMethodologyBlock('2.5.19');
    const html = buildForensicHtmlExport([makeRecord()], { ...BASE_META, methodology: m });
    const models = html.slice(html.indexOf('<dt>Text judge:</dt>'), html.indexOf('<dt>Room sensor:</dt>'));
    expect(models).toContain('Claude reader (Open, paid reading):');
    expect(models).toContain('claude-haiku-5-5');
    expect(models).toContain('Anthropic');
    expect(models).toContain('decision.claude');
    // Its conditions travel with the name: a reader of an export without a paid key is not told Claude read their items.
    expect(models).toContain('only for a key that holds the paid reading');
    // Beside the three it was left out of, in the order the items travel.
    expect(models.indexOf('Open reader:')).toBeLessThan(models.indexOf('Claude reader'));
  });

  it('the Claude entry is escaped like the others', () => {
    const m = buildMethodologyBlock('2.5.19');
    m.models.paidReader = 'claude <b>x</b> & more';
    const html = buildForensicHtmlExport([makeRecord()], { ...BASE_META, methodology: m });
    expect(html).toContain('claude &lt;b&gt;x&lt;/b&gt; &amp; more');
    expect(html).not.toContain('claude <b>x</b>');
  });

  // gem 81 (recount 8): the placeholder Encounter used to render these prompts named a
  // real language, 'English', where the live code fills in the item's own detected
  // language (or "the same language as the original input"). Every rendered export
  // read as though the model was always told to answer in English.
  it('does not tell a reader the model was always instructed to answer in English', () => {
    const html = buildForensicHtmlExport([makeRecord()], {
      ...BASE_META,
      methodology: buildMethodologyBlock('1.2.3'),
    });
    expect(html).toContain('detected per item');
    expect(html).not.toMatch(/this language:\s*English\b/);
  });

  // The adult path reaches the page, or it does not exist. The 2026-09-18
  // model pin landed in the block and missed the renderer on the first
  // attempt, and the demo came out carrying the new note and no model; these
  // assert the rendered document, not the object.
  describe('the adult reader reaches the rendered page', () => {
    const html = buildForensicHtmlExport([makeRecord()], {
      ...BASE_META,
      methodology: buildMethodologyBlock('1.2.3'),
    });

    it('prints the adult reader pin beside the feed judge pin', () => {
      expect(html).toContain('openai/gpt-oss-120b');
      // The reader is named by its level.
      expect(html).toContain('Open reader');
    });

    it('prints the adult system text verbatim and escaped', () => {
      // A phrase that occurs in the adult prompt and in no other prompt on
      // the page, so this cannot pass on the child/teen judges' text.
      expect(html).toContain('your reading is the measurement');
      // Its own security clause arrives escaped like every other prompt.
      expect(html).toContain('&lt;user-content&gt;');
    });

    it('prints the two cuts an adult record was gated by', () => {
      const m = buildMethodologyBlock('1.2.3');
      // Anchored to the label. A bare toContain('4') passes on any document.
      expect(html).toContain(
        `Open reader, acts at (severity):</dt><dd>&ge; ${m.thresholds.adultReaderFireSeverity},`,
      );
      expect(html).toContain(
        `rewriting at (severity):</dt><dd>&ge; ${m.thresholds.adultReaderHideSeverity}<`,
      );
      // Charged is half the fire rule; a severity alone would overstate what fires.
      expect(html).toMatch(/only when it called the item charged/);
      // The confidence caveat: an adult record's confidence measures nothing.
      expect(html).toMatch(/not a measure of certainty/);
    });

    it('prints the family map that named the technique on an adult record', () => {
      expect(html).toContain('Family answered');
      expect(html).toContain('Technique on the record');
      // The map's own pairs, on the page.
      expect(html).toMatch(/hostile<\/td><td>anger-trigger/);
      expect(html).toMatch(/commercial<\/td><td>consumer-rapid-frame/);
    });

    it('no longer tells an adult reader the floor table applied to them', () => {
      // The caption and the column header both claimed it until 2026-09-18.
      // An adult post never reaches this table: neutralizer.ts routes it to
      // the measured reader first, and that reader applies no floor.
      expect(html).not.toMatch(/Adult mode reads the teen column/i);
      expect(html).not.toContain('Teen / adult');
      expect(html).toMatch(/Open posts do not pass through this table/i);
      // And the post judge's Calm text is no longer offered as the Open one
      // (S3, PLAN-A section 3: the heading speaks of levels, not ages).
      expect(html).not.toContain('Post judge: Calm (Open uses this framing)');
      // The comment judge's Calm framing IS used for Open comments
      // (prompts-v2.ts maps adult onto it), so that label must survive.
      expect(html).toContain('Comment judge: Calm (Open uses this framing)');
    });
  });

  it('names Gemma, the second reader, beside the adult reader pin (two-model process)', () => {
    // JUDGE-V1-PAIR (src/ai/judge-pair.ts) asks a second model, Gemma, whenever
    // the first fires, and only acts where both agree. The block used to name
    // one model for a two-model process.
    const html = buildForensicHtmlExport([makeRecord()], {
      ...BASE_META,
      methodology: buildMethodologyBlock('1.2.3'),
    });
    expect(html).toContain('google/gemma-4-31B-it');
  });

  it('does not call the per-record aiModel stamp authoritative without a date caveat', () => {
    // 194 records from builds shipped 19-24 September 2026 name the wrong AI
    // model in aiModel; nothing from 2.5.15 onward is affected. The note must
    // stop calling the per-record MODEL stamp unconditionally authoritative.
    const m = buildMethodologyBlock('1.2.3');
    expect(m.models.modelProvenanceNote).toMatch(/aiModel stamp is NOT authoritative/i);
    expect(m.models.modelProvenanceNote).toContain('24 September 2026');
    // The provider (company) stamp is a separate, unaffected claim.
    expect(m.models.modelProvenanceNote).toMatch(/aiProvider stamp is authoritative/i);
    // Pinned to his own record (cold read, 28 Sep 2026): Groq named to 23 Sep,
    // DeepInfra from 22 Sep, both dates present on the 22nd and 23rd while
    // installs moved over. Not 21 Sep, which is only when the proxy switched.
    expect(m.models.modelProvenanceNote).toContain('Groq until 23 September 2026');
    expect(m.models.modelProvenanceNote).toContain('DeepInfra from 22 September 2026');
    expect(m.models.modelProvenanceNote).not.toContain('21 September 2026');
  });

  it('omits the section entirely when no methodology block is supplied', () => {
    const html = buildForensicHtmlExport([makeRecord()], BASE_META);
    // The CSS rules live in STYLES and the header STRING rides in the embedded
    // i18n JSON either way — the rendered ELEMENT is the valid absence lock.
    expect(html).not.toContain('<details class="fw-methodology">');
    expect(html).not.toContain('THE LITMUS');
  });

  it('RO locale uses RO labels while instruction text stays verbatim English', () => {
    const html = buildForensicHtmlExport([makeRecord()], {
      ...BASE_META,
      locale: 'ro',
      methodology: buildMethodologyBlock('1.2.3'),
    });
    expect(html).toContain('Cum au fost identificate elementele');
    expect(html).toContain('Praguri de decizie');
    // The instructions themselves are the English texts the models run.
    expect(html).toContain('THE LITMUS');
  });
});
