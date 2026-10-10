// Types for stray-runs.mjs, so the typed test lane can import it.

export interface ProcessRow {
  pid: number;
  ppid: number | null;
  name: string;
  /** Milliseconds since 1970, or null when the list does not say. */
  started: number | null;
  commandLine: string | null;
}

export interface Run extends ProcessRow {
  why: string;
}

export const TOOLS: string[];

export const PROCESS_QUERY: string;

export function folderKey(folder: string): string;

export function runsATool(commandLine: string | null, folder?: string): boolean;

export function namesFolder(commandLine: string | null, folder: string, isCheckout?: (dir: string) => boolean): boolean;

export function findRuns(
  processes: ProcessRow[],
  folder: string,
  options?: { since?: number | null; selfPid?: number | null; isCheckout?: (dir: string) => boolean },
): { runs: Run[]; machineWide: number };

export function parseProcessList(text: string): ProcessRow[];

export function readWindowsProcesses(): ProcessRow[];

export function localTime(ms: number): string;

export function age(ms: number): string;

export function run(
  argv: string[],
  print?: (line: string) => void,
  deps?: {
    readProcesses?: () => ProcessRow[];
    now?: () => number;
    selfPid?: number | null;
    isCheckout?: (dir: string) => boolean;
  },
): number;
