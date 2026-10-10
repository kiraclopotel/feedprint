// L7 + F48. Whatever sits on a teal fill is drawn in the on-accent colour, and the switch rules L2 and L5 set stay set.
//
// L2 and L5 changed the switches' colours and checked them on built packages in a browser; they added no test to the suite, so a
// later CSS edit to a switch could land unseen. This one reads tokens.css and popup-design.css as text and settles the cascade for
// the switch parts itself (no browser): for Receipts' `.toggle` and Off's `.fw-off .toggle`, in the dark theme, the light theme and
// the system-light fallback, it works out the on track, the off track, the knob and the locked padlock from the rules and the
// tokens, then holds each part against the track it sits on at 3:1 (a control's parts need that; STANDARD C, the Accent role).
// Before L7 the on knob was #f0f0f0 on the teal track in Receipts (2.02:1) and #fff in Off (2.30:1) in the dark theme.
//
// The cascade here is small on purpose: classes, attributes, :root, :not([attr]), descendant selectors, pseudo-elements,
// specificity, source order and !important, which is all the switch rules use. A selector it cannot read (a child combinator,
// :hover) is treated as not matching, so it can only make a part look less styled, never more.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';

const POPUP_CSS = readSource('src/ui/popup/popup-design.css');
const TOKENS_CSS = readSource('src/ui/shared/tokens.css');

// ─── a small CSS reader ───
interface Rule { selectors: string[]; decls: Record<string, string>; order: number; media: string | null }

function parseDecls(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  let depth = 0; let cur = '';
  const parts: string[] = [];
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  for (const p of parts) {
    const i = p.indexOf(':');
    if (i < 0) continue;
    const name = p.slice(0, i).trim();
    const value = p.slice(i + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

function parseCss(text: string): Rule[] {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let order = 0;
  const walk = (s: string, media: string | null): void => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const head = s.slice(i, open).trim();
      let depth = 1; let j = open + 1;
      while (depth > 0 && j < s.length) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (head.startsWith('@media')) walk(body, head.replace(/\s+/g, ' '));
      else if (!head.startsWith('@')) rules.push({ selectors: head.split(',').map(x => x.trim()).filter(Boolean), decls: parseDecls(body), order: order++, media });
      i = j;
    }
  };
  walk(src, null);
  return rules;
}

// ─── selector matching ───
interface El { root?: boolean; attrs: Record<string, string | undefined>; classes: string[] }
interface Compound { root: boolean; classes: string[]; attrs: Array<[string, string]>; notAttr: string[]; pseudoEl: string | null; unreadable: boolean; tag: string | null }

function compound(src: string): Compound {
  const c: Compound = { root: false, classes: [], attrs: [], notAttr: [], pseudoEl: null, unreadable: false, tag: null };
  let rest = src;
  const take = (re: RegExp, f: (m: RegExpMatchArray) => void): boolean => {
    const m = rest.match(re);
    if (!m) return false;
    f(m); rest = rest.slice(m[0].length); return true;
  };
  take(/^[a-zA-Z][a-zA-Z0-9-]*/, m => { c.tag = m[0]; });
  while (rest.length) {
    if (take(/^::(after|before)/, m => { c.pseudoEl = m[1]; })) continue;
    if (take(/^:root/, () => { c.root = true; })) continue;
    if (take(/^:not\(\[([a-z-]+)\]\)/, m => { c.notAttr.push(m[1]); })) continue;
    if (take(/^\.([a-zA-Z0-9_-]+)/, m => { c.classes.push(m[1]); })) continue;
    if (take(/^\[([a-z-]+)="([^"]*)"\]/, m => { c.attrs.push([m[1], m[2]]); })) continue;
    c.unreadable = true; break;
  }
  return c;
}

function specificity(cs: Compound[]): [number, number, number] {
  let b = 0; let c = 0;
  for (const x of cs) {
    b += x.classes.length + x.attrs.length + x.notAttr.length + (x.root ? 1 : 0);
    c += (x.tag ? 1 : 0) + (x.pseudoEl ? 1 : 0);
  }
  return [0, b, c];
}

function matchesEl(c: Compound, el: El): boolean {
  if (c.unreadable) return false;
  if (c.tag && c.tag !== 'html' && !el.root) return false;
  if (c.root && !el.root) return false;
  for (const k of c.classes) if (!el.classes.includes(k)) return false;
  for (const [a, v] of c.attrs) if (el.attrs[a] !== v) return false;
  for (const a of c.notAttr) if (el.attrs[a] !== undefined) return false;
  return true;
}

/** `chain` runs from <html> to the element; the last compound must match the element, earlier ones some ancestor, in order. */
function selectorMatches(selector: string, chain: El[], pseudoEl: string | null): { ok: boolean; spec: [number, number, number] } {
  if (/[>+~]/.test(selector.replace(/\[[^\]]*\]|\([^)]*\)/g, ''))) return { ok: false, spec: [0, 0, 0] };
  const cs = selector.split(/\s+/).map(compound);
  const last = cs[cs.length - 1];
  if ((last.pseudoEl ?? null) !== pseudoEl) return { ok: false, spec: [0, 0, 0] };
  if (!matchesEl(last, chain[chain.length - 1])) return { ok: false, spec: [0, 0, 0] };
  let at = chain.length - 2;
  for (let i = cs.length - 2; i >= 0; i--) {
    while (at >= 0 && !matchesEl(cs[i], chain[at])) at--;
    if (at < 0) return { ok: false, spec: [0, 0, 0] };
    at--;
  }
  return { ok: true, spec: specificity(cs) };
}

type Form = 'dark' | 'light' | 'system-light';

function applies(rule: Rule, form: Form): boolean {
  if (rule.media === null) return true;
  if (/^@media \(prefers-color-scheme: light\)$/.test(rule.media)) return form === 'system-light';
  return false; // reduced motion and the like: not a colour
}

function cascade(rules: Rule[], form: Form, chain: El[], pseudoEl: string | null, prop: string): string | null {
  const hits: Array<{ imp: boolean; spec: [number, number, number]; order: number; value: string }> = [];
  for (const r of rules) {
    if (!applies(r, form)) continue;
    let v = r.decls[prop];
    // the `border` shorthand sets the border colour too (the base padlock shackle is written that way)
    if (v === undefined && prop === 'border-color' && r.decls.border !== undefined) {
      const m = r.decls.border.match(/^\d+px\s+solid\s+(.+?)(\s*!important)?$/);
      if (m) v = m[1];
    }
    if (v === undefined) continue;
    for (const sel of r.selectors) {
      const m = selectorMatches(sel, chain, pseudoEl);
      if (m.ok) hits.push({ imp: /!important\s*$/.test(v), spec: m.spec, order: r.order, value: v.replace(/\s*!important\s*$/, '') });
    }
  }
  hits.sort((a, b) => (Number(a.imp) - Number(b.imp)) || (a.spec[0] - b.spec[0]) || (a.spec[1] - b.spec[1]) || (a.spec[2] - b.spec[2]) || (a.order - b.order));
  return hits.length ? hits[hits.length - 1].value : null;
}

// ─── tokens and colours ───
function tokenMap(form: Form): Record<string, string> {
  const rules = parseCss(TOKENS_CSS);
  const pick = (selector: string, media: string | null): Record<string, string> => {
    const r = rules.find(x => x.selectors.includes(selector) && x.media === media);
    expect(r, `tokens.css has ${selector}${media ? ' under ' + media : ''}`).toBeTruthy();
    return (r as Rule).decls;
  };
  const base = pick(':root', null);
  if (form === 'dark') return { ...base, ...pick(':root[data-theme="dark"]', null) };
  if (form === 'light') return { ...base, ...pick(':root[data-theme="light"]', null) };
  return { ...base, ...pick(':root:not([data-theme])', '@media (prefers-color-scheme: light)') };
}

type Rgb = [number, number, number];

function colour(value: string, tokens: Record<string, string>): Rgb {
  const v = value.trim();
  let m = v.match(/^var\((--[a-z0-9-]+)\)$/);
  if (m) { expect(tokens[m[1]], `${m[1]} is defined in this theme form`).toBeTruthy(); return colour(tokens[m[1]], tokens); }
  m = v.match(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as Rgb;
  }
  m = v.match(/^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/);
  if (m) {
    const a = colour(m[1], tokens); const b = colour(m[3], tokens); const p = Number(m[2]) / 100;
    return [0, 1, 2].map(i => a[i] * p + b[i] * (1 - p)) as Rgb;
  }
  throw new Error(`cannot read the colour "${v}"`);
}

const lin = (c: number): number => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (c: Rgb): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a: Rgb, b: Rgb): number => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ─── the switch parts ───
const RULES = parseCss(POPUP_CSS);
const FORMS: Form[] = ['dark', 'light', 'system-light'];
const PRODUCTS: Array<[string, string[]]> = [['Receipts', []], ['Off', ['fw-off']]];

function chainFor(form: Form, wrapper: string[], state: string[]): El[] {
  const html: El = { root: true, attrs: { 'data-theme': form === 'dark' ? 'dark' : form === 'light' ? 'light' : undefined }, classes: [] };
  return [html, ...wrapper.map(c => ({ attrs: {}, classes: [c] })), { attrs: {}, classes: ['toggle', ...state] }];
}

function part(form: Form, wrapper: string[], state: string[], pseudo: string | null, prop: string): Rgb {
  const raw = cascade(RULES, form, chainFor(form, wrapper, state), pseudo, prop);
  expect(raw, `a ${prop} for ${pseudo ?? 'the track'} of .toggle.${state.join('.')}${wrapper.length ? ' under .' + wrapper.join('.') : ''} (${form})`).not.toBeNull();
  return colour(raw as string, tokenMap(form));
}

describe('the switch parts can be seen on their track, in both products and every theme form', () => {
  for (const [product, wrapper] of PRODUCTS) {
    for (const form of FORMS) {
      const at = `${product}, ${form}`;

      it(`${at}: the on knob is at least 3:1 against the on track`, () => {
        const track = part(form, wrapper, ['on'], null, 'background');
        const knob = part(form, wrapper, ['on'], 'after', 'background');
        expect(ratio(knob, track), `${at}: knob ${knob.map(Math.round)} on track ${track.map(Math.round)}`).toBeGreaterThanOrEqual(3);
      });

      it(`${at}: the off knob is at least 3:1 against the off track`, () => {
        const track = part(form, wrapper, ['off'], null, 'background');
        const knob = part(form, wrapper, ['off'], 'after', 'background');
        expect(ratio(knob, track), `${at}: knob ${knob.map(Math.round)} on track ${track.map(Math.round)}`).toBeGreaterThanOrEqual(3);
      });

      it(`${at}: the padlock on a locked-on switch (its body and its shackle) is at least 3:1 against the track`, () => {
        const state = ['on', 'locked-on'];
        const track = part(form, wrapper, state, null, 'background');
        const body = part(form, wrapper, state, 'after', 'background');
        const shackle = part(form, wrapper, state, 'before', 'border-color');
        expect(ratio(body, track), `${at}: body ${body.map(Math.round)} on track ${track.map(Math.round)}`).toBeGreaterThanOrEqual(3);
        expect(ratio(shackle, track), `${at}: shackle ${shackle.map(Math.round)} on track ${track.map(Math.round)}`).toBeGreaterThanOrEqual(3);
      });

      it(`${at}: the on track is the teal token`, () => {
        const track = part(form, wrapper, ['on'], null, 'background');
        const teal = colour('var(--fw-teal)', tokenMap(form));
        expect(track).toEqual(teal);
      });
    }
  }
});

describe('what L2 and L5 set stays set', () => {
  it('the Quiet hours day pill that is on carries the on-accent text colour', () => {
    const rule = RULES.find(r => r.selectors.includes('.quiet-hours .qh-day.on'));
    expect(rule, 'the rule for the day pill that is on').toBeTruthy();
    expect((rule as Rule).decls.color).toBe('var(--fw-on-accent)');
  });

  it('the PIN error slot is centred under the centred PIN rows', () => {
    const rule = RULES.find(r => r.selectors.includes('.pin-err-slot') && r.decls['text-align'] !== undefined);
    expect(rule, 'a text-align on .pin-err-slot').toBeTruthy();
    expect((rule as Rule).decls['text-align']).toBe('center');
  });

  it("the Mode card's help line has no size of its own: the Help role decides", () => {
    const rule = RULES.find(r => r.selectors.includes('.mode-card .mode-head .fr-desc'));
    expect(rule, 'the rule for the Mode card help line').toBeTruthy();
    expect((rule as Rule).decls['font-size']).toBeUndefined();
    expect((rule as Rule).decls['line-height']).toBeUndefined();
  });

  it("tokens.css's system-light fallback carries the on-accent colour", () => {
    expect(tokenMap('system-light')['--fw-on-accent']).toBe('#ffffff');
  });
});
