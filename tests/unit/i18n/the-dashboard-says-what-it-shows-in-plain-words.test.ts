// The dashboard's Record, Patterns and Export tabs say what they show, not how the machine stores it.
//
// Nine lines still spoke in developer words: "IndexedDB" and "signing keypair" in the uninstall note, "Bar height" and
// "histogram" over the usage chart, "heartbeat" in the excluded-accounts note, "exposure records" over the Patterns
// tab (which meant "flagged posts"), "operational metadata excluded" in the Export count (which counts what is not a
// flag, not "metadata"), and "wired" for a folder the person chose. The facts stay, the machine words go, in all four
// languages. The check reads those nine lines (strings, and the text each function returns for a plain sample) and holds
// the words out; the other dashboard lines that still carry them belong to the Issues tab and the later words rows.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const KEYS = [
  'usageSub', 'noteUninstallLead', 'noteUninstall1', 'noteUninstall4', 'exclusionsSub',
  'patPressureSub', 'patPressureEmpty', 'exportExcluded', 'folderWireStatusNone',
] as const;

const DEVELOPER = /IndexedDB|keypair|\+ reinstall|Bar height|heartbeat|exposure records|operational metadata|wired|metadat|latido|batimento|histogram/i;

const LANGS = ['en', 'ro', 'es', 'pt-BR'] as const;

function render(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'function') {
    for (const arg of ['day', 'hour', 'week', 'month', 3]) {
      try {
        const r = (value as (a: unknown) => unknown)(arg);
        if (typeof r === 'string') return r;
      } catch {
        // a frame this line does not know: try the next sample
      }
    }
  }
  return '';
}

describe('the dashboard says what it shows, in plain words', () => {
  for (const lang of LANGS) {
    it(`${lang}: the nine lines carry no developer word`, () => {
      const t = (DASHBOARD_STRINGS as unknown as Record<string, Record<string, unknown>>)[lang];
      expect(t, `no ${lang} table`).toBeTruthy();
      const hits: string[] = [];
      for (const key of KEYS) {
        const text = render(t[key]);
        expect(text.length, `${lang}.${key} renders nothing`).toBeGreaterThan(10);
        const m = DEVELOPER.exec(text);
        if (m) hits.push(`${key}: …${text.slice(Math.max(0, m.index - 20), m.index + 40)}…`);
      }
      expect(hits).toEqual([]);
    });
  }

  it('the facts the machine words stood for are said in plain ones', () => {
    const en = (DASHBOARD_STRINGS as unknown as Record<string, Record<string, unknown>>)['en'];
    expect(render(en.patPressureEmpty)).toBe('No flagged entries in this range yet.');
    expect(render(en.folderWireStatusNone)).toBe('No folder chosen yet.');
    expect(String(en.noteUninstallLead)).toBe('If you uninstall Feedprint.');
    expect((en.exportExcluded as (n: number) => string)(4)).toContain('4 left out because they are not flags');
    expect(render(en.usageSub)).toContain('the colours are named under the chart');
  });
});
