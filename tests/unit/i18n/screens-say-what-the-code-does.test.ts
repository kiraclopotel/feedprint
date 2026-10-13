// Screen sentences a parent or a reader acts on, held to what the code does: what Reset record keeps,
// what Re-check writes, what the AI is sent for a comment, which exports carry the checker, what leaves
// the computer, when the PIN is asked again, what a backup folder holds.
//
// English is pinned by the claim it must make and the claim it must not. The other three languages are
// pinned by the words that carry the same claim, so a reworded translation that drops the claim fails
// here instead of drifting away from the English unnoticed.

import { describe, expect, it } from 'vitest';
import { DASHBOARD_STRINGS } from '../../../src/i18n/dashboard-strings';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';

type Lang = 'en' | 'es' | 'pt-BR' | 'ro';
const LANGS: Lang[] = ['en', 'es', 'pt-BR', 'ro'];
const D = DASHBOARD_STRINGS as unknown as Record<Lang, Record<string, unknown>>;
const P = POPUP_STRINGS as unknown as Record<Lang, Record<string, unknown>>;

function text(t: Record<Lang, Record<string, unknown>>, lang: Lang, key: string): string {
  const v = t[lang][key];
  expect(typeof v, `${lang}.${key}`).toBe('string');
  return v as string;
}

/** One pattern per language: the words that carry the claim. */
function everyLangHas(t: Record<Lang, Record<string, unknown>>, key: string, want: Record<Lang, RegExp>) {
  for (const lang of LANGS) {
    expect(text(t, lang, key), `${lang}.${key}`).toMatch(want[lang]);
  }
}
function noLangHas(t: Record<Lang, Record<string, unknown>>, key: string, gone: Record<Lang, RegExp>) {
  for (const lang of LANGS) {
    expect(text(t, lang, key), `${lang}.${key}`).not.toMatch(gone[lang]);
  }
}

describe('screen sentences match what the code does', () => {
  it('Reset record says the entries move to the archives, the signing key stays, the PIN is asked if one is set', () => {
    for (const key of ['hdrResetTip', 'hdrHelpResetBody']) {
      everyLangHas(D, key, {
        en: /monthly archives/,
        es: /archivos mensuales/,
        'pt-BR': /arquivos mensais/,
        ro: /arhivele lunare/,
      });
      everyLangHas(D, key, {
        en: /signing key/,
        es: /clave de firma/,
        'pt-BR': /chave de assinatura/,
        ro: /cheia de semnare/,
      });
      noLangHas(D, key, {
        en: /wipe everything|Destructive/i,
        es: /borra todo|Destructivo/i,
        'pt-BR': /apaga tudo|Destrutivo/i,
        ro: /șterge tot|Distructiv/i,
      });
    }
    expect(text(D, 'en', 'hdrResetTip')).toMatch(/Asks for the PIN if one is set/);
  });

  it('Re-check says it adds a new signed entry, not that nothing is stored', () => {
    everyLangHas(D, 'feedRecheckTip', {
      en: /new signed entry/,
      es: /entrada firmada nueva/,
      'pt-BR': /nova entrada assinada/,
      ro: /intrare nouă, semnată/,
    });
    noLangHas(D, 'feedRecheckTip', {
      en: /nothing is stored/i,
      es: /no se guarda nada/i,
      'pt-BR': /nada é guardado/i,
      ro: /nu se stochează nimic/i,
    });
  });

  it('the allowance line says every key has the same allowance, not that a higher plan gives more', () => {
    everyLangHas(D, 'opsCardCapAction', {
      en: /Every license key has the same allowance/,
      es: /Todas las claves de licencia tienen la misma cuota/,
      'pt-BR': /Todas as chaves de licença têm a mesma cota/,
      ro: /Toate cheile de licență au aceeași cotă/,
    });
    noLangHas(D, 'opsCardCapAction', {
      en: /higher plan/i,
      es: /plan superior/i,
      'pt-BR': /plano maior/i,
      ro: /plan superior/i,
    });
  });

  it('the checker is said to be in the HTML exports only', () => {
    everyLangHas(D, 'anchorVerifierValue', {
      en: /every HTML export/,
      es: /cada exportación HTML/,
      'pt-BR': /cada exportação em HTML/,
      ro: /fiecare export HTML/,
    });
    noLangHas(D, 'anchorVerifierValue', {
      en: /bundled with every export/,
      es: /cada exportación$/,
      'pt-BR': /cada exportação$/,
      ro: /fiecare export$/,
    });
    for (const lang of LANGS) {
      const list = D[lang].anchorExplainers as Array<{ why: string }>;
      const why = list.map((x) => x.why).find((w) => /JSON/.test(w)) ?? '';
      expect(why, `${lang}.anchorExplainers checker sentence`).not.toBe('');
      expect(why, lang).toMatch(/JSON/);
      expect(why, lang).toMatch(/CSV/);
      expect(why, lang).toMatch(/PDF/);
      expect(why, lang).not.toMatch(/Every export includes|Cada exportaci[oó]n incluye|Cada exporta[cç][aã]o inclui|Fiecare export include/);
    }
  });

  // The read-one-item card and its sentence left Home on 9 Oct 2026 (his word).

  it('the PIN sentence says the second ask is for leaving Silent', () => {
    everyLangHas(P, 'setupPinBody', {
      en: /leaving Silent asks for it again/,
      es: /salir de Silencioso lo vuelve a pedir/,
      'pt-BR': /sair do Silencioso pede o PIN de novo/,
      ro: /ieșirea din nivelul Silențios îl cere din nou/,
    });
    noLangHas(P, 'setupPinBody', {
      en: /asked a second time before the mode itself changes/,
      es: /se pide una segunda vez antes de que cambie el modo/,
      'pt-BR': /pedido uma segunda vez antes de o modo mudar/,
      ro: /cerut a doua oară înainte ca modul/,
    });
  });

  it('the backup-folder sentence says a hand-made backup still asks where to save', () => {
    everyLangHas(D, 'folderWireBody', {
      en: /still asks where to save/,
      es: /sigue preguntando dónde guardarla/,
      'pt-BR': /continua perguntando onde salvar/,
      ro: /tot te întreabă unde/,
    });
    noLangHas(D, 'folderWireBody', {
      en: /every backup is written there silently/i,
      es: /cada copia se escribe ahí en silencio/i,
      'pt-BR': /cada cópia é escrita ali em silêncio/i,
      ro: /fiecare copie de siguranță este scrisă acolo/i,
    });
  });

  it('the install-locked backup warning says no copy has a passphrase, and names the backup-folder exception', () => {
    for (const lang of LANGS) {
      const fn = D[lang].backupHealthInstallLockedOnly as (age: string) => string;
      const s = fn('2 days ago');
      expect(s, lang).toContain('2 days ago');
    }
    const en = (D.en.backupHealthInstallLockedOnly as (a: string) => string)('X');
    expect(en).toMatch(/no copy has been saved with a passphrase/);
    expect(en).toMatch(/unless you named a backup folder/);
    expect(en).not.toMatch(/every copy so far is locked/);
    expect((D.es.backupHealthInstallLockedOnly as (a: string) => string)('X')).toMatch(/ninguna copia se ha guardado con contraseña/);
    expect((D['pt-BR'].backupHealthInstallLockedOnly as (a: string) => string)('X')).toMatch(/nenhuma cópia foi salva com senha/);
    expect((D.ro.backupHealthInstallLockedOnly as (a: string) => string)('X')).toMatch(/nicio copie nu a fost salvată cu parolă/);
  });

  // B2 unit 5 (30 Sep 2026), said again on 12 Oct 2026 (packet 33) now that Silent reads with a key: the record stays on
  // this computer and only a code with no post text leaves, for the time stamp; Silent without a key sends nothing at
  // all; the rephrasing the levels describe needs a key for Live Rephrase, and without one every level filters on this
  // computer. es, pt-BR and ro say "a code that identifies the record" in place of "fingerprint".
  it('the welcome line says the record stays on the computer, only a code leaves, Silent without a key sends nothing, and the rephrasing needs a key', () => {
    everyLangHas(P, 'setupWelcomeBody1', {
      en: /keeps that record on this computer\./,
      es: /guarda ese registro en este ordenador\./,
      'pt-BR': /guarda esse registro neste computador\./,
      ro: /păstrează acest registru pe acest calculator\./,
    });
    everyLangHas(P, 'setupWelcomeBody1', {
      en: /Only a fingerprint of it, with no post text, goes to independent time-stamp services so the record can be dated; Silent without a key sends nothing at all\./,
      es: /Solo un código que identifica el registro, sin texto de publicaciones, se envía a servicios de sellado de tiempo independientes para poder fechar el registro; Silencioso sin clave no envía nada en absoluto\./,
      'pt-BR': /Só um código que identifica o registro, sem texto de publicações, vai para serviços independentes de carimbo de tempo, para que o registro possa ser datado; o Silencioso sem chave não envia nada\./,
      ro: /Doar un cod care identifică registrul, fără textul postărilor, ajunge la servicii independente de marcare a timpului, ca registrul să poată fi datat; nivelul Silențios fără cheie nu trimite nimic deloc\./,
    });
    everyLangHas(P, 'setupWelcomeBody1', {
      en: /needs a key for Live Rephrase; without one, every level filters on this computer\./,
      es: /necesita una clave para Live Rephrase; sin ella, cada nivel filtra en este ordenador\./,
      'pt-BR': /precisa de uma chave do Live Rephrase; sem ela, todos os níveis filtram neste computador\./,
      ro: /are nevoie de o cheie pentru Live Rephrase; fără cheie, fiecare nivel filtrează pe acest calculator\./,
    });
    // The old sentences, each false now, do not come back: the time stamp as the whole story, "Silent sends nothing until".
    noLangHas(P, 'setupWelcomeBody1', {
      en: /so the record can be dated\./,
      es: /para poder fechar el registro\./,
      'pt-BR': /para que o registro possa ser datado\./,
      ro: /ca registrul să poată fi datat\./,
    });
    noLangHas(P, 'setupWelcomeBody1', {
      en: /on this computer only/,
      es: /solo en esta computadora,/,
      'pt-BR': /só neste computador,/,
      ro: /doar pe acest calculator,/,
    });
  });
});
