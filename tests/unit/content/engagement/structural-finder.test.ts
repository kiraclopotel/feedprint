// @vitest-environment jsdom
//
// Regression tests for ENG-1 (audit swarm-2026-07-13, docs/audits/swarm-2026-07-13/07-engagement-hider.md):
// the wrapper tier (`metaWrapperMatches`) is guaranteed true for every
// candidate this scan ever considers, because POST_CONTAINER_SELECTORS (the
// outer scan-scope list) is a subset of META_STABLE_HOOK_SELECTOR (the
// wrapper-tier selector). Counting wrapper as a scored tier collapses the
// documented "≥2 independent tiers" fusion threshold to "≥1 real tier",
// which lets a single weak signal (e.g. a generic aria-label stem like
// "share") hide buttons inside a user-opened share/save dialog.
//
// These tests assert observable behavior (does tagEngagementElements hide
// the element?), not internals, so they survive future scoring refactors.

import { afterEach, describe, expect, it, vi } from 'vitest';

// tagAsEngagement() fire-and-forgets a parent-facing hidden-metrics counter
// via chrome.storage, which isn't available in this jsdom unit-test
// environment. Stub it so tagging assertions stay hermetic (no unhandled
// rejection noise from a `chrome` global that doesn't exist here).
vi.mock('../../../../src/storage/settings', () => ({ incrementMetricsHidden: vi.fn() }));

import { tagEngagementElements } from '../../../../src/content/engagement/structural-finder';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('tagEngagementElements — ENG-1 wrapper-tier independence', () => {
  it('does not hide a share-sheet button carrying only wrapper + one weak (aria) signal', () => {
    // [role="dialog"] is both a POST_CONTAINER_SELECTORS entry and a
    // META_STABLE_HOOK_SELECTOR entry, so `wrapper` is free for anything
    // inside it. The button below has a generic aria-label stem ("share")
    // but no matching SVG icon path, no qualifying flex/child-count
    // structure, and no count text — i.e. exactly one real signal (aria).
    // Pre-fix this scored aria(1) + wrapper(1, free) = 2 and got hidden;
    // that is the ENG-1 false-positive (native share-sheet button
    // vanishing inside a dialog the user just opened).
    const host = mount(`
      <div role="dialog">
        <div>
          <button aria-label="Share to Messenger">Share to Messenger</button>
        </div>
      </div>
    `);

    const result = tagEngagementElements(host);
    const button = host.querySelector('button')!;

    expect(button.dataset.fwEngagementBar).toBeUndefined();
    expect(button.style.display).not.toBe('none');
    expect(result.tagged).toBe(0);
  });

  it('does not hide a candidate carrying only the wrapper signal and nothing else', () => {
    const host = mount(`
      <div role="dialog">
        <button>Untitled control</button>
      </div>
    `);

    const result = tagEngagementElements(host);
    const button = host.querySelector('button')!;

    expect(button.dataset.fwEngagementBar).toBeUndefined();
    expect(result.tagged).toBe(0);
  });

  it('still hides a genuine action-bar button with two independent non-wrapper signals (no regression)', () => {
    // aria stem "like" (Tier 1) + the exact FB thumb-icon d-path prefix
    // (Tier 2) are independent of the free wrapper tier — this is the
    // real engagement-bar shape the fusion threshold exists to catch.
    const host = mount(`
      <article>
        <button aria-label="Like">
          <svg><path d="M6.235 21H3v-9h3.235V21z"></path></svg>
        </button>
      </article>
    `);

    const result = tagEngagementElements(host);
    const button = host.querySelector('button')!;

    expect(button.dataset.fwEngagementBar).toBe('true');
    expect(button.style.display).toBe('none');
    expect(result.tagged).toBe(1);
  });

  it('still hides a genuine FB-style comment button (aria + svg) inside a dialog modal', () => {
    // Same two-independent-signal shape as above, but scoped inside a
    // [role="dialog"] photo/post modal instead of <article> — confirms the
    // fix doesn't regress modal-scoped engagement hiding (the FB photo
    // viewer live-test case documented above in this file).
    const host = mount(`
      <div role="dialog">
        <button aria-label="Comment">
          <svg><path d="M21.07 11.286c0-4.86-4.123-8.572-9.07-8.572"></path></svg>
        </button>
      </div>
    `);

    const result = tagEngagementElements(host);
    const button = host.querySelector('button')!;

    expect(button.dataset.fwEngagementBar).toBe('true');
    expect(result.tagged).toBe(1);
  });
});
