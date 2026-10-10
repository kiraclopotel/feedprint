/** @vitest-environment jsdom */
// Audit cause 1: covers were released on every failure path through a
// scattered set of releaseProtection calls. The settleProtection terminal is
// now the only caller. The first test is the structural lock (a grep); the
// others pin the terminal's contract: the record it owns goes first, the
// per-mode decision is its own, and in Child a release without a record is
// refused.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repoPath } from '../../../helpers/repo-root';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

vi.mock('../../../../src/storage/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/storage/settings')>();
  return {
    ...actual,
    getSettings: vi.fn(async () => ({ mode: 'child', uiLanguage: 'en', dailyCap: 200 })),
  };
});
vi.mock('../../../../src/content/record/forensic-retry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/content/record/forensic-retry')>();
  return {
    ...actual,
    sendHighStakesForensicLog: vi.fn(async () => 'accepted' as const),
  };
});
vi.mock('../../../../src/core/calibration', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../src/core/calibration')>()),
  getEffectiveThreshold: vi.fn(async () => 0.45),
}));

import { createProtectionSettler, type SettleOutcome } from '../../../../src/content/protection/settle-protection';
import {
  _settleProtectionForTesting as settleProtection,
  _setChildProtectionModeForTesting,
  _mountProtectionForTesting,
  _stampClassificationForTesting,
  _childProtectionActiveCountForTesting,
} from '../../../../src/content/index';
import { _resetForensicDedupForTesting } from '../../../../src/content/record/forensic-gate';
import { sendHighStakesForensicLog } from '../../../../src/content/record/forensic-retry';
import type { PostContent } from '../../../../src/types/post';

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('releaseProtection has one call site', () => {
  it('is called only from the settleProtection terminal', () => {
    const root = repoPath('src', 'content');
    const hits: string[] = [];
    let definitions = 0;
    for (const file of listTsFiles(root)) {
      const text = readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (/\bfunction releaseProtection\(/.test(line)) { definitions++; continue; }
        // Forward slashes whatever the machine: the file sits in a folder since PLAN-2026-09-16
        // item 10.4, so the separator is part of the name now, and on Windows join gives a
        // backslash. Left as it was, this test would read differently on two machines.
        const where = file.slice(root.length + 1).split(sep).join('/');
        if (/\breleaseProtection\(/.test(line)) hits.push(`${where}: ${line.trim()}`);
      }
    }
    expect(definitions).toBe(1);
    expect(hits).toEqual(['protection/settle-protection.ts: if (result === \'released\') deps.releaseProtection(post);']);
  });
});

describe('settleProtection terminal contract', () => {
  it('writes the record it owns before releasing, and releases in every mode for a plain outcome', () => {
    const order: string[] = [];
    const settle = createProtectionSettler<string>({
      isChildProtectionEnabled: () => true,
      releaseProtection: () => order.push('release'),
      writeCancelledStaleRecord: () => order.push('record'),
      holdProtection: () => order.push('hold'),
    });
    expect(settle('p', { record: 'write-cancel', reason: 'test' })).toBe('released');
    expect(order).toEqual(['record', 'release']);
  });

  it('keeps a Child cover on retain-in-child, holds it, and releases it in other modes', () => {
    let child = true;
    const release = vi.fn();
    const hold = vi.fn();
    const settle = createProtectionSettler<string>({
      isChildProtectionEnabled: () => child,
      releaseProtection: release,
      writeCancelledStaleRecord: vi.fn(),
      holdProtection: hold,
    });
    expect(settle('p', { record: 'verdict', reason: 'test', disposition: 'retain-in-child' })).toBe('retained');
    expect(release).not.toHaveBeenCalled();
    expect(hold).toHaveBeenCalledTimes(1);
    child = false;
    expect(settle('p', { record: 'verdict', reason: 'test', disposition: 'retain-in-child' })).toBe('released');
    expect(release).toHaveBeenCalledTimes(1);
    // No cover exists outside Child, so nothing is held there.
    expect(hold).toHaveBeenCalledTimes(1);
  });

  it('refuses an outcome that names no record in Child; non-Child has no cover and releases', () => {
    let child = true;
    const release = vi.fn();
    const settle = createProtectionSettler<string>({
      isChildProtectionEnabled: () => child,
      releaseProtection: release,
      writeCancelledStaleRecord: vi.fn(),
      holdProtection: vi.fn(),
    });
    const unnamed = { reason: 'cast-in' } as unknown as SettleOutcome;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(settle('p', unnamed)).toBe('refused');
    expect(release).not.toHaveBeenCalled();
    child = false;
    expect(settle('p', unnamed)).toBe('released');
    expect(release).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe('the production terminal in Child', () => {
  function makePost(id: string, text: string): { post: PostContent; article: HTMLElement } {
    const article = document.createElement('article');
    article.setAttribute('role', 'article');
    const textEl = document.createElement('div');
    textEl.dataset.testid = 'tweetText';
    textEl.textContent = text;
    article.appendChild(textEl);
    document.body.appendChild(article);
    const post = {
      id, text, author: '@someone', timestamp: '2026-08-23T00:00:00Z',
      platform: 'twitter', domRef: new WeakRef(textEl), kind: 'post',
    } as unknown as PostContent;
    return { post, article };
  }

  beforeEach(() => {
    _resetForensicDedupForTesting();
    vi.mocked(sendHighStakesForensicLog).mockClear();
    document.body.innerHTML = '';
    _setChildProtectionModeForTesting('child');
  });

  it('a release with no record is impossible: an unnamed outcome keeps the cover up', () => {
    const { post, article } = makePost('unnamed', 'a post nobody recorded');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    expect(_childProtectionActiveCountForTesting()).toBe(1);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(settleProtection(post, { reason: 'no-record' } as unknown as SettleOutcome)).toBe('refused');
    errorSpy.mockRestore();
    expect(_childProtectionActiveCountForTesting()).toBe(1);
    expect(article.querySelector('.fw-provisional-shield')).not.toBeNull();
  });

  it('a hide that did not land keeps its cover past the deadline, and the cover says the post was skipped', () => {
    vi.useFakeTimers();
    try {
      const { post, article } = makePost('retained', 'a post whose hide could not be applied');
      _stampClassificationForTesting(post);
      _mountProtectionForTesting(post, performance.now());
      const cover = article.querySelector('.fw-provisional-shield');
      expect(cover?.textContent).toBe('One moment, checking this one…');

      expect(settleProtection(post, {
        record: 'verdict',
        reason: 'hide-not-applied',
        disposition: 'retain-in-child',
      })).toBe('retained');

      // The verdict is in, so the cover stops claiming it is still checking.
      expect(cover?.textContent).toBe('Skipped by your Strict filter. Keep scrolling.');
      expect(cover?.getAttribute('aria-label')).toBe('Skipped by your Strict filter. Keep scrolling.');

      // The deadline reaper answers a verdict that never came. This one came.
      vi.advanceTimersByTime(180_000);
      expect(article.querySelector('.fw-provisional-shield')).not.toBeNull();
      expect(_childProtectionActiveCountForTesting()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('write-cancel puts a cancelled-stale record on the chain and then releases', async () => {
    const { post, article } = makePost('written', 'a post the terminal records itself');
    _stampClassificationForTesting(post);
    _mountProtectionForTesting(post, performance.now());
    expect(settleProtection(post, { record: 'write-cancel', reason: 'test' })).toBe('released');
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
    expect(_childProtectionActiveCountForTesting()).toBe(0);
    expect(article.querySelector('.fw-provisional-shield')).toBeNull();
    const cancel = vi.mocked(sendHighStakesForensicLog).mock.calls
      .map((c) => c[0] as { type: string; payload: { verdict?: string; originalText?: string } })
      .find((m) => m.type === 'CANCEL_LOG');
    expect(cancel?.payload.verdict).toBe('cancelled-stale');
    expect(cancel?.payload.originalText).toBe(post.text);
  });
});
