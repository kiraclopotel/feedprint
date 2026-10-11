// @vitest-environment jsdom
//
// With both extensions on one page, a switch that is on in either product must be acted on. Receipts writes in
// its stamp only what it takes over from Off here, the ads where its Block ads is on, and writes it again when
// that changes; Off runs the rest from its own settings. Swearing and slurs stay with Off: Receipts' pipeline
// passes short texts before its swear mask, and its YouTube reader skips the tiles Off's word filter covers.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adultPreset, childPreset, teenPreset } from '../../../../src/storage/presets';
import type { FWSettings, FeatureToggles } from '../../../../src/storage/settings';
import {
  RECORDER_RUNS_ATTR, keepRecorderStamp, receiptsRunsOn, recorderRuns, watchRecorderRuns,
} from '../../../../src/content/engagement/recorder-runs';

const root = document.documentElement;
const settingsWith = (features: FeatureToggles, extra: Partial<FWSettings> = {}): FWSettings =>
  ({ features, strictLanguage: false, mode: 'teen', ...extra }) as unknown as FWSettings;

type Listener = (changes: Record<string, unknown>, area?: string) => void;
let listeners: Listener[];
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise<void>((r) => setTimeout(r, 0)); };

beforeEach(() => {
  listeners = [];
  vi.stubGlobal('chrome', {
    storage: { onChanged: {
      addListener: (l: Listener) => { listeners.push(l); },
      removeListener: (l: Listener) => { listeners = listeners.filter((x) => x !== l); },
    } },
  });
  root.removeAttribute('data-fw-recorder');
  root.removeAttribute(RECORDER_RUNS_ATTR);
});
afterEach(() => { vi.unstubAllGlobals(); root.removeAttribute('data-fw-recorder'); root.removeAttribute(RECORDER_RUNS_ATTR); });

describe('what Receipts names', () => {
  it('names the ads only where its Block ads is on', () => {
    const off = teenPreset();
    off['block-ads'] = { enabled: true, perPlatform: { youtube: { enabled: false } } };
    expect(receiptsRunsOn(settingsWith(off), 'facebook')).toContain('ads');
    expect(receiptsRunsOn(settingsWith(off), 'youtube')).not.toContain('ads');
  });

  it('never names swearing or slurs, at any level or switch', () => {
    for (const preset of [childPreset, teenPreset, adultPreset]) {
      for (const mode of ['child', 'teen', 'adult'] as const) {
        for (const strictLanguage of [false, true]) {
          const runs = receiptsRunsOn(settingsWith(preset(), { mode, strictLanguage }), 'youtube');
          expect(runs, `${mode} strict=${strictLanguage}`).not.toContain('swearing');
          expect(runs).not.toContain('slurs');
        }
      }
    }
  });

  it("never names the own list: Off's list holds words Receipts does not know", () => {
    expect(receiptsRunsOn(settingsWith(childPreset(), { mode: 'child', strictLanguage: true }), 'tiktok')).not.toContain('words');
  });
});

describe("Receipts' stamp", () => {
  it('writes what it runs before the stamp, so Off never sees the stamp without the list', () => {
    const order: string[] = [];
    const obs = new MutationObserver((m) => { for (const r of m) order.push(r.attributeName ?? ''); });
    obs.observe(root, { attributes: true });
    keepRecorderStamp('facebook', settingsWith(teenPreset()), async () => settingsWith(teenPreset()), '2.5.19');
    return settle().then(() => {
      obs.disconnect();
      expect(order).toEqual([RECORDER_RUNS_ATTR, 'data-fw-recorder']);
      expect(recorderRuns()).toEqual(new Set(['ads']));
    });
  });

  it('writes it again when its settings change, and stops listening when stopped', async () => {
    let now = settingsWith(teenPreset());
    const stop = keepRecorderStamp('facebook', now, async () => now, '2.5.19');
    expect(root.getAttribute(RECORDER_RUNS_ATTR)).toBe('ads');
    const noAds = teenPreset();
    noAds['block-ads'] = { enabled: false };
    now = settingsWith(noAds);
    for (const l of listeners) l({ features: { newValue: noAds } }, 'local');
    await settle();
    expect(root.getAttribute(RECORDER_RUNS_ATTR), 'Off takes the ads back').toBe('');
    for (const l of listeners) l({ features: { newValue: noAds } }, 'session');
    stop();
    expect(listeners).toEqual([]);
  });

  it('keeps one listener when Receipts starts again on the same page', () => {
    keepRecorderStamp('facebook', settingsWith(teenPreset()), async () => settingsWith(teenPreset()), '2.5.19');
    const stop = keepRecorderStamp('facebook', settingsWith(teenPreset()), async () => settingsWith(teenPreset()), '2.5.19');
    expect(listeners).toHaveLength(1);
    stop();
    expect(listeners).toEqual([]);
  });
});

/** A guard of the extension's life that starts alive in each test: the real one, once dead, stays dead for the file. */
async function freshGuard() {
  vi.resetModules();
  const listeners: Array<() => void> = [];
  const armed = vi.fn();
  const guard = {
    armed,
    isContextAlive: () => true,
    onContextInvalidated: (l: () => void) => { armed(); listeners.push(l); },
    markContextInvalidated: () => { for (const l of listeners.splice(0)) l(); },
  };
  vi.doMock('../../../../src/storage/context-guard', () => guard);
  return guard;
}
afterEach(() => { vi.doUnmock('../../../../src/storage/context-guard'); });

describe('a Receipts that goes away under the open tab', () => {
  it('takes its stamp with it, the stamp before the list, so Off takes everything back', async () => {
    vi.resetModules();
    const runs = await import('../../../../src/content/engagement/recorder-runs');
    const guard = await import('../../../../src/storage/context-guard');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    runs.keepRecorderStamp('facebook', settingsWith(teenPreset()), async () => settingsWith(teenPreset()), '2.5.19');
    expect(runs.recorderRuns()).toEqual(new Set(['ads']));
    const order: string[] = [];
    const obs = new MutationObserver((m) => { for (const r of m) order.push(r.attributeName ?? ''); });
    obs.observe(root, { attributes: true });
    guard.markContextInvalidated();
    await settle();
    obs.disconnect();
    expect(order).toEqual(['data-fw-recorder', RECORDER_RUNS_ATTR]);
    expect(runs.recorderRuns(), 'no recorder on the page').toBeNull();
  });

  it("stops Receipts' filters and its settings listener with the stamp, and listens for the end once however often it starts", async () => {
    const guard = await freshGuard();
    const runs = await import('../../../../src/content/engagement/recorder-runs');
    const filters = vi.fn();
    runs.stopWhenFeedprintGoes(filters);
    // The settings module, loaded fresh with it, keeps a listener of its own.
    const before = [...listeners];
    for (let i = 0; i < 3; i++) runs.keepRecorderStamp('facebook', settingsWith(teenPreset()), async () => settingsWith(teenPreset()), '2.5.19');
    expect(guard.armed).toHaveBeenCalledTimes(1);
    guard.markContextInvalidated();
    expect(runs.recorderRuns()).toBeNull();
    expect(filters, "Receipts' ad filters").toHaveBeenCalledTimes(1);
    expect(listeners, 'its settings listener').toEqual(before);
  });

  it('notices within seconds on a quiet page, where Receipts makes no call', async () => {
    vi.useFakeTimers();
    try {
      await freshGuard();
      const runtime: { id?: string } = { id: 'receipts' };
      vi.stubGlobal('chrome', { runtime, storage: { onChanged: { addListener: () => {}, removeListener: () => {} } } });
      const runs = await import('../../../../src/content/engagement/recorder-runs');
      const filters = vi.fn();
      runs.stopWhenFeedprintGoes(filters);
      runs.keepRecorderStamp('youtube', settingsWith(teenPreset()), async () => settingsWith(teenPreset()), '2.5.19');
      await vi.advanceTimersByTimeAsync(9000);
      expect(runs.recorderRuns(), 'still there').toEqual(new Set(['ads']));
      delete runtime.id;
      await vi.advanceTimersByTimeAsync(3000);
      expect(runs.recorderRuns()).toBeNull();
      expect(filters).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the watch on what Receipts runs', () => {
  it('fires on a change and not on the same list written again', async () => {
    root.setAttribute(RECORDER_RUNS_ATTR, 'ads slurs');
    const changed = vi.fn();
    const stop = watchRecorderRuns(changed);
    root.setAttribute(RECORDER_RUNS_ATTR, 'ads slurs');
    await settle();
    expect(changed).not.toHaveBeenCalled();
    root.setAttribute(RECORDER_RUNS_ATTR, 'slurs');
    await settle();
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
});
