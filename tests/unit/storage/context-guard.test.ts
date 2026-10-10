/** @vitest-environment jsdom */
// LOOP-044: context-guard unit tests. isContextError is now exported so
// queue.ts can branch its log level — keep the behavior test-protected.

import { describe, it, expect } from 'vitest';
import { isContextError } from '../../../src/storage/context-guard';

describe('context-guard — isContextError', () => {
  it('detects the Chrome MV3 "Extension context invalidated" Error instance', () => {
    const err = new Error('Extension context invalidated.');
    expect(isContextError(err)).toBe(true);
  });

  it('detects the message substring embedded in a longer error', () => {
    const err = new Error('chrome.runtime.sendMessage failed: Extension context invalidated');
    expect(isContextError(err)).toBe(true);
  });

  it('detects the string form (non-Error throws)', () => {
    expect(isContextError('Extension context invalidated')).toBe(true);
  });

  it('returns false for unrelated errors (Groq JSON-mode refusal etc.)', () => {
    expect(isContextError(new Error('Failed to generate JSON.'))).toBe(false);
    expect(isContextError(new Error('fetch failed'))).toBe(false);
    expect(isContextError(new Error('rewrite-timeout'))).toBe(false);
  });

  it('returns false for null / undefined / non-error thrown values', () => {
    expect(isContextError(null)).toBe(false);
    expect(isContextError(undefined)).toBe(false);
    expect(isContextError(42)).toBe(false);
    expect(isContextError({})).toBe(false);
  });
});
