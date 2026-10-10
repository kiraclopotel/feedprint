// Two sentences on the Issues tab, both untrue, on the tab a tester opens when
// something looks wrong.
//
// "Turn on the captureV2Metrics feature flag, then browse a social site with a
// paid/dev license active." There is no control for that flag on any surface of
// this product. The only way to set it is a console command against extension
// storage, which is not a thing a reader has or should have. An instruction a
// person cannot follow is worse than none, because it reads to them as their
// own failure.
//
// "the captureV2Metrics flag is already ON (dev/paid licenses enable it
// automatically)". The only code that turns this flag on is
// enablePerfCaptureForDevTier in src/content/index.ts, and its second line is
// `if (license.tier !== 'dev') return;`. A paying customer was told a flag was
// on for them when nothing in the product would ever turn it on.
//
// This file reads that function and holds the sentence to it, so the claim and
// the code that decides it cannot drift apart again. (2026-09-18)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../../../src/i18n/dashboard-strings';
import { UI_LANGUAGES } from '../../../../../src/i18n';
import { REPO_ROOT as ROOT } from '../../../../helpers/repo-root';

/** The one function that can turn the flag on without a human console. */
function autoEnableSource(): string {
  const text = readFileSync(join(ROOT, 'src', 'content', 'index.ts'), 'utf8');
  const start = text.indexOf('async function enablePerfCaptureForDevTier');
  expect(start, 'the auto-enable function is still there to read').toBeGreaterThan(-1);
  return text.slice(start, start + 800);
}

describe('the Issues tab asks for nothing a reader cannot do', () => {
  it('auto-enables the flag for exactly one tier, and that tier is dev', () => {
    const src = autoEnableSource();
    expect(src, 'it returns unless the tier is dev').toContain("license.tier !== 'dev'");
    // If a second tier is ever added here, the sentences below have to be
    // rewritten in four languages, and this line is what will say so.
    const tiersNamed = [...src.matchAll(/tier\s*[!=]==?\s*'([a-z]+)'/g)].map((m) => m[1]);
    expect([...new Set(tiersNamed)], 'one tier, named once').toEqual(['dev']);
  });

  it('claims no paid tier turns it on, in any language', () => {
    for (const lang of UI_LANGUAGES) {
      const t = DASHBOARD_STRINGS[lang];
      const said = [t.opsPerfNoSamples1, t.opsPerfNoSamples2, t.opsPerfOnNoData].join(' ').toLowerCase();
      // Whole words, not substrings: the Spanish for "switched off" is
      // "apagada", which contains "paga", and a substring ban reported the
      // sentence saying the feature is OFF as a claim that paying turns it on.
      for (const word of ['paid', 'paga', 'pag\u00e1', 'pl\u0103tit', 'pago', 'pagante']) {
        const hit = new RegExp(`(^|[^\\p{L}])${word}([^\\p{L}]|$)`, 'u').test(said);
        expect(
          hit,
          `${lang}: the panel says "${word}", and only the dev tier auto-enables this flag`,
        ).toBe(false);
      }
    }
  });

  it('tells no reader to turn a flag on', () => {
    const t = DASHBOARD_STRINGS.en;
    const said = [t.opsPerfNoSamples1, t.opsPerfNoSamples2].join(' ').toLowerCase();
    expect(said, 'no instruction to switch it on').not.toContain('turn on the');
    // And it says the reader has nothing to do, which is the true and the kind
    // thing: an empty debug panel is not a problem they have.
    expect(said).toContain('nothing');
  });

  // The control. The panel still has to say what it is, or the empty state
  // becomes a mystery of a different kind.
  it('still names the flag and says what the panel measures', () => {
    for (const lang of UI_LANGUAGES) {
      const t = DASHBOARD_STRINGS[lang];
      const said = [t.opsPerfNoSamples1, t.opsPerfNoSamples2].join(' ');
      expect(said.length, `${lang} is not a stub`).toBeGreaterThan(120);
      expect(said, `${lang} has no em dash`).not.toContain('—');
    }
    // The flag name itself is rendered by the component between the two
    // fragments, so neither fragment carries it; the sentence has to read
    // correctly around it.
    expect(DASHBOARD_STRINGS.en.opsPerfNoSamples1.trimEnd().endsWith('the')).toBe(true);
    expect(DASHBOARD_STRINGS.en.opsPerfNoSamples2.trimStart().startsWith('flag')).toBe(true);
  });
});
