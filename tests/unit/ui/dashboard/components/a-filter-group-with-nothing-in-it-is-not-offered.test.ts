// A heading that opens onto nothing.
//
// Two of the Activity tab's filter groups are built from the records rather
// than from a fixed list: "Model that read it" and "Where it was". On a record
// set with neither, the group rendered as a heading with no options under it.
// A reader who opens it finds an empty box, which reads as a filter that is
// broken rather than one that has nothing to offer, and this is the tab a
// person spends most of their time on.
//
// The surface group guarded itself with `surfacesPresent.length > 0`. The model
// group did not, and there was nothing to notice that: two implementations of
// one rule, one of them missing, which is the shape most of this week's defects
// have had. The guard now lives once, over the whole list, so a group added
// tomorrow inherits it and the surface group's private copy is gone.
//
// This file tests the pieces the rule is built from, since railGroups is
// assembled inside a component that needs a record store, a drill and an
// integrity result to mount. (2026-09-18)

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { modelOptions, surfaceOptions, MODEL_NONE } from '../../../../../src/ui/dashboard/components/filter-rail';
import type { ForensicRecord } from '../../../../../src/types/forensic';
import { REPO_ROOT as ROOT } from '../../../../helpers/repo-root';

const TAB = join(ROOT, 'src', 'ui', 'dashboard', 'components', 'ActivityTab.tsx');

function record(over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: 'r1', timestamp: '2026-09-18T10:00:00Z', platform: 'facebook',
    originalText: 'a post', originalHash: 'h', originalLength: 6, neutralizedText: '',
    author: '@a', postUrl: '', techniques: [], overallScore: 0,
    userAgeCategory: 'adult', aiSource: 'cloud', feedSource: 'for-you',
    integrityHash: 'h1', signature: 's', publicKeyFingerprint: 'fp',
    chainPosition: 0, kind: 'post', verdict: 'pass',
    ...over,
  } as unknown as ForensicRecord;
}

describe('a filter group with nothing in it is not offered', () => {
  it('the two record-derived groups really can come back empty', () => {
    expect(modelOptions([]), 'no records, no models to choose between').toEqual([]);
    expect(surfaceOptions([]), 'and no surfaces').toEqual([]);
  });

  it('applies one length rule to the whole list, not to one group', () => {
    const src = readFileSync(TAB, 'utf8');
    expect(
      src,
      'the rule is applied once, over every group',
    ).toContain('railGroupsAll.filter((g) => g.options.length > 0)');
    expect(
      src,
      'and the surface group no longer carries its own copy of it',
    ).not.toContain('surfacesPresent.length > 0 ?');
  });

  // The control. A rule that dropped groups too eagerly would empty the rail.
  it('keeps a group that has something to offer', () => {
    const records = [
      record({ aiModel: 'gpt-oss-120b' } as Partial<ForensicRecord>),
      record({ id: 'r2' }),
    ];
    const models = modelOptions(records);
    expect(models.length, 'one named model and the none bucket').toBeGreaterThan(1);
    expect(models).toContain(MODEL_NONE);
  });

  // And the shape that made this hard to see: a set where every record was
  // read by nothing still yields ONE option, so the group is not empty and is
  // still shown. That is right: it tells the reader nothing read any of it.
  it('still offers the group when the only answer is "nothing read it"', () => {
    const models = modelOptions([record(), record({ id: 'r2' })]);
    expect(models).toEqual([MODEL_NONE]);
  });
});
