/** @vitest-environment jsdom */
// Cancelled-verdict race — act on re-encounter.
//
// A verdict that arrives after the DOM node scrolled away is stamped
// 'cancelled-*' in the chain and its UI is suppressed. Pre-fix, the cancel
// branch ALSO consumed the session text-dedup entry (forensic-gate), so a
// re-encountered item was skipped entirely — the miss was locked in until
// page reload (53 instances in a 2.3-day chain, worst case severity 10).
//
// The contract locked here:
//   1. A cancel never consumes the main dedup entry; the re-encounter gets
//      full handling (record + UI). Cancel records dedup among themselves.
//   2. A successfully RENDERED item still dedups normally — no
//      double-processing regression, and no trailing cancel record for an
//      already-recorded text.
//   3. A mid-flight cancel's preserved verdict maps to an actionable
//      LateVerdict: hide/collapse pass through; a confirmed concern with no
//      rewrite in hand routes to the MARK floor (196219f: confirmed concern,
//      no safe rewrite → at least MARK, never nothing).
//   4. Applying a stored late verdict to a fresh DOM node drives the same
//      injector paths a live verdict would have — including the severity-10
//      hide case, which must never be silent.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repoPath } from '../../../helpers/repo-root';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'teen', uiLanguage: 'en' })),
    isFeatureEnabled: vi.fn(() => true),
  };
});

vi.mock('../../../../src/content/injector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/injector')>();
  return {
    ...actual,
    injectIntoElement: vi.fn(),
    injectCollapseOrHide: vi.fn(),
    injectAdHide: vi.fn(() => false),
    injectHardHide: vi.fn(() => true),
    markOnlyElement: vi.fn(),
  };
});

import {
  shouldLogForensic,
  hasLoggedForensic,
  shouldLogCancelForensic,
  _resetForensicDedupForTesting,
} from '../../../../src/content/record/forensic-gate';
import {
  lateVerdictFromCancelledAnalysis,
  _storeLateVerdictForTesting,
  _peekLateVerdictForTesting,
  _seedSessionVerdictCachesForTesting,
  _sessionVerdictCacheSizesForTesting,
  _clearSessionVerdictCachesOnModeChangeForTesting,
  _sessionVerdictKeyForTesting,
  _hasSessionPassForTesting,
  _isAuthoritativeSessionPassReasonForTesting,
  _storeLateVerdictRealForTesting,
  _noteStaleCancelledForTesting,
  _noteReencounterIfStaleCancelledForTesting,
  type LateVerdict,
} from '../../../../src/content/post-path/late-verdict-cache';
import {
  _resolveRuntimeModeForTesting,
  _applyLateVerdictDirectForTesting,
  _setActiveAdapterForTesting,
} from '../../../../src/content/index';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';
import {
  injectIntoElement,
  injectHardHide,
  injectCollapseOrHide,
  markOnlyElement,
} from '../../../../src/content/injector';
import type { AnalysisResult } from '../../../../src/types/analysis';
import type { PlatformAdapter } from '../../../../src/content/platforms/adapter';
import type { PostContent } from '../../../../src/types/post';

const INDEX_PATH = 'src/content/post-path/result-apply.ts';

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    postId: 'p1',
    techniques: [
      { technique: 'shame-attack' as never, present: true, confidence: 1, severity: 8, evidence: ['e'] },
    ],
    overallScore: 8,
    overallConfidence: 1,
    isManipulative: true,
    processingTimeMs: 10,
    ...overrides,
  };
}

function makePost(id: string, text: string): { post: PostContent; el: HTMLElement } {
  const el = document.createElement('article');
  el.textContent = text;
  document.body.appendChild(el);
  const post = {
    id,
    text,
    author: 'tester',
    timestamp: '2026-07-01T00:00:00Z',
    platform: 'twitter',
    domRef: new WeakRef(el),
    kind: 'post',
  } as unknown as PostContent;
  return { post, el };
}

beforeEach(() => {
  _setActiveAdapterForTesting({ platform: 'twitter' } as unknown as PlatformAdapter);
  _resetForensicDedupForTesting();
  _clearSessionVerdictCachesOnModeChangeForTesting();
  _resetDiagnosticsForTesting();
  vi.mocked(injectIntoElement).mockClear();
  vi.mocked(injectHardHide).mockClear();
  vi.mocked(injectCollapseOrHide).mockClear();
  vi.mocked(markOnlyElement).mockClear();
  document.body.innerHTML = '';
});

describe('dedup unlock — cancel never consumes the main entry', () => {
  it('memoizes only authoritative fresh or persistent-cache PASS reasons', () => {
    expect(_isAuthoritativeSessionPassReasonForTesting('post-llm-no-techniques')).toBe(true);
    expect(_isAuthoritativeSessionPassReasonForTesting('pre-llm-cache-pass')).toBe(true);
    expect(_isAuthoritativeSessionPassReasonForTesting('pre-llm-cap-exhausted')).toBe(false);
    expect(_isAuthoritativeSessionPassReasonForTesting('pre-llm-ai-call-failed')).toBe(false);
    expect(_isAuthoritativeSessionPassReasonForTesting(undefined)).toBe(false);
  });

  it('keys session verdicts by the complete classification input', () => {
    const first = makePost('reused-id', 'first text').post;
    const replacement = makePost('reused-id', 'replacement text').post;
    expect(_sessionVerdictKeyForTesting(first)).not.toBe(_sessionVerdictKeyForTesting(replacement));
  });

  it('does not replay an organic PASS after the same card hydrates as sponsored', () => {
    const organic = makePost('late-sponsored', 'same card text').post;
    const sponsored = makePost('late-sponsored', 'same card text').post;
    sponsored.is_sponsored = true;
    // action stays undefined (= no intervention). The seed helper adds the
    // post to the pass set unconditionally; AnalysisResult.action is the
    // intervention union and deliberately has no 'pass' member.
    const analysis = makeAnalysis();

    _seedSessionVerdictCachesForTesting(organic, {
      postId: organic.id,
      originalHash: 'hash',
      rewrittenText: 'unused',
      analysis,
      aiSource: 'cloud',
      processingTimeMs: 10,
    }, analysis);

    expect(_hasSessionPassForTesting(organic)).toBe(true);
    expect(_hasSessionPassForTesting(sponsored)).toBe(false);
  });

  it('invalidates every verdict shape when the mode changes', () => {
    const { post } = makePost('mode-switch', 'unsafe child-mode post');
    const analysis = makeAnalysis({ action: 'hide' });
    _seedSessionVerdictCachesForTesting(post, {
      postId: post.id,
      originalHash: 'hash',
      rewrittenText: 'safer text',
      analysis,
      aiSource: 'cloud',
      processingTimeMs: 10,
    }, analysis);
    expect(_sessionVerdictCacheSizesForTesting()).toEqual([1, 1, 1, 1]);

    // This is the storage mode-listener action before Adult re-detection.
    _clearSessionVerdictCachesOnModeChangeForTesting();
    expect(_sessionVerdictCacheSizesForTesting()).toEqual([0, 0, 0, 0]);
  });

  it('resolves removal of the stored mode key to the Teen default', () => {
    expect(_resolveRuntimeModeForTesting(undefined)).toBe('teen');
  });

  it('a cancelled text stays eligible for full handling on re-encounter', () => {
    // First encounter: verdict arrives late → cancel record written.
    expect(shouldLogCancelForensic('late verdict text')).toBe(true);
    // The main entry was NOT consumed …
    expect(hasLoggedForensic('late verdict text')).toBe(false);
    // … so the re-encounter records + renders normally.
    expect(shouldLogForensic('late verdict text')).toBe(true);
  });

  it('cancel records dedup among themselves (no chain spam)', () => {
    expect(shouldLogCancelForensic('cancelled twice')).toBe(true);
    expect(shouldLogCancelForensic('cancelled twice')).toBe(false);
  });

  it('a rendered item still dedups normally — no double-processing', () => {
    // Successful render consumes the entry …
    expect(shouldLogForensic('rendered text')).toBe(true);
    // … so a re-encounter writes no second record
    expect(shouldLogForensic('rendered text')).toBe(false);
    // … and a late cancel for an already-recorded text writes nothing.
    expect(shouldLogCancelForensic('rendered text')).toBe(false);
  });

  it('cancel-then-render-then-cancel: exactly one cancel + one real record', () => {
    expect(shouldLogCancelForensic('t')).toBe(true);   // encounter 1: cancelled
    expect(shouldLogForensic('t')).toBe(true);          // encounter 2: rendered
    expect(shouldLogCancelForensic('t')).toBe(false);   // encounter 3: late cancel — already recorded
    expect(shouldLogForensic('t')).toBe(false);         // encounter 4: deduped
  });
});

describe('lateVerdictFromCancelledAnalysis — verdict → actionable shape', () => {
  it('hide passes through', () => {
    const v = lateVerdictFromCancelledAnalysis(makeAnalysis({ action: 'hide', overallScore: 10 }));
    expect(v).toEqual({ kind: 'hide', analysis: expect.objectContaining({ action: 'hide' }) });
  });

  it('collapse passes through', () => {
    const v = lateVerdictFromCancelledAnalysis(makeAnalysis({ action: 'collapse' }));
    expect(v?.kind).toBe('collapse');
  });

  it('MARK floor: confirmed concern with no rewrite in hand → mark, never nothing', () => {
    // action 'rewrite': the rewrite text was never produced (cancel fired
    // before neutralization) — must still be visibly actionable.
    expect(lateVerdictFromCancelledAnalysis(makeAnalysis({ action: 'rewrite' }))?.kind).toBe('mark');
    // legacy/undefined action on a confirmed flag → same floor.
    expect(lateVerdictFromCancelledAnalysis(makeAnalysis({ action: undefined }))?.kind).toBe('mark');
  });

  it('unconfirmed analyses store nothing', () => {
    expect(lateVerdictFromCancelledAnalysis(makeAnalysis({ isManipulative: false }))).toBeNull();
    expect(lateVerdictFromCancelledAnalysis(undefined)).toBeNull();
  });
});

describe('applyLateVerdictDirect — stored verdict lands on the fresh node', () => {
  it('severity-10 cancelled hide, re-encountered → hidden, never silent', async () => {
    const analysis = makeAnalysis({ action: 'hide', overallScore: 10 });
    const late = lateVerdictFromCancelledAnalysis(analysis)!;
    _storeLateVerdictForTesting('sev10-post', late);
    expect(_peekLateVerdictForTesting('sev10-post')).toBe(late);

    const { post, el } = makePost('sev10-post', 'a severity-10 threat that scrolled away');
    await _applyLateVerdictDirectForTesting(post, late);
    // The apply runs the live path, whose visual and record land after a settings read.
    await new Promise((r) => setTimeout(r, 30));

    expect(injectHardHide).toHaveBeenCalledTimes(1);
    expect(vi.mocked(injectHardHide).mock.calls[0][0]).toBe(el);
  });

  it('mark floor renders the severity dot on the original text', async () => {
    const analysis = makeAnalysis({ action: undefined });
    const late = lateVerdictFromCancelledAnalysis(analysis)!;
    const { post, el } = makePost('mark-post', 'confirmed concern, rewrite never produced');

    await _applyLateVerdictDirectForTesting(post, late);
    // The apply runs the live path, whose visual and record land after a settings read.
    await new Promise((r) => setTimeout(r, 30));

    expect(markOnlyElement).toHaveBeenCalledTimes(1);
    const [calledEl, calledAnalysis, , originalText] = vi.mocked(markOnlyElement).mock.calls[0];
    expect(calledEl).toBe(el);
    expect(calledAnalysis).toBe(analysis);
    expect(originalText).toBe(post.text);
  });

  it('neutralize (render-gate suppressed rewrite) re-injects the rewrite', async () => {
    const neutralized = {
      rewrittenText: 'a calmer version',
      analysis: makeAnalysis(),
      aiSource: 'cloud',
    } as never;
    const late: LateVerdict = { kind: 'neutralize', neutralized };
    const { post, el } = makePost('neut-post', 'original hostile text');

    await _applyLateVerdictDirectForTesting(post, late);
    // The apply runs the live path, whose visual and record land after a settings read.
    await new Promise((r) => setTimeout(r, 30));

    expect(injectIntoElement).toHaveBeenCalledTimes(1);
    expect(vi.mocked(injectIntoElement).mock.calls[0][0]).toBe(el);
    expect(vi.mocked(injectIntoElement).mock.calls[0][1]).toBe(neutralized);
  });

  it('dead domRef no-ops without throwing (node gone again before apply)', async () => {
    const late = lateVerdictFromCancelledAnalysis(makeAnalysis({ action: 'hide' }))!;
    const post = {
      id: 'dead-post',
      text: 'gone',
      author: 'tester',
      timestamp: '2026-07-01T00:00:00Z',
      platform: 'twitter',
      domRef: { deref: () => undefined } as unknown as WeakRef<HTMLElement>,
      kind: 'post',
    } as unknown as PostContent;

    await _applyLateVerdictDirectForTesting(post, late);
    // The apply runs the live path, whose visual and record land after a settings read.
    await new Promise((r) => setTimeout(r, 30));

    expect(injectHardHide).not.toHaveBeenCalled();
    expect(injectCollapseOrHide).not.toHaveBeenCalled();
    expect(markOnlyElement).not.toHaveBeenCalled();
  });
});

// First-encounter recovery MEASUREMENT (owner-authorized :decide 2026-08-04).
// Counters only — these tests also stand guard that the instrument never
// mutates behavior: every assertion below is about counts, and the behavioral
// contracts above must keep passing unchanged around them.
describe('first-encounter recovery measurement', () => {
  const readCounters = () => _getDiagnosticCountersForTesting();

  it('storing a real late verdict counts recoverable; applying it counts recovered', async () => {
    const { post } = makePost('fe-recover', 'recover me');
    const late = lateVerdictFromCancelledAnalysis(makeAnalysis({ action: 'hide' }))!;
    _storeLateVerdictRealForTesting(post, late);
    expect(readCounters().firstEncounterRecoverable).toBe(1);
    expect(readCounters().firstEncounterRecovered).toBeUndefined();

    await _applyLateVerdictDirectForTesting(post, late);
    // The apply runs the live path, whose visual and record land after a settings read.
    await new Promise((r) => setTimeout(r, 30));
    expect(readCounters().firstEncounterRecovered).toBe(1);
  });

  it('cap eviction counts every dropped recoverable verdict', () => {
    const late = lateVerdictFromCancelledAnalysis(makeAnalysis({ action: 'hide' }))!;
    for (let i = 0; i <= 500; i++) {
      const { post } = makePost(`fe-evict-${i}`, `text ${i}`);
      _storeLateVerdictRealForTesting(post, late);
    }
    expect(readCounters().firstEncounterRecoverable).toBe(501);
    expect(readCounters().firstEncounterRecoverableEvicted).toBeGreaterThan(0);
  });

  it('a stale-cancelled post counts its re-encounter exactly once', () => {
    const { post } = makePost('fe-stale', 'stale text');
    _noteStaleCancelledForTesting(post);
    _noteReencounterIfStaleCancelledForTesting(post);
    _noteReencounterIfStaleCancelledForTesting(post);
    expect(readCounters().firstEncounterStaleReencountered).toBe(1);
  });

  it('a mode change clears the stale set — cross-mode re-encounters never count', () => {
    const { post } = makePost('fe-stale-mode', 'stale text');
    _noteStaleCancelledForTesting(post);
    _clearSessionVerdictCachesOnModeChangeForTesting();
    _noteReencounterIfStaleCancelledForTesting(post);
    expect(readCounters().firstEncounterStaleReencountered).toBeUndefined();
  });

  it('source lock: the cancel branch counts both cancel kinds and the unconfirmed mid-flight case', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(repoPath(...INDEX_PATH.split(String.fromCharCode(47))), 'utf8');
    expect(src).toMatch(/result\.cancelKind === 'stale' \? 'firstEncounterCancelStale' : 'firstEncounterCancelMidFlight'/);
    expect(src).toMatch(/if \(result\.cancelKind === 'stale'\) noteStaleCancelled\(post\);/);
    expect(src).toMatch(/else bumpCounter\('firstEncounterMidFlightUnconfirmed'\);/);
  });
});
