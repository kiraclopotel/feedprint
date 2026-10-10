import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readSource } from '../../helpers/read-source';

// A path from the repository root, which is what readSource takes. Written as a path relative to
// this file it resolved above the repository and read the main checkout's copy instead of this
// one, and said nothing about it (PLAN-2026-09-16 item 11.4).
const INDEX_PATH = 'src/content/post-path/result-apply.ts';
const source = readSource(INDEX_PATH);

describe('M67 recovered post intervention wiring', () => {
  it('hands the recovered element to Child protection before mutation', () => {
    expect(source).toMatch(
      /const el = recovered;[\s\S]{0,180}prepareCurrentPostMutation\(post, el\)/,
    );
  });
});
