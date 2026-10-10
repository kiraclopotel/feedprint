// Receipts sells no key, and most installs hold none: they run the built-in filter and no AI at
// all. Some screens still spoke as if every install had a live AI layer ("the AI layer is BETA",
// "AI Safety Interpretations" over every coloured edge, "Unlock AI protection", "Receipts stopped
// scanning" at a limit the built-in filter never reaches). Each sentence here has to be true for
// an install without a key and still true for one that holds an old key.

import { describe, expect, it } from 'vitest';

import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { I18N } from '../../../src/i18n/export-strings';
import { UI_LANGUAGES } from '../../../src/i18n';

type Lang = (typeof UI_LANGUAGES)[number];

/** The built-in filter, named where a sentence says who read the feed. */
const BUILT_IN: Record<Lang, RegExp> = {
  en: /built-in filter/i,
  es: /filtro integrado/i,
  'pt-BR': /filtro embutido/i,
  ro: /filtrul încorporat|filtrului încorporat|filtrul său încorporat/i,
};

const AI_LAYER_BETA = /AI layer is BETA|capa de IA está en BETA|camada de IA está em BETA|stratul AI este BETA/i;
const STOPPED_SCANNING = /stopped scanning|dejó de analizar|parou de analisar|a oprit scanarea/i;
const EVERY_EDGE_IS_AI = /These are AI Safety Interpretations|Son Interpretaciones de Seguridad de la IA|São Interpretações de Segurança da IA|Acestea sunt Interpretări de Siguranță AI/;
const AI_CLASSIFIED_ALL = /how AI Safety Interpretation classified|cómo la Interpretación de Seguridad de la IA clasificó|como a Interpretação de Segurança da IA classificou|modul în care Interpretarea de Siguranță AI a clasificat/;

describe.each(UI_LANGUAGES)('%s', (lang) => {
  const d = DASHBOARD_STRINGS[lang];
  const e = I18N[lang];

  it('no screen calls the AI layer BETA', () => {
    for (const s of [d.statsLimit4, d.recordLimit3]) expect(s).not.toMatch(AI_LAYER_BETA);
  });

  it('the record\'s limits name the built-in filter and the AI only where a key turned it on', () => {
    expect(d.statsLimit4).toMatch(BUILT_IN[lang]);
    expect(d.recordLimit3).toMatch(BUILT_IN[lang]);
  });


  it('a limit stops the AI reading, not the scanning: the built-in filter and the record go on', () => {
    expect(d.opsLegendCapBody).not.toMatch(STOPPED_SCANNING);
    expect(d.opsLegendCapBody).toMatch(BUILT_IN[lang]);
  });

  it('the export does not call every reading an AI one', () => {
    expect(e.feedIntro).not.toMatch(EVERY_EDGE_IS_AI);
    expect(e.feedIntro).toMatch(BUILT_IN[lang]);
    expect(e.notMeasureBullets).not.toMatch(AI_CLASSIFIED_ALL);
    expect(e.notMeasureBullets).toMatch(BUILT_IN[lang]);
    // The instructions travel in every export; they reached a model only where a key turned it on.
    expect(e.methodologyIntro).toMatch(/license key|clave de licencia|chave de licença|cheie de licență/);
  });
});
