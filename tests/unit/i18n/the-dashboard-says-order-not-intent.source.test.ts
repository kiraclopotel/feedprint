// The dashboard's behaviour panels count what the export counts, and their words stay with those
// counts. The numbers behind them are timestamps, adjacency and views against likes, the same as
// the export's (tests/unit/forensics/the-export-report-says-order-not-intent.test.ts); none records
// why, and nothing measures a tired mind. So no panel may claim that the feed decided which voices
// and stories to keep bringing back, that one hit built on the last, that the opening of a scroll
// is when the feed bids for attention, that late content came when the reader was least likely to
// stop, that rooms run hotter than their engagement explains, or that the late hours are when tired
// minds are easiest to push. ("va a más" stays out of the list: Spanish uses it for an account whose
// flagged share is measured to rise, recidEscalating, which is a count.)

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT } from '../../helpers/repo-root';

const FILES = ['en', 'es', 'pt-br', 'ro'].map((l) => join(REPO_ROOT, 'src', 'i18n', 'dashboard', `${l}.ts`));

// The phrasings that claim intent, in each language.
const CLAIMS_INTENT = new RegExp([
  'decided you should keep hearing', 'decided some stories', 'build on it rather than release',
  'escalating scroll', 'running hotter', 'run hotter', 'chosen for the reader', 'bids for your attention',
  'least likely to stop', 'easiest to push', 'boosted rooms',
  'decidió que debías', 'decidió que algunas historias', 'construir sobre ella',
  'más calientes', 'elegida para quien lee', 'puja por tu atención', 'menos probable que pararas',
  'empujar a una mente cansada', 'secciones impulsadas',
  'decidiu que você devia', 'decidiu que algumas histórias', 'construir em cima', 'vai aumentando',
  'mais quentes', 'escolhida para quem lê', 'dá o lance', 'menos provável que você parasse',
  'empurrar uma mente cansada', 'seções impulsionadas',
  'a decis să le tot auzi', 'a decis că unele povești', 'să construiască pe ea', 'escaladează',
  'ardeau mai tare', 'ard mai tare', 'aleasă pentru cititor', 'îți cere atenția',
  'cel mai puțin probabil să te oprești', 'cel mai ușor de împins', 'camere împinse',
].join('|'), 'i');

describe('the dashboard says order, not intent', () => {
  it('no language says the feed chose, decided, built on, pushed or caught a tired mind', () => {
    for (const file of FILES) {
      const hit = readFileSync(file, 'utf8').match(CLAIMS_INTENT);
      expect(hit?.[0], file).toBeUndefined();
    }
  });
});

// Panels that go further than the numbers, read against feed-behavior-data.ts: the amplification
// counts are one per environment record (a busy room writes several), so they are readings, not
// rooms; the skew compares the first and last third of the items in a sitting, not minutes; a
// chain pairs each flagged item with the next flagged one; the voices are accounts seen on 3 or
// more days, ranked by days. Nothing records that a feed pushed, chose, brought back or
// re-engaged, or how fresh anyone's attention was.
const SAID_MORE = new RegExp([
  'first minutes of a scroll', 'attention is freshest', 'what got pushed', 'reach vs the room',
  'the surface did', 'brought back on 3', 'builds familiarity', 'chosen to re-engage',
  'came one after another', 'came up most often', 'of the comment rooms had', 'rooms read high',
  'of the rooms in this record',
  'primele minute ale unei derulări', 'atenția este cea mai proaspătă', 'ce a fost împins',
  'audiență față de implicarea', 'suprafața a făcut-o', 'le-a adus înapoi în 3', 'construiește familiaritate',
  'alese să-ți recâștige', 'venite unul după altul', 'conturile care au apărut cel mai des',
  'dintre camerele de comentarii au avut', 'citesc amplificare ridicată', 'din camerele din acest registru',
  'primeros minutos de scroll', 'atención está más fresca', 'qué se empujó', 'alcance frente a',
  'los eligió la superficie', 'trajo de vuelta en 3', 'construye familiaridad', 'elegidos para reenganchar',
  'llegaron uno tras otro', 'más veces aparecieron', 'de las secciones de comentarios tuvo',
  'secciones dieron una lectura', 'de las secciones de este registro',
  'primeiros minutos de rolagem', 'atenção está mais fresca', 'o que foi empurrado', 'alcance diante',
  'a superfície escolheu', 'trouxe de volta em 3', 'constrói familiaridade', 'escolhidos para reengajar',
  'chegaram um depois do outro', 'contas que mais apareceram', 'das seções de comentários tiveram',
  'seções deram leitura', 'das seções deste registro',
].join('|'), 'i');

describe('the dashboard says order, not intent (second pass)', () => {
  it('no language says more than the panel counts', () => {
    for (const file of FILES) {
      const hit = readFileSync(file, 'utf8').match(SAID_MORE);
      expect(hit?.[0], file).toBeUndefined();
    }
  });
});
