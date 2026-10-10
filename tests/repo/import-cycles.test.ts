// D9 (docs/history/archive/reality-FUNCTION_MAP.md drill list) — import-cycle lock.
//
// Two properties, and the second one is new since 2026-09-16 (PLAN-2026-09-16 item 8.12):
//
//   1. Zero VALUE-LEVEL cycles in src. A value cycle is the class that bites at runtime: a module
//      reads a still-uninitialized binding from its partner during load, and the service-worker
//      context has no tolerance for that.
//   2. Zero cycles of ANY kind, type-only included. Six type-only cycles were broken by moving the
//      shared shape into a leaf file under src/types (settings and presets, the profanity filter and
//      its regional lexicon, the batch scorer and the present-target test, post and forensic, and
//      the two through the chain anchor). A type-only cycle is erased at compile time, so it never
//      bit; what it did was hide which module owns a shape, and make every later split harder.
//
// If this fails on a cycle you just created: the shape both files need belongs in its own file.

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import madge from 'madge';
import { REPO_ROOT as ROOT } from '../helpers/repo-root';

describe('D9 — src has no value-level import cycles', () => {
  it(
    'madge (type imports skipped) reports zero circular dependencies',
    async () => {
      const res = await madge(resolve(ROOT, 'src'), {
        fileExtensions: ['ts', 'tsx'],
        detectiveOptions: {
          ts: { skipTypeImports: true },
          tsx: { skipTypeImports: true },
        },
      });
      // A moved or empty src/ would make madge report no cycles for the wrong reason.
      expect(Object.keys(res.obj()).length).toBeGreaterThan(300);
      expect(res.circular()).toEqual([]);

      // The same question again, with type imports counted.
      const withTypes = await madge(resolve(ROOT, 'src'), { fileExtensions: ['ts', 'tsx'] });
      expect(Object.keys(withTypes.obj()).length).toBeGreaterThan(300);
      expect(withTypes.circular()).toEqual([]);
    },
    120_000,
  );
});
