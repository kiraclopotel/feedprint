// Feedprint's Settings page and setup wizard fit the 396x600 popup at every level in en, es, pt-BR and ro (13 Oct 2026,
// the Leader's 01:2x list on the Tester's read of d96d2dd7; probes crew/visuals/pop-set.mjs and wiz.mjs). Three moves:
// the Reset link ends the level sentence's last line instead of a 30 px row; the swear lock's note at Silent opens with
// its row's (i), words unchanged; the wizard's steps take the scale's 12 px between their parts (14 ran the level step
// 8 px past the popup in es and 27 in pt-BR at Open). Packet 35 brings the Open sentence to two lines in es and pt-br.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');

describe('Settings and the wizard fit the popup', () => {
  it('the Reset link sits inside the level sentence, after its words, and the group is described by the words alone', () => {
    const p = src('ui/popup/panels/SettingsPanel.tsx');
    const block = p.slice(p.indexOf('<p className="level-sentence">'), p.indexOf('</p>', p.indexOf('<p className="level-sentence">')));
    expect(block).toContain('<span id="fw-level-sentence">{levelSentence}</span>');
    expect(block).toContain('{resetShown && <>{\' \'}<span className="mode-state">{resetLink}</span></>}');
    expect(p).toContain('{levelSentence === null && resetShown && <div className="mode-state">{resetLink}</div>}');
    const css = src('ui/popup/popup-panel.css');
    expect(css).toContain('.fw-popup .level-sentence .mode-state { display: inline; margin: 0 0 0 2px; white-space: nowrap; }');
    expect(css).toContain('.fw-popup .level-sentence .mode-state .lnk { display: inline; min-width: 0; min-height: 0; font-size: inherit; }');
    expect(css).toContain('.fw-popup .level-sentence:has(.mode-state) { text-wrap: balance; }');
  });

  it('the swear lock\'s note opens with the row\'s (i), and the switch still names its state', () => {
    const p = src('ui/popup/panels/SettingsPanel.tsx');
    expect(p).toContain('note={childMode ? t.softenSwearingDescChild : undefined}\n          quiet\n          noteInFold\n');
    expect(p).toContain('label={childMode ? t.softenSwearingAriaChild : t.softenSwearingName}');
    const c = src('ui/popup/controls.tsx');
    expect(c).toContain('const quietNote = quiet && note && !noteInFold ? note : null;');
    expect(c).toContain('{open && noteInFold && note && <div className="fr-desc fr-state">{note}</div>}');
  });

  it('the wizard\'s steps keep 12 px between their parts', () => {
    // And, after the level got a heading of its own (c16b62b4), 16 px of padding, no margin on a nested paragraph, and
    // no 8 px over the main button (13 Oct 2026).
    const css = src('ui/popup/popup-design.css');
    expect(css).toMatch(/\.setup-step \{\n  padding: 16px 20px; display:flex; flex-direction:column; gap:12px;/);
    expect(css).toContain('.setup-step p.tag { margin: 0; }\n.setup-step h3 + p.tag { margin-top: 4px; }\n');
    expect(src('ui/popup/popup-frame.css')).toMatch(/\.setup-step > \.pop-cta \{[^}]*margin-top: 0;/);
  });

  it('packet 35: the Open sentence fits two lines in es and pt-br (95 characters at most)', () => {
    expect(POPUP_STRINGS.es.levelSentenceAdult).toBe('Lo marcado llega tal cual, con un punto rojo. Púlsalo: el motivo y luego la versión tranquila.');
    expect(POPUP_STRINGS['pt-BR'].levelSentenceAdult).toBe('O post marcado chega intacto, com ponto vermelho. Toque nele: o motivo, depois a versão calma.');
    for (const lang of ['es', 'pt-BR'] as const) expect([...POPUP_STRINGS[lang].levelSentenceAdult].length).toBeLessThanOrEqual(95);
  });
});
