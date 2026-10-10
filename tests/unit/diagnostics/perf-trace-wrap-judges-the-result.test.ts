// A wrapped step that resolves is not always a step that worked: the AI judge resolves to null
// when it got no reading. The tracer takes the caller's judgement of the result, so the sample it
// saves says whether the step produced what it was for.

import { describe, it, expect, afterEach } from 'vitest';
import { __makeActiveTracerForTests, type PerfRecord } from '../../../src/diagnostics/perf-trace';

const sent: PerfRecord[] = [];

function installRuntime(): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      sendMessage: (m: { type: string; payload: PerfRecord }) => {
        if (m.type === 'CAPTURE_PERF_RECORD') sent.push(m.payload);
        return Promise.resolve();
      },
    },
  };
}

afterEach(() => {
  sent.length = 0;
  delete (globalThis as { chrome?: unknown }).chrome;
});

describe('perf-trace wrap takes the caller\'s judgement of the result', () => {
  it('saves success false, with the reason, when the judgement says the result is not a success', async () => {
    installRuntime();
    const tracer = __makeActiveTracerForTests({ platform: 'youtube', mode: 'adult' });
    const out = await tracer.wrap(
      'combined_call',
      async () => null,
      (r) => (r === null ? { success: false, error: 'rate-limit' } : { success: true }),
    );
    expect(out).toBeNull();
    expect(sent).toHaveLength(1);
    expect(sent[0].stage).toBe('combined_call');
    expect(sent[0].success).toBe(false);
    expect(sent[0].error).toBe('rate-limit');
  });

  it('still saves success true for a resolved step when no judgement is given', async () => {
    installRuntime();
    const tracer = __makeActiveTracerForTests({ platform: 'youtube', mode: 'adult' });
    await tracer.wrap('combined_call', async () => 'reading');
    expect(sent).toHaveLength(1);
    expect(sent[0].success).toBe(true);
  });
});
