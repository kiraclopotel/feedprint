// Capability audit 2026-09-06, P0 item 4: mode and model as filter axes in the
// Activity rail. Both read fields that are on every record (userAgeCategory;
// aiModel or its absence). The count an option shows must equal the rows it
// opens, the same invariant every other axis carries.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import {
  MODE_OPTIONS, matchesMode, MODEL_NONE, modelKey, matchesModel, modelOptions,
} from '../../../../../src/ui/dashboard/components/filter-rail';
import {
  computeRailCounts, recordPasses, isAnyFilterActive, type ActivityFilterState,
} from '../../../../../src/ui/dashboard/components/activity-filters';
import { matchesWhat } from '../../../../../src/ui/dashboard/components/activity-filters';

function rec(over: Partial<ForensicRecord>): ForensicRecord {
  return {
    id: over.id ?? 'r', timestamp: '2026-09-01T10:00:00.000Z', platform: 'tiktok', kind: 'post',
    originalText: 'x', originalHash: 'h', originalLength: 1, neutralizedText: '', author: 'a',
    postUrl: 'https://www.tiktok.com/@a/video/1', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'foryou', integrityHash: 'ih',
    verdict: 'pass',
    ...over,
  } as ForensicRecord;
}

const SET: ForensicRecord[] = [
  rec({ id: '1', aiModel: 'openai/gpt-oss-120b' }),
  rec({ id: '2', aiModel: 'openai/gpt-oss-120b', userAgeCategory: 'teen' }),
  rec({ id: '3', aiModel: 'openai/gpt-oss-20b', userAgeCategory: 'child' }),
  rec({ id: '4', aiSource: 'rules', aiModel: undefined }),
  rec({ id: '5', aiSource: 'none', aiModel: '' }),
];

const NONE: ActivityFilterState = {
  filter: 'all', platformFilter: 'all', accountFilter: 'all', whenFilter: 'any',
  severityFilter: null, kindFilter: null, modeFilter: null, modelFilter: null,
  techniqueFilter: null, hiddenCategoryFilter: null, safetyBucketFilter: null,
  recordIdsFilter: null, roomUrlFilter: null, hourRangeFilter: null, search: '',
  surfaceFilter: null, sessionFilter: null, seenBeforeFilter: null, authorFilter: null,
};
const what = (r: ForensicRecord, f: ActivityFilterState['filter']) => matchesWhat(r, f, new Map(), new Set());
const idx = new Map<string, string>();

describe('mode axis', () => {
  it('is userAgeCategory, one option per record', () => {
    for (const r of SET) expect(MODE_OPTIONS.filter(m => matchesMode(r, m))).toHaveLength(1);
  });
});

describe('model axis', () => {
  it('a missing or empty aiModel sits under MODEL_NONE', () => {
    expect(modelKey(SET[3])).toBe(MODEL_NONE);
    expect(modelKey(SET[4])).toBe(MODEL_NONE);
    expect(matchesModel(SET[3], MODEL_NONE)).toBe(true);
    expect(matchesModel(SET[0], MODEL_NONE)).toBe(false);
  });
  it('options come from the records, most first, MODEL_NONE last', () => {
    expect(modelOptions(SET)).toEqual(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', MODEL_NONE]);
    expect(modelOptions([])).toEqual([]);
  });
});

describe('count equals click-through on both axes', () => {
  it('rail counts match the rows each option opens, alone and combined', () => {
    const passesWith = (s: ActivityFilterState) => (r: ForensicRecord, except?: Parameters<typeof recordPasses>[4]) =>
      recordPasses(r, s, what, idx, except);
    const counts = computeRailCounts(SET, passesWith(NONE), what);
    expect(counts.mode).toEqual({ relaxed: 3, moderate: 1, strict: 1 });
    expect(counts.model).toEqual({ 'openai/gpt-oss-120b': 2, 'openai/gpt-oss-20b': 1, [MODEL_NONE]: 2 });
    for (const m of MODE_OPTIONS) {
      const s = { ...NONE, modeFilter: m };
      expect(SET.filter(r => passesWith(s)(r)).length).toBe(counts.mode[m]);
    }
    for (const k of modelOptions(SET)) {
      const s = { ...NONE, modelFilter: k };
      expect(SET.filter(r => passesWith(s)(r)).length).toBe(counts.model[k]);
    }
    // With mode held to adult, the model counts are click-through counts under that hold.
    const held = { ...NONE, modeFilter: 'relaxed' as const };
    const under = computeRailCounts(SET, passesWith(held), what);
    expect(under.model).toEqual({ 'openai/gpt-oss-120b': 1, 'openai/gpt-oss-20b': 0, [MODEL_NONE]: 2 });
    expect(SET.filter(r => passesWith({ ...held, modelFilter: MODEL_NONE })(r)).map(r => r.id)).toEqual(['4', '5']);
  });
  it('either axis counts as an active narrowing (flattens the feed)', () => {
    expect(isAnyFilterActive(NONE, '')).toBe(false);
    expect(isAnyFilterActive({ ...NONE, modeFilter: 'moderate' }, '')).toBe(true);
    expect(isAnyFilterActive({ ...NONE, modelFilter: MODEL_NONE }, '')).toBe(true);
  });
});
