// Packet 36 (13 Oct 2026, his words at 01:3x: "Live Rephrase" and "Calmer rewrites (Live Rephrase)" read as two of the
// same thing): the Live Rephrase fold names the level's two switches, "Show the calm version first" and "Show the dot",
// the dot's row moving in from General under the first. Without a key there is no fold, and General keeps the dot's row
// with the line every install's dot deserves (featMarkersDescFree). The comments row's standing note opens with its (i)
// so the fold fits the popup; on a YouTube tab, where its switch is disabled, the line saying why stays in view.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';
import { UI_LANGUAGES } from '../../../../src/i18n';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');

describe('the Live Rephrase fold names the level\'s two switches', () => {
  it('in the fold: the main switch, the calm version, the dot, then the comments and the language', () => {
    const c = src('ui/popup/panels/ai/AiCard.tsx');
    const at = (s: string) => { const i = c.indexOf(s); expect(i, s).toBeGreaterThan(0); return i; };
    const master = at('name={t.featAiMasterName}'), calm = at('name={t.reframeRewritesName}'), dot = at('name={t.featMarkersName}');
    const comments = at('{aiGroup.map(r => {'), lang = at('<div className="feat-row fr-stack">');
    expect(master < calm && calm < dot && dot < comments && comments < lang).toBe(true);
    expect(c).toContain("onClick={() => { void toggle('show-reframe-markers'); }}");
    expect(c).toContain("noteInFold={r.id === 'rewritten-comments-first' && !onYouTube}");
  });

  it('in General only without a key, with its free line', () => {
    const p = src('ui/popup/panels/SettingsPanel.tsx');
    expect(p).toContain('{!readingOn && featRow(reframeMarkers)}');
    expect(p).toContain("{ id: 'show-reframe-markers', name: t.featMarkersName, desc: t.featMarkersDescFree, group: 'essential', shown: true },");
  });

  it('the words are the packet\'s, and the free line is the one every install\'s dot had', () => {
    expect(POPUP_STRINGS.en.reframeRewritesName).toBe('Show the calm version first');
    expect(POPUP_STRINGS.en.featMarkersName).toBe('Show the dot');
    expect(POPUP_STRINGS.en.featMarkersDescFree).toBe('A dot appears beside a post that was changed; tap it to see why.');
    for (const lang of UI_LANGUAGES) {
      const t = POPUP_STRINGS[lang];
      expect(t.featMarkersDescFree, lang).not.toBe(t.featMarkersDesc);
      expect(t.reframeRewritesName, lang).not.toMatch(/Live Rephrase/);
    }
    // Shortened to sit on one line beside the BETA pill (packet 36's addition, 03:01).
    expect(POPUP_STRINGS.es.featRewriteName).toBe('Reescribir comentarios');
    expect(POPUP_STRINGS['pt-BR'].featRewriteName).toBe('Reescrever os comentários');
  });
});
