// Off, the filter product: what its manifest may and may not declare, and
// how the shared modules behave when the product constant says "off".

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { _setProductForTesting, currentProduct, isOffProduct } from '../../../src/product';
import { shouldControlEngagement } from '../../../src/content/engagement/controller';
import {
  FWSettings,
  CURRENT_SETTINGS_SCHEMA_VERSION,
} from '../../../src/storage/settings';
import { adultPreset } from '../../../src/storage/presets';

import { REPO_ROOT as root } from '../../helpers/repo-root';
const off = JSON.parse(readFileSync(resolve(root, 'manifest.off.json'), 'utf8'));
const receipts = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));

describe('manifest.json, the recorder', () => {
  // 2026-09-18, M186. The record lives in IndexedDB at the extension's origin,
  // and without this permission that origin is a best-effort bucket Chrome may
  // evict whole under disk pressure. The way that fails is the worst shape a
  // failure can take here: the database re-opens EMPTY and every read of it
  // succeeds, so the chain restarts at position 0 and the dashboard says the
  // record holds nothing, with no error and no marker, because there is no
  // chain left to write a marker on. This permission is what exempts the origin
  // from eviction, so it is not a nice-to-have and it does not get dropped in a
  // tidy-up. It carries no permission warning to the user on update.
  it('asks for unlimitedStorage, which is what keeps Chrome from evicting the record', () => {
    expect(receipts.permissions).toContain('unlimitedStorage');
  });

  it('asks for nothing beyond the five it needs', () => {
    expect([...receipts.permissions].sort()).toEqual(
      ['alarms', 'downloads', 'downloads.ui', 'storage', 'unlimitedStorage'],
    );
  });
});

describe('manifest.off.json', () => {
  it('holds only the storage permission and no proxy host', () => {
    // Off keeps settings and nothing else, so it needs no exemption from a
    // quota it never approaches; asking for one would be a permission on the
    // install screen with nothing behind it.
    expect(off.permissions).toEqual(['storage']);
    expect(off.host_permissions.some((h: string) => h.includes('api.feelingwise.org'))).toBe(false);
    expect(off.background).toBeUndefined();
  });
  it('excludes every private-message route the recorder excludes', () => {
    const offEx = off.content_scripts[0].exclude_matches;
    for (const cs of receipts.content_scripts) {
      for (const pattern of cs.exclude_matches) expect(offEx).toContain(pattern);
    }
  });
  it('runs one content script and no page-world script', () => {
    expect(off.content_scripts).toHaveLength(1);
    expect(off.content_scripts[0].js).toEqual(['content.js']);
  });
  it('takes its store name from the default locale and fits the store', () => {
    // Since 1.0.2 the name is a __MSG_ key; the English message is what the
    // store shows by default.
    //
    // Until 1.0.10 this test also required "FeelingWise" inside the name. It was dropped on
    // 2026-09-20, not weakened by accident: the listing was measured that day and came up in
    // Chrome Web Store search for no phrase a stranger would type, only for our own brand words.
    // The store prints the publisher name beside the title anyway, so the 75 characters go to what
    // people search. Evidence: the demand study of 21 September 2026 (quieter-feed.md, kept
    // outside this repository). The name's wording is
    // pinned in tests/unit/i18n/store-locales.test.ts, which is where a change to it must be
    // argued.
    expect(off.name).toBe('__MSG_offName__');
    expect(off.default_locale).toBe('en');
    const en = JSON.parse(readFileSync(resolve(root, '_locales', off.default_locale, 'messages.json'), 'utf8'));
    const name = en.offName.message as string;
    expect(name).toMatch(/^Off - /);
    expect(name.length).toBeLessThanOrEqual(75);
  });
});

describe('product constant', () => {
  afterEach(() => _setProductForTesting(null));

  it('defaults to receipts in tests', () => {
    expect(currentProduct()).toBe('receipts');
    expect(isOffProduct()).toBe(false);
  });

  it('the engagement controller always has work in Off (the slur rule), never idles', () => {
    const features = adultPreset();
    for (const key of Object.keys(features)) features[key as keyof typeof features].enabled = false;
    const settings: FWSettings = {
      settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
      mode: 'adult',
      strictLanguage: false, hideUnrewritable: false, aiAnalysisEnabled: true,
      parentPin: '', dailyCap: 5000, monthlyUsdCapOverride: null, locale: 'en',
      outputLanguage: 'auto', uiLanguage: 'auto',
        totalChecksToday: 0, totalNeutralizedToday: 0, totalTokensToday: 0,
      estimatedCostToday: 0, lastResetDate: '',
      totalChecksThisMonth: 0, totalTokensThisMonth: 0, lastResetMonth: '',
      totalTokensAllTime: 0, totalChecksAllTime: 0,
      totalNeutralizedAllTime: 0, estimatedCostAllTime: 0,
      features,
      presets: { appliedAt: '', appliedPreset: 'adult' },
      dashboardTheme: 'dark',
    };
    expect(shouldControlEngagement('twitter', settings)).toBe(false);
    _setProductForTesting('off');
    expect(shouldControlEngagement('twitter', settings)).toBe(true);
  });

  it('a blocked item records nothing until an entry point installs the sink', async () => {
    // Off's separation is structural since 2026-09-16 (PLAN-2026-09-16 item 9.2): the filter hands
    // a blocked item to a sink, Receipts installs one at start-up and Off installs none. With no
    // sink there is no record path to take, whatever product flag says.
    const { recordBlocked, setBlockedRecorder, __resetBlockedRecorderForTest } =
      await import('../../../src/content/engagement/recorder-sink');
    __resetBlockedRecorderForTest();
    expect(() => recordBlocked({} as never)).not.toThrow();

    const sink = vi.fn();
    setBlockedRecorder(sink);
    recordBlocked({} as never);
    expect(sink).toHaveBeenCalledTimes(1);
    __resetBlockedRecorderForTest();
  });

  it("the filter never imports the recorder, and Off's entry installs no sink", async () => {
    const { readFileSync } = await import('node:fs');
    const { repoPath } = await import('../../helpers/repo-root');
    const read = (p: string): string => readFileSync(repoPath(...p.split('/')), 'utf8');
    for (const f of ['ai-content-blocker', 'media-only-ad-blocker', 'media-timeout', 'reels-blocker']) {
      const src = read(`src/content/engagement/${f}.ts`);
      expect(src, f).not.toMatch(/from '\.\.\/(forensics|ai|analysis)\//);
      expect(src, f).toMatch(/from '\.\/recorder-sink'/);
    }
    expect(read('src/products/off/content.ts')).not.toContain('setBlockedRecorder');
    expect(read('src/content/index.ts')).toContain('setBlockedRecorder(');
  });

  it("Off's content script reaches no AI or analysis module through its runtime imports", async () => {
    // The check above reads one hop; a shared helper that sits in a module importing the AI client
    // pulls the client in several hops away, so this walks every runtime import from Off's entry.
    const { existsSync, readFileSync, statSync } = await import('node:fs');
    const { dirname, relative } = await import('node:path');
    const edge = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^'";]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    const seen = new Set(['src/products/off/content.ts']);
    const queue = [...seen];
    while (queue.length) {
      const file = queue.shift()!;
      const src = readFileSync(resolve(root, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"])\/\/.*$/gm, '$1');
      for (const m of src.matchAll(edge)) {
        if (m[1] || (m[2] && /^\{\s*(type\s+\w+\s*(as\s+\w+\s*)?,?\s*)+\}\s+from\s+$/.test(m[2].trim() + ' '))) continue;
        const spec = m[3] ?? m[4];
        if (!spec.startsWith('.')) continue;
        const base = resolve(root, dirname(file), spec);
        const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
          .find((c) => existsSync(c) && statSync(c).isFile());
        if (!hit) continue;
        const rel = relative(root, hit).replace(/\\/g, '/');
        if (!seen.has(rel)) { seen.add(rel); queue.push(rel); }
      }
    }
    expect(seen.size).toBeGreaterThan(20);
    expect([...seen].filter((f) => /^src\/(ai|analysis)\//.test(f))).toEqual([]);
  });
});
