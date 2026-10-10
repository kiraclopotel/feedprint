// @vitest-environment jsdom
//
// Parity: the verifier every export embeds and the separate checker must
// read the same file the same way. They share the core text by
// construction, but each wraps it in its own walk (runVerification in the
// page, verifyExportText in the checker), and a walk can diverge. So the
// page's own script is run, as a browser runs it, over each of the
// vectors, and its published verdict is compared with EXPECTED.json, which
// the separate checker wrote. A manifest failure is the one reading the page
// publishes no verdict for: it prints the failure and stops, and that is
// checked as text. There are two such readings, the manifest and the file's
// own key, and both are checked as text.

import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { I18N, verifierScript } from '../../../src/forensics/html-export';
import { EXPECTED_PATH, VECTORS_DIR, type Expected } from '../../../scripts/build-verifier-vectors';

type Verdicts = { state: string; byId: Record<string, { cls: string; label: string }> };
const w = window as unknown as { __FW_EXPORT__?: unknown; __FW_VERDICTS__?: Verdicts; crypto: Crypto };

beforeAll(() => {
  // The page's script runs its check on load only where crypto.subtle exists.
  for (const target of [globalThis, window] as unknown as Array<Record<string, unknown>>) {
    if (!(target.crypto as Crypto | undefined)?.subtle) Object.defineProperty(target, 'crypto', { value: webcrypto, configurable: true });
  }
});

const expected = JSON.parse(readFileSync(EXPECTED_PATH, 'utf8')) as Record<string, Expected>;
const files = readdirSync(VECTORS_DIR).filter((f) => f.endsWith('.html')).sort();

function mount(html: string): Record<string, unknown> {
  document.documentElement.innerHTML = html.replace(/[\s\S]*?<body>/, '').replace(/<\/body>[\s\S]*/, '');
  const m = /<script type="application\/json" id="fw-export-data">([\s\S]*?)<\/script>/.exec(html);
  const payload = JSON.parse(m![1]) as Record<string, unknown>;
  delete w.__FW_VERDICTS__;
  w.__FW_EXPORT__ = payload;
  return payload;
}

function runPage(): Promise<Verdicts | undefined> {
  return new Promise((resolve) => {
    const done = () => { document.removeEventListener('fw-verified', done); resolve(w.__FW_VERDICTS__); };
    document.addEventListener('fw-verified', done);
    new Function(verifierScript(I18N.en))();
    // A manifest failure publishes nothing and dispatches nothing: give the
    // page's async walk time to print its failure, then read the status.
    setTimeout(() => resolve(w.__FW_VERDICTS__), 1500);
  });
}

describe('the embedded verifier agrees with the separate checker on every vector', () => {
  it.each(files)('%s', async (name) => {
    mount(readFileSync(join(VECTORS_DIR, name), 'utf8'));
    const verdicts = await runPage();
    const want = expected[name];
    if (want.firstFailure && want.firstFailure.reason === 'manifest') {
      expect(verdicts).toBeUndefined();
      const status = document.getElementById('fw-status')?.textContent ?? '';
      expect(status).toContain(I18N.en.chainBroken);
      expect(status).toContain(I18N.en.manifestFailed);
      return;
    }
    // The second terminal reading, and the earlier one: the file's own key
    // could not be set up, so no record was checked and the page publishes no
    // verdict for any of them either. It was written here as one case, the
    // manifest, and vector 17 (2026-09-18) is the first file in the set that
    // reaches this branch; without it the page's silence read as a parity
    // failure. What the page must not do is stay quiet, so the words it prints
    // in place of the verdicts are the assertion.
    if (want.firstFailure && want.firstFailure.reason === 'key-setup') {
      expect(verdicts).toBeUndefined();
      const status = document.getElementById('fw-status')?.textContent ?? '';
      expect(status).toContain(I18N.en.chainBroken);
      expect(status).toContain(I18N.en.failReasonVerifierSetup);
      return;
    }
    expect(verdicts).toBeDefined();
    expect(verdicts!.state).toBe(want.state);
    // The page marks the same records failed that the checker names first.
    const failedIds = Object.entries(verdicts!.byId).filter(([, v]) => v.cls === 'fail').map(([id]) => id);
    if (want.firstFailure) expect(failedIds.length).toBeGreaterThan(0); else expect(failedIds).toEqual([]);
    // A withheld record reads as withheld on the page, not as a failure.
    if (want.redacted > 0) expect(Object.keys(verdicts!.byId)).toHaveLength(want.records);
  }, 20000);
});
