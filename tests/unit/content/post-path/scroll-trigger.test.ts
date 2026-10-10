// @vitest-environment jsdom
//
// scroll-trigger — debounced passive scroll listener that re-invokes the
// per-platform comment adapter on user scroll (closes the
// MutationObserver-only trigger gap inside already-mounted DOM).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupScrollExtractionTrigger } from '../../../../src/content/post-path/scroll-trigger';

describe('setupScrollExtractionTrigger', () => {
  let target: EventTarget;
  let onScroll: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    target = new EventTarget();
    onScroll = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onScroll once after the default debounce expires', () => {
    setupScrollExtractionTrigger(target, onScroll);

    target.dispatchEvent(new Event('scroll'));
    expect(onScroll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(249);
    expect(onScroll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid-fire scrolls into a single onScroll call', () => {
    setupScrollExtractionTrigger(target, onScroll);

    for (let i = 0; i < 10; i++) {
      target.dispatchEvent(new Event('scroll'));
      vi.advanceTimersByTime(50); // each tick stays inside the 250ms debounce
    }
    expect(onScroll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });

  it('fires once per burst — two bursts separated by debounceMs produce two calls', () => {
    setupScrollExtractionTrigger(target, onScroll);

    target.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(250);
    expect(onScroll).toHaveBeenCalledTimes(1);

    target.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(250);
    expect(onScroll).toHaveBeenCalledTimes(2);
  });

  it('disposer removes the scroll listener', () => {
    const dispose = setupScrollExtractionTrigger(target, onScroll);

    dispose();

    target.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(1000);
    expect(onScroll).not.toHaveBeenCalled();
  });

  it('disposer clears a pending timeout so onScroll never fires post-dispose', () => {
    const dispose = setupScrollExtractionTrigger(target, onScroll);

    target.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(100); // mid-debounce

    dispose();

    vi.advanceTimersByTime(1000);
    expect(onScroll).not.toHaveBeenCalled();
  });

  it('respects a custom debounceMs option', () => {
    setupScrollExtractionTrigger(target, onScroll, { debounceMs: 500 });

    target.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(250);
    expect(onScroll).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });
});
