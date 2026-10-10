// @vitest-environment jsdom
//
// What the post path writes, read against what the page did. Each case runs the real path on real DOM
// for a site's card in one mode (the injector is real; only a failure is forced), turns the payload
// into a record with the real writer, and asks whether the record says what the page showed:
//   - a Child video skipped in place of a mark says the video rule did it, not that the page failed;
//   - a swear mask says stars only when the stars landed, and otherwise what the page did instead: the
//     video skipped (Child), the caption marked yellow (Adult), the words left as served, or a hide;
//   - a sponsored ad the household switched Block Ads off for is a pass with that note, not a failed
//     hide, and the Child cover does not stay over it;
//   - a Child cover that stays because nothing landed is recorded as a mark that did not land, and a mark
//     whose video skip did not land keeps the cover on the live path and on a stored verdict;
//   - the words on a Reel hidden by a rule name the rule, not a direct threat.
// Then the standalone checker reads every distinct shape the runs wrote.

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const state = vi.hoisted(() => ({
  mode: 'teen' as 'child' | 'teen' | 'adult',
  blockAds: true,
  failRewrite: false,
  failHide: false,
  added: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: state.mode, uiLanguage: 'en', dailyCap: 2000, features: {} })),
    isFeatureEnabled: vi.fn((_s: unknown, id: string) => (id === 'block-ads' ? state.blockAds : true)),
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
vi.mock('../../../src/content/injector', async (importOriginal) => {
  const a = await importOriginal<typeof import('../../../src/content/injector')>();
  return {
    ...a,
    injectIntoElement: vi.fn((...args: Parameters<typeof a.injectIntoElement>) => (state.failRewrite ? false : a.injectIntoElement(...args))),
    injectHardHide: vi.fn((...args: Parameters<typeof a.injectHardHide>) => (state.failHide ? false : a.injectHardHide(...args))),
    injectAdHide: vi.fn((...args: Parameters<typeof a.injectAdHide>) => (state.failHide ? false : a.injectAdHide(...args))),
    injectCollapseOrHide: vi.fn((...args: Parameters<typeof a.injectCollapseOrHide>) => (state.failHide ? false : a.injectCollapseOrHide(...args))),
  };
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
      return 'accepted' as const;
    }),
  };
});

import {
  _applyLateVerdictDirectForTesting as applyLateVerdictDirect,
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _mountProtectionForTesting,
  _onProcessingResultForTesting as onProcessingResult,
  _setActiveAdapterForTesting,
  _setChildProtectionModeForTesting,
} from '../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../src/content/record/forensic-gate';
import { _resetDiagnosticsForTesting } from '../../../src/diagnostics/diagnostics';
import { _resetAdvanceBreakerForTesting, _setHostForTesting } from '../../../src/content/protection/video-feed-hide';
import {
  NOTE_NOT_APPLIED, NOTE_SETTING_OFF, NOTE_VIDEO_FOLDED, NOTE_VIDEO_MARKED, NOTE_VIDEO_SKIPPED,
} from '../../../src/content/record/decision';
import type { PlatformAdapter } from '../../../src/content/platforms/adapter';
import { buildBrowserVerifierSource, BROWSER_VERIFIER_PATH } from '../../../scripts/build-standalone-verifier';
import { attachSignedManifest, buildForensicHtmlExport } from '../../../src/forensics/html-export';
import { computeRecordIntegrityHash } from '../../../src/forensics/canonical-payload';
import type { DecisionBlock, ForensicRecord } from '../../../src/types/forensic';
import {
  PLATFORM, drawCard, judged, pipelineResult, settle, type Card, type Kind, type Mode, type Site,
} from '../../helpers/record-matrix';

interface Run { record: ForensicRecord; decision: DecisionBlock; card: Card }

/** Every record this file's runs produced, in order: the chain the checker reads at the end. */
const collected: ForensicRecord[] = [];

if (!globalThis.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });

/** One record per distinct shape, so the chain stays small and every value the writers can sign is in it. */
function distinctShapes(): ForensicRecord[] {
  const seen = new Set<string>();
  return collected.filter((r) => {
    const d = r.decision as DecisionBlock | undefined;
    const key = JSON.stringify([r.verdict, r.visualApplied, !!r.neutralizedText, d?.row, d?.action, d?.applied, d?.note, d?.rewrite?.outcome ?? null, r.userAgeCategory]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function run(site: Site, mode: Mode, kind: Kind, opts: { failRewrite?: boolean; failHide?: boolean; blockAds?: boolean } = {}): Promise<Run> {
  state.mode = mode;
  state.blockAds = opts.blockAds ?? true;
  state.failRewrite = !!opts.failRewrite;
  state.failHide = !!opts.failHide;
  state.added.length = 0;
  _setChildProtectionModeForTesting(mode);
  _setHostForTesting(site === 'reel' ? 'www.instagram.com' : null);
  history.pushState({}, '', site === 'reel' ? '/reels/AAA/' : '/');
  _setActiveAdapterForTesting({ platform: PLATFORM[site] } as unknown as PlatformAdapter);
  _resetForensicDedupForTesting();
  const card = drawCard(site, `${site}-${mode}-${kind}`);
  if (mode === 'child') _mountProtectionForTesting(card.post, performance.now());
  onProcessingResult(card.post, pipelineResult(kind, mode));
  await settle();
  expect(state.added, `${site} ${mode} ${kind}: one record`).toHaveLength(1);
  const record = state.added[0] as unknown as ForensicRecord;
  collected.push(record);
  return { record, decision: record.decision as DecisionBlock, card };
}

beforeEach(() => {
  document.body.innerHTML = '';
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  _resetAdvanceBreakerForTesting();
});
afterEach(() => { _setHostForTesting(null); history.pushState({}, '', '/'); });

const TEXT_SITES: Site[] = ['x', 'facebook', 'instagram', 'youtube'];
const MODES: Mode[] = ['child', 'teen', 'adult'];

describe('a video the Child mode skipped in place of a mark', () => {
  for (const site of ['tiktok', 'reel'] as const) {
    it(`${site}: the record says hide, and says the video rule did it, not that the page failed`, async () => {
      const { decision, record } = await run(site, 'child', 'mark');
      expect(decision.action).toBe('mark');
      expect(decision.applied).toBe('hide');
      expect(decision.note).toBe(NOTE_VIDEO_SKIPPED);
      expect(record.verdict).toBe('flagged-hidden');
    });
  }

  it('the same mark on a text post is a mark with no note, and a Teen or Adult video is marked with none', async () => {
    expect((await run('x', 'child', 'mark')).decision).toMatchObject({ action: 'mark', applied: 'mark', note: null });
    expect((await run('tiktok', 'teen', 'mark')).decision).toMatchObject({ applied: 'mark', note: null });
    expect((await run('tiktok', 'adult', 'mark')).decision).toMatchObject({ applied: 'mark', note: null });
  });

  it('a skip that did not land is not called a skip: the cover stays and the record says the mark did not land', async () => {
    const { decision, record } = await run('tiktok', 'child', 'mark', { failHide: true });
    expect(document.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(decision.applied).toBe('mark');
    expect(record.visualApplied).toBe(false);
    expect(record.verdict).toBe('flagged');
    expect(decision.note).not.toBe(NOTE_VIDEO_SKIPPED);
  });

  it('the same on a Reel, and a Teen or Adult mark that cannot find its caption keeps no cover', async () => {
    const reel = await run('reel', 'child', 'mark', { failHide: true });
    expect(document.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(reel.decision.applied).toBe('mark');
    expect(reel.record.visualApplied).toBe(false);
    const teen = await run('tiktok', 'teen', 'mark', { failHide: true });
    expect(teen.decision.applied).toBe('mark');
    expect(teen.record.visualApplied).toBeUndefined();
  });
});

describe('a stored verdict applied when the post comes back', () => {
  it('Child: a mark whose video skip did not land keeps the cover, as the live path does', async () => {
    state.mode = 'child';
    state.failHide = true;
    state.failRewrite = false;
    _setChildProtectionModeForTesting('child');
    _setActiveAdapterForTesting({ platform: 'tiktok' } as unknown as PlatformAdapter);
    _resetForensicDedupForTesting();
    const card = drawCard('tiktok', 'late-1');
    _mountProtectionForTesting(card.post, performance.now());
    await applyLateVerdictDirect(card.post, { kind: 'mark', analysis: judged(5) } as never);
    await settle();
    expect(document.querySelector('.fw-provisional-shield')).not.toBeNull();
  });
});

describe('a swear is starred in place in every mode, and the record says what the page showed', () => {
  const ALL_SITES: Site[] = [...TEXT_SITES, 'tiktok', 'reel'];
  for (const site of ALL_SITES) {
    for (const mode of MODES) {
      it(`${site} ${mode}: the words are starred, the video (if any) stays and plays, and the record says stars`, async () => {
        const { decision, record, card } = await run(site, mode, 'mask');
        expect(decision).toMatchObject({ row: 'D1', action: 'allow', applied: 'mask', note: null });
        expect(record.verdict).toBe('masked');
        expect(record.neutralizedText).not.toBe('');
        expect((card.caption ?? card.anchor).textContent).toBe(record.neutralizedText);
        if (card.item) {
          expect(card.item.contains(card.video!)).toBe(true);
          expect(card.item.style.getPropertyValue('display')).not.toBe('none');
          expect(card.caption!.hasAttribute('data-fw-yellow')).toBe(false);
        }
      });
    }
  }

  for (const site of ALL_SITES) {
    for (const mode of MODES) {
      it(`${site} ${mode}: stars that did not land leave the item as served, in Child too, and the record says so`, async () => {
        const { decision, record, card } = await run(site, mode, 'mask', { failRewrite: true });
        expect(decision).toMatchObject({ action: 'allow', applied: 'allow', note: NOTE_NOT_APPLIED, rewrite: { attempted: true, outcome: 'failed' } });
        expect(record.verdict).toBe('pass');
        expect(record.neutralizedText).toBe('');
        expect((card.caption ?? card.anchor).textContent).toContain('you will never be enough');
        expect(document.querySelector('.fw-provisional-shield')).toBeNull();
        if (card.item) expect(card.item.style.getPropertyValue('display')).not.toBe('none');
      });
    }
  }

  it('x Child: a failed mask that also could not hide anything still leaves the item as served, with no cover', async () => {
    const { decision, record } = await run('x', 'child', 'mask', { failRewrite: true, failHide: true });
    expect(document.querySelector('.fw-provisional-shield')).toBeNull();
    expect(decision).toMatchObject({ applied: 'allow', note: NOTE_NOT_APPLIED });
    expect(record.visualApplied).toBeUndefined();
  });
});

describe('a sponsored ad the household switched Block Ads off for', () => {
  for (const site of ['x', 'facebook', 'tiktok'] as const) {
    for (const mode of ['child', 'teen'] as const) {
      it(`${site} ${mode}: recorded as shown as served, switched off, not as a hide that failed`, async () => {
        const { decision, record } = await run(site, mode, 'ad', { blockAds: false });
        expect(decision).toMatchObject({ row: 'R4', applied: 'allow', note: NOTE_SETTING_OFF });
        expect(record.verdict).toBe('pass');
        expect(record.visualApplied).toBeUndefined();
      });
    }
  }

  it('Child: the cover does not stay on over an ad the household asked to see', async () => {
    await run('x', 'child', 'ad', { blockAds: false });
    expect(document.querySelector('.fw-provisional-shield')).toBeNull();
  });

  it('a hide that failed with Block Ads on is still a failed hide, and the Child cover stays', async () => {
    const { decision, record } = await run('x', 'child', 'ad', { failHide: true });
    expect(decision).toMatchObject({ row: 'R4', applied: 'mark', note: NOTE_NOT_APPLIED });
    expect(record.visualApplied).toBe(false);
    expect(document.querySelector('.fw-provisional-shield')).not.toBeNull();
  });

  it('Adult keeps its own shape: shown as served, switched off', async () => {
    const { decision, record } = await run('x', 'adult', 'ad', { blockAds: false });
    expect(decision).toMatchObject({ row: 'R4', applied: 'allow', note: NOTE_SETTING_OFF });
    expect(record.verdict).toBe('pass');
  });
});

interface FWVerifier {
  verifyExportText(text: string): Promise<{ state: string; records: number; failures: Array<{ index: number; id: string | null; reason: string }> }>;
}

describe('the standalone checker reads every shape the runs above wrote', () => {
  let signedHtml = '';
  let api: FWVerifier;

  beforeAll(async () => {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const full = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y };
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jwk.x}|${jwk.y}`));
    const fp = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    const sign = async (hash: string): Promise<string> => {
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: { name: 'SHA-256' } }, kp.privateKey, new TextEncoder().encode(hash));
      return Buffer.from(sig).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const shapes = distinctShapes();
    const records: ForensicRecord[] = [];
    let prev = '';
    for (let i = 0; i < shapes.length; i++) {
      const base = { ...shapes[i], publicKeyFingerprint: fp, chainPosition: i, prevRecordHash: prev } as Omit<ForensicRecord, 'integrityHash' | 'signature' | 'chainAnchor'>;
      const integrityHash = await computeRecordIntegrityHash(base);
      records.push({ ...base, integrityHash, signature: await sign(integrityHash) } as ForensicRecord);
      prev = integrityHash;
    }
    signedHtml = await attachSignedManifest(
      buildForensicHtmlExport(records, { fwVersion: 'V-test', publicKeyJwk: jwk, publicKeyFingerprint: fp, locale: 'en' }),
      sign,
    );
    const src = readFileSync(BROWSER_VERIFIER_PATH, 'utf8');
    expect(src).toBe(buildBrowserVerifierSource());
    new Function('window', 'crypto', 'atob', 'TextEncoder', src)(window, crypto, atob, TextEncoder);
    api = (window as unknown as { FWVerifier: FWVerifier }).FWVerifier;
    expect(records.length).toBeGreaterThan(10);
  });

  function withRecord(index: number, edit: (r: ForensicRecord) => void): string {
    return signedHtml.replace(/(<script type="application\/json" id="fw-export-data">)([\s\S]*?)(<\/script>)/, (_m, open: string, body: string, close: string) => {
      const data = JSON.parse(body) as { records: ForensicRecord[]; manifest?: unknown };
      edit(data.records[index]);
      delete data.manifest;
      return open + JSON.stringify(data).replace(/</g, '\u003c') + close;
    });
  }

  it('verifies the whole chain, with no failure', async () => {
    const report = await api.verifyExportText(signedHtml);
    expect(report.failures).toEqual([]);
    expect(report.state).toBe('verified');
  });

  it('refuses a record whose applied action, or whose note, was changed', async () => {
    const index = distinctShapes().findIndex((r) => (r.decision as DecisionBlock).applied === 'hide' && (r.decision as DecisionBlock).note === NOTE_VIDEO_SKIPPED);
    expect(index).toBeGreaterThanOrEqual(0);
    expect((await api.verifyExportText(withRecord(index, (r) => { (r.decision as { applied: string }).applied = 'allow'; }))).state).toBe('failed');
    expect((await api.verifyExportText(withRecord(index, (r) => { (r.decision as { note: string | null }).note = null; }))).state).toBe('failed');
  });
});

describe('a Child cover that stays because no terminal landed', () => {
  it('a rewrite and its fallback hide both failed: the cover stays, so the record says the item was not shown as served', async () => {
    const { decision, record } = await run('x', 'child', 'rewrite', { failRewrite: true, failHide: true });
    expect(document.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(decision.applied).toBe('mark');
    expect(decision.note).toBe(NOTE_NOT_APPLIED);
    expect(decision.rewrite).toEqual({ attempted: true, outcome: 'failed' });
    expect(record.visualApplied).toBe(false);
    expect(record.verdict).toBe('flagged');
  });

  it('a video skip that did not land: no rewrite was tried, and the record does not say one failed', async () => {
    const { decision, record } = await run('tiktok', 'child', 'rewrite', { failHide: true });
    expect(document.querySelector('.fw-provisional-shield')).not.toBeNull();
    expect(decision.applied).toBe('mark');
    expect(decision.note).toBe(NOTE_NOT_APPLIED);
    expect(decision.rewrite).toEqual({ attempted: false, outcome: 'off' });
    expect(record.visualApplied).toBe(false);
  });
});

describe('a sponsored ad removed on a video says the same thing in every mode', () => {
  for (const mode of MODES) {
    it(`tiktok ${mode}: the video rule turned the fold into a hide, and the note says so`, async () => {
      const { decision } = await run('tiktok', mode, 'ad');
      expect(decision).toMatchObject({ row: 'R4', action: 'collapse', applied: 'hide', note: NOTE_VIDEO_FOLDED });
    });
  }
});

describe('the words on a Reel hidden by a rule name the rule', () => {
  const said = async (mode: Mode, kind: Kind): Promise<string> => (await run('reel', mode, kind)).card.anchor.textContent ?? '';

  it('Teen: the household\'s own word is quoted, a slur and an ad are named as what they are', async () => {
    expect(await said('teen', 'blocklist')).toContain('on this household\'s block list ("cheapthing")');
    expect(await said('teen', 'slur')).toContain('an identity slur');
    expect(await said('teen', 'ad')).toContain('an advertisement');
  });

  it('Adult: the same, and an ad is not called a direct threat', async () => {
    expect(await said('adult', 'blocklist')).toContain('on this household\'s block list ("cheapthing")');
    expect(await said('adult', 'slur')).toContain('an identity slur');
    expect(await said('adult', 'ad')).toContain('an advertisement');
  });

  it('none of them falls to the default reason', async () => {
    for (const mode of ['teen', 'adult'] as const) {
      for (const kind of ['blocklist', 'slur', 'ad', 'hide'] as const) {
        expect(await said(mode, kind), `${mode} ${kind}`).not.toContain('direct threat or harassment');
      }
    }
  });
});
