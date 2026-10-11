// The dashboard wears the look the popup's dots choose. Each look on the dashboard is the popup's own ground, text,
// accent and second colour put into the house values (ground, ink, record, noise), so this holds dashboard-looks.css
// equal to popup-looks.css (and, for look A, to tokens.css), checks the pairs the dashboard draws from those four
// colours for contrast, dark and light, and checks that both pages apply the stored look and follow a change. The
// house sheet mixes the card, the muted text and the control edges from ink and ground in oklab, and the looks mix
// their tints in oklch, so each colour here is mixed the way its sheet mixes it, at the share the sheet gives.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { POPUP_LOOKS } from '../../../../src/ui/shared/looks';
import { contrast as ratio, mixOklab as mix, mixOklch, share } from '../../../helpers/colour-mix';

const DASH_LOOKS = readSource('src/ui/dashboard/dashboard-looks.css');
const POPUP_LOOKS_CSS = readSource('src/ui/popup/popup-looks.css');
const TOKENS = readSource('src/ui/shared/tokens.css');
const HOUSE = readSource('src/ui/dashboard/dashboard-house.css');

function block(css: string, start: RegExp): Record<string, string> {
  const m = start.exec(css);
  if (!m) throw new Error(`block not found: ${start}`);
  const from = m.index + m[0].length;
  const body = css.slice(from, css.indexOf('}', from));
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[d[1]] = d[2].toLowerCase();
  return out;
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const dashStart = (look: string, mode: 'dark' | 'light') => {
  const who = look === 'a' ? ':root:not([data-look])' : `:root[data-look="${look}"]`;
  return new RegExp(esc(`${who}${mode === 'dark' ? ':not([data-theme="light"])' : '[data-theme="light"]'} {`));
};
const popupStart = (look: string, mode: 'dark' | 'light') =>
  new RegExp(esc(`:root[data-look="${look}"]${mode === 'dark' ? ':not([data-theme="light"])' : '[data-theme="light"]'} {`));

/** The popup's colours for a look: A draws the base tokens, the others their own block. */
function popupColours(look: string, mode: 'dark' | 'light'): Record<string, string> {
  if (look !== 'a') return block(POPUP_LOOKS_CSS, popupStart(look, mode));
  const dark = block(TOKENS, /^:root \{/m);
  return mode === 'dark' ? dark : { ...dark, ...block(TOKENS, /:root\[data-theme="light"\] \{/) };
}

// The state colours the dashboard prints verdicts in, per mode, as the house sheet sets them.
const STATE = {
  dark: block(HOUSE, /:root\[data-theme="dark"\]\s+\{(?= --fw-ok)/),
  light: block(HOUSE, /:root\[data-theme="light"\] \{(?= --fw-ok)/),
};

// The shares the looks give their tints, read from the sheet so the table follows any change to them.
const VIVID = (mode: 'dark' | 'light') => new RegExp(
  esc(mode === 'dark' ? ':root[data-look="d"] .dash-header,' : ':root[data-look="d"][data-theme="light"] .dash-header,')
  + String.raw`[^{]*\{\s*background: linear-gradient\(120deg,\s*color-mix\(in oklch, var\(--fw-record\) (\d+)%, var\(--fw-ground\)\) 0%,\s*color-mix\(in oklch, var\(--fw-noise\) (\d+)%`);
const TINT = {
  header: share(DASH_LOOKS, /^\.dash-header \{ background: linear-gradient\(180deg, color-mix\(in oklch, var\(--fw-record\) (\d+)%, var\(--fw-ground\)\)/m),
  feedLogHead: share(DASH_LOOKS, /^\.fl-row-head, \.fl-row-head:hover \{ background: color-mix\(in oklch, var\(--fw-record\) (\d+)%, var\(--fw-ground\)\)/m),
  entriesChip: share(DASH_LOOKS, /^\.pg-records-chip \{ border-color: var\(--fw-record\); background: color-mix\(in oklch, var\(--fw-record\) (\d+)%, var\(--fw-ground\)\)/m),
  chipHover: share(DASH_LOOKS, /^\.chip\.active:hover \{ background: color-mix\(in oklch, var\(--fw-record\) (\d+)%, var\(--fw-ink\)\)/m),
  tabHover: share(DASH_LOOKS, /^\.dash-tab:hover, \.dash-tab:focus-visible \{ color: var\(--fw-record\); background: color-mix\(in oklch, var\(--fw-record\) (\d+)%, var\(--fw-ground\)\)/m),
};

describe('the dashboard wears the look the popup chooses', () => {
  it('both pages apply the stored look before the first paint, and follow a change made in the other', () => {
    const dashboard = readSource('src/ui/dashboard/Dashboard.tsx');
    expect(dashboard).toMatch(/^import \{ eagerApplyStoredLook, followStoredLook \} from '\.\.\/shared\/looks';$/m);
    expect(dashboard).toMatch(/^eagerApplyStoredLook\(\);$/m);
    expect(dashboard).toMatch(/^followStoredLook\(\);$/m);
    expect(dashboard).toMatch(/^import '\.\/dashboard-looks\.css';$/m);
    const popup = readSource('src/ui/popup/Popup.tsx');
    expect(popup).toMatch(/^eagerApplyStoredLook\(\);$/m);
    expect(popup).toMatch(/if \(changes\.popupLook\) applyLook\(changes\.popupLook\.newValue\);/);
  });

  for (const look of POPUP_LOOKS) {
    for (const mode of ['dark', 'light'] as const) {
      it(`look ${look}, ${mode}: the popup's colours, and every pair clears 4.5:1 for text and 3:1 for an edge`, () => {
        const own = block(DASH_LOOKS, dashStart(look, mode));
        const pop = popupColours(look, mode);
        expect(own).toEqual({ '--fw-ground': pop['--fw-bg'], '--fw-ink': pop['--fw-text'], '--fw-record': pop['--fw-teal'], '--fw-noise': pop['--fw-purple'] });

        const ground = own['--fw-ground'], ink = own['--fw-ink'];
        const t: Record<string, string> = {
          ground, ink, record: own['--fw-record'], noise: own['--fw-noise'],
          card: mix(ink, 0.05, ground), muted: mix(ink, 0.66, ground), edge: mix(ink, 0.48, ground),
          ok: STATE[mode]['--fw-ok'], warn: STATE[mode]['--fw-warn'], danger: STATE[mode]['--fw-danger'],
        };
        const text: Array<[string, string]> = [
          ['ink', 'ground'], ['ink', 'card'], ['muted', 'ground'], ['muted', 'card'], ['ground', 'ink'], ['ground', 'record'],
          ['record', 'ground'], ['record', 'card'], ['noise', 'ground'], ['noise', 'card'],
          ['ok', 'card'], ['warn', 'card'], ['danger', 'card'],
        ];
        const fails: string[] = [];
        for (const [fg, bg] of text) if (ratio(t[fg], t[bg]) < 4.5) fails.push(`${fg} on ${bg} ${ratio(t[fg], t[bg]).toFixed(2)}`);
        if (ratio(t.edge, t.card) < 3) fails.push(`edge against card ${ratio(t.edge, t.card).toFixed(2)}`);
        expect(fails).toEqual([]);
      });

      it(`look ${look}, ${mode}: the text on each tint the look adds clears 4.5:1, and the bars 3:1`, () => {
        const own = block(DASH_LOOKS, dashStart(look, mode));
        const ground = own['--fw-ground'], ink = own['--fw-ink'], record = own['--fw-record'], noise = own['--fw-noise'];
        const card = mix(ink, 0.05, ground), muted = mix(ink, 0.66, ground), activeRow = mix(ink, 0.09, ground);
        // The header's stops: A, B and C fade the accent into the page; D and E run from the accent through the
        // second colour into the page.
        const vivid = look === 'd' || look === 'e';
        const stops = vivid
          ? [mixOklch(record, share(DASH_LOOKS, VIVID(mode), 1), ground), mixOklch(noise, share(DASH_LOOKS, VIVID(mode), 2), ground), ground]
          : [mixOklch(record, TINT.header, ground), ground];
        const feedLogHead = mixOklch(record, TINT.feedLogHead, ground);
        const entriesChip = mixOklch(record, TINT.entriesChip, ground);
        const tabHover = mixOklch(record, TINT.tabHover, ground);
        const text: Array<[string, string, string]> = [
          ...stops.flatMap((stop, i): Array<[string, string, string]> => [[`ink on header stop ${i}`, ink, stop], [`muted on header stop ${i}`, muted, stop]]),
          ['ink on the Feed log head', ink, feedLogHead], ['muted on the Feed log head', muted, feedLogHead],
          ['the count on the Entries chip', record, entriesChip], ['the label on the Entries chip', muted, entriesChip],
          ['ground on a chosen chip under the pointer', ground, mixOklch(record, TINT.chipHover, ink)],
          ['a tab name under the pointer or the keyboard', record, tabHover],
        ];
        const fills: Array<[string, string, string]> = [
          ['a bar on its track', record, card], ['the chosen bar on its track', noise, card], ['the chosen bar on its row', noise, activeRow],
          ['the keyboard ring on a tab', record, tabHover],
        ];
        const fails: string[] = [];
        for (const [what, fg, bg] of text) if (ratio(fg, bg) < 4.5) fails.push(`${what} ${ratio(fg, bg).toFixed(2)}`);
        for (const [what, fg, bg] of fills) if (ratio(fg, bg) < 3) fails.push(`${what} ${ratio(fg, bg).toFixed(2)}`);
        expect(fails).toEqual([]);
      });
    }
  }

  it('no look sets a state colour', () => {
    expect(DASH_LOOKS).not.toMatch(/--fw-(ok|warn|danger|red|amber|green)(-soft)?\s*:/);
  });
});
