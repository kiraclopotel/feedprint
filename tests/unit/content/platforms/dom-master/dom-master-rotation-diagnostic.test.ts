// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  maybeFireRotationDiagnostic,
  _resetRotationDiagnosticGuards,
} from '../../../../../src/content/platforms/dom-master/rotation-diagnostic';

function makeChild(tag: string, className: string, innerTag = 'span', innerText = 'row'): HTMLElement {
  const el = document.createElement(tag);
  if (className) el.className = className;
  const inner = document.createElement(innerTag);
  inner.textContent = innerText;
  el.appendChild(inner);
  return el;
}

describe('rotation-diagnostic — describeContainerShape enrichment (post-2026-05-23)', () => {
  beforeEach(() => {
    _resetRotationDiagnosticGuards();
  });

  afterEach(() => {
    // Defensive: restore any leaked spies if a test assertion failed
    // before its own mockRestore() ran. Without this, a failing test
    // leaves console.warn mocked and a later test's vi.spyOn returns
    // the previously-mocked function (with stale call history).
    vi.restoreAllMocks();
  });

  it('emits child tag/class hints alongside container shape', () => {
    // An IG permalink rotation alert reported only
    // container: ul/3children — no structural hint about the
    // children, so the team couldn't tell whether IG had rotated
    // the row wrapper away from <li>. Post-enrichment: up to 3
    // direct-child descriptors (tag.firstClass/grandchildCount).
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');
    ul.appendChild(makeChild('div', '_a9zj'));
    ul.appendChild(makeChild('div', '_a9zm'));
    ul.appendChild(makeChild('div', '_a9z5'));

    const fired = maybeFireRotationDiagnostic('instagram', ul, {
      contentSelectors: ['span', 'div'],
    });

    expect(fired).toBe(true);
    expect(warnSpy).toHaveBeenCalledOnce();
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('container: ul/3children');
    expect(msg).toContain('div._a9zj/1');
    expect(msg).toContain('div._a9zm/1');
    expect(msg).toContain('div._a9z5/1');
    warnSpy.mockRestore();
  });

  it('omits the class chunk when a direct child has no class', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');
    ul.appendChild(makeChild('li', ''));

    const fired = maybeFireRotationDiagnostic('twitter', ul, {
      contentSelectors: ['span', 'li'],
    });

    expect(fired).toBe(true);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('ul/1children');
    expect(msg).toMatch(/\[li\/1\]/);
    warnSpy.mockRestore();
  });

  it('caps the child-shape list at 3 even with many children', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');
    for (let i = 0; i < 10; i++) {
      ul.appendChild(makeChild('div', `row-${i}`));
    }

    const fired = maybeFireRotationDiagnostic('facebook', ul, {
      contentSelectors: ['span', 'div'],
    });

    expect(fired).toBe(true);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('ul/10children');
    expect(msg).toContain('div.row-0/1');
    expect(msg).toContain('div.row-1/1');
    expect(msg).toContain('div.row-2/1');
    expect(msg).not.toContain('div.row-3/1');
    warnSpy.mockRestore();
  });

  it('truncates long first-class names to 12 chars in the child-shape descriptor', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');
    ul.appendChild(makeChild('div', 'some_very_long_class_name_that_should_be_truncated'));

    const fired = maybeFireRotationDiagnostic('youtube', ul, {
      contentSelectors: ['span'],
    });

    expect(fired).toBe(true);
    const msg = warnSpy.mock.calls[0][0] as string;
    // Truncated form lands in the child-shape descriptor (12-char cap).
    expect(msg).toMatch(/container: ul\/1children \[div\.some_very_lo\/1\]/);
    warnSpy.mockRestore();
  });

  it('returns false (no warning) when no content selector matches', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ul = document.createElement('ul');

    const fired = maybeFireRotationDiagnostic('tiktok', ul, {
      contentSelectors: ['nonexistent-tag'],
    });

    expect(fired).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
