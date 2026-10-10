// Types for the two exports tests/repo/architecture-layering.test.ts reads out of the eslint config
// (PLAN-2026-09-16 items 8.11 and 5.8: a .mjs a test imports gets a declaration file, never a
// type-check escape). The config itself stays plain JS, because eslint loads it directly.

/** The layer order, bottom first. A folder may import anything below it and nothing above. */
export declare const LAYERS: string[];

/** Upward imports that exist today, per layer, each kept only while the import is still there. */
export declare const TOLERATED: Record<string, string[]>;

declare const config: unknown;
export default config;
