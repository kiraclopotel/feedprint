/** @vitest-environment jsdom */
//
// The PIN is a feature and is never forced (his word, 12 Oct 2026: most people own their computer and do not share it). Moving a
// Relaxed install up to Strict or Moderate used to stop at a "Set a PIN first" step, added after the Tester's full test of 11 Oct 2026
// found Strict standing with nothing locking it. That step is gone: the switch goes on, with or without a PIN. Where a PIN is set,
// LEAVING Strict still asks for it, as before.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installChromeStorageStub, type ChromeStorageStub } from '../../helpers/chrome-storage';
import { applyPreset, getSettings, utcDayKey, utcMonthKey, CURRENT_SETTINGS_SCHEMA_VERSION } from '../../../src/storage/settings';
import { modeSwitchRequiresPin, useModeSwitch, type ModeSwitchState } from '../../../src/ui/popup/switches';
import type { Mode } from '../../../src/types/mode';
import { readSource } from '../../helpers/read-source';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `edited`: a switch of the level was changed by hand, so the switch asks the question before it undoes it (12 Oct 2026).
function install(mode: Mode, parentPin: string, edited = false) {
  const preset = applyPreset(mode).features;
  const features = edited ? { ...preset, 'block-ads': { enabled: false } } : preset;
  return { mode, parentPin, features, readFailedFallback: false } as never;
}

describe('moving up to Strict or Moderate asks for no PIN', () => {
  let stub: ChromeStorageStub;
  let root: Root;
  let box: HTMLDivElement;
  let state: ModeSwitchState;
  const onApplied = vi.fn(async () => undefined);

  function Harness({ settings }: { settings: ReturnType<typeof install> }) {
    state = useModeSwitch(settings, onApplied);
    return null;
  }

  beforeEach(() => {
    stub = installChromeStorageStub({
      initial: {
        settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION, lastResetDate: utcDayKey(), lastResetMonth: utcMonthKey(),
        mode: 'adult',
      },
    });
    onApplied.mockClear();
    box = document.createElement('div');
    document.body.appendChild(box);
    root = createRoot(box);
  });
  afterEach(() => { act(() => root.unmount()); box.remove(); stub.restore(); });

  const mount = (settings: ReturnType<typeof install>) => act(() => { root.render(createElement(Harness, { settings })); });

  for (const [target, name] of [['child', 'Strict'], ['teen', 'Moderate']] as const) {
    it(`Relaxed to ${name} with no PIN set applies at once: no PIN step, no question`, async () => {
      mount(install('adult', ''));
      await act(async () => { state.onModeClick(target); });
      expect(state.pinForMode).toBeNull();
      expect(state.pendingMode).toBeNull();
      expect((await getSettings()).mode).toBe(target);
      expect(onApplied).toHaveBeenCalled();
    });
  }

  it('with a switch the person changed, the only thing asked is the change question, never a PIN', async () => {
    mount(install('adult', '', true));
    act(() => state.onModeClick('child'));
    expect(state.pinForMode).toBeNull();
    expect(state.pendingMode).toBe('child');
    await act(async () => { state.confirmPending(); });
    expect((await getSettings()).mode).toBe('child');
  });

  it('a PIN that is set changes nothing on the way up', async () => {
    mount(install('adult', 'x'.repeat(8)));
    await act(async () => { state.onModeClick('child'); });
    expect(state.pinForMode).toBeNull();
    expect((await getSettings()).mode).toBe('child');
  });

  it('the "Set a PIN first" step is gone from the switch state, the Settings panel and all four languages', () => {
    expect(readSource('src/ui/popup/switches.ts')).not.toMatch(/pinSetupForMode|modeSwitchNeedsNewPin|onPinSetup/);
    expect(readSource('src/ui/popup/panels/SettingsPanel.tsx')).not.toMatch(/pinSetupForMode|modePinFirst|onPinSetup/);
    for (const lang of ['en', 'es', 'pt-br', 'ro', 'types']) {
      expect(readSource(`src/i18n/popup/${lang}.ts`), lang).not.toContain('modePinFirst');
    }
  });
});

describe('where a PIN is set, leaving Strict still asks for it', () => {
  it('leaving Strict with a PIN demands it, grace window or not; with none, nothing is demanded', () => {
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hashed' }, 'adult')).toBe(true);
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hashed' }, 'teen')).toBe(true);
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: '' }, 'adult')).toBe(false);
  });

  it('a snapshot that could not be read does not say there is no PIN: leaving Strict still asks', () => {
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: '', readFailedFallback: true }, 'adult')).toBe(true);
  });

  it('moving up, or staying, never asks for a PIN', () => {
    expect(modeSwitchRequiresPin({ mode: 'adult', parentPin: 'hashed' }, 'child')).toBe(false);
    expect(modeSwitchRequiresPin({ mode: 'teen', parentPin: 'hashed' }, 'child')).toBe(false);
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hashed' }, 'child')).toBe(false);
  });
});
