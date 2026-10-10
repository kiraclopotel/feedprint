// @vitest-environment jsdom
//
// TT-3 (2026-07-13 swarm audit) — tiktok-engagement.ts's comment-section
// discovery and its sticker-comment hider both gated exclusively on
// `[data-e2e^="comment-level-"]`, the row marker `tiktok-bundle.ts`'s own
// selector-contract header documents as STRIPPED from TikTok's current
// comment panel (replaced by the `DivCommentItemWrapper` substring-class
// anchor, `TT_COMMENT_ROW_SELECTOR`). `emoji-stripper.ts` and
// `empty-comment-hide.ts` already list both selectors side by side and
// degrade gracefully; `tiktok-engagement.ts` used the stale selector alone,
// so on current TikTok DOM:
//   (a) `controlCommentSection` never found a container -> the
//       block-comment-posting / rewritten-comments-first section-level
//       toggles silently no-opped;
//   (b) `hideStickerComments()` never found a row to inspect -> the
//       explicitly-requested "[Sticker]" placeholder hider never ran.
//
// These tests build fixtures in the CURRENT DOM shape (no `comment-level-`
// attribute anywhere — mirrors `buildContainerWithComments` in
// tiktok-bundle-extract.test.ts: DivCommentItemWrapper row, `a[href^="/@"]`
// author, TUXText body span) and assert the gate engages. A second set of
// fixtures uses the OLD DOM shape to prove no regression.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/content/engagement/section-model', () => ({
  startCountChipScan: () => () => {},
}));

import { startTikTokEngagementControl } from '../../../src/content/engagement/tiktok-engagement';
import {
  FWSettings,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { childPreset } from '../../../src/storage/presets';

// controlCommentSection / controlActionRail fire-and-forget
// `void incrementMetricsHidden()` on a first-time hide, which calls
// `chrome.storage.local.{get,set}` directly. Not under test here (TT-3 is
// about selector recognition, not the metrics counter), but an unmocked
// `chrome` global makes every real hide throw an unhandled rejection.
function mockChromeStorage(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
      },
    },
    runtime: { id: 'test-extension-id' },
  };
}

function makeSettings(): FWSettings {
  return {
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    mode: 'child',
    strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
    parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
    outputLanguage: 'auto', uiLanguage: 'auto',
    totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
    estimatedCostToday: 0, lastResetDate: '',
    totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
    totalTokensAllTime: 0, totalChecksAllTime: 0,
    totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
    // childPreset() has block-comment-posting: true — the exact toggle
    // TT-3 says silently stopped applying to the comment SECTION.
    features: childPreset(),
    presets: { appliedAt: '', appliedPreset: 'child' },
    dashboardTheme: 'dark',
  };
}

// ── Comment-section fixtures ────────────────────────────────────────────

function newShapeCommentSection(): HTMLElement {
  // Current DOM shape: no `comment-level-*` attribute anywhere. Row anchor
  // is the DivCommentItemWrapper substring class.
  const section = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'css-2-DivCommentItemWrapper e2';
  const author = document.createElement('a');
  author.setAttribute('href', '/@viewer1');
  author.textContent = 'viewer1';
  row.appendChild(author);
  const body = document.createElement('span');
  body.className = 'TUXText TUXText--weight-normal';
  body.textContent = 'a genuine public comment';
  row.appendChild(body);
  section.appendChild(row);
  // discoverContainer requires minHeight: 80 on the candidate; jsdom's
  // getBoundingClientRect defaults to all-zero, so stub it on the
  // candidate the walk will land on (the row's parent, `section`).
  section.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 300,
    width: 400, height: 300, toJSON: () => ({}),
  });
  return section;
}

function oldShapeCommentSection(): HTMLElement {
  const section = document.createElement('div');
  const row = document.createElement('div');
  row.setAttribute('data-e2e', 'comment-level-1');
  const text = document.createElement('span');
  text.setAttribute('data-e2e', 'comment-text-1');
  text.textContent = 'a genuine public comment';
  row.appendChild(text);
  section.appendChild(row);
  section.getBoundingClientRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 300,
    width: 400, height: 300, toJSON: () => ({}),
  });
  return section;
}

describe('TT-3 — controlCommentSection recognizes current TikTok DOM', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    mockChromeStorage();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('engages block-comment-posting on the NEW DOM shape (DivCommentItemWrapper only, no comment-level-*)', () => {
    const section = newShapeCommentSection();
    document.body.appendChild(section);

    stop = startTikTokEngagementControl(makeSettings());

    expect(section.dataset.fwCommentSection).toBe('hidden');
  });

  it('still engages on the OLD DOM shape (comment-level-* present) — no regression', () => {
    const section = oldShapeCommentSection();
    document.body.appendChild(section);

    stop = startTikTokEngagementControl(makeSettings());

    expect(section.dataset.fwCommentSection).toBe('hidden');
  });
});

// ── Sticker-comment-hider fixtures ──────────────────────────────────────

function newShapeStickerRow(text: string, author = 'viewer2'): HTMLElement {
  const row = document.createElement('div');
  row.className = 'css-3-DivCommentItemWrapper e3';
  const authorLink = document.createElement('a');
  authorLink.setAttribute('href', `/@${author}`);
  authorLink.textContent = author;
  row.appendChild(authorLink);
  const body = document.createElement('span');
  body.className = 'TUXText TUXText--weight-normal';
  body.textContent = text;
  row.appendChild(body);
  return row;
}

function oldShapeStickerRow(text: string): HTMLElement {
  const row = document.createElement('div');
  row.setAttribute('data-e2e', 'comment-level-1');
  const textEl = document.createElement('span');
  textEl.setAttribute('data-e2e', 'comment-text-1');
  textEl.textContent = text;
  row.appendChild(textEl);
  return row;
}

describe('TT-3 — hideStickerComments recognizes current TikTok DOM', () => {
  let stop: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
    mockChromeStorage();
  });

  afterEach(() => {
    stop?.();
    stop = null;
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
  });

  it('hides a "[Sticker]" placeholder row on the NEW DOM shape', () => {
    const row = newShapeStickerRow('[Sticker]');
    document.body.appendChild(row);

    stop = startTikTokEngagementControl(makeSettings());

    expect(row.dataset.fwStickerHidden).toBe('true');
    expect(row.style.getPropertyValue('display')).toBe('none');
  });

  it('leaves a genuine (non-sticker) comment visible on the NEW DOM shape', () => {
    const row = newShapeStickerRow('this is a real comment, not a sticker');
    document.body.appendChild(row);

    stop = startTikTokEngagementControl(makeSettings());

    expect(row.dataset.fwStickerHidden).toBeUndefined();
  });

  it('still hides a "[Sticker]" placeholder row on the OLD DOM shape — no regression', () => {
    const row = oldShapeStickerRow('[Sticker]');
    document.body.appendChild(row);

    stop = startTikTokEngagementControl(makeSettings());

    expect(row.dataset.fwStickerHidden).toBe('true');
  });
});
