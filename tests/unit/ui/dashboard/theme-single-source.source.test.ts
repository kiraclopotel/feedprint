// D5 (docs/history/archive/reality-FUNCTION_MAP.md drill list) — theme single-source lock.
//
// src/ui/shared/theme.ts is the ONE home for theme resolution, application,
// and the ThemeChoice type. The dashboard carried drifting inline copies of
// resolveTheme/applyTheme (the exact fork the shared module's own header
// says it replaced on 2026-05-24 — it grew back), and ThemeChoice was
// declared independently in three files. Unified 2026-07-14; these
// source-scan locks fail if any copy grows back.
//
// Source-scan style is deliberate: the drift class is "someone re-declares
// a local helper", which no behavioral test can see (both copies behave
// identically until they diverge — and divergence is exactly the bug).

import { describe, it, expect } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { repoPath } from '../../../helpers/repo-root';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Source-read paths, hoisted so a decomposition step re-points one line.
const DASHBOARD_SHELL = 'src/ui/dashboard/Dashboard.tsx';
const SHARED_THEME_PATH = 'src/ui/shared/theme.ts';
const DASH_HEADER_PATH = 'src/ui/dashboard/components/DashHeader.tsx';
const DASHBOARD_STRINGS_PATH = 'src/i18n/dashboard/types.ts';
const POPUP_PATH = 'src/ui/popup/Popup.tsx';
const POPUP_STRINGS_PATH = 'src/i18n/popup-strings.ts';

const read = (rel: string): string =>
  readSource(rel);

describe('D5 — theme logic has exactly one home (src/ui/shared/theme.ts)', () => {
  it('shared/theme.ts still exports the canonical surface', () => {
    const shared = read(SHARED_THEME_PATH);
    expect(shared).toContain('function resolveTheme');
    expect(shared).toContain('export function applyTheme');
    expect(shared).toContain('export function eagerApplyStoredTheme');
    expect(shared).toContain("export type ThemeChoice = 'dark' | 'light' | 'system'");
  });

  it('Dashboard.tsx declares no local theme helpers and imports the shared ones', () => {
    const dash = read(DASHBOARD_SHELL);
    expect(dash).not.toMatch(/function\s+resolveTheme/);
    expect(dash).not.toMatch(/function\s+applyTheme/);
    expect(dash).not.toMatch(/type\s+ThemeChoice\s*=/);
    // The eager pre-mount apply comes from the shared module, not inline.
    expect(dash).toContain('eagerApplyStoredTheme()');
    expect(dash).toMatch(/from '\.\.\/shared\/theme'/);
  });

  it('DashHeader.tsx cycles via the shared nextThemeInCycle, not an inline ternary', () => {
    const hdr = read(DASH_HEADER_PATH);
    expect(hdr).toContain('nextThemeInCycle(theme)');
    expect(hdr).not.toMatch(/'dark'\s*\?\s*'light'\s*:/);
  });

  it('DashHeader.tsx re-exports the shared ThemeChoice rather than declaring its own', () => {
    const hdr = read(DASH_HEADER_PATH);
    expect(hdr).not.toMatch(/type\s+ThemeChoice\s*=\s*'dark'/);
    expect(hdr).toMatch(/import \{ nextThemeInCycle, type ThemeChoice \} from '\.\.\/\.\.\/shared\/theme'/);
  });

  it('the dashboard string interface imports the shared ThemeChoice rather than declaring its own', () => {
    const strings = read(DASHBOARD_STRINGS_PATH);
    expect(strings).not.toMatch(/type\s+ThemeChoice\s*=\s*'dark'/);
    expect(strings).toMatch(/import type \{ ThemeChoice \} from '\.\.\/\.\.\/ui\/shared\/theme'/);
  });

  it('no OTHER file under src declares a ThemeChoice type', () => {
    // Fast targeted sweep of the only realistic regrowth sites; a full-tree
    // walk lives in knip/lint land, this locks the known offenders' siblings.
    for (const rel of [POPUP_PATH, POPUP_STRINGS_PATH]) {
      expect(read(rel)).not.toMatch(/type\s+ThemeChoice\s*=/);
    }
  });
});
