// Types for retirement-preflight.mjs, so the typed test lane can import it.

export const REPO_ROOT: string;

export const GUARDS: Record<
  | 'frozen'
  | 'preCommit'
  | 'moved'
  | 'docs'
  | 'root'
  | 'outbox'
  | 'outboxGate'
  | 'scripts'
  | 'citations'
  | 'manifest'
  | 'copy'
  | 'snapshot'
  | 'snapshotLists'
  | 'context',
  string
>;

export interface Tree {
  root: string;
  files: string[];
  fileSet: Set<string>;
  dirs: Set<string>;
  /** The file's text with LF line endings, or null when it is missing or not text. */
  text(path: string): string | null;
  bytes(path: string): Uint8Array;
}

export interface Target {
  path: string;
  isFolder: boolean;
  files: string[];
  fileSet: Set<string>;
  covers(path: string): boolean;
  needle: string;
  /** For an index module, the name of the folder code imports it by ('' at the root); otherwise null. */
  folderName: string | null;
  whole: RegExp;
  name: string;
  uniqueName: boolean;
}

export interface Finding {
  level: 'pin' | 'note';
  where: string;
  what: string;
  /** Each file and line the finding stands for, when it stands for more than its `where`. */
  places?: string[];
}

export interface Section {
  id: string;
  title?: string;
  guard?: string | null;
  findings?: Finding[];
  skipped?: string;
  unread?: string;
  lines?: number;
}

export function openTree(root?: string): Tree;

export function tokensOf(text: string): Array<{ type: 'string' | 'template' | 'name' | 'punct' | 'regex'; value: string; at: number }>;

export function stringsIn(text: string, name: string): Array<{ value: string; line: number }> | null;

export function entriesIn(text: string, name: string): Array<{ key: string; values: string[]; line: number }> | null;

export function regexIn(text: string, name: string): RegExp | null;

export function makeTarget(path: string, tree: Tree): Target;

export function howLineNames(line: string, file: string, target: Target, code: boolean): string | null;

export function pageLineNames(line: string, bases: string[], target: Target, tree: Tree): string | null;

export function ranges(lines: number[]): string;

export function normalTarget(input: string, root?: string): string | null;

export function preflight(path: string, tree: Tree): Promise<{ target: Target; sections: Section[] }>;

export function report(
  result: { target: Target; sections: Section[] },
  options?: { all?: boolean },
): { lines: string[]; pinned: boolean; incomplete: boolean };

export function run(argv: string[], print?: (line: string) => void, deps?: { root?: string; tree?: Tree }): Promise<number>;
