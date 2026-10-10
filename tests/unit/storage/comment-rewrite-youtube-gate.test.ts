// YouTube is capture-only: comments are recorded + marked but never rewritten.
// Locks isCommentRewriteEnabled (src/storage/settings.ts), ruled 2026-06-07.

import { describe, it, expect } from 'vitest';
import { isCommentRewriteEnabled } from '../../../src/storage/settings';
import type { FWSettings } from '../../../src/storage/settings';

// Minimal settings with the rewrite feature ON globally + a youtube override ON.
const settingsRewriteOn = {
  features: {
    'rewritten-comments-first': {
      enabled: true,
      perPlatform: { youtube: { enabled: true } },
    },
  },
} as unknown as FWSettings;

const settingsRewriteOff = {
  features: { 'rewritten-comments-first': { enabled: false } },
} as unknown as FWSettings;

describe('isCommentRewriteEnabled — YouTube capture-only rule', () => {
  it('is ALWAYS false for youtube, even when the toggle (and its override) is ON', () => {
    expect(isCommentRewriteEnabled(settingsRewriteOn, 'youtube')).toBe(false);
  });

  it('honors the toggle for other platforms (twitter ON)', () => {
    expect(isCommentRewriteEnabled(settingsRewriteOn, 'twitter')).toBe(true);
    expect(isCommentRewriteEnabled(settingsRewriteOn, 'tiktok')).toBe(true);
  });

  it('is false everywhere when the toggle is off', () => {
    expect(isCommentRewriteEnabled(settingsRewriteOff, 'twitter')).toBe(false);
    expect(isCommentRewriteEnabled(settingsRewriteOff, 'youtube')).toBe(false);
  });
});
