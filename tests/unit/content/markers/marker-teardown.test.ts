// @vitest-environment jsdom
//
// Q71 + Q72 (wiring W64): style resilience and teardown.
//
// Q71: the module-level stylesInjected latch made style-tag removal
// unrecoverable; a replaced <head> left every later marker an invisible
// unstyled button. The DOM is now the only authority.
// Q72: no teardown existed; releaseAllGuards drops guard observers and
// strong refs on interceptor.stop(), and removeAllTeenMarkers honors a
// markers-off flip (rewrites and guards deliberately stay).

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTeenMarker, removeAllTeenMarkers } from '../../../../src/content/markers/teen-marker';
import type { AnalysisResult } from '../../../../src/types/analysis';

const INDEX_PATH = 'src/content/index.ts';
const INTERCEPTOR_PATH = 'src/content/post-path/dom-interceptor.ts';

function makeAnalysis(): AnalysisResult {
  return {
    techniques: [{ name: 'fear-appeal', severity: 7, confidence: 0.9 }],
    overallScore: 7,
    overallConfidence: 0.9,
    isManipulative: true,
    processingTimeMs: 1,
    primaryTechnique: 'fear-appeal',
    explanation: 'pushes fear',
  } as unknown as AnalysisResult;
}

function makeBody(text: string): HTMLElement {
  const el = document.createElement('div');
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.getElementById('fw-teen-marker-styles')?.remove();
});

describe('Q71 — style tag heals after removal', () => {
  it('a second marker re-creates the style block when the first was removed', () => {
    renderTeenMarker({
      el: makeBody('one'), analysis: makeAnalysis(),
      originalText: 'one', kind: 'rewrite', rewriteText: 'calm one',
    });
    expect(document.getElementById('fw-teen-marker-styles')).not.toBeNull();

    // Simulate a SPA replacing <head> content.
    document.getElementById('fw-teen-marker-styles')!.remove();

    renderTeenMarker({
      el: makeBody('two'), analysis: makeAnalysis(),
      originalText: 'two', kind: 'rewrite', rewriteText: 'calm two',
    });
    expect(document.getElementById('fw-teen-marker-styles')).not.toBeNull();
  });
});

describe('Q72 — teardown honors the setting', () => {
  it('removeAllTeenMarkers removes every dot but leaves the body text', () => {
    const a = makeBody('body a');
    const b = makeBody('body b');
    renderTeenMarker({ el: a, analysis: makeAnalysis(), originalText: 'body a', kind: 'rewrite', rewriteText: 'calm a' });
    renderTeenMarker({ el: b, analysis: makeAnalysis(), originalText: 'toxic', kind: 'collapse' });
    expect(document.querySelectorAll('.fw-teen-marker').length).toBe(2);

    removeAllTeenMarkers();
    expect(document.querySelectorAll('.fw-teen-marker').length).toBe(0);
    expect(a.textContent).toContain('body a');
  });

  it('wiring (source-lock): stop releases guards; the features path removes dots on markers-off', () => {
    const interceptor = readFileSync(join(process.cwd(), INTERCEPTOR_PATH), 'utf8');
    const index = readFileSync(join(process.cwd(), INDEX_PATH), 'utf8');
    const stopBlock = interceptor.match(/stop\(\): void \{[\s\S]{0,400}/)?.[0] ?? '';
    expect(stopBlock).toContain('releaseAllGuards();');
    const featuresBlock = index.match(/function applyRuntimeStrictLanguageChange[\s\S]{0,900}/)?.[0] ?? '';
    expect(featuresBlock).toContain('removeAllTeenMarkers();');
    expect(featuresBlock).toContain("isFeatureEnabled(settings, 'show-reframe-markers', platform)");
  });
});
