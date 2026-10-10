// Types for review-verdicts.mjs, so the typed test lane can import it.

export const REPO_ROOT: string;

export type Role = 'work' | 'review' | 'repair';

export interface JournalEvent {
  role: Role;
  what: 'started' | 'returned' | 'failed';
  key: string;
  verdict?: 'ok' | 'problems' | null;
  status?: string | null;
  commits?: string[];
}

export interface Unit {
  journal: string;
  id: string;
  events: JournalEvent[];
}

export interface Journal {
  name: string;
  units: Unit[];
  badLines: number;
  plainAnswers: number;
  unknownKeys: number;
}

export interface Verdict {
  covered: boolean;
  reason: string;
}

export interface CheckedCommit {
  hash: string;
  subject: string;
  covered: boolean;
  units: Array<{ journal: string; id: string } & Verdict>;
}

export function roleOf(label: unknown): { role: Role; id: string } | null;

export function commitTokens(answer: unknown): string[];

export function parseJournal(text: string, name: string): Journal;

export function unitVerdict(unit: Unit): Verdict;

export function checkCommits(journals: Journal[], commits: Array<{ hash: string; subject: string }>): CheckedCommit[];

export function readCommits(range: string, repo?: string): { commits: Array<{ hash: string; subject: string }>; merges: number };

export function journalFiles(paths: string[]): string[];

export function run(argv: string[], print?: (line: string) => void): number;
