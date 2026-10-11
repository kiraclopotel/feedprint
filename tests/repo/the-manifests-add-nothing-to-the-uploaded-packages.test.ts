// UP1 (board/units/UP1.md; SCOPE item 3, P23, F15, release rule 3). A permission, a host or a page match that is new in an update makes the
// browser switch the extension off for each person who has it until they accept the new warning. This release is an update for all of
// them, so nothing may arrive that is not already in the package that is uploaded: a permission or host only in a release of its own,
// announced one release ahead.
//
// The two fixtures are the manifest.json of each uploaded package, read from the zip itself (`unzip -p <zip> manifest.json`), never from a
// worktree's source:
//   tests/fixtures/release-manifests/receipts-2.5.18.json  from receipts-2.5.18.zip (Feedprint, build id fwbid-690dba9d19b8-r2518),
//     zip sha256 d5b7aabbc3aab64bca4ef4d5f1f288ffef142a107bac934f88aca414cd74a631 (sha256sum of the zip, as in its row of docs/spec/RELEASES.tsv)
//   tests/fixtures/release-manifests/off-1.0.13.json       from off-1.0.13.zip (build id fwbid-690dba9d19b8-r1013),
//     zip sha256 4241d4d2b527f7330118ecb95a949669902b48da0c4cf9a5013701128e0ea5d2 (sha256sum of the zip, as in its row of docs/spec/RELEASES.tsv)
// The source manifest.json is compared with the Receipts fixture and manifest.off.json with the Off fixture: every entry of permissions,
// host_permissions and content_scripts[].matches in the source is in the fixture's same list. An addition fails and names the entry and
// the rule. A removal passes (taking a permission away asks nobody anything). optional_permissions are listed in the output, not failed.
//
// tests/repo/manifest-permissions.test.ts pins what each permission is used for; this file is the other half: it pins what is uploaded.
// When the next package is uploaded, the fixture is replaced by its manifest in the same commit, with the new zip's sha256 above.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';

type Manifest = {
  permissions?: string[];
  host_permissions?: string[];
  optional_permissions?: string[];
  optional_host_permissions?: string[];
  content_scripts?: Array<{ matches?: string[] }>;
};

const RULE = 'a permission or host only in a release of its own, announced one release ahead (PLAN release rule 3)';

const read = (rel: string): Manifest => JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) as Manifest;

const matchesOf = (m: Manifest): string[] => [...new Set((m.content_scripts ?? []).flatMap((c) => c.matches ?? []))];

/** Every entry the source manifest asks for that the uploaded package's manifest does not: one line each, naming the list and the rule. */
function additions(source: Manifest, uploaded: Manifest, product: string): string[] {
  const lists: Array<[string, string[], string[]]> = [
    ['permissions', source.permissions ?? [], uploaded.permissions ?? []],
    ['host_permissions', source.host_permissions ?? [], uploaded.host_permissions ?? []],
    ['content_scripts[].matches', matchesOf(source), matchesOf(uploaded)],
  ];
  const out: string[] = [];
  for (const [name, now, then] of lists) {
    for (const entry of now) {
      if (!then.includes(entry)) out.push(`${product}: ${name} gains "${entry}", which the uploaded package does not have. The rule: ${RULE}.`);
    }
  }
  return out;
}

const PRODUCTS: Array<{ product: string; source: string; fixture: string }> = [
  { product: 'Receipts', source: 'manifest.json', fixture: 'tests/fixtures/release-manifests/receipts-2.5.18.json' },
  { product: 'Off', source: 'manifest.off.json', fixture: 'tests/fixtures/release-manifests/off-1.0.13.json' },
];

describe.each(PRODUCTS)('UP1: $product adds nothing to the uploaded package', ({ product, source, fixture }) => {
  const now = read(source);
  const uploaded = read(fixture);

  it('the source manifest asks for nothing the uploaded package does not', () => {
    expect(additions(now, uploaded, product)).toEqual([]);
  });

  it('guard: the fixture is a real manifest (it has permissions, hosts and content matches to compare)', () => {
    expect(uploaded.permissions?.length ?? 0, 'permissions').toBeGreaterThan(0);
    expect(uploaded.host_permissions?.length ?? 0, 'host_permissions').toBeGreaterThan(0);
    expect(matchesOf(uploaded).length, 'content_scripts matches').toBeGreaterThan(0);
  });

  it('one added host fails, naming the host and the rule', () => {
    const grown: Manifest = { ...now, host_permissions: [...(now.host_permissions ?? []), 'https://added.example/*'] };
    const found = additions(grown, uploaded, product);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"https://added.example/*"');
    expect(found[0]).toContain('host_permissions');
    expect(found[0]).toContain('announced one release ahead');
  });

  it('one added permission fails, naming the permission and the rule', () => {
    const grown: Manifest = { ...now, permissions: [...(now.permissions ?? []), 'tabs'] };
    const found = additions(grown, uploaded, product);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"tabs"');
    expect(found[0]).toContain('permissions gains');
    expect(found[0]).toContain('announced one release ahead');
  });

  it('one added content match fails, naming the match and the rule', () => {
    const first = (now.content_scripts ?? [])[0] ?? { matches: [] };
    const grown: Manifest = { ...now, content_scripts: [{ ...first, matches: [...(first.matches ?? []), '*://*.added.example/*'] }, ...(now.content_scripts ?? []).slice(1)] };
    const found = additions(grown, uploaded, product);
    expect(found).toHaveLength(1);
    expect(found[0]).toContain('"*://*.added.example/*"');
    expect(found[0]).toContain('content_scripts[].matches');
    expect(found[0]).toContain('announced one release ahead');
  });

  it('a removal passes: taking an entry away asks nobody anything', () => {
    const shrunk: Manifest = { ...now, host_permissions: (now.host_permissions ?? []).slice(1), permissions: (now.permissions ?? []).slice(1) };
    expect(additions(shrunk, uploaded, product)).toEqual([]);
  });

  it('optional permissions are listed in the output and never fail', () => {
    const optional = [...(now.optional_permissions ?? []), ...(now.optional_host_permissions ?? [])];
    console.log(`${product}: optional permissions in the source manifest: ${optional.length ? optional.join(', ') : 'none'}`);
    expect(additions({ ...now, optional_permissions: ['tabs'] }, uploaded, product), 'an optional permission is not an addition').toEqual([]);
  });
});
