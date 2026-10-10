// A quiet stretch in the record is not the person being away.
//
// The export's "return after quiet" card counts the first record after two hours with no
// record. It called that "2+ hours away" and "the moment you reopened the app". The record
// does not know either: on a chain built by the product's own code (2026-09-20) all six such
// stretches held a signed recorder-down marker, or spanned a chain that had been lost with
// records in it. A recorder that was not running and a person who was not there leave the
// same silence, and only the second is what the card said. The counting is unchanged; the
// words now say what was measured and where the file says more.

import { describe, it, expect } from 'vitest';
import { I18N } from '../../../src/i18n/export-strings';

const LOCALES = Object.keys(I18N) as Array<keyof typeof I18N>;
// What each language said: away, a break, time out, reopened the app.
const ASSERTS_ABSENCE = /hours away|after time away|reopened the app|ore de pauză|după o pauză a avut|redeschis aplicația|sin aparecer|tiempo fuera fue|reabriste la aplicación|ou mais fora\.|tempo fora ficou|reabriu o aplicativo/i;

describe('the return card says what the record knows', () => {
  it('no language says the person was away or reopened the app', () => {
    for (const l of LOCALES) {
      for (const key of ['bhReturnSub', 'bhReturnCapParent', 'bhReturnCapSelf'] as const) {
        expect(I18N[l][key], `${String(l)} ${key}`).not.toMatch(ASSERTS_ABSENCE);
      }
    }
  });

  it('the card names the limit once, where the reader meets the number', () => {
    const LIMIT: Record<string, RegExp> = { en: /cannot tell time away from a recorder that was not running/, ro: /nu poate deosebi o pauză de un înregistrator care nu funcționa/, es: /no distingue un tiempo fuera de un registrador que no estaba en marcha/, 'pt-BR': /não distingue um tempo fora de um gravador que não estava funcionando/ };
    for (const l of LOCALES) expect(I18N[l].bhReturnSub, String(l)).toMatch(LIMIT[String(l)]);
  });

  it('the placeholders the script fills are all still there', () => {
    for (const l of LOCALES) {
      expect(I18N[l].bhReturnCapParent).toContain('%1');
      expect(I18N[l].bhReturnCapParent).toContain('%2');
      expect(I18N[l].bhReturnCapSelf).toContain('%1');
      expect(I18N[l].bhReturnCapSelf).toContain('%2');
    }
  });
});
