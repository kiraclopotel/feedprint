// The export's dropdowns (the filters above the table) opened a list whose options did not read in his Chrome (12 Oct 2026,
// his screenshot): the select is flat and clear and takes the page's ink, but the list it opens is the browser's own, drawn
// on its own ground, so an option in the page's light ink sat on a light list (or dark on dark) whenever the browser's scheme
// and the page's tokens disagreed. The page declared light on the root and dark only inside a media query. Now it declares
// both, so the browser's own widgets follow the reader's device the way the page's tokens do, and the options carry the
// page's own ground and ink, so they read whichever way the browser draws the list.

import { describe, it, expect } from 'vitest';
import { STYLES } from '../../../src/forensics/html-export-styles';
import { buildForensicHtmlExport, type ExportMetadata } from '../../../src/forensics/html-export';

const META: ExportMetadata = {
  fwVersion: 'V1.0.0-test',
  publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'AAA', y: 'BBB' },
  publicKeyFingerprint: 'a3f9c2e1deadbeef',
  locale: 'en',
};

describe('the export\'s dropdown options read in both looks', () => {
  it('the root declares both schemes, so the browser draws its own widgets to match the reader\'s device', () => {
    const root = STYLES.slice(STYLES.indexOf(':root{\n  --ground'), STYLES.indexOf('@media (prefers-color-scheme:dark)'));
    expect(root).toContain('color-scheme:light dark;');
    expect(root).not.toMatch(/color-scheme:light;/);
  });

  it('an option carries the page\'s ground and ink, which follow the same device preference', () => {
    expect(STYLES).toMatch(/select option,\s*select optgroup\{[^}]*background-color:var\(--lift\)[^}]*color:var\(--ink\)/);
    // The tokens the options use are the ones the dark look redefines, so they flip together.
    const dark = STYLES.slice(STYLES.indexOf('@media (prefers-color-scheme:dark)'));
    expect(dark).toContain('--ink:');
    expect(dark).toContain('--lift:');
  });

  it('the file that is written carries those rules', () => {
    const html = buildForensicHtmlExport([], META);
    expect(html).toContain('select option,select optgroup{background-color:var(--lift);color:var(--ink);}');
    expect(html).toContain('color-scheme:light dark;');
  });
});
