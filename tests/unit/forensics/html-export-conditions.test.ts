/** @vitest-environment jsdom */
// Capability audit 2026-09-06, P0 item 3: page one states the conditions the
// records were made under. Per epoch: the mode (userAgeCategory, on every
// record) and the configuration at capture (configSnapshot threshold and daily
// cap, with the count of records that carry no snapshot). A multi-key file
// carries them as two columns beside the models column; a single-key file as
// one summary row. The FW version that wrote a record is not on the record
// (the audit, section 2), so no version column is invented.

import { describe, expect, it } from 'vitest';
import type { ForensicRecord } from '../../../src/types/forensic';
import {
  buildForensicHtmlExport,
  computeEpochSummaries,
  conditionsText,
  modesText,
  I18N,
} from '../../../src/forensics/html-export';

function record(fp: string, position: number, over: Partial<ForensicRecord> = {}): ForensicRecord {
  return {
    id: `fr-${fp}-${position}`,
    timestamp: new Date(Date.UTC(2026, 5, 1 + (position % 20), 0, 0, position % 60)).toISOString(),
    platform: 'twitter',
    originalText: `t${position}`,
    originalHash: `oh${position}`,
    originalLength: 2,
    techniques: [],
    overallScore: 0,
    userAgeCategory: 'adult',
    chainPosition: position,
    integrityHash: `h${fp}${position}`,
    publicKeyFingerprint: fp,
    configSnapshot: { mode: 'adult', threshold: 0.6, dailyCap: 50 },
    ...over,
  } as ForensicRecord;
}

const ACTIVE = 'fd3577e462c42ebc';
const OLD = 'c77cfc0df6327079';

function build(records: ForensicRecord[], locale: keyof typeof I18N = 'en'): string {
  return buildForensicHtmlExport(records, {
    fwVersion: 'FeelingWise V2.5.2',
    publicKeyJwk: {},
    publicKeyFingerprint: ACTIVE,
    locale,
  });
}

function mixed(): ForensicRecord[] {
  return [
    record(ACTIVE, 0),
    record(ACTIVE, 1),
    record(ACTIVE, 2, { userAgeCategory: 'teen', kind: 'comment', configSnapshot: { mode: 'teen', threshold: 6, dailyCap: 50 } }),
    record(ACTIVE, 3, { configSnapshot: undefined }),
    record(OLD, 0, { userAgeCategory: 'child', configSnapshot: { mode: 'child', threshold: 0.4, dailyCap: 20 } }),
    record(OLD, 1, { userAgeCategory: 'child', configSnapshot: undefined }),
  ];
}

describe('computeEpochSummaries: modes and conditions', () => {
  it('counts modes and distinct configurations per key, most records first, and the snapshot-less', () => {
    const epochs = computeEpochSummaries(mixed(), ACTIVE);
    const own = epochs.find(e => e.ownKey)!;
    expect(own.modes).toEqual([{ mode: 'adult', records: 3 }, { mode: 'teen', records: 1 }]);
    expect(own.conditions).toEqual([
      { threshold: 0.6, dailyCap: 50, records: 2 },
      { threshold: 6, dailyCap: 50, records: 1 },
    ]);
    expect(own.noSnapshot).toBe(1);
    const old = epochs.find(e => e.fingerprint === OLD)!;
    expect(old.modes).toEqual([{ mode: 'child', records: 2 }]);
    expect(old.conditions).toEqual([{ threshold: 0.4, dailyCap: 20, records: 1 }]);
    expect(old.noSnapshot).toBe(1);
  });

  it('renders the words in the export language', () => {
    const own = computeEpochSummaries(mixed(), ACTIVE).find(e => e.ownKey)!;
    expect(modesText(own, I18N.en)).toBe('3 recorded with the app in adult mode (a setting from before the three modes), 1 recorded with the app in teen mode (a setting from before the three modes)');
    expect(conditionsText(own, I18N.en)).toBe('2 at confidence cut 0.6, daily cap 50; 1 at severity floor 6 of 10, daily cap 50; 1 of them do not carry the settings the app was running under, so this file cannot say what those were');
    expect(modesText(own, I18N.ro)).toBe('3 înregistrate cu aplicația în modul adult (o setare de dinainte de cele trei moduri), 1 înregistrate cu aplicația în modul adolescent (o setare de dinainte de cele trei moduri)');
    expect(conditionsText(own, I18N.ro)).not.toMatch(/\{(n|t|c)\}/);
  });

  it('the note on a setting from before the levels does not depend on a date, in the four languages', () => {
    expect(I18N.en.epochModeBeforeLevels).toBe('(a setting from before the three modes)');
    expect(I18N.es.epochModeBeforeLevels).toBe('(un ajuste de antes de los tres modos)');
    expect(I18N['pt-BR'].epochModeBeforeLevels).toBe('(uma configuração de antes dos três modos)');
    expect(I18N.ro.epochModeBeforeLevels).toBe('(o setare de dinainte de cele trei moduri)');
    for (const lang of [I18N.en, I18N.es, I18N['pt-BR'], I18N.ro]) {
      expect(lang.epochModeBeforeLevels).not.toMatch(/\d/);
    }
  });

  it('a record written under a level says the level, with no note, in the four languages', () => {
    const e = { modes: [{ mode: 'strict', records: 2 }, { mode: 'relaxed', records: 1 }, { mode: 'child', records: 1 }] } as Parameters<typeof modesText>[0];
    expect(modesText(e, I18N.en)).toBe('2 recorded with the app in silent mode, 1 recorded with the app in open mode, 1 recorded with the app in child mode (a setting from before the three modes)');
    expect(modesText(e, I18N.ro)).toContain('2 înregistrate cu aplicația în modul silențios, 1 înregistrate cu aplicația în modul deschis');
    expect(modesText(e, I18N.es)).toContain('2 registrados con la aplicación en modo silencioso');
    expect(modesText(e, I18N['pt-BR'])).toContain('2 registrados com o aplicativo em modo silencioso');
  });
});

describe('page one: conditions', () => {
  it('a multi-key file carries mode and configuration as two columns beside the models column', () => {
    const html = build(mixed());
    document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
    const heads = Array.from(document.querySelectorAll('.fw-epochs thead th')).map(th => th.textContent);
    const at = heads.indexOf(I18N.en.epochColModels);
    expect(at).toBeGreaterThan(-1);
    expect(heads.slice(at, at + 3)).toEqual([I18N.en.epochColModels, I18N.en.epochColModes, I18N.en.epochColConditions]);
    const rows = Array.from(document.querySelectorAll('.fw-epochs tbody tr'));
    expect(rows[0].textContent).toContain('3 recorded with the app in adult mode (a setting from before the three modes), 1 recorded with the app in teen mode (a setting from before the three modes)');
    expect(rows[0].textContent).toContain('2 at confidence cut 0.6, daily cap 50');
    expect(rows[0].textContent).toContain('1 at severity floor 6 of 10');
    expect(rows[1].textContent).toContain('2 recorded with the app in child mode (a setting from before the three modes)');
    expect(rows[1].textContent).toContain('1 of them do not carry the settings the app was running under, so this file cannot say what those were');
    // no single-key row on a multi-key file
    expect(html).not.toContain(`${I18N.en.summaryConditions}:</dt>`);
  });

  it('a single-key file carries the same conditions as one summary row', () => {
    const html = build(mixed().filter(r => r.publicKeyFingerprint === ACTIVE));
    expect(html).not.toContain('<table class="fw-epochs"');
    expect(html).toContain(`${I18N.en.summaryConditions}:</dt><dd data-fw-prov="conditions">3 recorded with the app in adult mode (a setting from before the three modes), 1 recorded with the app in teen mode (a setting from before the three modes)<br>`);
    expect(html).toContain('2 at confidence cut 0.6, daily cap 50; 1 at severity floor 6 of 10, daily cap 50; 1 of them do not carry the settings the app was running under, so this file cannot say what those were');
  });

  it('every locale resolves its placeholders', () => {
    for (const locale of Object.keys(I18N) as Array<keyof typeof I18N>) {
      const html = build(mixed(), locale);
      const start = html.indexOf('<table class="fw-epochs"');
      const table = html.slice(start, html.indexOf('</table>', start));
      expect(table, locale).not.toMatch(/\{(n|t|c)\}/);
      expect(table, locale).toContain(I18N[locale].epochColConditions);
    }
  });
});
