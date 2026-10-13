// The policy table: the one place a reading becomes an action. The rows, where each cell comes
// from, and the rules they keep: docs/design/POLICY-TABLE-2026-09-07.md. Not yet wired into the
// pipeline or the comment flush. Pure: no I/O, no settings, no clock.
//
// Three readings and one household go in. The judge is JUDGE-V1 as is (charged, family, severity
// 0 to 10). Of the descriptor's fields, protect and swearing are measured and ship, target and
// speech act missed their gate, and topic and graphic are not measured yet. The rails are the
// fixed gates that ran before either AI call. The household is the mode, the reader's topic rules
// and the swearing setting. The first row whose condition holds names the action, and its id is
// the record's why.

import type { Mode } from '../../types/mode';

export type JudgeFamily = 'hostile' | 'threat' | 'commercial' | 'body' | 'profanity' | 'none';
type Target = 'present' | 'public' | 'group' | 'thing' | 'nobody';
type Protect = 'none' | 'self-harm' | 'drug' | 'grooming' | 'sexual' | 'violence' | 'challenge';
export type Rail = 'blocklist' | 'identity-slur' | 'coded-harm' | 'sponsored' | 'topic';
export type Action = 'allow' | 'context' | 'mark' | 'soften' | 'mask' | 'collapse' | 'hide' | 'record';
/** The household's own topic rule: what to do with a topic the reader asked not to see. */
type TopicRule = 'collapse' | 'hide';

interface JudgeReading {
  charged: boolean;
  family: JudgeFamily;
  /** 0 to 10, the judge's own number; 0 whenever charged is false. */
  severity: number;
}

interface DescriptorReading {
  /**
   * Absent: the descriptor missed its gate on target (kappa 0.44 and 0.40 against 0.68,
   * docs/research/context-2026-09-07/RESULTS.md, last section). So J3 and J4 never fire and J7
   * decides the 4 to 6 band. A target that passes later means a fellow commenter, never the
   * post's author or a person in its media.
   */
  target?: Target;
  topic: string;
  protect: Protect;
  graphic: boolean;
  swearing: boolean;
}

export interface Reading {
  /** null when the judge did not run (free tier, cap, breaker, a rail fired first). */
  judge: JudgeReading | null;
  /** null when the descriptor did not run. */
  descriptor: DescriptorReading | null;
  rails: Rail[];
}

export interface Household {
  mode: Mode;
  /** topic label -> the rule the reader or parent set. Absent topics have no rule. */
  topicRules: Readonly<Record<string, TopicRule>>;
  /** 'mask' stars vulgar words on anything that stays visible; 'show' leaves them. */
  swearing: 'show' | 'mask';
}

export interface Decision {
  action: Action;
  /** The row that fired, e.g. 'R2', 'P1', 'J3', 'T1', 'D1'. */
  row: string;
  /** Fixed words for the record and the notice, e.g. 'rail:identity-slur', 'topic:politics household'. */
  reason: string;
  /** True when `swearing` is masked on top of a visible action. */
  mask: boolean;
}

/** Ordered by how much of the item the reader still sees; a higher index shows less. */
const ORDER: readonly Action[] = ['allow', 'context', 'mark', 'soften', 'collapse', 'hide'];
export function actionRank(a: Action): number {
  const i = ORDER.indexOf(a);
  return i === -1 ? 0 : i;
}
function higher(a: Action, b: Action): Action {
  return actionRank(b) > actionRank(a) ? b : a;
}

type Cells = Readonly<Record<Mode, Action>>;
interface Row {
  id: string;
  when: (r: Reading, h: Household) => boolean;
  cells: Cells;
  reason: (r: Reading, h: Household) => string;
}

const sev = (r: Reading): number => (r.judge && r.judge.charged ? r.judge.severity : 0);
const charged = (r: Reading): boolean => !!r.judge && r.judge.charged;
const inBand = (r: Reading, lo: number, hi: number): boolean => charged(r) && sev(r) >= lo && sev(r) <= hi;
const protect = (r: Reading): Protect => r.descriptor?.protect ?? 'none';
const target = (r: Reading): Target | null => r.descriptor?.target ?? null;
const family = (r: Reading): JudgeFamily | null => r.judge?.family ?? null;
const topic = (r: Reading): string | null => r.descriptor?.topic ?? null;
const hasRail = (r: Reading, name: Rail): boolean => r.rails.includes(name);
const cells = (child: Action, teen: Action, adult: Action): Cells => ({ child, teen, adult });

/**
 * In the design's order. A cell the design marks (choice) is the default here; the household's
 * topic rules (T1) are how a reader changes it.
 */
export const POLICY_ROWS: readonly Row[] = [
  { id: 'R1', when: (r) => hasRail(r, 'blocklist'), cells: cells('hide', 'hide', 'hide'), reason: () => 'rail:blocklist' },
  { id: 'R2', when: (r) => hasRail(r, 'identity-slur'), cells: cells('hide', 'hide', 'hide'), reason: () => 'rail:identity-slur' },
  { id: 'R3', when: (r) => hasRail(r, 'coded-harm'), cells: cells('hide', 'hide', 'hide'), reason: () => 'rail:coded-harm' },
  { id: 'R4', when: (r) => hasRail(r, 'sponsored'), cells: cells('collapse', 'collapse', 'collapse'), reason: () => 'rail:sponsored' },
  // A topic the person switched on (src/core/policy/topic-lexicon.ts). Their choice, so it hides at every level and nothing
  // lowers it; a written list found it and no model read the item, so the record names no technique and no severity.
  { id: 'R5', when: (r) => hasRail(r, 'topic'), cells: cells('hide', 'hide', 'hide'), reason: () => 'rail:topic' },
  { id: 'P1', when: (r) => protect(r) === 'grooming', cells: cells('hide', 'hide', 'mark'), reason: () => 'protect:grooming' },
  { id: 'P2', when: (r) => protect(r) === 'self-harm', cells: cells('hide', 'hide', 'mark'), reason: () => 'protect:self-harm' },
  { id: 'P3', when: (r) => protect(r) === 'sexual', cells: cells('hide', 'hide', 'allow'), reason: () => 'protect:sexual' },
  { id: 'P4', when: (r) => protect(r) === 'drug', cells: cells('hide', 'collapse', 'allow'), reason: () => 'protect:drug' },
  { id: 'P4b', when: (r) => protect(r) === 'challenge', cells: cells('hide', 'hide', 'mark'), reason: () => 'protect:challenge' },
  { id: 'P5', when: (r) => protect(r) === 'violence' || r.descriptor?.graphic === true, cells: cells('hide', 'collapse', 'mark'), reason: (r) => (protect(r) === 'violence' ? 'protect:violence' : 'graphic') },
  { id: 'J1', when: (r) => inBand(r, 9, 10), cells: cells('hide', 'hide', 'hide'), reason: (r) => `judge:${family(r)}:${sev(r)}` },
  { id: 'J2', when: (r) => inBand(r, 7, 8), cells: cells('hide', 'hide', 'collapse'), reason: (r) => `judge:${family(r)}:${sev(r)}` },
  { id: 'J3', when: (r) => inBand(r, 4, 6) && target(r) === 'present', cells: cells('hide', 'collapse', 'mark'), reason: (r) => `judge:${family(r)}:${sev(r)} target:present` },
  { id: 'J4', when: (r) => inBand(r, 4, 6) && target(r) === 'group', cells: cells('hide', 'mark', 'mark'), reason: (r) => `judge:${family(r)}:${sev(r)} target:group` },
  { id: 'J5', when: (r) => inBand(r, 4, 6) && family(r) === 'body', cells: cells('hide', 'mark', 'allow'), reason: (r) => `judge:body:${sev(r)}` },
  { id: 'J6', when: (r) => inBand(r, 4, 6) && family(r) === 'commercial', cells: cells('hide', 'mark', 'mark'), reason: (r) => `judge:commercial:${sev(r)}` },
  { id: 'J7', when: (r) => inBand(r, 4, 6), cells: cells('mark', 'mark', 'mark'), reason: (r) => `judge:${family(r)}:${sev(r)}` },
  // Child allows here too. Marking put a marker on 142 of 500 items (the composite harness on the
  // dev split), 28 percent of a child's feed, in a band where the judge's precision is not
  // measured: it is measured from 4 up.
  { id: 'J8', when: (r) => inBand(r, 1, 3), cells: cells('allow', 'allow', 'allow'), reason: (r) => `judge:${family(r)}:${sev(r)}` },
  { id: 'D1', when: () => true, cells: cells('allow', 'allow', 'allow'), reason: () => 'not-charged' },
];

/** The rails' actions are final; nothing lowers them. */
const RAIL_ROWS = new Set(['R1', 'R2', 'R3', 'R4', 'R5']);

export function decide(reading: Reading, household: Household): Decision {
  const row = POLICY_ROWS.find((x) => x.when(reading, household));
  if (!row) throw new Error('policy table has no terminal row');
  let action: Action = row.cells[household.mode];
  let id = row.id;
  let reason = row.reason(reading, household);

  // T1: the household's own topic rule. It never lowers a rail, never raises severity, and
  // never writes a technique; when it wins, the record says the household said so.
  const t = topic(reading);
  const rule = t ? household.topicRules[t] : undefined;
  if (rule && !RAIL_ROWS.has(id)) {
    const raised = higher(action, rule);
    if (raised !== action) {
      action = raised;
      id = 'T1';
      reason = `topic:${t} household`;
    }
  }

  const visible = action === 'allow' || action === 'context' || action === 'mark' || action === 'soften';
  const mask = household.swearing === 'mask' && visible && reading.descriptor?.swearing === true;
  return { action, row: id, reason, mask };
}

/**
 * The record's `verdict` for an action, so every count the export makes keeps its meaning
 * (docs/design/DECISION-BLOCK-2026-09-07.md, section 1). A mask is its own verdict: filed under
 * pass, starred text was counted as untouched though the page changed it. It is still not a flag.
 */
export function verdictFor(action: Action): 'pass' | 'masked' | 'flagged' | 'flagged-hidden' {
  switch (action) {
    case 'mark':
    case 'soften':
      return 'flagged';
    case 'collapse':
    case 'hide':
      return 'flagged-hidden';
    case 'mask':
      return 'masked';
    default:
      return 'pass';
  }
}
