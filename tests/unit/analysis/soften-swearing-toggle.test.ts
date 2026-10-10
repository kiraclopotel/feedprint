// The soften of ordinary swearing: a switch in teen and adult, a rail in child.
//
// Q4 (mode-rails C1) made this a real switch in June, and the word it used was
// SPEND: softening then meant asking the rewriter for a calmer sentence, so
// forcing it by mode forced a paid call. Child mode alone stopped forcing it.
//
// Two things happened after that. On 2026-09-07 the rewriter left this path:
// the vulgar words are starred in place by the same filter that found them,
// every other word stands, and the pipeline says in full "no model call, no
// cap, no tier". The spend the June decision protected does not exist any
// more. Then the owner closed the question the switch had left open: a child
// install gets strict protection, since a parent would rather see swearing
// hidden whenever it is correctly caught.
//
// So child is a rail again, and it is free. What is NOT restored is the
// always-on TEEN rule, which was retired on evidence and stays retired: 31 of
// 36 teen softenings acted on register profanity that was fine for a teen.
// Teen and adult keep the switch, and strictLanguage still reaches any mode.
// The visibility floors did not move.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blanketProfanitySoften, hideOnRewriteUnavailable } from '../../../src/analysis/pipeline';
import { childPreset, teenPreset, adultPreset } from '../../../src/storage/presets';
import type { FWSettings, FeatureToggles } from '../../../src/storage/settings';

const PIPELINE_PATH = 'src/analysis/pipeline.ts';

function settingsWith(features: FeatureToggles, strictLanguage = false): FWSettings {
  return { features, strictLanguage, mode: 'teen' } as unknown as FWSettings;
}

describe('blanketProfanitySoften (toggle semantics)', () => {
  it('child preset seeds the spend ON; teen and adult seed it OFF', () => {
    expect(blanketProfanitySoften(settingsWith(childPreset()))).toBe(true);
    expect(blanketProfanitySoften(settingsWith(teenPreset()))).toBe(false);
    expect(blanketProfanitySoften(settingsWith(adultPreset()))).toBe(false);
  });

  it('child mode softens whatever the switch says', () => {
    // The June behaviour, reversed on the owner's word of 2026-09-20. It cost
    // a paid rewrite then and costs nothing now, which is what made the
    // reversal cheap rather than a trade.
    const features = childPreset();
    features['soften-swearing'] = { enabled: false };
    const s = { features, strictLanguage: false, mode: 'child' } as unknown as FWSettings;
    expect(blanketProfanitySoften(s)).toBe(true);
  });

  it('and teen and adult still decide for themselves', () => {
    // The half that is evidence and stays. A rail in child is not a rail
    // everywhere.
    const teen = teenPreset();
    teen['soften-swearing'] = { enabled: false };
    expect(blanketProfanitySoften({ features: teen, strictLanguage: false, mode: 'teen' } as unknown as FWSettings)).toBe(false);
    const adult = adultPreset();
    adult['soften-swearing'] = { enabled: true };
    expect(blanketProfanitySoften({ features: adult, strictLanguage: false, mode: 'adult' } as unknown as FWSettings)).toBe(true);
  });

  it('strictLanguage implies the spend in any mode regardless of the toggle', () => {
    expect(blanketProfanitySoften(settingsWith(adultPreset(), true))).toBe(true);
  });

  it('per-platform override wins', () => {
    const features = childPreset();
    features['soften-swearing'] = { enabled: true, perPlatform: { twitter: { enabled: false } } };
    const s = settingsWith(features);
    expect(blanketProfanitySoften(s, 'twitter')).toBe(false);
    expect(blanketProfanitySoften(s, 'facebook')).toBe(true);
  });
});

describe('the visibility rails did NOT move (mode-rails R3)', () => {
  it('hideOnRewriteUnavailable keys on mode alone: Child folds, teen and adult mark (2026-09-07)', () => {
    expect(hideOnRewriteUnavailable('child')).toBe(true);
    expect(hideOnRewriteUnavailable('teen')).toBe(false);
    expect(hideOnRewriteUnavailable('adult')).toBe(false);
  });

  it('the child profanity HIDE branch still gates on mode, not the toggle (source-lock)', () => {
    const pipeline = readFileSync(join(process.cwd(), PIPELINE_PATH), 'utf8');
    expect(pipeline).toContain("profanityResult.filtered && settings.mode === 'child'");
    // The gate reads mode for CHILD only, and still reads the switch for the
    // other two. Both halves are asserted, so a later edit that turns the rail
    // into a blanket, or drops it, fails here.
    const gate = pipeline.match(/export function blanketProfanitySoften[\s\S]{0,1200}/)?.[0] ?? '';
    expect(gate).toContain("if (settings.mode === 'child') return true;");
    expect(gate).toContain("isFeatureEnabled(settings, 'soften-swearing'");
    expect(gate).not.toContain("mode === 'teen'");
    expect(gate).not.toContain("mode === 'adult'");
  });
});
