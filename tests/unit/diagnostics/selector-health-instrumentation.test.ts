// RECON F3a (2026-08-18) — a surface FeelingWise cannot see must not report clean.
//
// The dashboard printed "Facebook — no visit observed today" on a day Facebook
// had been browsed for hours (fbCommentAlreadySeen reached 9,139). Cause: no
// Facebook code path ever recorded a selector-health label, so assessPlatformDrift
// saw zero queries and reported the same 'not-monitored' it uses for "you did not
// open this app today". Ignorance rendered as a quiet day.
//
// Two guards live here.
//
//  1. The verdict split: an instrumented platform with no data is 'not-monitored';
//     an uninstrumented one is 'not-instrumented', which the panel renders as
//     "not instrumented, so nothing can be reported here".
//
//  2. INSTRUMENTED_PLATFORMS is a hand-maintained list, which is exactly the kind
//     of thing that silently goes stale and reintroduces this bug. So it is
//     checked against the source: every platform with a label literal in src/
//     must be listed, and every listed platform must actually have one. Adding
//     the first sweep call for Instagram will fail this test until the list is
//     updated, which is the intended nag.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessPlatformDrift,
  INSTRUMENTED_PLATFORMS,
  MONITORED_PLATFORMS,
  type SelectorHealthSnapshot,
} from '../../../src/diagnostics/selector-health';
import { repoPath } from '../../helpers/repo-root';

// Through the repository-root helper, not a count of .. from this file: the count was wrong the
// moment the test moved into a folder (PLAN-2026-09-16 item 11.2).
const SRC = repoPath('src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Platforms that actually register a selector-health label somewhere in src/.
 * Labels are "<platform>.<site>" string literals. Hostnames ("facebook.com")
 * share that shape and are excluded — they are not labels.
 */
function platformsWithLabelsInSource(): Set<string> {
  const pattern = new RegExp(
    `'(${MONITORED_PLATFORMS.join('|')})\\.([a-zA-Z0-9._-]+)'`,
    'g',
  );
  const found = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(pattern)) {
      if (m[2] === 'com') continue; // hostname, not a label
      found.add(m[1]);
    }
  }
  return found;
}

const EMPTY: SelectorHealthSnapshot = { counters: {} } as SelectorHealthSnapshot;

describe('RECON F3a — uninstrumented platforms say so', () => {
  it('Facebook now registers at least one selector-health label', () => {
    expect(platformsWithLabelsInSource().has('facebook')).toBe(true);
  });

  it('INSTRUMENTED_PLATFORMS matches what the source actually records', () => {
    const inSource = [...platformsWithLabelsInSource()].sort();
    expect([...INSTRUMENTED_PLATFORMS].sort()).toEqual(inSource);
  });

  it('with no data, instrumented platforms are not-monitored and the rest not-instrumented', () => {
    const byPlatform = Object.fromEntries(
      assessPlatformDrift(EMPTY).map(d => [d.platform, d.status]),
    );
    for (const platform of MONITORED_PLATFORMS) {
      const expected = (INSTRUMENTED_PLATFORMS as readonly string[]).includes(platform)
        ? 'not-monitored'
        : 'not-instrumented';
      expect(byPlatform[platform], platform).toBe(expected);
    }
  });

  it('the two verdicts are actually distinguishable — at least one platform of each today', () => {
    // Guards the split from collapsing back into one bucket. If every platform
    // becomes instrumented this test should be retired, not weakened.
    const statuses = assessPlatformDrift(EMPTY).map(d => d.status);
    expect(statuses).toContain('not-monitored');
    expect(statuses).toContain('not-instrumented');
  });

  it('both verdicts ship in both languages, and differ from each other', async () => {
    const { DASHBOARD_STRINGS } = await import('../../../src/i18n/dashboard-strings');
    for (const lang of ['en', 'ro'] as const) {
      const s = DASHBOARD_STRINGS[lang];
      expect(s.opsDriftNotInstrumented.length).toBeGreaterThan(0);
      expect(s.opsDriftNotInstrumented).not.toBe(s.opsDriftNotMonitored);
    }
    expect(DASHBOARD_STRINGS.ro.opsDriftNotInstrumented)
      .not.toBe(DASHBOARD_STRINGS.en.opsDriftNotInstrumented);
  });
});
