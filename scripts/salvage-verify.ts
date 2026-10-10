/**
 * Verify salvaged forensic records against their own cryptography.
 *
 * The salvage in past-forensics/ was scraped out of old HTML exports. Until
 * this runs, "27983 records recovered" is a claim about JSON parsing and
 * nothing more. Two independent checks decide whether those records are
 * evidence or just text:
 *
 *   1. integrityHash — recompute the canonical payload hash with the SAME
 *      function the extension uses and compare. Catches any alteration to a
 *      hashed field, including anything my own scraping did to them.
 *   2. signature — ECDSA P-256 verify over that hash, under the public key
 *      embedded in the export the record came from. Catches a record whose
 *      content and hash were changed together.
 *
 * Read-only. Touches nothing in the browser profile and writes one report.
 *
 * Run: npx tsx scripts/salvage-verify.ts [--dir past-forensics/salvage-<date>]
 * (default: the 2026-09-01 folder; scripts/salvage-extract.ts writes new ones)
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto } from 'node:crypto';
import { computeRecordIntegrityHash } from '../src/forensics/canonical-payload';
import type { ForensicRecord } from '../src/types/forensic';

const dirArg = process.argv.indexOf('--dir');
const SALVAGE_DIR = dirArg >= 0 && process.argv[dirArg + 1]
  ? join(process.cwd(), process.argv[dirArg + 1])
  : join(process.cwd(), 'past-forensics', 'salvage-2026-09-01');
const SIGN_ALGO = { name: 'ECDSA', hash: { name: 'SHA-256' } } as const;

function base64UrlToBuffer(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Uint8Array.from(Buffer.from(b64 + pad, 'base64'));
}

interface EpochFile {
  publicKeyFingerprint: string;
  publicKeyJwk: JsonWebKey | null;
  recoveredFrom: string[];
  records: ForensicRecord[];
}

interface EpochReport {
  fingerprint: string;
  records: number;
  hashOk: number;
  hashFailed: number;
  signatureOk: number;
  signatureFailed: number;
  unsigned: number;
  keyUnusable: boolean;
  firstFailures: string[];
}

async function main(): Promise<void> {
  const files = readdirSync(SALVAGE_DIR).filter(f => f.startsWith('epoch-') && f.endsWith('.json'));
  const reports: EpochReport[] = [];

  for (const file of files) {
    const epoch: EpochFile = JSON.parse(readFileSync(join(SALVAGE_DIR, file), 'utf8'));
    const report: EpochReport = {
      fingerprint: epoch.publicKeyFingerprint,
      records: epoch.records.length,
      hashOk: 0,
      hashFailed: 0,
      signatureOk: 0,
      signatureFailed: 0,
      unsigned: 0,
      keyUnusable: false,
      firstFailures: [],
    };

    let key: CryptoKey | null = null;
    if (epoch.publicKeyJwk && Object.keys(epoch.publicKeyJwk).length > 0) {
      try {
        key = await webcrypto.subtle.importKey(
          'jwk',
          { ...epoch.publicKeyJwk, key_ops: ['verify'], ext: true },
          { name: 'ECDSA', namedCurve: 'P-256' },
          true,
          ['verify'],
        );
      } catch {
        report.keyUnusable = true;
      }
    } else {
      report.keyUnusable = true;
    }

    for (const record of epoch.records) {
      let computed: string;
      try {
        computed = await computeRecordIntegrityHash(record);
      } catch (err) {
        report.hashFailed++;
        if (report.firstFailures.length < 5) {
          report.firstFailures.push(`${record.id}: hash threw ${err instanceof Error ? err.message : String(err)}`);
        }
        continue;
      }
      if (computed === record.integrityHash) {
        report.hashOk++;
      } else {
        report.hashFailed++;
        if (report.firstFailures.length < 5) {
          report.firstFailures.push(`${record.id}: hash ${computed.slice(0, 12)} != stored ${String(record.integrityHash).slice(0, 12)}`);
        }
        continue;
      }

      if (!record.signature) {
        report.unsigned++;
        continue;
      }
      if (!key) continue;
      try {
        const ok = await webcrypto.subtle.verify(
          SIGN_ALGO,
          key,
          base64UrlToBuffer(record.signature),
          new TextEncoder().encode(record.integrityHash),
        );
        if (ok) report.signatureOk++;
        else {
          report.signatureFailed++;
          if (report.firstFailures.length < 5) report.firstFailures.push(`${record.id}: signature did not verify`);
        }
      } catch {
        report.signatureFailed++;
      }
    }

    reports.push(report);
    const pct = (n: number) => (report.records === 0 ? '0.0' : ((100 * n) / report.records).toFixed(1));
    console.log(
      `${report.fingerprint}  n=${String(report.records).padStart(6)}  ` +
      `hash ok ${String(report.hashOk).padStart(6)} (${pct(report.hashOk)}%)  ` +
      `sig ok ${String(report.signatureOk).padStart(6)} (${pct(report.signatureOk)}%)  ` +
      `sig bad ${report.signatureFailed}  unsigned ${report.unsigned}` +
      (report.keyUnusable ? '  [no usable public key]' : ''),
    );
    for (const f of report.firstFailures) console.log(`    ${f}`);
  }

  writeFileSync(join(SALVAGE_DIR, 'VERIFICATION.json'), JSON.stringify(reports, null, 1), 'utf8');

  const total = reports.reduce((a, r) => a + r.records, 0);
  const hashOk = reports.reduce((a, r) => a + r.hashOk, 0);
  const sigOk = reports.reduce((a, r) => a + r.signatureOk, 0);
  console.log(`\nTOTAL ${total} records: ${hashOk} hash-verified, ${sigOk} signature-verified`);
}

void main();
