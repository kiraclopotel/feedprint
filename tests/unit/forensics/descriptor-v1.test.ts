/** @vitest-environment jsdom */
// DESCRIPTOR-V1 in the product (PLAN-2026-09-15 item 1): the measured question
// verbatim, the reply parsed to the three fields that passed their measure, the
// step that never delays or changes a verdict, the record's decision block, and
// the export's label.
//
// The case that holds the question against the research file it was measured from lives in
// tests/private/docs/descriptor-v1-question.test.ts: that file is private, so the case cannot run
// in the public copy, while everything below it can (PLAN-2026-09-16 item 7.3).

import { describe, it, expect, vi } from 'vitest';
import {
  DESCRIPTOR_V1_SCHEMA, parseDescriptorV1, buildDescriptorV1UserPrompt,
} from '../../../src/ai/descriptor-v1';
import { withDescriptorV1, descriptorV1Settled } from '../../../src/content/record/descriptor-step';
import { decisionForJudge } from '../../../src/content/record/decision';
import { buildForensicHtmlExport, FEED_SCRIPT, I18N, type ExportMetadata } from '../../../src/forensics/html-export';
import type { PipelineResult } from '../../../src/analysis/pipeline';
import type { AnalysisResult } from '../../../src/types/analysis';
import type { PostContent } from '../../../src/types/post';
import type { ForensicRecord } from '../../../src/types/forensic';
import { EXPORT_NUMBERS_INLINE_SOURCE } from '../../../src/forensics/export-numbers-inline';

describe('the question is the measured one', () => {
  it('sends the measured schema and message shape', () => {
    expect((DESCRIPTOR_V1_SCHEMA.schema as { required: string[] }).required).toEqual(['effect', 'target', 'group', 'coded', 'news-about-group']);
    const msg = buildDescriptorV1UserPrompt({ text: 'item', platform: 'twitter', kind: 'comment', parentText: 'parent' });
    expect(msg).toBe('<user-content>\nPlatform: twitter\n\nKind: comment\n\nTHE POST IT REPLIES TO (context only, not the item to describe):\nparent\n\nTHE ITEM TO DESCRIBE:\nitem\n</user-content>');
  });
});

describe('parsing keeps the three measured fields', () => {
  it('reads effect, target and group, and drops news and coded', () => {
    expect(parseDescriptorV1('{"effect":"group-hostility","target":"group","group":"jews-israelis","coded":true,"news-about-group":false}'))
      .toEqual({ effect: 'group-hostility', target: 'group', group: 'jews-israelis' });
  });
  it('a group is kept only when the target is a group', () => {
    expect(parseDescriptorV1('{"effect":"person-hostility","target":"person","group":"women","coded":false,"news-about-group":false}'))
      .toEqual({ effect: 'person-hostility', target: 'person', group: 'none' });
  });
  it('refuses anything outside the shape', () => {
    for (const raw of ['', 'not json', '{"effect":"hate","target":"group","group":"none"}', '{"effect":"threat","target":"everyone","group":"none"}', '{"effect":"threat","target":"none","group":"aliens"}']) {
      expect(parseDescriptorV1(raw), raw).toBeNull();
    }
  });
});

const post = { id: 'p1', text: 'text', platform: 'twitter', kind: 'post' } as unknown as PostContent;
function fired(): PipelineResult {
  const analysis = {
    postId: 'p1', techniques: [], overallScore: 6, overallConfidence: 0.9, isManipulative: true, processingTimeMs: 1,
    judge: { id: 'judge-v1', hash: 'h', model: 'm', charged: true, family: 'hostile', severity: 6, effect: 'recruit', intent: 'react' },
  } as AnalysisResult;
  return { action: 'mark', analysis } as PipelineResult;
}

describe('the step', () => {
  it('hands the verdict on before the reading arrives, and the record waits for it', async () => {
    let answer!: (v: unknown) => void;
    const ask = vi.fn(() => new Promise((r) => { answer = r; })) as never;
    const result = fired();
    const out = await withDescriptorV1(async () => result, ask)(post);
    expect(out).toBe(result);
    expect(out.analysis!.descriptorV1).toBeUndefined();
    answer({ effect: 'group-hostility', target: 'group', group: 'muslims' });
    await descriptorV1Settled(out.analysis);
    expect(out.analysis!.descriptorV1).toEqual({ id: 'descriptor-v1', hash: '6edd22a95b90', model: 'openai/gpt-oss-120b', effect: 'group-hostility', target: 'group', group: 'muslims' });
    expect(out.action).toBe('mark');
    expect(out.analysis!.overallScore).toBe(6);
  });

  it('asks nothing for a pass, a cancel, a legacy verdict or a rule', async () => {
    const ask = vi.fn(async () => ({ effect: 'threat', target: 'none', group: 'none' })) as never;
    const legacy = fired(); delete legacy.analysis!.judge;
    for (const r of [{ action: 'pass' } as PipelineResult, { action: 'cancelled', analysis: fired().analysis } as PipelineResult, legacy]) {
      await withDescriptorV1(async () => r, ask)(post);
    }
    expect(ask).not.toHaveBeenCalled();
  });

  it('a failed call or a slow one leaves the record without the reading', async () => {
    const failing = await withDescriptorV1(async () => fired(), (async () => { throw new Error('down'); }) as never)(post);
    await descriptorV1Settled(failing.analysis);
    expect(failing.analysis!.descriptorV1).toBeUndefined();
    const slow = await withDescriptorV1(async () => fired(), (() => new Promise(() => undefined)) as never)(post);
    const t0 = Date.now();
    await descriptorV1Settled(slow.analysis, 30);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(slow.analysis!.descriptorV1).toBeUndefined();
  });
});

describe('the record', () => {
  const judge = { id: 'judge-v1' as const, hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', charged: true, family: 'hostile', severity: 6, effect: 'recruit', intent: 'react' };
  const base = { mode: 'adult' as const, judge, provider: 'groq', applied: 'mark' as const, mask: false, rewrite: null };

  it('the decision block carries the reading when there is one', () => {
    const dv = { id: 'descriptor-v1' as const, hash: '6edd22a95b90', model: 'openai/gpt-oss-120b', effect: 'group-hostility', target: 'group', group: 'jews-israelis' };
    expect(decisionForJudge({ ...base, descriptorV1: dv }).descriptorV1).toEqual(dv);
  });

  it('without one the block has no such key, so it serialises exactly as before', () => {
    const d = decisionForJudge(base);
    expect('descriptorV1' in d).toBe(false);
    expect(JSON.stringify(d)).not.toContain('descriptorV1');
  });
});

describe('the export names it on the card', () => {
  const META: ExportMetadata = { fwVersion: 'test', publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' }, publicKeyFingerprint: 'fp', locale: 'en' };
  function card(decision: unknown): string {
    const r = {
      id: 'r-1', timestamp: '2026-09-15T06:00:00.000Z', platform: 'twitter', originalText: 'x', originalHash: 'h', originalLength: 1,
      neutralizedText: '', author: '@a', postUrl: '', overallScore: 6, userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
      integrityHash: 'ih', signature: 's', publicKeyFingerprint: 'fp', chainPosition: 0, kind: 'post', verdict: 'flagged',
      techniques: [{ name: 'anger-trigger', severity: 6, confidence: 0.9 }], decision,
    } as unknown as ForensicRecord;
    const html = buildForensicHtmlExport([r], META);
    (window as unknown as { __FW_EXPORT__: unknown }).__FW_EXPORT__ = JSON.parse(html.match(/<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/)![1]);
    document.body.innerHTML = '<div id="fw-feed"></div>';
    new Function(`${EXPORT_NUMBERS_INLINE_SOURCE};${FEED_SCRIPT}`)();
    return document.getElementById('fw-feed')!.textContent!;
  }

  it('shows the effect and not the group, which missed its measure on a fresh set (RESULTS-3.md)', () => {
    const text = card({ descriptorV1: { id: 'descriptor-v1', hash: 'h', model: 'm', effect: 'group-hostility', target: 'group', group: 'jews-israelis' } });
    expect(text).toContain(I18N.en.dvGroupHostility);
    expect(text).not.toContain(I18N.en.dvgJewsIsraelis);
  });

  it('shows the effect alone when the target is not a group, and nothing for a record without it', () => {
    expect(card({ descriptorV1: { id: 'descriptor-v1', hash: 'h', model: 'm', effect: 'person-hostility', target: 'person', group: 'none' } })).toContain(I18N.en.dvPersonHostility);
    const none = card(undefined);
    expect(none).not.toContain(I18N.en.dvGroupHostility);
    expect(none).not.toContain(I18N.en.dvPersonHostility);
  });

  it('every interface language carries every label', () => {
    for (const loc of Object.keys(I18N) as Array<keyof typeof I18N>) {
      for (const k of Object.keys(I18N.en).filter(k => k.startsWith('dv'))) {
        expect((I18N[loc] as unknown as Record<string, string>)[k], `${loc} ${k}`).toBeTruthy();
      }
    }
  });
});
