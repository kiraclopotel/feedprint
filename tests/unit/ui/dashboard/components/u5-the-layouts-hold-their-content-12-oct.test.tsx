/** @vitest-environment jsdom */
// The polish program's dashboard U5 (12 Oct 2026, POLISH-BACKLOG-2026-10-12.md, "## Dashboard", rows 8, 24, 32, 33, 60, 61, 69):
// layouts that hold their content, measured on a built copy with an invented record.
// 8. The recurring voices table ran past its card on a 53-character handle; a handle breaks at a dot.
// 24. Feed behavior's cards sit in pairs; an empty one steps down to the end, and its partner took half a row beside a hole.
// 32. The day squares drew a Sunday-to-Saturday week: "5 different days" showed 2 teal squares, and the strip began at a
//     different x on each row.
// 33. How content arrived: the right-hand figures wrapped wherever the 118px column ended.
// 60. Exposure's "Observed again and again" with nothing to show sat half width beside a hole.
// 61. Issues: the explanation sat 20px under its title and 9px above the panel.
// 69. A long handle on the Overview broke inside a word.

import { afterEach, describe, expect, it } from 'vitest';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readSource } from '../../../../helpers/read-source';
import { FeedBehaviorPanels } from '../../../../../src/ui/dashboard/components/FeedBehaviorPanels';
import type { FeedBehaviorModel } from '../../../../../src/ui/dashboard/components/feed-behavior-data';
import { breakableHandle } from '../../../../../src/ui/dashboard/shown-text';
import { I18nProvider } from '../../../../../src/i18n/react';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const src = (f: string) => readSource(`src/ui/dashboard/${f}`);
const t = DASHBOARD_STRINGS.en;

const FILLED: FeedBehaviorModel = {
  contentCount: 60, rangeStart: '2026-10-08', rangeEnd: '2026-10-12', flaggedCount: 18, baseRatePct: 30,
  runs: { length: 3, endAt: '2026-10-12T10:00:00Z' },
  skew: { bigSessions: 2, totalSessions: 4, openFlagged: 1, openTotal: 6, closeFlagged: 3, closeTotal: 6, openPct: 16.7, closePct: 50, lean: 'even' },
  returns: { flagged: 4, total: 9, pct: 44.4 },
  amplification: { high: 5, normal: 20, low: 10, unknown: 0, total: 35 },
  advertiser: { forYou: 3, total: 6 },
  chains: { handoffs: [{ a: 'anger-trigger', b: 'fear-appeal', n: 3, sustained: false }], sustained: [], totalPairs: 20, unnamedPairs: 0 },
  voices: [{ author: '@a.long.handle', platform: 'facebook', days: 3, seen: 5, flagged: 1 }],
  namedSources: 4, cautions: [], predictionClauses: [],
};
const NO_SKEW = { ...FILLED.skew, bigSessions: 0, totalSessions: 0 };
const NO_RUNS = { length: 0, endAt: null };
const NO_RETURNS = { flagged: 0, total: 0, pct: 0 };
const NO_AMP = { high: 0, normal: 0, low: 0, unknown: 0, total: 0 };
const NO_ADV = { forYou: 0, total: 0 };
const NO_CHAINS = { handoffs: [], sustained: [], totalPairs: 0, unnamedPairs: 0 };

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
  await act(async () => { root?.unmount(); });
  host?.remove();
  root = null;
  host = null;
});

async function spansOf(model: FeedBehaviorModel): Promise<Record<string, string>> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(React.createElement(I18nProvider, { lang: 'en', children: React.createElement(FeedBehaviorPanels, { model, lens: 'parent' }) }));
  });
  const out: Record<string, string> = {};
  const titles: Record<string, string> = {
    runs: t.fbRunsTitle, skew: t.fbSkewTitle, returns: t.fbReturnTitle, amp: t.fbAmpTitle, chains: t.fbChainsTitle, voices: t.fbVoicesTitle,
  };
  for (const card of host.querySelectorAll('.fb-grid > .fb-card')) {
    for (const [key, title] of Object.entries(titles)) {
      if ((card.textContent ?? '').includes(title)) out[key] = [...card.classList].find((c) => c.startsWith('span-')) + (card.classList.contains('fb-card-empty') ? ' empty' : '');
    }
  }
  return out;
}

describe('dashboard U5: the layouts hold their content after the walk of 12 Oct 2026', () => {
  it('24: cards that have a partner keep their 7 and 5, 6 and 6, 7 and 5', async () => {
    expect(await spansOf(FILLED)).toEqual({
      runs: 'span-7', skew: 'span-5', returns: 'span-6', amp: 'span-6', chains: 'span-7', voices: 'span-5',
    });
  });

  it('24: a card whose partner is empty takes the whole row, whichever of the pair is the empty one', async () => {
    const a = await spansOf({ ...FILLED, skew: NO_SKEW });
    expect(a.runs).toBe('span-12');
    const b = await spansOf({ ...FILLED, runs: NO_RUNS });
    expect(b.skew).toBe('span-12');
    const c = await spansOf({ ...FILLED, returns: NO_RETURNS });
    expect(c.amp).toBe('span-12');
    const d = await spansOf({ ...FILLED, amplification: NO_AMP, advertiser: NO_ADV });
    expect(d.returns).toBe('span-12');
    const e = await spansOf({ ...FILLED, chains: NO_CHAINS });
    expect(e.voices).toBe('span-12');
    const f = await spansOf({ ...FILLED, voices: [] });
    expect(f.chains).toBe('span-12');
  });

  it('8 and 69: a handle can break after a dot, an underscore or a hyphen, and keeps its own letters', () => {
    const handle = '@the.longest.account_name-anyone.could.pick';
    const drawn = breakableHandle(handle);
    expect(drawn).toContain('.​');
    expect(drawn).toContain('_​');
    expect(drawn).toContain('-​');
    expect(drawn.replace(/​/g, '')).toBe(handle);
    expect(src('components/OverviewTab.tsx')).toContain('{breakableHandle(s.author)}');
    expect(src('components/FeedBehaviorPanels.tsx')).toContain('{breakableHandle(v.author)}');
  });

  it('8: the plain tables let a name break anywhere, so the table stays inside its card', () => {
    expect(src('dashboard-design.css')).toMatch(/table\.fb-plain td:not\(\.num\) \{ overflow-wrap: anywhere; \}/);
  });

  it('32: the day squares are the seven days ending on the newest record, in a strip of one width at the end of its row', () => {
    const tab = src('components/PatternsTab.tsx');
    expect(tab).toContain('d.setDate(d.getDate() - 6 + i);');
    expect(tab).toContain("style={{ display: 'flex', gap: 3, width: 102, flex: 'none' }}");
    expect(tab).toContain("background: active ? 'var(--fw-teal)' : 'var(--fw-line)',");
    // The strip is the last child of both rows that draw it.
    expect(tab).toMatch(/\{t\.patCrossDayLine\(theme\.daysActive, theme\.recordCount\)\}\s*<\/span>\s*<StreakGrid /);
    expect(tab).toMatch(/\{t\.patItems\(theme\.recordCount\)\} · \{t\.patDays\(theme\.daysActive\)\}\s*<\/span>\s*<StreakGrid /);
  });

  it('33: the right-hand figures have a 150px column and the interval its own line', () => {
    expect(src('dashboard-design.css')).toMatch(/\.ov-srv-row \{\n  display: grid; grid-template-columns: 110px 1fr 150px;/);
    expect(src('components/OverviewTab.tsx')).toContain("<span className=\"fr\" style={{ display: 'block', opacity: 0.7 }}>{t.shareInterval(sh.lowerPct, sh.upperPct)}</span>");
  });

  it('60: an empty "Observed again and again" is the one-line row every other empty card is', () => {
    expect(src('components/ExposureView.tsx')).toContain("repeated.length > 0 ? 'stats-card full' : 'stats-card pat-section-empty'");
  });

  it('61: the Issues explanation sits close under its title and clear of the panel', () => {
    const frame = src('dashboard-frame.css');
    expect(frame).toMatch(/\.ops-panel \.ops-title \{[^}]*margin-bottom: 8px !important;/);
    expect(frame).toMatch(/\.ops-allgood \{[^}]*margin-top: 24px;/);
  });
});
