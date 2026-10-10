// The Romanian saved file speaks one way: polite, "dumneavoastră" (GLOSSARY.md; the head's word of 1 Oct).
//
// Ten lines had slipped into the familiar "tu" (te, tine, tău, ți-a, "Decide", "Cere", "deschide") while about fifty
// lines around them say "dumneavoastră". The check holds the ten values as written, and holds the familiar forms out of
// every Romanian value of the saved file's table. "Pentru tine" is TikTok's own tab name and stays; it is taken out
// before the scan.

import { describe, expect, it } from 'vitest';
import { I18N as EXPORT_STRINGS } from '../../../src/i18n/export-strings';

const RO = (EXPORT_STRINGS as unknown as Record<string, Record<string, unknown>>).ro;

// What each of the ten reads now. The slots ({name}, {list}, {n}, {sample}) and the trailing spaces are part of the value.
const POLITE: Record<string, string> = {
  whatThisFileTells: 'Ce spune acest fișier despre dumneavoastră',
  whatThisFileTellsIntroNamed: 'Acest fișier vă numește {name}, un nume ales de dumneavoastră. Nu conține nicio adresă și niciun cont al dumneavoastră. Vă identifică oricum, din ce vi s-a arătat: {list}. ',
  whatThisFileTellsIntro: 'Acest fișier nu conține numele dumneavoastră, nicio adresă și niciun cont al dumneavoastră. Vă identifică oricum, din ce vi s-a arătat: {list}. ',
  tellsAdvertisers: '{n} agenți publicitari care au plătit ca să ajungă la dumneavoastră',
  tellsContainers: '{n} grupuri sau comunități cu nume în care vă aflați{sample}',
  tellsLinks: '{n} legături înapoi către propria dumneavoastră vedere asupra elementelor',
  feedViewOriginal: 'deschideți postarea originală',
  feedViewComment: 'deschideți exact acest comentariu',
};

// The familiar forms, whole words (a letter on either side makes it another word: "ține" is not "tine").
const FAMILIAR = /(?<![\p{L}])(tău|tale|ta|tine|ți-a|te numește|te aflai|Decide cine|Cere întregul|deschide postarea|deschide exact)(?![\p{L}])/u;

describe('the Romanian saved file speaks one way, polite', () => {
  it('the ten lines that said "tu" read as the polite form', () => {
    expect(RO, 'no Romanian table').toBeTruthy();
    for (const [key, want] of Object.entries(POLITE)) expect(RO[key], key).toBe(want);
    expect(String(RO.whatThisFileTellsOutro)).toMatch(/Decideți cine primește fișierul pe această bază\.$/);
    expect(String(RO.chainNoteOutsideStated)).toMatch(/Cereți întregul registru dacă aveți nevoie de tot\.$/);
  });

  it('no Romanian value of the saved file uses the familiar "tu"', () => {
    const hits: string[] = [];
    for (const [key, value] of Object.entries(RO)) {
      if (typeof value !== 'string') continue;
      const text = value.replace(/Pentru tine/g, '');
      const m = FAMILIAR.exec(text);
      if (m) hits.push(`${key}: …${text.slice(Math.max(0, m.index - 20), m.index + 40)}…`);
    }
    expect(hits).toEqual([]);
  });
});
