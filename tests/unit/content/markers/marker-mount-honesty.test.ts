// @vitest-environment jsdom
//
// Q68 + Q74 (wiring W63): marker mount identity and honest empty-case.
//
// Q68: 'after'-mounted dots deduped only via nextElementSibling; a
// platform-inserted node between body and dot double-mounted a second dot
// with a second closure. WeakMap identity is now the authority.
// Q74: rewrite-kind with empty original AND empty base fell through to a
// GREEN dot announcing "safe rewrite shown" over nothing, and toggling
// back blanked the body; and when a rewrite-less body held real platform
// text, GREEN falsely claimed a rewrite. Empty base now skips the marker;
// rewrite-less base uses the mark-only (RED) posture.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderTeenMarker } from '../../../../src/content/markers/teen-marker';
import type { AnalysisResult } from '../../../../src/types/analysis';

function makeAnalysis(): AnalysisResult {
  return {
    techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }],
    overallScore: 7,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'fear-appeal',
    explanation: 'pushes fear at the reader',
  } as unknown as AnalysisResult;
}

function makeBody(text: string): HTMLElement {
  const wrap = document.createElement('div');
  const el = document.createElement('div');
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  wrap.appendChild(el);
  document.body.appendChild(wrap);
  return el;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('Q68 — after-mount dedup survives platform-inserted siblings', () => {
  it('re-render with a foreign node between body and dot does not double-mount', () => {
    const el = makeBody('a comment');
    const first = renderTeenMarker({
      el, analysis: makeAnalysis(), originalText: 'a comment',
      kind: 'rewrite', rewriteText: 'calm version', mount: 'after',
    });
    expect(first).not.toBeNull();

    // Platform inserts a translate/pin node directly after the body.
    const foreign = document.createElement('div');
    foreign.className = 'platform-translate-chip';
    el.after(foreign);
    expect(el.nextElementSibling).toBe(foreign);

    const second = renderTeenMarker({
      el, analysis: makeAnalysis(), originalText: 'a comment',
      kind: 'rewrite', rewriteText: 'calm version', mount: 'after',
    });
    expect(second).toBeNull();
    expect(el.parentElement!.querySelectorAll('.fw-teen-marker').length).toBe(1);
  });

  it('a detached prior marker allows a fresh mount (virtualizer remount)', () => {
    const el = makeBody('a comment');
    const first = renderTeenMarker({
      el, analysis: makeAnalysis(), originalText: 'a comment',
      kind: 'rewrite', rewriteText: 'calm version', mount: 'after',
    })!;
    first.remove();
    const second = renderTeenMarker({
      el, analysis: makeAnalysis(), originalText: 'a comment',
      kind: 'rewrite', rewriteText: 'calm version', mount: 'after',
    });
    expect(second).not.toBeNull();
  });
});

describe('Q74 — honest empty/rewrite-less final branch', () => {
  it('empty original AND empty body mounts no marker at all', () => {
    const el = makeBody('');
    const marker = renderTeenMarker({
      el, analysis: makeAnalysis(), originalText: '', kind: 'rewrite',
      // rewriteText omitted; holder text empty
    });
    expect(marker).toBeNull();
    expect(el.querySelector('.fw-teen-marker')).toBeNull();
  });

  it('rewrite-less body with real text uses the mark-only posture, not GREEN', () => {
    const el = makeBody('untouched platform text');
    const marker = renderTeenMarker({
      el, analysis: makeAnalysis(), originalText: '', kind: 'rewrite',
    })!;
    expect(marker).not.toBeNull();
    expect(marker.style.getPropertyValue('--fw-marker-color')).toBe('#e53935'); // RED, not GREEN
    expect(marker.getAttribute('aria-label')).not.toContain('rewrote');
  });

  it('genuine rewrite-without-original keeps the GREEN posture', () => {
    const el = makeBody('calm rewrite text');
    const marker = renderTeenMarker({
      el, analysis: makeAnalysis(), originalText: '', kind: 'rewrite',
      rewriteText: 'calm rewrite text',
    })!;
    expect(marker.style.getPropertyValue('--fw-marker-color')).toBe('#4caf50');
  });
});
