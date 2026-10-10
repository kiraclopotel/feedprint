// Types for export-tamper-corpus.mjs.
//
// The corpus is plain ESM because the promise check in scripts/verify/product-copy-claims.mjs is a
// node script and cannot import TypeScript, while the test beside it runs under vitest and is
// TypeScript. One implementation, two callers, and this file is what lets the typed caller see it.

/** What the checker said about one file. `state` is its own word: verified, partial or failed. */
export interface CheckerReading {
  code: number;
  state: string;
  manifest: string | null;
  reason: string | null;
  detail?: string | null;
  raw?: string;
}

export interface Mutation {
  /** The name this mutation is reported under. */
  name: string;
  /** What is changed, in one phrase, for a reader of the output. */
  why: string;
  /** The reading expected from the whole file, manifest and all. */
  whole: 'failed' | 'partial' | 'verified';
  /** The reading expected from the same edit with the manifest deleted, or null when not asked. */
  bare: 'failed' | 'partial' | null;
  apply(html: string): string;
}

export interface CorpusEntryResult {
  name: string;
  why: string;
  expected: string;
  observed: CheckerReading;
}

export interface CorpusRun {
  dir: string;
  original: CheckerReading;
  whole: CorpusEntryResult[];
  bare: CorpusEntryResult[];
}

export declare const REPO_ROOT: string;
export declare const BASE_EXPORT_REL: string;
export declare const CHECKER_REL: string;
export declare const BASE_EXPORT_PATH: string;
export declare const CHECKER_PATH: string;
export declare const MUTATIONS: Mutation[];

export declare function editPayload(html: string, edit: (data: Record<string, unknown>) => void): string;
export declare function replaceOnce(html: string, from: string, to: string): string;
export declare function replaceOnceAfter(html: string, anchor: string, from: string, to: string): string;
export declare function replaceRowText(html: string, prov: string, to: string): string;
export declare function flipChar(s: string, index: number): string;
export declare function mutantsOf(baseHtml: string): Array<Mutation & { html: string }>;
export declare function bareMutantsOf(baseHtml: string): Array<Mutation & { html: string }>;
export declare function checkFile(checkerPath: string, filePath: string): CheckerReading;
export declare function runCorpus(options?: { checkerPath?: string; baseHtml?: string }): CorpusRun;
