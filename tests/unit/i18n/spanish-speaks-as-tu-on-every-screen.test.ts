// Spanish speaks to one reader as "tú" on every screen it prints (GLOSSARY.md, amendment 9).
//
// Two lines had slipped into "usted": the dashboard's note for a backup that was not saved ("Pulse ... y deje abierto")
// and the saved file's hint over the records numbers ("Pulse un número ... púlselo otra vez"), while every other
// Spanish screen says "tú". The check reads every Spanish value in the four tables the reader can see (the popup, the
// dashboard, the saved file and the page markers), strings and the text each function returns for a plain sample, and
// holds the imperative forms of "usted" out of them.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { I18N as EXPORT_STRINGS } from '../../../src/i18n/export-strings';
import { MARKER_STRINGS } from '../../../src/i18n/marker-strings';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

// The "usted" imperatives of the verbs the lines used, case as printed: the first two lines (V5), then the receipt line and the print
// note on the Export tab (V5b: Pegue, envíe, Use), and the print fallback (Ábralo, imprímalo).
const USTED = /(Pulse|púlselo|deje|tenía sigue|Pegue|envíe(?![a-záéíóúñ])|Use|Ábralo|imprímalo)/;

function texts(path: string, value: unknown, out: Array<[string, string]>, depth = 0): void {
  if (depth > 6) return;
  if (typeof value === 'string') { out.push([path, value]); return; }
  if (typeof value === 'function') {
    try {
      const r = (value as (...a: unknown[]) => unknown)('interrupted', 3, 2);
      if (typeof r === 'string') out.push([path, r]);
    } catch {
      // a function that needs another argument shape is not a sentence here
    }
    return;
  }
  if (Array.isArray(value)) { value.forEach((v, i) => texts(`${path}[${i}]`, v, out, depth + 1)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) texts(`${path}.${k}`, v, out, depth + 1);
  }
}

const TABLES: Array<[string, unknown]> = [
  ['popup', (POPUP_STRINGS as unknown as Record<string, unknown>).es],
  ['dashboard', (DASHBOARD_STRINGS as unknown as Record<string, unknown>).es],
  ['export', (EXPORT_STRINGS as unknown as Record<string, unknown>).es],
  ['markers', (MARKER_STRINGS as unknown as Record<string, unknown>).es],
];

describe('Spanish speaks as "tú" on every screen', () => {
  for (const [name, table] of TABLES) {
    it(`no ${name} sentence in Spanish uses the "usted" imperative`, () => {
      expect(table, `${name} has no Spanish table`).toBeTruthy();
      const found: Array<[string, string]> = [];
      texts(name, table, found);
      expect(found.length, `${name}: nothing was read`).toBeGreaterThan(20);
      const hits = found.filter(([, s]) => USTED.test(s)).map(([k, s]) => `${k}: ${s.slice(0, 100)}`);
      expect(hits).toEqual([]);
    });
  }

  it('the two corrected lines keep the quoted button and say it as "tú"', () => {
    const d = (DASHBOARD_STRINGS as unknown as Record<string, Record<string, unknown>>).es;
    const note = (d.backupNotSaved as (r: string) => string)('interrupted');
    expect(note).toContain('Pulsa «Hacer copia ahora» otra vez y deja abierto el cuadro de guardado');
    expect(note).toContain('la copia que ya tenías sigue siendo la más reciente');
    const e = (EXPORT_STRINGS as unknown as Record<string, Record<string, unknown>>).es;
    expect(e.rdNumbersHint).toBe('Pulsa un número para ver solo lo que cuenta; púlsalo otra vez para verlo todo.');
  });
});
