// @vitest-environment jsdom
//
// The marker's text swap must not make the post unreadable.
//
// Reported by the owner on the live FeelingWise Page, 2026-09-04: a
// repeat-exposure mark landed on one of our own posts and the body went black
// on black, readable only by selecting it.
//
// Mechanism: `findTextHolder` returns the first CHILD of the post body that
// carries text. Facebook nests the readable colour on a span inside that child,
// so `holder.textContent = ...` deletes the node holding the colour and the
// replacement text falls back to the holder's own colour. On the dark theme
// that is near-black on a near-black card.
//
// The fix reads the computed colour of the deepest text-bearing descendant
// before the first swap and pins it on the holder. These tests assert the
// contract, not the shade: whatever the platform was using stays in force.

import { describe, it, expect, beforeEach } from 'vitest';
import { renderTeenMarker } from '../../../../src/content/markers/teen-marker';
import type { AnalysisResult } from '../../../../src/types/analysis';

function makeAnalysis(): AnalysisResult {
  return {
    techniques: [{ name: 'repeat-exposure', severity: 6, confidence: 1 }],
    overallScore: 6,
    overallConfidence: 1,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'repeat-exposure',
    explanation: 'this exact post seen 7 times',
  } as unknown as AnalysisResult;
}

/**
 * Facebook's shape: the body's child carries no colour of its own, and the
 * readable colour sits on a span inside it. The body itself is the near-black
 * the card is painted in, which is what the swapped text used to inherit.
 */
function makeFacebookishBody(text: string): HTMLElement {
  const wrap = document.createElement('div');
  const el = document.createElement('div');
  el.style.color = 'rgb(8, 8, 8)';
  const inner = document.createElement('div');
  const span = document.createElement('span');
  span.style.color = 'rgb(228, 230, 235)';
  span.textContent = text;
  inner.appendChild(span);
  el.appendChild(inner);
  wrap.appendChild(el);
  document.body.appendChild(wrap);
  return el;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('marker text swap keeps the platform colour', () => {
  it('a mark-only toggle does not leave the body in the card colour', () => {
    const el = makeFacebookishBody('The other thing we make is called Receipts.');
    renderTeenMarker({ el, analysis: makeAnalysis(), originalText: '', kind: 'rewrite', rewriteText: '', lang: 'en' });

    const marker = el.querySelector('.fw-teen-marker') as HTMLButtonElement;
    expect(marker).not.toBeNull();

    marker.click();

    const holder = Array.from(el.children).find((c) => !c.classList.contains('fw-teen-marker')) as HTMLElement;
    // The holder now carries a single text node, so its own colour is what the
    // reader sees. It must be the span's colour, never the body's near-black.
    expect(holder.style.color).toBe('rgb(228, 230, 235)');
    expect(holder.style.color).not.toBe('rgb(8, 8, 8)');
  });

  it('keeps the colour across a toggle back to the original text', () => {
    const el = makeFacebookishBody('Seen this a lot.');
    renderTeenMarker({ el, analysis: makeAnalysis(), originalText: '', kind: 'rewrite', rewriteText: '', lang: 'en' });
    const marker = el.querySelector('.fw-teen-marker') as HTMLButtonElement;

    marker.click();
    marker.click();

    const holder = Array.from(el.children).find((c) => !c.classList.contains('fw-teen-marker')) as HTMLElement;
    expect(holder.style.color).toBe('rgb(228, 230, 235)');
    expect(holder.textContent).toContain('Seen this a lot.');
  });

  it('leaves a fully transparent colour alone rather than copying it', () => {
    // A platform hiding its own text on purpose is not a colour worth keeping;
    // copying it would reproduce the bug under a different name.
    // Same nesting as the Facebook case, so the holder is the wrapper and the
    // colour under test is one the fix would have to copy deliberately.
    const wrap = document.createElement('div');
    const el = document.createElement('div');
    const inner = document.createElement('div');
    const span = document.createElement('span');
    span.style.color = 'rgba(0, 0, 0, 0)';
    span.textContent = 'invisible on purpose';
    inner.appendChild(span);
    el.appendChild(inner);
    wrap.appendChild(el);
    document.body.appendChild(wrap);

    renderTeenMarker({ el, analysis: makeAnalysis(), originalText: '', kind: 'rewrite', rewriteText: '', lang: 'en' });
    const marker = el.querySelector('.fw-teen-marker') as HTMLButtonElement;
    marker.click();

    const holder = Array.from(el.children).find((c) => !c.classList.contains('fw-teen-marker')) as HTMLElement;
    expect(holder.style.color).toBe('');
  });
});
