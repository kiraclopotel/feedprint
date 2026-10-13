// Off's two looks (13 Oct 2026, the Leader's call after the dry run: the picker costs about 1.6 KB of the popup script,
// 3,276 bytes left under the 368 KB cap; crew/visuals/off-bytes.mjs). A, Crimson: the crimson frame with the teal
// controls. B, Quiet: a hairline frame, a flat header, warm paper in light, and the mark's crimson as the one accent
// (dark #df4b61 at 4.57:1 on the card, light #d31147 at 5.16:1; crew/visuals/off-ink.mjs). Pictures crew/visuals/olk2-*.
// Words: packet 35 (crew/popup/words-2026-10-12/35-open-sentence-two-lines-and-off-looks.md).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { POPUP_STRINGS } from '../../../../src/i18n/popup-strings';

const src = (f: string) => readFileSync(new URL(`../../../../src/${f}`, import.meta.url), 'utf8');

describe('Off: a picker of two looks in the footer', () => {
  it('applies the stored look before React draws, again on each read, and saves the choice', () => {
    const p = src('products/off/popup/OffPopup.tsx');
    // Split, so the repository's path check does not read the quoted import as one of this file's own.
    expect(p).toContain('import { applyLook, eagerApplyStoredLook } from ');
    expect(p).toContain("ui/shared/looks';");
    expect(p).toContain('eagerApplyStoredTheme();\neagerApplyStoredLook();\n');
    expect(p).toContain("applyLook(s.popupLook === 'b' ? 'b' : 'a');");
    expect(p).toContain("void saveSettings({ popupLook: l });");
    expect(p).toContain('<OffLooks settings={settings} />');
  });

  it('is a radio group of two named buttons that the arrow keys move', () => {
    const p = src('products/off/popup/OffPopup.tsx');
    expect(p).toContain('role="radiogroup" aria-label={t.offLookAria}');
    expect(p).toContain('role="radio" data-look={l} aria-checked={look === l} tabIndex={look === l ? 0 : -1}');
    expect(p).toContain("aria-label={l === 'a' ? t.offLookA : t.offLookB}");
    expect(p).toContain("if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;");
  });

  it('look B redraws the tokens on the root, quiets the frame and the header, and keeps one accent', () => {
    const css = src('products/off/popup/off-popup.css');
    expect(css).toContain(':root[data-look="b"] { --fw-bg: #0b0c10; --fw-card: #15161b; --fw-teal: #df4b61; --fw-on-accent: #0a0a0a; }');
    expect(css).toContain(':root[data-look="b"][data-theme="light"] { --fw-bg: #f7f4f0; --fw-card: #fdfbf8; --fw-teal: #d31147; --fw-on-accent: #ffffff; }');
    expect(css).toContain(':root[data-look="b"] body:not(.fw-detached) .fw-popup.fw-off::after { border-color: var(--fw-border-light); box-shadow: none; }');
    expect(css).toContain('html[data-look="b"] body:not(.fw-detached) .fw-popup.fw-off .pop-header { background: var(--fw-bg); }');
    expect(css).toContain(':root[data-look="b"] .fw-off .off-hidden { color: var(--fw-text-secondary); }');
    expect(css).toContain('.fw-off .look-btn {\n  width: 24px; height: 24px;');
  });

  it('every language names the picker and both looks', () => {
    const want = {
      en: ['Style of this window', 'Crimson', 'Quiet'],
      ro: ['Stilul acestei ferestre', 'Carmin', 'Liniștit'],
      es: ['Estilo de esta ventana', 'Carmesí', 'Sobrio'],
      'pt-BR': ['Estilo desta janela', 'Carmesim', 'Discreto'],
    } as const;
    for (const [lang, [aria, a, b]] of Object.entries(want)) {
      const t = POPUP_STRINGS[lang as keyof typeof POPUP_STRINGS];
      expect([t.offLookAria, t.offLookA, t.offLookB], lang).toEqual([aria, a, b]);
    }
  });
});
