// extraction-canary fires once per platform per session: COLD-START when
// the adapter never extracts in this session, REGRESSION when it stops
// extracting after having worked. Zero-mutation batches don't count
// against the canary (nothing to extract anyway). Both fires are gated
// behind wall-clock minimums (COLD_START_TIME_GATE_MS / REGRESSION_TIME_GATE_MS)
// to suppress SPA hydration + virtualizer churn false-positives.

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  recordExtractionResult,
  _resetExtractionCanaryForTesting,
  __CANARY_THRESHOLDS,
} from '../../../src/diagnostics/extraction-canary';

describe('extraction-canary', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    _resetExtractionCanaryForTesting();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('does not warn when the adapter extracts on the first batch', () => {
    recordExtractionResult('twitter', 5, 10);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not warn on isolated zero-extracts before the cold-start threshold', () => {
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD - 1; i++) {
      recordExtractionResult('twitter', 0, 5);
    }
    // Threshold not yet reached — should be silent regardless of time gate.
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('fires COLD-START warning at the threshold when adapter has never extracted', () => {
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD; i++) {
      recordExtractionResult('tiktok', 0, 5);
    }
    // Threshold count reached but time gate not crossed yet — should still be silent.
    expect(warnSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    recordExtractionResult('tiktok', 0, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('extraction-canary tiktok');
    expect(warnSpy.mock.calls[0][0]).toContain('selectors may be stale');
  });

  it('fires REGRESSION warning when extraction was working but now stops', () => {
    recordExtractionResult('instagram', 4, 10);
    for (let i = 0; i < __CANARY_THRESHOLDS.REGRESSION_THRESHOLD; i++) {
      recordExtractionResult('instagram', 0, 5);
    }
    // Threshold count reached but time gate not crossed yet — should still be silent.
    expect(warnSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.REGRESSION_TIME_GATE_MS + 1000);
    recordExtractionResult('instagram', 0, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('extraction was working but has');
  });

  it('does not warn twice per platform once the alarm has fired', () => {
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD + 20; i++) {
      recordExtractionResult('youtube', 0, 5);
    }
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    recordExtractionResult('youtube', 0, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Subsequent calls after the warn must not re-fire.
    for (let i = 0; i < 50; i++) {
      recordExtractionResult('youtube', 0, 5);
    }
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('zero-mutation batches do not count toward the canary', () => {
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD + 10; i++) {
      recordExtractionResult('facebook', 0, 0);
    }
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    recordExtractionResult('facebook', 0, 0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('platforms are tracked independently', () => {
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD; i++) {
      recordExtractionResult('tiktok', 0, 5);
    }
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    recordExtractionResult('tiktok', 0, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('tiktok');

    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD; i++) {
      recordExtractionResult('instagram', 0, 5);
    }
    // IG's firstCallAt was set right after the tiktok time-advance above, so
    // hitting the count threshold is not enough; the gate is per-platform.
    expect(warnSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    recordExtractionResult('instagram', 0, 5);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[1][0]).toContain('instagram');
  });

  it('a non-zero extract resets the consecutive-zeros counter', () => {
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD - 5; i++) {
      recordExtractionResult('twitter', 0, 5);
    }
    expect(warnSpy).not.toHaveBeenCalled();

    recordExtractionResult('twitter', 3, 5);

    for (let i = 0; i < __CANARY_THRESHOLDS.REGRESSION_THRESHOLD - 1; i++) {
      recordExtractionResult('twitter', 0, 5);
    }
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.REGRESSION_TIME_GATE_MS + 1000);
    expect(warnSpy).not.toHaveBeenCalled();

    recordExtractionResult('twitter', 0, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('extraction was working');
  });

  it('time gate suppresses COLD-START when threshold is reached within the warmup window', () => {
    // Simulates the X / TikTok SPA-boot pattern: React mounts produce many
    // zero-extract MO batches in the first few seconds before the adapter-
    // targeted nodes exist. Without the gate the canary would fire here.
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD + 50; i++) {
      recordExtractionResult('twitter', 0, 5);
    }
    expect(warnSpy).not.toHaveBeenCalled();
    // A non-zero extract within the gate clears the counter — real path
    // for SPA boot where extraction succeeds within seconds.
    recordExtractionResult('twitter', 5, 5);
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    recordExtractionResult('twitter', 5, 5);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('time gate suppresses REGRESSION when threshold is reached within the silence window', () => {
    // Simulates FB / IG virtualizer pattern: a short burst of zero-extract
    // MO batches during scroll re-mount sequences. Without the gate the
    // 20-count threshold would fire on routine scroll churn.
    recordExtractionResult('facebook', 4, 10);
    for (let i = 0; i < __CANARY_THRESHOLDS.REGRESSION_THRESHOLD + 30; i++) {
      recordExtractionResult('facebook', 0, 5);
    }
    expect(warnSpy).not.toHaveBeenCalled();
    // Extraction resumes shortly — real recovery path. Counter resets.
    recordExtractionResult('facebook', 2, 5);
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.REGRESSION_TIME_GATE_MS + 1000);
    recordExtractionResult('facebook', 1, 5);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // rawCandidateCount discriminator: a zero-extract where the adapter's own
  // selector STILL matches elements is "all already stamped" (idle/dwell),
  // not drift. Reproduces the x.com/home 2026-05-30 false positive: 8 tweets
  // matched, all stamped, yet 80+ zero batches accrued over >2 min.
  it('does NOT fire REGRESSION when selector still matches elements (all already stamped)', () => {
    recordExtractionResult('twitter', 6, 10, true, 6);
    for (let i = 0; i < __CANARY_THRESHOLDS.REGRESSION_THRESHOLD + 50; i++) {
      // 0 NEW posts, but 8 tweets are present in the DOM (already stamped)
      recordExtractionResult('twitter', 0, 5, true, 8);
    }
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.REGRESSION_TIME_GATE_MS + 1000);
    recordExtractionResult('twitter', 0, 5, true, 8);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('DOES fire REGRESSION when the selector matches zero (genuine drift)', () => {
    recordExtractionResult('twitter', 6, 10, true, 6);
    for (let i = 0; i < __CANARY_THRESHOLDS.REGRESSION_THRESHOLD; i++) {
      // selector now matches nothing → real DOM rotation
      recordExtractionResult('twitter', 0, 5, true, 0);
    }
    expect(warnSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.REGRESSION_TIME_GATE_MS + 1000);
    recordExtractionResult('twitter', 0, 5, true, 0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('extraction was working but has');
  });

  it('omitted rawCandidateCount preserves legacy behavior (still fires)', () => {
    for (let i = 0; i < __CANARY_THRESHOLDS.COLD_START_THRESHOLD; i++) {
      recordExtractionResult('tiktok', 0, 5); // 3-arg legacy call, no discriminator
    }
    vi.advanceTimersByTime(__CANARY_THRESHOLDS.COLD_START_TIME_GATE_MS + 1000);
    recordExtractionResult('tiktok', 0, 5);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
