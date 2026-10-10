// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  queryWithFallback,
  queryAllWithFallback,
  extractTextWithFallback,
} from '../../../../src/content/platforms/selector-chain';

function createDOM(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div;
}

describe('queryWithFallback', () => {
  it('returns first match when primary works', () => {
    const root = createDOM('<span class="primary">Hello</span>');
    const result = queryWithFallback(root, ['.primary', '.fallback']);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('Hello');
  });

  it('falls back when primary returns null', () => {
    const root = createDOM('<span class="fallback">World</span>');
    // 2026-04-25: implementation uses console.info (per AUDIT-FIX-01 noise
    // discipline — fallback hits are diagnostic, not warnings).
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const result = queryWithFallback(root, ['.primary', '.fallback'], 'test');
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('World');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('primary selector failed'),
    );
    infoSpy.mockRestore();
  });

  it('returns null when all selectors fail', () => {
    const root = createDOM('<span>Nothing</span>');
    const result = queryWithFallback(root, ['.a', '.b', '.c']);
    expect(result).toBeNull();
  });

  it('handles invalid selectors gracefully', () => {
    const root = createDOM('<span class="valid">OK</span>');
    const result = queryWithFallback(root, ['[[[invalid', '.valid']);
    expect(result).not.toBeNull();
    expect(result!.textContent).toBe('OK');
  });
});

describe('queryAllWithFallback', () => {
  it('uses first selector that has results', () => {
    const root = createDOM(`
      <span class="b">One</span>
      <span class="b">Two</span>
    `);
    // 2026-04-25: implementation uses console.info (see queryWithFallback test).
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const results = queryAllWithFallback(root, ['.a', '.b'], 'test');
    expect(results).toHaveLength(2);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.stringContaining('primary selector failed'),
    );
    infoSpy.mockRestore();
  });
});

describe('extractTextWithFallback', () => {
  it('skips elements with text shorter than minLength', () => {
    const root = createDOM(`
      <p class="short">Short</p>
      <p class="long">This is a long enough paragraph for testing purposes.</p>
    `);
    const result = extractTextWithFallback(root, ['p'], 20);
    expect(result).not.toBeNull();
    expect(result!.text).toBe(
      'This is a long enough paragraph for testing purposes.',
    );
  });

  it('returns null when nothing matches', () => {
    const root = createDOM('<p>Short</p>');
    const result = extractTextWithFallback(root, ['.missing'], 20);
    expect(result).toBeNull();
  });
});
