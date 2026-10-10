// The published conformance vectors must agree with the shipped rule.
//
// verifier/vectors/CONTENT-IDENTITY.json is addressed to somebody who does not
// have this repository: a second implementer diffs their output against it to
// prove their reading of FORMAT.md section 9 matches ours. That only means
// anything while the file and the code say the same thing.
//
// The failure this prevents is quiet and one-directional. If the rule in
// src/forensics/content-identity.ts is widened or narrowed and this file is not
// regenerated, the published vectors keep certifying implementations that no
// longer agree with us, and every corroboration count computed by either side is
// wrong with nothing failing anywhere. So the vectors are checked against the
// production function, not against a copy of it.
//
// Regenerate with the generator named in the file's own commit, then run this.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentIdentity, CONTENT_IDENTITY_VERSION } from '../../src/forensics/content-identity';

interface Vector { group: string; name: string; text: string; identity: string }
interface VectorFile { rule: string; what: string; contract: string[]; limits: string[]; vectors: Vector[] }

const file: VectorFile = JSON.parse(
  readFileSync(resolve(__dirname, '../../verifier/vectors/CONTENT-IDENTITY.json'), 'utf8'),
);

describe('the published content-identity vectors', () => {
  it('names the rule this build ships', () => {
    expect(file.rule).toBe(CONTENT_IDENTITY_VERSION);
  });

  it('is not empty, because a conformance suite of nothing conforms to anything', () => {
    expect(file.vectors.length).toBeGreaterThanOrEqual(20);
    expect(new Set(file.vectors.map((v) => v.group)).size).toBeGreaterThanOrEqual(8);
  });

  it.each(file.vectors.map((v) => [`${v.group} / ${v.name}`, v] as const))(
    'agrees with the shipped rule for %s',
    async (_label, vector) => {
      expect(await contentIdentity(vector.text)).toBe(vector.identity);
    },
  );

  it('keeps its own promise that a group is one identity', () => {
    const byGroup = new Map<string, Set<string>>();
    for (const v of file.vectors) {
      if (!byGroup.has(v.group)) byGroup.set(v.group, new Set());
      byGroup.get(v.group)!.add(v.identity);
    }
    for (const [group, identities] of byGroup) {
      expect(identities.size, `group ${group} must hold exactly one identity`).toBe(1);
    }
  });

  it('keeps its own promise that groups differ, with the one collision it declares', () => {
    const perGroup = new Map<string, string>();
    for (const v of file.vectors) perGroup.set(v.group, v.identity);

    const collisions = new Map<string, string[]>();
    for (const [group, identity] of perGroup) {
      if (!collisions.has(identity)) collisions.set(identity, []);
      collisions.get(identity)!.push(group);
    }
    const shared = [...collisions.values()].filter((groups) => groups.length > 1);

    // `empty` and `whitespace-only` both normalise to the empty string. That is
    // the only cross-group collision the file declares, and any other one means
    // normalisation has started merging things it should not.
    expect(shared).toHaveLength(1);
    expect([...shared[0]].sort()).toEqual(['empty', 'whitespace-only']);
  });

  it('states its limits, because a vector file quoted without them is a claim we did not make', () => {
    expect(file.contract.length).toBeGreaterThanOrEqual(3);
    expect(file.limits.join(' ')).toContain('not by itself evidence');
  });
});
