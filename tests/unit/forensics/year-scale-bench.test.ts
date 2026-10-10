// Queue item 11 — year-scale record performance, the MEASUREMENT half.
//
// Benchmarks the pure aggregation layer (everything the dashboard computes
// per load) over a synthetic 100k-record year. Pure JS timing in Node is a
// valid proxy for the same functions in the dashboard page; what it CANNOT
// measure is the IndexedDB read itself (store.getRecords()'s getAll()) —
// fake-indexeddb timing says nothing about Chrome. That half needs a live
// machine once a real chain approaches this size.
//
// Bounds are deliberately LOOSE (CI-safe); the value is the reported
// timings in the test output, which the queue item records.

import { describe, it, expect } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import type { AuthorProfile } from '../../../src/forensics/author-store';
import {
  computeExposureTimeline,
  computeAmplificationTrend,
  computeAuthorEscalation,
} from '../../../src/forensics/analytics';
import {
  computeExposureSkew,
  computePeriodicity,
  computeRuns,
} from '../../../src/forensics/sequence';
import { buildThemes } from '../../../src/forensics/topics';

const N = 100_000;
const PLATFORMS = ['tiktok', 'instagram', 'twitter', 'facebook', 'youtube'];
const TECHNIQUES = ['anger-trigger', 'fear-appeal', 'fomo', 'shame-attack', 'misleading-format'];
const TEXTS = [
  'alegeri candidat campanie vot primar consiliu local astazi',
  'reteta ciorba legume gatit bucatarie aroma traditionala buna',
  'fotbal meci echipa gol campionat stadion suporteri fantastic',
  'telefon nou baterie ecran aplicatie update model lansare',
  'vacanta mare plaja soare munte drumetie peisaj superb',
  'breaking news shocking truth they hide from everyone now',
  'miracle diet burns fat instantly doctors hate this trick',
  'gaming stream highlights ranked clutch play insane reaction',
];

function buildYear(): ForensicRecord[] {
  const records: ForensicRecord[] = [];
  const start = Date.UTC(2025, 5, 1);
  for (let i = 0; i < N; i++) {
    const flagged = i % 5 === 0;
    records.push({
      id: `r${i}`,
      timestamp: new Date(start + i * ((365 * 86_400_000) / N)).toISOString(),
      platform: PLATFORMS[i % PLATFORMS.length],
      originalText: `${TEXTS[i % TEXTS.length]} varianta ${i % 977}`,
      author: `author${i % 500}`,
      verdict: flagged ? 'flagged' : 'pass',
      techniques: flagged
        ? [{ name: TECHNIQUES[i % TECHNIQUES.length], severity: (i % 6) + 4, confidence: 0.9 }]
        : [],
      postUrl: `https://example.com/p/${i % 3000}`,
      neutralizedText: '',
      overallScore: flagged ? (i % 6) + 4 : 0,
    } as unknown as ForensicRecord);
  }
  return records;
}

function buildYearProfiles(): AuthorProfile[] {
  const totalSeen = N / 500;
  return Array.from({ length: 500 }, (_, i) => {
    const handle = `author${i}`;
    const platform = PLATFORMS[i % PLATFORMS.length];
    const allFlagged = i % 5 === 0;
    const techniques: Record<string, number> = allFlagged ? { 'anger-trigger': totalSeen } : {};
    return {
      profileKey: `${handle}@${platform}`,
      handle,
      platform,
      totalSeen,
      totalFlagged: allFlagged ? totalSeen : 0,
      techniques,
      firstSeen: '2025-06-01T00:00:00.000Z',
      lastSeen: '2026-05-31T23:59:59.999Z',
    };
  });
}

describe('year-scale aggregation benchmark (100k records)', () => {
  it('every dashboard aggregation stays inside the interactive budget', async () => {
    const records = buildYear();
    const profiles = buildYearProfiles();
    const timings: Record<string, number> = {};
    const time = (label: string, fn: () => unknown) => {
      const t0 = performance.now();
      fn();
      timings[label] = Math.round(performance.now() - t0);
    };

    time('computeExposureTimeline(week)', () => computeExposureTimeline(records, { bucket: 'week' }));
    time('computeAmplificationTrend', () => computeAmplificationTrend(records));
    time('computeAuthorEscalation', () => computeAuthorEscalation(records, profiles));
    time('computeExposureSkew', () => computeExposureSkew(records));
    time('computePeriodicity', () => computePeriodicity(records));
    time('computeRuns', () => computeRuns(records));

    const t0 = performance.now();
    const { themes } = await buildThemes(records);
    timings['buildThemes (Patterns)'] = Math.round(performance.now() - t0);
    expect(themes.length).toBeGreaterThan(0);

    // The honest record: print the measured profile so the queue item can
    // cite real numbers instead of guesses (stdout — vitest swallows console.log).
    process.stdout.write(`[year-scale 100k] ms per aggregation: ${JSON.stringify(timings)}\n`);

    for (const [label, ms] of Object.entries(timings)) {
      // Loose CI bound: any single aggregation past 10s at 100k means the
      // dashboard needs pagination/worker work BEFORE chains reach a year.
      expect(ms, label).toBeLessThan(10_000);
    }
  }, 60_000);
});
