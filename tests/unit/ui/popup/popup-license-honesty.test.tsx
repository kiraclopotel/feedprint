// Popup honesty + safety-of-switch contracts (audit POP-5, POP-3, TEST-5).
//
// POP-5: a well-formatted but revoked/typo'd paid key used to render a fully
//   "Active" UI, with the only failure signal a small header dot. The popup
//   must instead surface an honest inline banner when the live proxy probe
//   returns 'revoked' — mirroring the existing free-tier banner.
// POP-3: switching mode destructively re-applies the preset grid, wiping every
//   custom toggle. A switch that would change something must confirm first; a
//   true no-op switch must not prompt.
// TEST-5: first Popup container render test — HomeTab via renderToString (the
//   project test env is `node`; @testing-library/react is not installed, so we
//   use the same renderToString pattern as operational-events-panel.test.tsx).

import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { createElement } from 'react';
import {
  HomeTab,
  KeysTab,
  PopHeader,
  computeAiBannerState,
  computeStatusStates,
  modeSwitchResetsToggles,
  resolveModeClick,
  modeSwitchRequiresPin,
} from '../../../../src/ui/popup/Popup';
import { I18nProvider } from '../../../../src/i18n/react';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import type { FWSettings } from '../../../../src/storage/settings';
import { childPreset, teenPreset } from '../../../../src/storage/presets';
import type { LicenseInfo } from '../../../../src/storage/license';

// ─── POP-5 · banner-state logic ───────────────────────────────────────
describe('computeAiBannerState (POP-5)', () => {
  it('free tier → "free" regardless of probe result', () => {
    expect(computeAiBannerState({ tier: 'free' }, null)).toBe('free');
    expect(computeAiBannerState({ tier: 'free' }, 'ok')).toBe('free');
    expect(computeAiBannerState({ tier: 'free' }, 'revoked')).toBe('free');
  });

  it('paid tier with a revoked probe → "revoked"', () => {
    expect(computeAiBannerState({ tier: 'starter' }, 'revoked')).toBe('revoked');
    expect(computeAiBannerState({ tier: 'family' }, 'revoked')).toBe('revoked');
  });

  it('paid tier assumes good until proven revoked (no false alarm)', () => {
    // null (pre-probe), 'ok', and 'unknown' (transient network) must NOT
    // downgrade the UI — matches computeStatusStates semantics.
    expect(computeAiBannerState({ tier: 'starter' }, null)).toBe('none');
    expect(computeAiBannerState({ tier: 'starter' }, 'ok')).toBe('none');
    expect(computeAiBannerState({ tier: 'starter' }, 'unknown')).toBe('none');
  });
});

// ─── Header pill · a probe that could not run must say so ─────────────
// The probe has always been wired; what it could not do was report its own
// failure. 'unknown' (offline, DNS down, proxy 5xx, 5s abort) mapped to the
// same green 'ok' as a proxy that actually accepted the key, so a parent
// could be shown a confirmed-good license nothing had confirmed. With the AI
// layer down, comment protection falls back to the deterministic floor, so
// this was the expensive direction to be wrong in.
describe('computeStatusStates license pill', () => {
  it('a proxy that accepted the key is the only thing that turns the pill green', () => {
    expect(computeStatusStates({ tier: 'starter' }, 'ok').licenseState).toBe('ok');
  });

  it('a probe that could not complete reads "unchecked", not ok and not revoked', () => {
    expect(computeStatusStates({ tier: 'starter' }, 'unknown').licenseState).toBe('unchecked');
    expect(computeStatusStates({ tier: 'family' }, 'unknown').licenseState).toBe('unchecked');
  });

  it('nothing asked yet reads "checking", so no state is claimed before the answer', () => {
    expect(computeStatusStates({ tier: 'starter' }, null).licenseState).toBe('checking');
  });

  it('a refused key is the only red', () => {
    expect(computeStatusStates({ tier: 'starter' }, 'revoked').licenseState).toBe('err');
  });

  it('free tier is neutral, never amber or red, whatever the probe says', () => {
    for (const probe of ['ok', 'revoked', 'unknown', null] as const) {
      const state = computeStatusStates({ tier: 'free' }, probe).licenseState;
      expect(state).toBe('free');
      expect(state).not.toBe('warn');
      expect(state).not.toBe('err');
    }
  });

  it('a refused (revoked or expired) key is still red, as before', () => {
    // A paid-shaped key the proxy refused is the red; nothing else earns it.
    expect(computeStatusStates({ tier: 'starter' }, 'revoked').licenseState).toBe('err');
    expect(computeStatusStates({ tier: 'family' }, 'revoked').licenseState).toBe('err');
  });

  it('a paid, valid key is unchanged for every paid tier', () => {
    for (const tier of ['starter', 'family']) {
      expect(computeStatusStates({ tier }, 'ok').licenseState).toBe('ok');
      expect(computeStatusStates({ tier }, 'unknown').licenseState).toBe('unchecked');
      expect(computeStatusStates({ tier }, null).licenseState).toBe('checking');
    }
  });
});

function renderHeader(licenseState: 'ok' | 'warn' | 'err' | 'checking' | 'unchecked' | 'free', lang: 'en' | 'ro') {
  return renderToString(
    createElement(I18nProvider, {
      lang,
      children: createElement(PopHeader, { licenseState }),
    }),
  );
}

describe('PopHeader on a fresh free install (gem 12)', () => {
  // Since 9 Oct 2026 a free install shows no chip at all (it read LICENSE beside the License tab), so nothing on it
  // can read as a warning.
  it('a free install shows no licence chip, so no warn or err chip either', () => {
    const { licenseState } = computeStatusStates({ tier: 'free' }, null);
    const html = renderHeader(licenseState, 'en');
    expect(html).not.toContain('status-chip');
  });

  it('a refused key still renders the red chip, and the plain label stays', () => {
    const { licenseState } = computeStatusStates({ tier: 'starter' }, 'revoked');
    const html = renderHeader(licenseState, 'en');
    expect(html).toContain('status-chip err');
  });

  it('a free install\'s header has no AI word and no License chip beside the License tab', () => {
    const html = renderHeader('free', 'en');
    expect(html).not.toContain('status-chip');
    expect(html).not.toMatch(/\bAI\b/);
  });
});

describe('PopHeader renders the unchecked state in words, in both languages', () => {
  it('EN: an unchecked probe shows "Not checked" and says the license is not the problem', () => {
    const html = renderHeader('unchecked', 'en');
    expect(html).toContain('Not checked');
    expect(html).toContain('status-chip unchecked');
    expect(html).toContain('Could not check the license right now');
  });

  it('RO: same state, same promise', () => {
    const html = renderHeader('unchecked', 'ro');
    expect(html).toContain('Neverificat');
    expect(html).toContain('nu a putut fi verificată acum');
  });

  it('the unchecked wording never accuses the license, in either language', () => {
    // The rule for this pill: a failed check reads "could not check",
    // never "not authorised". Guard the words, not just the state name.
    for (const lang of ['en', 'ro'] as const) {
      const t = POPUP_STRINGS[lang];
      const unchecked = `${t.statusUnchecked} ${t.statusUncheckedShort}`.toLowerCase();
      for (const accusation of [
        'unauthorized', 'unauthorised', 'revoked', 'invalid', 'not accepted',
        'neautorizat', 'revocat', 'invalid', 'respins',
      ]) {
        expect(unchecked).not.toContain(accusation);
      }
      expect(unchecked).not.toBe(t.statusRevoked.toLowerCase());
    }
  });

  it('a green pill still reads as the plain license label, unchanged', () => {
    const html = renderHeader('ok', 'en');
    expect(html).toContain('status-chip ok');
    expect(html).toContain('License');
    expect(html).not.toContain('Not checked');
  });
});

// ─── POP-5 · container render (TEST-5) ────────────────────────────────
// Minimal settings — HomeTab reads only these fields at first paint (the
// coverage card stays hidden because its chrome.tabs effect does not run under
// renderToString, so `coverage` is undefined).
const settingsStub = {
  mode: 'teen',
  dailyCap: 2000,
  totalChecksToday: 0,
  totalNeutralizedToday: 0,
  totalNeutralizedAllTime: 0,
  metricsHiddenToday: 0,
  metricsHiddenAllTime: 0,
  totalChecksAllTime: 0,
  uiLanguage: 'en',
} as unknown as FWSettings;

function renderHome(license: LicenseInfo, probeResult: 'ok' | 'revoked' | 'unknown' | null) {
  return renderToString(
    createElement(
      I18nProvider,
      {
        lang: 'en',
        children: createElement(HomeTab, {
          settings: settingsStub,
          license,
          probeResult,
          onOpenDashboard: () => {},
          onOpenDashboardSection: () => {},
        }),
      },
    ),
  );
}

describe('HomeTab AI-off banner render (POP-5 / TEST-5)', () => {
  it('revoked paid key shows the "license not accepted" banner', () => {
    const html = renderHome({ tier: 'starter', secret: 'abc123def456' }, 'revoked');
    expect(html).toContain('License key not accepted');
    expect(html).toContain('pop-bn err');
    expect(html).toContain('role="alert"');
  });

  // Since 9 Oct 2026 the calm note is said on the License tab (popup-read-card and strict-home tests hold Home clean).
  it('free tier: Home carries no AI banner and no refusal', () => {
    const html = renderHome({ tier: 'free', secret: '' }, null);
    expect(html).not.toContain('pop-bn');
    expect(html).not.toContain('License key not accepted');
  });

  it('paid key with an ok probe shows neither AI-off banner', () => {
    const html = renderHome({ tier: 'starter', secret: 'abc123def456' }, 'ok');
    expect(html).not.toContain('License key not accepted');
    expect(html).not.toContain('AI reading: optional');
  });
});

// ─── POP-5 · License tab pill/dot honesty (residual) ──────────────────
// HomeTab's banner isn't the only place a revoked paid-shaped key used to
// read as fully active: the License tab itself (the screen a parent opens
// specifically to check the key) never consulted the probe result at all —
// its pill said "active" and its dot was green regardless.
function renderKeys(license: LicenseInfo, probeResult: 'ok' | 'revoked' | 'unknown' | null) {
  return renderToString(
    createElement(
      I18nProvider,
      {
        lang: 'en',
        children: createElement(KeysTab, {
          settings: settingsStub,
          license,
          probeResult,
          onChange: async () => {},
        }),
      },
    ),
  );
}

describe('KeysTab license-tab honesty (POP-5 residual)', () => {
  it('revoked paid key shows "not accepted" pill, err dot, and an alert — never the active pill', () => {
    const html = renderKeys({ tier: 'starter', secret: 'abc123def456' }, 'revoked');
    expect(html).toContain('not accepted');
    expect(html).toContain('key-dot err');
    expect(html).toContain('key-pill err');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('>active<');
  });

  // Since 8 Oct 2026 an accepted key has no pill: the line under the name says "AI reading on", once.
  it('paid key with an ok probe says the reading is on, with the ok dot', () => {
    const html = renderKeys({ tier: 'starter', secret: 'abc123def456' }, 'ok');
    expect(html).not.toContain('key-pill');
    expect(html).toContain('key-dot ok');
    expect(html).not.toContain('not accepted');
  });

  it('paid key with no probe yet (null) assumes good — same policy as computeAiBannerState', () => {
    const html = renderKeys({ tier: 'starter', secret: 'abc123def456' }, null);
    expect(html).not.toContain('key-pill');
    expect(html).not.toContain('not accepted');
  });

  it('free tier shows neither pill regardless of probe', () => {
    const html = renderKeys({ tier: 'free', secret: '' }, 'revoked');
    expect(html).not.toContain('key-pill');
  });
});

// ─── POP-3 · mode-switch reset gate ───────────────────────────────────
describe('modeSwitchResetsToggles (POP-3)', () => {
  it('grid already equal to the target preset → no reset (no confirm)', () => {
    expect(modeSwitchResetsToggles(childPreset(), 'child')).toBe(false);
    expect(modeSwitchResetsToggles(teenPreset(), 'teen')).toBe(false);
  });

  it('different preset → would reset (confirm required)', () => {
    expect(modeSwitchResetsToggles(teenPreset(), 'child')).toBe(true);
    expect(modeSwitchResetsToggles(childPreset(), 'teen')).toBe(true);
  });

  it('a single custom toggle away from the preset → would reset', () => {
    const custom = teenPreset();
    custom['show-reframe-markers'] = { enabled: !custom['show-reframe-markers'].enabled };
    expect(modeSwitchResetsToggles(custom, 'teen')).toBe(true);
  });
});

describe('resolveModeClick (POP-3)', () => {
  it('same mode → noop', () => {
    expect(resolveModeClick({ mode: 'teen', features: teenPreset() }, 'teen')).toBe('noop');
  });

  it('different mode that would wipe customizations → confirm', () => {
    expect(resolveModeClick({ mode: 'teen', features: teenPreset() }, 'child')).toBe('confirm');
  });

  it('different mode but the grid already matches the target → apply (no confirm)', () => {
    // Parent is tagged teen but the grid already equals the child preset:
    // switching to child changes nothing, so apply silently.
    expect(resolveModeClick({ mode: 'teen', features: childPreset() }, 'child')).toBe('apply');
  });
});

describe('modeSwitchRequiresPin (D6)', () => {
  it('leaving Child demands the PIN even inside the grace window', () => {
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hash' }, 'teen')).toBe(true);
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hash' }, 'adult')).toBe(true);
  });

  it('entering Child stays one click, and non-child switches keep current friction', () => {
    expect(modeSwitchRequiresPin({ mode: 'teen', parentPin: 'hash' }, 'child')).toBe(false);
    expect(modeSwitchRequiresPin({ mode: 'adult', parentPin: 'hash' }, 'child')).toBe(false);
    expect(modeSwitchRequiresPin({ mode: 'teen', parentPin: 'hash' }, 'adult')).toBe(false);
  });

  it('no PIN set, nothing to demand', () => {
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: '' }, 'adult')).toBe(false);
  });

  it('re-clicking the current mode never gates', () => {
    expect(modeSwitchRequiresPin({ mode: 'child', parentPin: 'hash' }, 'child')).toBe(false);
  });
});

describe('mode state line (laydown 4.1)', () => {
  it('grid equal to the own-mode preset reads as standard', () => {
    expect(modeSwitchResetsToggles(childPreset(), 'child')).toBe(false);
    expect(modeSwitchResetsToggles(teenPreset(), 'teen')).toBe(false);
  });

  it('any toggled-away switch reads as customized for the own mode', () => {
    const custom = childPreset();
    custom['show-reframe-markers'] = { enabled: false };
    expect(modeSwitchResetsToggles(custom, 'child')).toBe(true);
  });
});
