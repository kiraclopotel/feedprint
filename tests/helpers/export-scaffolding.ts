// The scaffolding of a forensic export: the inline scripts it carries, in order, without the data
// it carries them for.
//
// Two artefacts in this repository are exports built once and committed: the verifier test vectors
// (verifier/vectors/, scripts/build-verifier-vectors.ts) and the public demo (landing/demo.html,
// scripts/build-demo-export.ts). Both are built by the real exporter, and neither is rebuilt by any
// build. So the exporter can grow a script block and both files keep describing the export of an
// earlier month, with every existing test still green: the checker still reads them correctly,
// because they are internally consistent, and nothing compares them to today's exporter.
//
// That happened. On 2026-09-16 the committed vectors carried 12 inline scripts and the exporter
// produced 14; the numbers engine had been inlined into every export and the vectors, which are the
// contract a second implementer of the checker works from, showed an export without it.
//
// Comparing whole files cannot work: every signature draws a fresh ECDSA nonce, so two builds of
// the same records differ byte for byte. What must not drift is the scaffolding, and that is what
// this compares. PLAN-2026-09-16 section 6, the demo and vector staleness lock.
import { buildForensicHtmlExport, type ExportMetadata } from '../../src/forensics/html-export';

/** Enough of a block to tell it from the others by eye, whitespace collapsed. */
const SIGNATURE_CHARS = 60;

/**
 * A cheap checksum over the whole block (djb2). The first 60 characters alone say WHICH script a
 * block is, which is what makes a failure readable, but they say nothing about its body: a change
 * anywhere after them left both committed artefacts stale with this guard still green. That
 * happened on 2026-09-17, when the reading view learned to print a refused author and neither the
 * vectors nor the demo were rebuilt. The length and the checksum close it.
 */
function checksum(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) ^ text.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

/**
 * One signature per inline script in the file, in the order written: the opening characters, the
 * length and a checksum of the whole block. Blocks carrying an `id` are the record payload and the
 * manifest, which are data and differ per file by design.
 */
export function scriptSignatures(html: string): string[] {
  return [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .filter((m) => !/\sid\s*=/.test(m[1] ?? ''))
    .map((m) => {
      const body = m[2].replace(/\s+/g, ' ').trim();
      return `${body.slice(0, SIGNATURE_CHARS)} [${body.length}:${checksum(body)}]`;
    });
}

/** The scaffolding today's exporter produces. Records are irrelevant to it, so there are none. */
export function freshExportScaffolding(locale: ExportMetadata['locale'] = 'en'): string[] {
  const meta: ExportMetadata = {
    fwVersion: 'scaffolding probe',
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' },
    publicKeyFingerprint: 'fp',
    locale,
  };
  return scriptSignatures(buildForensicHtmlExport([], meta));
}

/**
 * The wording table today's exporter writes into a file's payload. The script check above skips
 * blocks with an id, so a string added to or changed in the table left every committed export
 * behind with nothing failing.
 */
export function freshExportWording(locale: ExportMetadata['locale'] = 'en'): Record<string, unknown> {
  return exportWording(buildForensicHtmlExport([], {
    fwVersion: 'scaffolding probe',
    publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'A', y: 'B' },
    publicKeyFingerprint: 'fp',
    locale,
  }));
}

/** The wording table a committed export carries. */
export function exportWording(html: string): Record<string, unknown> {
  const m = /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/.exec(html);
  return m ? ((JSON.parse(m[1]) as { i18n?: Record<string, unknown> }).i18n ?? {}) : {};
}

/** What to do when a committed export no longer matches. Written once, read in two failures. */
export const REGENERATE =
  'The exporter has changed since this file was built. Rebuild both committed exports and commit ' +
  'them with the change: npm run gen:vectors and npm run gen:demo.';
