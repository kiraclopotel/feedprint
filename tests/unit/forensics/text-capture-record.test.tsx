/** @vitest-environment jsdom */
// `textCapture` on the record: stamped by every logger that takes an adapter's
// post, inside the canonical hash and the export's verifier copy, shown under
// the item on the dashboard card and in the everything-export, and a column
// in the CSV. Absent stays absent: a record the detector never saw carries
// nothing, and the legacy hash pin (canonical-payload-stability.test.ts)
// proves the field's absence changes no stored byte.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async () => undefined),
  getChainState: vi.fn(async () => ({ nextPosition: 3, prevRecordHash: 'prev' })),
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'sig'),
  getPublicKeyFingerprint: vi.fn(async () => 'fp'),
}));

import { logCancelEvent, logForensicEvent, logPassEvent, logSkippedEvent } from '../../../src/forensics/logger';
import { addRecord } from '../../../src/forensics/store';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import { I18N, VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE } from '../../../src/forensics/html-export';
import { TextCaptureNote } from '../../../src/ui/dashboard/components/FeedCard';
import { I18nProvider } from '../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { AnalysisResult } from '../../../src/types/analysis';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const mockedAddRecord = vi.mocked(addRecord);
beforeEach(() => mockedAddRecord.mockReset());

const analysis: AnalysisResult = {
  postId: 'p1', techniques: [], overallScore: 0, overallConfidence: 0.5, isManipulative: false, processingTimeMs: 10,
};

function lastRecord(): ForensicRecord {
  return mockedAddRecord.mock.calls.at(-1)![0] as ForensicRecord;
}

describe('every logger that takes a post carries textCapture onto the record', () => {
  it('pass', async () => {
    await logPassEvent({ originalText: 'x', analysis, mode: 'adult', platform: 'facebook', aiSource: 'cloud', passReason: 'r', textCapture: 'cut' });
    expect(lastRecord().textCapture).toBe('cut');
  });

  it('flagged', async () => {
    await logForensicEvent({ originalText: 'x', neutralizedText: '', analysis, mode: 'adult', platform: 'facebook', aiSource: 'cloud', textCapture: 'folded' });
    expect(lastRecord().textCapture).toBe('folded');
  });

  it('cancelled', async () => {
    await logCancelEvent({ originalText: 'x', verdict: 'cancelled-stale', mode: 'adult', platform: 'facebook', textCapture: 'whole' });
    expect(lastRecord().textCapture).toBe('whole');
  });

  it('skipped, the free tier\'s feed record', async () => {
    await logSkippedEvent({ originalText: 'x', mode: 'adult', platform: 'facebook', author: 'a', postUrl: '', skipReason: 'short', textCapture: 'cut' });
    expect(lastRecord().textCapture).toBe('cut');
  });

  it('and leaves it absent when the input carries none', async () => {
    await logPassEvent({ originalText: 'x', analysis, mode: 'adult', platform: 'facebook', aiSource: 'cloud', passReason: 'r' });
    expect('textCapture' in lastRecord() && lastRecord().textCapture !== undefined).toBe(false);
  });
});

function base(over: Partial<ForensicRecord> = {}): Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'> {
  return {
    id: 'fr-tc', timestamp: '2026-09-05T10:00:00.000Z', platform: 'facebook',
    originalText: 'The opener of a long post that the page cut… See more', originalHash: 'h', originalLength: 52,
    neutralizedText: '', author: 'a', postUrl: 'https://www.facebook.com/p/1', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'rules', feedSource: 'for-you', verdict: 'skipped', skipReason: 'free-tier',
    prevRecordHash: 'prev', chainPosition: 3, publicKeyFingerprint: 'fp',
    ...over,
  } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
}

describe('the field is inside the signature', () => {
  it('a record repainted from cut to whole hashes differently', async () => {
    const cut = await computeRecordIntegrityHash(base({ textCapture: 'cut' }));
    const whole = await computeRecordIntegrityHash(base({ textCapture: 'whole' }));
    const absent = await computeRecordIntegrityHash(base());
    expect(cut).not.toBe(whole);
    expect(cut).not.toBe(absent);
  });

  it('and the export\'s verifier copy names it', () => {
    expect(VERIFIER_CANONICAL_PAYLOAD_FN_SOURCE).toContain('textCapture:r.textCapture');
  });
});

function rec(textCapture: ForensicRecord['textCapture'], originalLength = 212): ForensicRecord {
  return { ...base({ textCapture, originalLength }), integrityHash: 'i' } as ForensicRecord;
}

function render(r: ForensicRecord, lang: 'en' | 'ro' | 'es' | 'pt-BR' = 'en'): string {
  return renderToString(createElement(I18nProvider, { lang, children: createElement(TextCaptureNote, { record: r }) }));
}

describe('the note under the item', () => {
  it('says what the page carried on a cut item, with the count, in every language', () => {
    for (const lang of UI_LANGUAGES) {
      const html = render(rec('cut', 212), lang);
      expect(html, lang).toContain('212');
      expect(html, lang).toContain(DASHBOARD_STRINGS[lang].feedTextCapture.cut(212));
    }
  });

  it('says the page carried the whole text on a folded item', () => {
    expect(render(rec('folded'))).toContain(DASHBOARD_STRINGS.en.feedTextCapture.folded);
  });

  it('says nothing on a whole item and nothing on a record the detector never saw', () => {
    expect(render(rec('whole'))).toBe('');
    expect(render(rec(undefined))).toBe('');
  });

  it('the export carries the same two lines in every locale, with the count slot', () => {
    for (const lang of UI_LANGUAGES) {
      expect(I18N[lang].feedTextCaptureCut, lang).toContain('{n}');
      expect(I18N[lang].feedTextCaptureFolded.length, lang).toBeGreaterThan(20);
    }
  });
});

describe('a record with a decision block takes its verdict from what the page showed (2026-09-07)', () => {
  const block = (applied: 'mask' | 'mark' | 'hide' | 'soften') => ({
    judge: null, reading: null, descriptor: null, rails: [],
    household: { mode: 'adult' as const, reader: 'default', topicRule: null, mask: applied === 'mask' },
    row: 'D1', action: 'allow' as const, applied, rewrite: null, note: null,
  });

  it('a mask is masked (C13, 2026-09-13), a mark is flagged, a hide is flagged-hidden', async () => {
    await logForensicEvent({ originalText: 'x', neutralizedText: 'x*', analysis, mode: 'adult', platform: 'facebook', aiSource: 'rules', decision: block('mask') });
    expect(lastRecord().verdict).toBe('masked');
    expect(lastRecord().decision?.applied).toBe('mask');
    await logForensicEvent({ originalText: 'x', neutralizedText: '', analysis, mode: 'adult', platform: 'facebook', aiSource: 'cloud', decision: block('mark') });
    expect(lastRecord().verdict).toBe('flagged');
    await logForensicEvent({ originalText: 'x', neutralizedText: '', analysis, mode: 'adult', platform: 'facebook', aiSource: 'cloud', decision: block('hide') });
    expect(lastRecord().verdict).toBe('flagged-hidden');
  });

  it('without a block the legacy rule stands', async () => {
    await logForensicEvent({ originalText: 'x', neutralizedText: '', analysis: { ...analysis, action: 'hide' }, mode: 'adult', platform: 'facebook', aiSource: 'cloud' });
    expect(lastRecord().verdict).toBe('flagged-hidden');
    expect(lastRecord().decision).toBeUndefined();
  });
});

describe('a pass the judge read carries its reading (2026-09-07)', () => {
  it('the pass record keeps verdict pass and carries the block and the reader', async () => {
    const block = {
      judge: { id: 'judge-v1', hash: '4f32b70b07b7', model: 'openai/gpt-oss-120b', provider: 'groq' },
      reading: { charged: false, family: 'none', severity: 0, effect: 'inert', intent: 'none' },
      descriptor: null, rails: [],
      household: { mode: 'adult' as const, reader: 'default', topicRule: null, mask: false },
      row: 'D1', action: 'allow' as const, applied: 'allow' as const, rewrite: null, note: null,
    };
    await logPassEvent({ originalText: 'x', analysis, mode: 'adult', platform: 'facebook', aiSource: 'cloud', passReason: 'post-llm-below-threshold', decision: block, reader: 'default' });
    expect(lastRecord().verdict).toBe('pass');
    expect(lastRecord().decision?.row).toBe('D1');
    expect(lastRecord().decision?.judge?.id).toBe('judge-v1');
    expect(lastRecord().reader).toBe('default');
  });
});
