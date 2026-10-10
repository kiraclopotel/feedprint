// @vitest-environment jsdom
//
// Q66 + Q67 (wiring W62): marker state vs the injector's rewrite guard.
//
// Q66: the two-state toggle stamped 'red' at RENDER time, and the guard
// skipped every non-green state, so folded posts lost their calm
// placeholder to the first platform re-render, permanently. The resting
// state is now 'base' and the guard defends both 'green' and 'base'.
// Q67: cache replay swapped the rewrite back into the body while a marker
// left on RED/YELLOW kept asserting the original was visible;
// resyncMarkerToGreen re-aligns state, dot, and aria.

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTeenMarker, resyncMarkerToGreen } from '../../../../src/content/markers/teen-marker';
import type { AnalysisResult } from '../../../../src/types/analysis';

const INJECTOR_PATH = 'src/content/injector.ts';

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
  const el = document.createElement('div');
  const span = document.createElement('span');
  span.textContent = text;
  el.appendChild(span);
  document.body.appendChild(el);
  return el;
}

beforeEach(() => { document.body.innerHTML = ''; });

describe('Q66 — resting state does not disarm the guard', () => {
  it('collapse marker rests on base, and the guard skip condition ignores it (source-lock)', () => {
    const body = makeBody('calm placeholder');
    renderTeenMarker({ el: body, analysis: makeAnalysis(), originalText: 'toxic', kind: 'collapse' });
    expect(body.dataset.fwMarkerState).toBe('base');

    const injector = readFileSync(join(process.cwd(), INJECTOR_PATH), 'utf8');
    expect(injector).toContain("el.dataset.fwMarkerState === 'yellow' || el.dataset.fwMarkerState === 'red'");
    expect(injector).not.toContain("el.dataset.fwMarkerState !== 'green'");
  });

  it('the user-pressed yellow state still exempts the guard (round trip)', () => {
    const body = makeBody('calm placeholder');
    const marker = renderTeenMarker({ el: body, analysis: makeAnalysis(), originalText: 'toxic', kind: 'collapse' })!;
    marker.click();
    expect(body.dataset.fwMarkerState).toBe('yellow');
    marker.click();
    expect(body.dataset.fwMarkerState).toBe('base');
  });
});

describe('Q67 — replay resync', () => {
  it('re-aligns a RED marker to green with dot and aria', () => {
    const body = makeBody('original text here');
    const marker = renderTeenMarker({
      el: body, analysis: makeAnalysis(), originalText: 'original text here',
      kind: 'rewrite', rewriteText: 'calm rewrite here',
    })!;
    marker.click(); // green -> yellow
    marker.click(); // yellow -> red
    expect(body.dataset.fwMarkerState).toBe('red');

    resyncMarkerToGreen(body, 'en');
    expect(body.dataset.fwMarkerState).toBe('green');
    // W65: aria-pressed removed (3-state cycle is not a two-state toggle);
    // the state-specific aria-label is the single accessibility channel.
    expect(marker.getAttribute('aria-pressed')).toBeNull();
    expect(marker.style.getPropertyValue('--fw-marker-color')).toBe('#4caf50');
  });

  it('no-ops on green and on base (two-state markers untouched)', () => {
    const body = makeBody('calm placeholder');
    renderTeenMarker({ el: body, analysis: makeAnalysis(), originalText: 'toxic', kind: 'collapse' });
    resyncMarkerToGreen(body, 'en');
    expect(body.dataset.fwMarkerState).toBe('base');
  });

  it('injectTeen calls it on the replay path (source-lock)', () => {
    const injector = readFileSync(join(process.cwd(), INJECTOR_PATH), 'utf8');
    expect(injector).toContain('if (mounted === null) resyncMarkerToGreen(el, lang);');
  });
});
