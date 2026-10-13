// The dashboard's motion is one small set of rules. A person who asks for less motion gets none; the evidence drawer
// eases to the height its content has; a dialog arrives over a beat; the rows and the tab underline answer the pointer in
// 120 ms; an opened Feed log row settles into place with its chevron. Each rule is held in its sheet.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const src = (f: string) => readFileSync(new URL(`../../../../src/ui/dashboard/${f}`, import.meta.url), 'utf8');
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `${selector} is in the sheet`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf('}', at) + 1);
};

describe('the dashboard moves on one clock', () => {
  it('under reduced motion every duration ends at once, nothing repeats, and the toast keeps its hold', () => {
    const looks = src('dashboard-looks.css');
    const block = /@media \(prefers-reduced-motion: reduce\) \{\n  \.dash-root \*, \.dash-root \*::before, \.dash-root \*::after, \.modal-backdrop, \.modal \{([^}]*)\}/.exec(looks);
    expect(block, 'the guard is in the sheet').not.toBeNull();
    expect(block![1]).toMatch(/animation-duration: \.001ms !important;/);
    expect(block![1]).toMatch(/animation-iteration-count: 1 !important;/);
    expect(block![1]).toMatch(/transition-duration: \.001ms !important;/);
    // The success toast fades out on a 5.3s delay; zeroing the delay would end it the moment it shows.
    expect(block![1]).not.toMatch(/animation-delay/);
    expect(src('dashboard-design.css')).toMatch(/dash-verify-toast-out 0\.7s ease 5\.3s forwards/);
    // A hover that lifts a control is movement too.
    const lifts = '.bar-row:hover, .recidivist-row:hover, .export-card:hover, .dash-header .dash-record-btn:hover:not(:disabled) { transform: none; }';
    expect(looks).toContain(lifts);
    // Both come after the rules they override, so they win the tie without !important.
    expect(looks.indexOf(lifts)).toBeGreaterThan(looks.indexOf('.dash-header .dash-record-btn:hover:not(:disabled) {'));
  });

  it('the evidence drawer is a grid row that eases from nothing to its content, with its gap inside the clip', () => {
    const design = src('dashboard-design.css');
    expect(design).toMatch(/\.fc-drawer-wrap \{ display: grid; grid-template-columns: minmax\(0, 1fr\); grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows \.2s var\(--fw-ease\), opacity \.15s ease; \}/);
    expect(design).toMatch(/\.fc-drawer-wrap\.open \{ grid-template-rows: 1fr; opacity: 1; \}/);
    expect(design).toMatch(/\.fc-drawer-wrap > \* \{ min-height: 0; overflow: hidden; \}/);
    expect(design).not.toMatch(/\.fc-drawer-wrap[^{]*\{[^}]*max-height/);
    // On the clipped child the gap would hold the closed track open at 9 or 12 px.
    expect(rule(design, '.fc-drawer-body')).toMatch(/margin-top: 9px;/);
    expect(design).toMatch(/\.fc-timeline \.fc-drawer-body \{ margin-top: 12px; \}/);
    expect(design).not.toMatch(/\n\.fc-drawer \{[^}]*margin-top/);
    expect(design).not.toMatch(/\.fc-timeline \.fc-drawer \{[^}]*margin-top/);
    // It is still always mounted: opening the drawer must not add a node and scroll the page.
    expect(readFileSync(new URL('../../../../src/ui/dashboard/components/FeedCard.tsx', import.meta.url), 'utf8'))
      .toMatch(/<div className=\{'fc-drawer-wrap' \+ \(showForensic \? ' open' : ''\)\} aria-hidden=\{!showForensic\}>/);
  });

  it('a dialog fades in over its backdrop and its box settles into place', () => {
    const design = src('dashboard-design.css');
    expect(design).toContain('@keyframes fw-fade-in { from { opacity: 0; } to { opacity: 1; } }');
    expect(design).toContain('@keyframes fw-modal-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }');
    expect(design).toContain('.modal-backdrop { animation: fw-fade-in .16s var(--fw-ease); }');
    expect(design).toContain('.modal { animation: fw-modal-in .2s var(--fw-ease); }');
  });

  it('rows and the tab underline answer the pointer in 120 ms', () => {
    const design = src('dashboard-design.css');
    expect(rule(design, '.fl-row')).toMatch(/transition: background-color \.12s ease, box-shadow \.12s ease;/);
    expect(rule(design, '.fwc-row')).toMatch(/transition: background-color \.12s ease, box-shadow \.12s ease;/);
    expect(design).toMatch(/\.fwc-row\.drill \.fwc-label::after \{ transition: border-color \.12s ease; \}/);
    expect(src('dashboard-frame.css')).toMatch(/\.dash-tab \{[^}]*transition: background-color \.12s ease, color \.12s ease, border-bottom-color \.12s ease; \}/);
  });

  it('an opened row, and the question inside it, settle into place while the chevron turns', () => {
    const design = src('dashboard-design.css');
    expect(design).toContain('.fl-open, .fl-ask { animation: dash-verify-toast-in .16s var(--fw-ease); }');
    expect(design).toContain('.fl-row:not(.fl-row-head) .fl-why::after { transition: transform .16s var(--fw-ease), border-color .12s ease; }');
    // Nothing new loops, and the verify toast and the help popover keep their timings.
    expect([...design.matchAll(/animation: ([^;]+);/g)].map((m) => m[1]).filter((v) => /infinite/.test(v))).toEqual(['fw-spin 0.8s linear infinite']);
    expect(design).toMatch(/animation: dash-verify-toast-in 0\.18s ease;/);
    expect(design).toMatch(/dash-verify-toast-in 0\.22s ease,/);
  });
});
