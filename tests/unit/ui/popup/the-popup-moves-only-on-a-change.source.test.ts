// The popup's motion rule: a movement follows a change the person made or saw, ends within 700 ms, never loops, and
// none runs when the system asks for reduced motion. popup-life.css is where the popup's life lives, and it loads last
// in both popups, so its rules are the ones that hold.

import { describe, expect, it } from 'vitest';
import { readSource } from '../../../helpers/read-source';
import { COUNT_UP_MS } from '../../../../src/ui/popup/life';

const LIFE = readSource('src/ui/popup/popup-life.css');
const ms = (value: string, unit: string) => (unit === 's' ? Number(value) * 1000 : Number(value));

describe('the popup moves only on a change', () => {
  it('every animation and transition in the life sheet ends within 700 ms', () => {
    // Every time value in every animation or transition declaration: a transition can list several properties.
    const declarations = [...LIFE.matchAll(/(?:animation|transition)\s*:([^;}]*)/g)].map(m => m[1]);
    const durations = declarations.flatMap(d => [...d.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)].map(m => ms(m[1], m[2])));
    expect(durations.length).toBeGreaterThan(0);
    for (const d of durations) expect(d).toBeLessThanOrEqual(700);
    expect(COUNT_UP_MS).toBeLessThanOrEqual(700);
  });

  it('nothing in the life sheet loops', () => {
    expect(LIFE).not.toMatch(/infinite/);
  });

  it('the dots and the mark that pulsed forever are stopped in every look', () => {
    expect(LIFE).toMatch(/html \.fw-popup \.pop-header \.ind,\s*html \.fw-popup \.status-chip \.status-dot,\s*html \.fw-popup \.pop-header \.wordmark::before \{ animation: none; \}/);
  });

  it('reduced motion stops every animation and transition, in every look', () => {
    expect(LIFE).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html \.fw-popup \*,\s*html \.fw-popup \*::before,\s*html \.fw-popup \*::after \{ animation: none !important; transition: none !important; \}/);
  });

  it('both popups load the life sheet', () => {
    // Patterns, not quoted paths: the path checker reads a quoted specifier in a test as a file the test points at.
    expect(readSource('src/ui/popup/Popup.tsx')).toMatch(/^import '\.\/popup-life\.css';$/m);
    expect(readSource('src/products/off/popup/OffPopup.tsx')).toMatch(/^import '(?:\.\.\/){3}ui\/popup\/popup-life\.css';$/m);
  });
});
