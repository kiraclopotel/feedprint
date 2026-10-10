// Evidence-gap register item 20, part 2 (2026-09-06): accounts the recorder
// skips. The list lives in storage, the worker consults it at the one point
// every retained record passes, and the heartbeat carries the count of skips
// without naming anyone. This file pins the key, the list's idempotence, the
// match, the payload reader, the counter's take-and-reset, and the wiring.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  addExclusion,
  excludableAuthor,
  exclusionKey,
  isExcludedAuthor,
  noteExcludedSkip,
  readExclusions,
  removeExclusion,
  peekExcludedSkipped,
  consumeExcludedSkipped,
} from '../../../src/forensics/author-exclusions';
import { heartbeatText } from '../../../src/forensics/heartbeat';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const g = globalThis as unknown as { chrome?: unknown };

describe('author exclusions', () => {
  let saved: unknown;
  let store: Record<string, unknown>;
  beforeEach(() => {
    store = {};
    saved = g.chrome;
    g.chrome = {
      storage: {
        local: {
          get: async (key: string) => ({ [key]: store[key] }),
          set: async (v: Record<string, unknown>) => { Object.assign(store, v); },
        },
      },
    };
  });
  afterEach(() => { g.chrome = saved; });

  it('one key per account: platform, lower-cased handle, no leading @', () => {
    expect(exclusionKey('twitter', ' @SomeOne ')).toBe('twitter:someone');
    expect(exclusionKey('facebook', 'Ana Popescu')).toBe('facebook:ana popescu');
  });

  it('adds once, matches by key, removes', async () => {
    expect(await readExclusions()).toEqual([]);
    const a = await addExclusion('twitter', '@SomeOne', 'their parent asked');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ key: 'twitter:someone', platform: 'twitter', author: '@SomeOne', reason: 'their parent asked' });
    expect(await addExclusion('twitter', 'someone', '')).toHaveLength(1);
    expect(await addExclusion('twitter', '   ', '')).toHaveLength(1);
    const b = await addExclusion('tiktok', 'other', 'x'.repeat(300));
    expect(b).toHaveLength(2);
    expect(b[1].reason).toHaveLength(200);
    expect(isExcludedAuthor(b, 'twitter', 'SOMEONE')).toBe(true);
    expect(isExcludedAuthor(b, 'facebook', 'someone')).toBe(false);
    expect(isExcludedAuthor(b, 'twitter', undefined)).toBe(false);
    const c = await removeExclusion('twitter:someone');
    expect(c.map(e => e.key)).toEqual(['tiktok:other']);
    expect(await readExclusions()).toHaveLength(1);
  });

  it('reads the author a delivery names: the item author, or the room author for a room summary', () => {
    expect(excludableAuthor('FORENSIC_LOG', { platform: 'twitter', author: '@a' })).toEqual({ platform: 'twitter', author: '@a' });
    expect(excludableAuthor('PASS_LOG', { platform: 'twitter', author: '' })).toBeUndefined();
    expect(excludableAuthor('ENVIRONMENT_LOG', { platform: 'tiktok', roomAuthor: '@host', author: 'ignored' })).toEqual({ platform: 'tiktok', author: '@host' });
    expect(excludableAuthor('GAP_LOG', { reason: 'x' })).toBeUndefined();
    expect(excludableAuthor('FORENSIC_LOG', null)).toBeUndefined();
  });

  it('counts skips and hands them to the heartbeat once', async () => {
    expect(await peekExcludedSkipped()).toBe(0);
    await noteExcludedSkip();
    await noteExcludedSkip();
    expect(await peekExcludedSkipped()).toBe(2);
    await consumeExcludedSkipped(2);
    expect(await peekExcludedSkipped()).toBe(0);
  });

  it('a skip counted while the marker was being written is carried, not lost', async () => {
    await noteExcludedSkip();
    await noteExcludedSkip();
    const carried = await peekExcludedSkipped();   // the heartbeat states 2
    await noteExcludedSkip();                      // a third skip lands mid-write
    await consumeExcludedSkipped(carried);
    expect(await peekExcludedSkipped()).toBe(1);   // the next heartbeat states it
  });

  it('a peek that is never consumed leaves the count for the next heartbeat', async () => {
    await noteExcludedSkip();
    expect(await peekExcludedSkipped()).toBe(1);
    expect(await peekExcludedSkipped()).toBe(1);
  });
});

describe('the heartbeat carries the count without a name', () => {
  it('excludedSkipped is in the hashed line', () => {
    const line = heartbeatText({ fromISO: 'a', toISO: 'b', platformsOpen: [], positionsSince: 0, canaryWarnings: {}, skippedExcluded: 3 }, 't', false);
    expect(line).toContain(' excludedSkipped=3');
    expect(line).not.toMatch(/author=|handle=/);
  });
});

describe('wiring (source lock)', () => {
  it('the worker drops an excluded delivery before it is enqueued and counts it; the heartbeat takes the count', () => {
    const sw = read('src/background/service-worker.ts');
    expect(sw).toContain('const excluded = excludableAuthor(type, payload);');
    expect(sw).toContain("sendResponse({ ok: true, deliveryId, state: 'skipped-excluded' });");
    expect(sw.indexOf('const excluded = excludableAuthor(type, payload);')).toBeLessThan(sw.indexOf('sharedChainWriteLock(() => enqueueForensicDelivery('));
    expect(sw).toContain('changes[EXCLUSIONS_KEY]');
    const hb = read('src/background/heartbeat.ts');
    expect(hb).toContain('peekExcludedSkipped()');
    // The count is retired only after the marker that states it is on the chain.
    expect(hb.indexOf('await appendHeartbeatMarker(')).toBeLessThan(hb.indexOf('consumeExcludedSkipped('));
  });

  it('the Feed log offers the skip on a content row and the Record tab lists the accounts with a remove', () => {
    // The rows moved from the Record tab to the Feed log on 10 Oct 2026; the list of skipped accounts stayed.
    expect(read('src/ui/dashboard/components/FeedLogTab.tsx')).toContain('addExclusion(r.platform, r.author');
    const tab = read('src/ui/dashboard/components/ForensicsTab.tsx');
    expect(tab).toContain('removeExclusion(e.key)');
    expect(tab).toContain('t.exclusionsTitle');
    for (const [locale, s] of Object.entries(DASHBOARD_STRINGS)) {
      for (const k of ['excludeBtn', 'excludeDone', 'exclusionsTitle', 'exclusionsSub', 'exclusionsNone', 'exclusionRemove'] as const) {
        expect((s as unknown as Record<string, unknown>)[k], `${locale}.${k}`).toBeTypeOf('string');
      }
    }
  });
});

describe('a name written with and without its diacritics', () => {
  // Measured 2026-09-17. A household that excluded "Serban" went on recording
  // every post by "Șerban", and the other way round, which is how a Romanian
  // name is written half the time. Facebook and TikTok authors are display
  // names, so this is the ordinary case, not an edge one.
  const list = [
    { key: exclusionKey('facebook', 'Șerban Popescu'), platform: 'facebook', author: 'Șerban Popescu', addedAt: '2026-09-17T10:00:00.000Z', reason: 'asked me to' },
  ];

  it('matches the same person written without them', () => {
    expect(isExcludedAuthor(list, 'facebook', 'Serban Popescu')).toBe(true);
  });

  it('matches an entry stored without them against a page that has them', () => {
    const plain = [
      { key: exclusionKey('tiktok', 'ana lacatus'), platform: 'tiktok', author: 'ana lacatus', addedAt: '2026-09-17T10:00:00.000Z', reason: '' },
    ];
    expect(isExcludedAuthor(plain, 'tiktok', 'Ana Lăcătuș')).toBe(true);
  });

  it('still keeps two handles that differ by punctuation apart', () => {
    // On X these are two different accounts, and excluding one must never take
    // out the other's record.
    const handles = [
      { key: exclusionKey('twitter', '@sam_q'), platform: 'twitter', author: '@sam_q', addedAt: '2026-09-17T10:00:00.000Z', reason: '' },
    ];
    expect(isExcludedAuthor(handles, 'twitter', '@sam-q')).toBe(false);
    expect(isExcludedAuthor(handles, 'twitter', '@sam_q')).toBe(true);
  });

  it('still keeps the platforms apart', () => {
    expect(isExcludedAuthor(list, 'twitter', 'Serban Popescu')).toBe(false);
  });
});
