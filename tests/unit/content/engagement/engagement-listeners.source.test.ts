// Wiring audit 13 Sep, P4 and P15 (source locks: both are one-line guards on
// listeners that need a live extension to fire).

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { readFileSync } from 'node:fs';

describe('P15: the engagement controller reacts to settings changes only', () => {
  it('ignores storage areas other than local before it tears anything down', () => {
    const src = readSource('src/content/engagement/controller.ts');
    const body = src.slice(src.indexOf('const storageListener = ('), src.indexOf('chrome.storage.onChanged.addListener(storageListener)'));
    const guard = body.indexOf("if (areaName !== undefined && areaName !== 'local') return;");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(body.indexOf('activeCleanup()'));
  });
});

describe('P4: the popup does not refresh on a setting nothing shows', () => {
  it('hideUnrewritable is not in the reload list', () => {
    const src = readSource('src/ui/popup/Popup.tsx');
    const list = src.slice(src.indexOf('const RELOAD_ON = ['), src.indexOf('] as const;', src.indexOf('const RELOAD_ON = [')));
    expect(list).not.toMatch(/'hideUnrewritable'/);
    expect(list).toContain("'strictLanguage'");
  });
});
