// Source-lock (same idiom as dashboard-load-failed.test.ts): the scoreRoom
// auxiliary Groq call must stay behind the comments-to-analyze-per-video
// toggle (wiring Q3). Before this gate the room read was a paid call with
// no parent-visible switch: its only output is the ENVIRONMENT_LOG chain
// field, and it fired on every successful comment batch.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

const INDEX_PATH = 'src/content/comment-batch/flush.ts';

describe('room-sensor spend gate', () => {
  const source = readSource(INDEX_PATH);

  it('scoreRoom only fires when the analysis-context toggle is on', () => {
    const block = source.match(/const roomSensorOn[\s\S]{0,400}?scoreRoom\(/)?.[0] ?? '';
    expect(block).toContain("isFeatureEnabled(settings, 'comments-to-analyze-per-video', sinkPlatform)");
    expect(block).toContain('roomSensorOn');
    // Exactly one scoreRoom call site in the content entry, and it is the
    // gated one.
    expect(source.match(/scoreRoom\(/g)?.length).toBe(1);
  });
});
