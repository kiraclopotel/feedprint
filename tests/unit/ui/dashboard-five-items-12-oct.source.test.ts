// The dashboard's five items of 12 Oct 2026 (the Leader's 20:1x calls on the Tester's notes, tester/READ-32d02098.md),
// measured in a built dist at 1280x800, dark and light (crew/visuals/df-before, df-after; the probe dash-seed.mjs FIVE=1).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { TECHNIQUE_COLORS, techniqueFill } from '../../../src/ui/dashboard/components/color-maps';

const src = (f: string) => readFileSync(new URL(`../../../src/${f}`, import.meta.url), 'utf8');

describe('the dashboard’s five items', () => {
  it('1: "Rushing you" leaves the flagged amber: Yellow 400 everywhere its colour is written', () => {
    expect(TECHNIQUE_COLORS['false-urgency']).toBe('#ffee58');
    expect(src('ui/shared/tokens.css')).toContain('--fw-tech-false-urgency:      #ffee58;');
    expect(src('ui/dashboard/dashboard-house.css')).toContain('--fw-tech-false-urgency: #ffee58;');
  });

  it('2: the five named techniques take a light value of the same hue, and the charts read it', () => {
    const house = src('ui/dashboard/dashboard-house.css');
    const light = ':root[data-theme="light"] { --fw-tech-anger-trigger: #e64a48; --fw-tech-fear-appeal: #6f74ef; --fw-tech-false-urgency: #678811; --fw-tech-scapegoating: #e93d78; }';
    expect(house).toContain(light);
    expect(house).toContain(':root:not([data-theme]) { --fw-tech-anger-trigger: #e64a48;');
    expect(techniqueFill('false-urgency')).toBe('var(--fw-tech-false-urgency, #ffee58)');
    expect(techniqueFill('shame-attack')).toBe('var(--fw-tech-shame-attack, #ab47bc)');
    expect(techniqueFill('bandwagon')).toBe(TECHNIQUE_COLORS['bandwagon']);
    expect(src('ui/dashboard/components/ExposureView.tsx')).toContain('color={techniqueFill(name) ?? TONE.ink}');
    expect(src('ui/dashboard/components/StatisticsTab.tsx').match(/color=\{techniqueFill\(name\) \?\? TONE\.ink\}/g)?.length).toBe(2);
  });

  it('3: a column tip stays inside the plot, over the bar while it fits, the end tips at the edges', () => {
    expect(src('ui/dashboard/components/chart-kit.tsx')).toContain("style={{ ['--bar']: `${c.parts.reduce((s, p) => s + p.h, 0)");
    const css = src('ui/dashboard/dashboard-design.css');
    expect(css).toContain('position: absolute; bottom: min(calc(var(--bar, 0px) + 6px), calc(100% - 25px)); left: 50%; transform: translateX(-50%);');
    expect(css).toContain('.fwc-col[data-tip]:first-child:hover::after, .fwc-col[data-tip]:first-child:focus-visible::after { left: 0; transform: none; }');
    expect(css).not.toContain('position: absolute; bottom: calc(100% + 6px); left: 50%;');
  });

  it('4: the log’s Hidden pill is the noise violet for a blocked item and the harm red for a harmful one', () => {
    expect(src('ui/dashboard/components/FeedLogTab.tsx')).toContain("(action === 'hidden' && feedActionKeyFor(r) === 'blocked' ? 'blocked' : PILL_CLASS[action])");
  });

  it('5: the legend under the period total names each family, as "What Feedprint did" does', () => {
    const x = src('ui/dashboard/components/ExposureView.tsx');
    expect(x).toContain('items={ACTION_ROWS.some((row) => families[row.key] > 0)');
    expect(x).not.toContain("{ color: TONE.flagged, strong: flaggedCount, label: t.expoActionLabels['detection'] },");
  });
});
