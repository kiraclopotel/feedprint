// The export's behaviour cards count order, repetition and ratios, and their words stay with
// what those counts hold. The numbers behind each card are timestamps, adjacency and views against
// likes; none of them records why. So no card may claim that the app chose, decided, built on or
// pushed anything, that a thread was brought back by the platform rather than the reader, that the
// opening of a scroll is when the app bids hardest, that rooms run hotter than their engagement
// explains, or that room temperature is chosen for the reader. An outsider reads this file as the
// record, so each language is checked for those claims. The counting itself is not under test here.

import { describe, it, expect } from 'vitest';
import { I18N } from '../../../src/i18n/export-strings';
import { MIN_RUN_RECORDS } from '../../../src/forensics/attendance';

const LOCALES = Object.keys(I18N) as Array<keyof typeof I18N>;

const KEYS = [
  'summaryUnattendedValue', 'feedReadingAsked', 'bhSkewCapSelf', 'bhAmpSub', 'bhAmpCapSelf',
  'bhAmpCapParent', 'bhCautionAmp', 'bhReserveSub', 'bhReserveCapParent', 'bhReserveCapSelf',
  'bhChainsCapParent', 'bhChainsCapSelf', 'bhVoicesCapSelf',
] as const;

// The phrasings that claim intent, in each language.
const CLAIMS_INTENT = new RegExp([
  "bids hardest", "choice, not the reader", "decided", "build on it", "escalating", "hotter than",
  "chosen for the reader", "not finished with you", "no count on this page", "boosted rooms",
  "vă cere atenția", "alegerea aplicației", "a decis", "să construiască pe ea", "escaladează",
  "ardeau mai tare", "ard mai tare", "aleasă pentru cititor", "nu au terminat", "niciun număr",
  "puja más fuerte", "decisión de la aplicación", "decidió", "construir sobre ella", "va a más",
  "más calientes", "elegida para quien lee", "no habían terminado", "ningún recuento",
  "lance mais forte", "escolha do aplicativo", "decidiu", "construir em cima", "vai aumentando",
  "mais quentes", "escolhida para quem lê", "não tinham terminado", "nenhuma contagem",
].join('|'), 'i');

// Captions that go further than the numbers: the timer rule allows a fifth of the gaps to be bursts
// (attendance.ts MAX_BURST_SHARE); a chain pairs each flagged item with the next flagged one, with
// unflagged items between; the voices are accounts seen on 3 or more days, ranked by days; nothing
// records that a platform pushed, chose, brought back or re-engaged.
const KEYS_2 = [
  'summaryUnattendedValue', 'bhChainsCapParent', 'bhVoicesCapSelf', 'bhVoicesSub',
  'bhVoicesCapParent', 'bhAmpTitle', 'bhAmpAdvNote', 'bhCautionReturn',
] as const;

const SAID_MORE = new RegExp([
  'no bursts', 'came one after another', 'most often', 'what got pushed', 'the surface did',
  'brought back on', 'builds familiarity', 'chosen to re-engage',
  'fără rafale', 'venite unul după altul', 'cel mai des', 'ce a fost împins', 'suprafața a făcut-o',
  'le-a adus înapoi', 'construiește familiaritate', 'alese să vă recâștige',
  'sin ráfagas', 'llegaron uno tras otro', 'más veces aparecieron', 'qué se empujó',
  'los eligió la superficie', 'trajo de vuelta', 'construye familiaridad', 'elegidos para reenganchar',
  'sem rajadas', 'chegaram um depois do outro', 'mais apareceram', 'o que foi empurrado',
  'a superfície escolheu', 'trouxe de volta', 'constrói familiaridade', 'escolhidos para reengajar',
].join('|'), 'i');

describe('the export report says order, not intent (second pass)', () => {
  it('no language says more than the record holds on these cards', () => {
    for (const l of LOCALES) {
      for (const key of KEYS_2) {
        expect(I18N[l][key], `${String(l)} ${key}`).not.toMatch(SAID_MORE);
      }
    }
  });

  it('the timer line allows a few bursts, as the rule does', () => {
    expect(I18N.en.summaryUnattendedValue).toContain('few bursts');
  });

  it('a chain pairs each flagged item with the next flagged one', () => {
    expect(I18N.en.bhChainsCapParent).toContain('the next flagged item');
  });

  it('every language names the stretch length the timer rule judges on', () => {
    for (const l of LOCALES) {
      expect(I18N[l].summaryUnattendedValue, String(l)).toContain(String(MIN_RUN_RECORDS));
    }
  });

  it('every language names the 3 days a voice must be seen on', () => {
    for (const l of LOCALES) {
      expect(I18N[l].bhVoicesSub, String(l)).toContain('3');
    }
  });

  it('the voices are accounts seen on 3 or more days, ranked by days', () => {
    expect(I18N.en.bhVoicesCapSelf).toContain('3 or more days');
    expect(I18N.en.bhVoicesCapSelf).toContain('number of days');
  });
});

describe('the export report says order, not intent', () => {
  it('no language says the app chose, decided, built on or pushed', () => {
    for (const l of LOCALES) {
      for (const key of KEYS) {
        expect(I18N[l][key], `${String(l)} ${key}`).not.toMatch(CLAIMS_INTENT);
      }
    }
  });

  it('the timer line names the 30-record stretch it is judged on and that timestamps are its only source', () => {
    expect(I18N.en.summaryUnattendedValue).toContain('30 or more');
    expect(I18N.en.summaryUnattendedValue).toContain('timestamps alone');
  });

  it('a thread seen on two days says the record cannot tell who brought it back', () => {
    expect(I18N.en.bhReserveSub).toContain('does not say whether the platform brought it back');
  });
});
