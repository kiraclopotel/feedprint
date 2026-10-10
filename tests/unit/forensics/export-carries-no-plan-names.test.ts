// An export carries no internal plan names.
//
// The export's inline scripts ship unminified on purpose: a stranger opening the file should be able
// to read what checked it. That also means every comment inside them reaches whoever the file is sent
// to, a lawyer or a school included. Until 2026-09-16 three of those comments named internal planning
// documents by item number (PLAN-2026-09-14 item 6, PLAN-2026-09-15 item 1, PLAN-2026-09-14 item 7).
// Nothing secret, but a document meant to explain itself was pointing its reader at files they will
// never have. The reasons in those comments stayed; the plan names went.
//
// This builds a real export, so it covers every inline script and every string the builder writes,
// not only the file where the three were found.
import { describe, expect, it } from 'vitest';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';

const meta: ExportMetadata = {
  fwVersion: 'plan-name probe',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' },
  publicKeyFingerprint: 'fp',
  locale: 'en',
};

describe('the exported HTML', () => {
  it.each(['en', 'ro', 'es', 'pt-BR'] as const)('names no internal plan document, in %s', (locale) => {
    const html = buildForensicHtmlExport([], { ...meta, locale });
    const found = [...html.matchAll(/PLAN-20\d\d-\d\d-\d\d[^\n]{0,40}/g)].map((m) => m[0]);
    expect(found).toEqual([]);
  });

  // That the export names nobody who built it is checked by the private name check, which builds
  // this same export: a public test can only look for a name by spelling it.
});
