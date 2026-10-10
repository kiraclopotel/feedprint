// @vitest-environment jsdom
//
// M98 photo-modal DOM probe: the cache-identity fix is blocked on live facts
// (does the underlay persist on /photo/N, which copy holds the tabindex
// pivot). The probe must classify those shapes content-free and stay silent
// on an unchanged page.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { noteTwitterPhotoSurface, _resetM98PhotoProbeForTesting } from '../../../../src/content/probes/m98-photo-probe';
import { _resetDiagnosticsForTesting, _getDiagnosticCountersForTesting } from '../../../../src/diagnostics/diagnostics';

function article(withPivot = false, statusHref?: string): HTMLElement {
  const a = document.createElement('article');
  a.setAttribute('role', 'article');
  if (withPivot) a.setAttribute('tabindex', '-1');
  if (statusHref) {
    const link = document.createElement('a');
    link.setAttribute('href', statusHref);
    a.appendChild(link);
  }
  return a;
}

beforeEach(() => {
  document.body.innerHTML = '';
  _resetDiagnosticsForTesting();
  _resetM98PhotoProbeForTesting();
});

describe('m98 photo-surface probe', () => {
  it('classifies an underlay pivot with a mounted modal — the dangerous mixed-tree shape', () => {
    const underlayFocused = article(true, '/u/status/123');
    document.body.appendChild(underlayFocused);
    const layers = document.createElement('div');
    layers.id = 'layers';
    layers.appendChild(article(false, '/u/status/123'));
    layers.appendChild(article(false, '/u/status/456'));
    document.body.appendChild(layers);

    noteTwitterPhotoSurface(document);
    const c = _getDiagnosticCountersForTesting();
    expect(c.m98PhotoModalSeen).toBe(1);
    expect(c.m98PivotInUnderlay).toBe(1);
    expect(c.m98UnderlayArticles).toBe(1);
    expect(c.m98PivotInLayers).toBeUndefined();
  });

  it('classifies a layers pivot with no underlay articles — the safe shape', () => {
    const layers = document.createElement('div');
    layers.id = 'layers';
    layers.appendChild(article(true, '/u/status/123'));
    layers.appendChild(article(false, '/u/status/456'));
    document.body.appendChild(layers);

    noteTwitterPhotoSurface(document);
    const c = _getDiagnosticCountersForTesting();
    expect(c.m98PivotInLayers).toBe(1);
    expect(c.m98UnderlayArticles).toBeUndefined();
  });

  it('counts multiple pivots and the no-pivot degradation case', () => {
    document.body.append(article(true), article(true));
    noteTwitterPhotoSurface(document);
    expect(_getDiagnosticCountersForTesting().m98MultiplePivots).toBe(1);

    _resetDiagnosticsForTesting();
    _resetM98PhotoProbeForTesting();
    document.body.innerHTML = '';
    document.body.append(article(false));
    noteTwitterPhotoSurface(document);
    expect(_getDiagnosticCountersForTesting().m98NoPivot).toBe(1);
  });

  it('an unchanged page emits once; the throttle also swallows rapid calls', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      document.body.append(article(true, '/u/status/9'));
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      noteTwitterPhotoSurface(document);
      noteTwitterPhotoSurface(document); // throttled (same 5s window)
      vi.setSystemTime(Date.now() + 6_000);
      noteTwitterPhotoSurface(document); // past throttle, unchanged signature
      expect(_getDiagnosticCountersForTesting().m98PhotoModalSeen).toBe(1);
      expect(info).toHaveBeenCalledTimes(1);
      info.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});
