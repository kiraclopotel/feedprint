// @vitest-environment jsdom
//
// A verdict that answers after its post scrolled away leaves a cancelled record and a stored verdict. When the
// post comes back the verdict is applied to the page, and until now nothing said so: the chain held only
// "cancelled", and the export card read "shame (signal level 8/10)" beside "did not classify it" while the page
// had hidden, softened or marked the item. Now the applied verdict is a record of its own, written by the same
// producers as a live verdict, with one signed sentence saying it was late; the cancelled record stays as written.

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const state = vi.hoisted(() => ({
  mode: 'teen' as 'child' | 'teen' | 'adult',
  added: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: state.mode, uiLanguage: 'en', dailyCap: 2000, features: {} })),
    isFeatureEnabled: vi.fn(() => true),
  };
});
vi.mock('../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));
vi.mock('../../../src/storage/context-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/context-guard')>();
  return { ...actual, safeSendMessage: vi.fn(() => undefined) };
});
vi.mock('../../../src/forensics/store', () => ({
  addRecord: vi.fn(async (r: Record<string, unknown>) => { state.added.push(r); }),
  getChainState: vi.fn(async () => ({ nextPosition: 0, prevRecordHash: '' })),
}));
vi.mock('../../../src/forensics/signing', () => ({
  signHash: vi.fn(async () => 'stub-signature'),
  getPublicKeyFingerprint: vi.fn(async () => 'stub-fp'),
}));
vi.mock('../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/content/record/forensic-retry')>();
  const logger = await import('../../../src/forensics/logger');
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async (msg: { type: string; payload: never }) => {
      if (msg.type === 'FORENSIC_LOG') await logger.logForensicEvent(msg.payload);
      else if (msg.type === 'BLOCKED_LOG') await logger.logBlockedEvent(msg.payload);
      else if (msg.type === 'CANCEL_LOG') await logger.logCancelEvent(msg.payload);
      return 'accepted' as const;
    }),
  };
});

import {
  _applyLateVerdictDirectForTesting as applyLateVerdictDirect,
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _onProcessingResultForTesting as onProcessingResult,
  _peekLateVerdictForTesting as peekLateVerdict,
  _sessionVerdictKeyForTesting as sessionVerdictKey,
  _setActiveAdapterForTesting,
  _setChildProtectionModeForTesting,
} from '../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting } from '../../../src/diagnostics/diagnostics';
import { NOTE_LATE_VERDICT } from '../../../src/content/record/decision';
import { DECISION_NOTE_KEYS, decisionNoteWords } from '../../../src/i18n/decision-notes';
import { UI_LANGUAGES } from '../../../src/i18n';
import type { PipelineResult } from '../../../src/analysis/pipeline';
import type { PlatformAdapter } from '../../../src/content/platforms/adapter';
import type { DecisionBlock, ForensicRecord } from '../../../src/types/forensic';
import type { PostContent } from '../../../src/types/post';
import { CAPTION, REWRITE, drawCard, judged, rewrite, settle } from '../../helpers/record-matrix';
import { buildBrowserVerifierSource, BROWSER_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

const AI = { model: 'openai/gpt-oss-120b', provider: 'deepinfra' };

function useMode(mode: 'child' | 'teen' | 'adult'): void {
  state.mode = mode;
  _setChildProtectionModeForTesting(mode);
}

/** The post as the adapter hands it over again: the same item, on a fresh node. */
function comesBack(): PostContent {
  return drawCard('x', 'late-1').post;
}

/** The first encounter: the verdict answered after the node was gone, so the chain got a cancelled record. */
async function scrolledAway(result: PipelineResult): Promise<void> {
  const first = drawCard('x', 'late-1').post;
  // The feed reused the box for another post while the answer was on its way.
  (first.domRef.deref() as HTMLElement).textContent = 'a calm post about bread, nothing else in it';
  document.body.innerHTML = '';
  onProcessingResult(first, result);
  await settle();
}

const lateFor = (post: PostContent) => peekLateVerdict(sessionVerdictKey(post));

const cancelled = (analysis = judged(8)): PipelineResult => ({
  action: 'cancelled', cancelKind: 'mid-flight', analysis: { ...analysis, isManipulative: true }, aiMeta: AI, detectionMode: 'combined-detect-neutralize',
} as unknown as PipelineResult);

const records = (): ForensicRecord[] => state.added as unknown as ForensicRecord[];
const decisionOf = (r: ForensicRecord): DecisionBlock => r.decision as DecisionBlock;

beforeEach(() => {
  document.body.innerHTML = '';
  state.added.length = 0;
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  useMode('teen');
});

describe('a mid-flight verdict applied when the post comes back', () => {
  it('writes its own record with the late sentence, and leaves the cancelled record as it was written', async () => {
    await scrolledAway(cancelled());
    expect(records()).toHaveLength(1);
    expect(records()[0].verdict).toBe('cancelled-mid-flight');
    const cancelledBytes = JSON.stringify(records()[0]);

    document.body.innerHTML = '';
    const back = comesBack();
    const late = lateFor(back)!;
    expect(late).toBeDefined();
    await applyLateVerdictDirect(back, late);
    await settle();

    expect(records()).toHaveLength(2);
    expect(JSON.stringify(records()[0])).toBe(cancelledBytes);
    const applied = records()[1];
    expect(applied.originalText).toBe(CAPTION);
    expect(decisionOf(applied)).toMatchObject({ row: 'J2', applied: 'mark', note: NOTE_LATE_VERDICT });
    expect(applied.verdict).toBe('flagged');
    expect(applied.aiModel).toBe(AI.model);
    expect(applied.aiProvider).toBe(AI.provider);
  });

  it('a hide that came back says hide, with the same sentence, and the page is hidden', async () => {
    await scrolledAway({ action: 'cancelled', cancelKind: 'mid-flight', analysis: { ...judged(9), action: 'hide' }, aiMeta: AI } as unknown as PipelineResult);
    document.body.innerHTML = '';
    const back = comesBack();
    await applyLateVerdictDirect(back, lateFor(back)!);
    await settle();
    const applied = records()[1];
    expect(decisionOf(applied)).toMatchObject({ applied: 'hide', note: NOTE_LATE_VERDICT });
    expect(applied.verdict).toBe('flagged-hidden');
    expect(applied.visualApplied).toBeUndefined();
  });
});

describe('a rewrite whose node was gone when it arrived', () => {
  it('is recorded as softened, with its words, when the post comes back', async () => {
    await scrolledAway({ action: 'neutralize', neutralized: rewrite(judged(7)), detectionMode: 'combined-detect-neutralize', aiMeta: AI } as unknown as PipelineResult);
    const gone = [...records()];
    document.body.innerHTML = '';
    const back = comesBack();
    const late = lateFor(back);
    expect(late, 'the verdict was stored when the node was gone').toBeDefined();
    await applyLateVerdictDirect(back, late!);
    await settle();
    const applied = records().filter((r) => !gone.includes(r)).at(-1)!;
    expect(decisionOf(applied)).toMatchObject({ applied: 'soften', note: NOTE_LATE_VERDICT });
    expect(applied.neutralizedText).toBe(REWRITE);
    expect(back.domRef.deref()!.textContent).toBe(REWRITE);
  });
});

describe('only when the chain does not already hold the item', () => {
  it('a real record for the same item stops it: no second record', async () => {
    const live = drawCard('x', 'late-1').post;
    onProcessingResult(live, { action: 'hide', analysis: { ...judged(9), action: 'hide' }, detectionMode: 'combined-detect-neutralize', aiMeta: AI } as unknown as PipelineResult);
    await settle();
    expect(records()).toHaveLength(1);
    document.body.innerHTML = '';
    const back = comesBack();
    await applyLateVerdictDirect(back, { kind: 'hide', analysis: { ...judged(9), action: 'hide' }, detectionMode: 'combined-detect-neutralize' } as never);
    await settle();
    expect(records()).toHaveLength(1);
  });
});

describe('the sentence, in every language', () => {
  it('has words in all four and is the key of its own', () => {
    expect(DECISION_NOTE_KEYS[NOTE_LATE_VERDICT]).toBe('feedNoteLateVerdict');
    for (const lang of UI_LANGUAGES) {
      const words = decisionNoteWords(lang, NOTE_LATE_VERDICT, undefined);
      expect(words, lang).toBeTruthy();
      expect(words).not.toBe(NOTE_LATE_VERDICT);
    }
    expect(NOTE_LATE_VERDICT).toBe('the reading answered after the item had scrolled away; it was applied when the item came back; applied is what it did');
  });
});

interface FWVerifier {
  verifyExportText(text: string): Promise<{ state: string; failures: Array<{ index: number; reason: string }> }>;
}

describe('the standalone checker, with the cancelled record, the applied one and a record from before this sentence', () => {
  let signedHtml = '';
  let api: FWVerifier;

  beforeAll(async () => {
    state.added.length = 0;
    _resetForensicDedupForTesting();
    useMode('teen');
    _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
    await scrolledAway(cancelled());
    document.body.innerHTML = '';
    const back = comesBack();
    await applyLateVerdictDirect(back, lateFor(back)!);
    await settle();
    // A record written before this sentence existed: one of the six old notes, unchanged.
    const old = { ...state.added[1], id: 'old-1', decision: { ...(state.added[1].decision as object), note: 'the video rule for this mode skipped the video; applied is what it did' } };
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
    const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const sign = async (hash: string): Promise<string> => {
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
      return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const records: ForensicRecord[] = [];
    let prev = '';
    for (const [i, r] of [state.added[0], state.added[1], old].entries()) {
      const base = { ...r, publicKeyFingerprint: fp, chainPosition: i, prevRecordHash: prev } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
      const integrityHash = await computeRecordIntegrityHash(base);
      records.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
      prev = integrityHash;
    }
    signedHtml = await attachSignedManifest(buildForensicHtmlExport(records, { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en' }), sign);
    const src = readFileSync(BROWSER_VERIFIER_PATH, 'utf8');
    expect(src).toBe(buildBrowserVerifierSource());
    new Function('window', 'crypto', 'atob', 'TextEncoder', src)(window, crypto, atob, TextEncoder);
    api = (window as unknown as { FWVerifier: FWVerifier }).FWVerifier;
  });

  it('verifies the chain', async () => {
    const report = await api.verifyExportText(signedHtml);
    expect(report.failures).toEqual([]);
    expect(report.state).toBe('verified');
  });

  it('refuses the applied record when its sentence is taken off', async () => {
    const tampered = signedHtml.replace(/(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/, (_m, open: string, body: string, close: string) => {
      const data = JSON.parse(body) as { records: ForensicRecord[]; manifest?: unknown };
      (data.records[1].decision as { note: string | null }).note = null;
      delete data.manifest;
      return open + JSON.stringify(data).replace(/</g, '\u003c') + close;
    });
    expect((await api.verifyExportText(tampered)).state).toBe('failed');
  });
});
