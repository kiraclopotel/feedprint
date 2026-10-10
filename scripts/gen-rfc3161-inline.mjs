// Generate the plain-JS copy of the RFC 3161 verifier that the standalone HTML
// export carries inside itself.
//
// WHY A GENERATED FILE
//
// The export is one HTML file that a recipient opens from file:// with no
// network and no imports, so every line it runs has to be inlined as text. The
// other inlined verifier pieces in html-export.ts are hand-written template
// strings, and the project already needs a drift test to keep one of them in
// step with its production twin (tests/unit/forensics/html-verifier-drift.test.ts).
//
// A second hand-maintained copy of 600 lines of ASN.1 parsing would drift for
// certain. So there is exactly one source, src/forensics/rfc3161.ts, and this
// script compiles it to an IIFE that the export inlines. The extension imports
// the module normally; the export inlines the compiled text; a test reruns this
// script and fails if the checked-in output no longer matches.
//
// Run: node scripts/gen-rfc3161-inline.mjs
// Check without writing: node scripts/gen-rfc3161-inline.mjs --check

import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'src', 'forensics', 'rfc3161.ts');
const OUT = join(ROOT, 'src', 'forensics', 'rfc3161-inline.generated.ts');

export async function generate() {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: '__FW_RFC3161__',
    // The export must open in whatever browser a recipient has, including one a
    // few years old on a court computer. es2019 keeps optional chaining and
    // nullish coalescing out of the emitted text.
    target: 'es2019',
    // Not minified on purpose: the export is evidence software, and a reader who
    // wants to check what the verifier does should be able to read it.
    minify: false,
    legalComments: 'none',
    logLevel: 'silent',
  });
  const js = result.outputFiles[0].text.trimEnd();
  return `// GENERATED FILE. Do not edit.
//
// Built from src/forensics/rfc3161.ts by scripts/gen-rfc3161-inline.mjs and
// checked by tests/unit/forensics/rfc3161-inline-drift.test.ts. Edit the source module,
// then run: npm run gen:rfc3161
//
// The standalone HTML export inlines this text so a recipient's browser can
// verify a time-stamp token offline. It exposes one global, __FW_RFC3161__,
// carrying verifyAnchorBase64, verifyTimeStampToken and parseTimeStampResp.

export const RFC3161_VERIFIER_SOURCE: string = ${JSON.stringify(js)};
`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const next = await generate();
  if (process.argv.includes('--check')) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8');
    } catch { /* missing file is a mismatch, reported below */ }
    if (current !== next) {
      console.error('rfc3161-inline.generated.ts is out of date. Run: npm run gen:rfc3161');
      process.exit(1);
    }
    console.log('rfc3161-inline.generated.ts is current.');
  } else {
    writeFileSync(OUT, next, 'utf8');
    console.log(`Wrote ${OUT} (${next.length} bytes).`);
  }
}
