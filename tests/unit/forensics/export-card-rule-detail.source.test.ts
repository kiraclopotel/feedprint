/**
 * @vitest-environment node
 *
 * 2026-09-20: the per-record detail panel (VERIFIER_SCRIPT_TEMPLATE, recordDetail) is
 * built only when a details element's toggle event fires, and jsdom (checked live:
 * setting .open = true, and clicking the summary, both leave a 'toggle' listener
 * unfired) never fires that event on its own. No jsdom render can reach this
 * function, so this reads the function's own text: the byRule branch that names a
 * fixed rule's match instead of an AI reading has to exist, has to read the same
 * four fields the feed card's techTags reads (aiSource, verdict, overrideOrigin,
 * techniques), has to route through feedGateRule, has to print no severity, and has
 * to run before the fw-opinion branch so a byRule record can never fall through to
 * the disclaimer meant for a model's reading.
 */

import { describe, it, expect } from 'vitest';
import { readSource } from '../../helpers/read-source';

const src = readSource('src/forensics/html-export-scripts.ts');

const start = src.indexOf('function recordDetail(');
const end = src.indexOf('function recordLine(');
if (start < 0 || end < 0 || end <= start) {
  throw new Error('recordDetail or recordLine moved; point this scan at its new bounds.');
}
const body = src.slice(start, end);

describe('the per-record detail names a rule, never an AI reading, for a rule-decided record', () => {
  it('tests the record on the same four fields the feed card tags read', () => {
    expect(body).toContain(
      "var byRule=r.aiSource==='rules'||r.aiSource==='none'||r.verdict==='blocked'"
      + "||(typeof r.overrideOrigin==='string'&&r.overrideOrigin!=='');",
    );
  });

  it('the byRule branch guards the rule paragraph and comes before the opinion branch', () => {
    const byRuleAt = body.indexOf('if(techList&&byRule){');
    const opinionAt = body.indexOf("el('div',{'class':'fw-opinion'}");
    expect(byRuleAt).toBeGreaterThan(-1);
    expect(opinionAt).toBeGreaterThan(-1);
    expect(byRuleAt).toBeLessThan(opinionAt);
  });

  it('the rule paragraph names the technique and the gate, and prints no severity', () => {
    const byRuleAt = body.indexOf('if(techList&&byRule){');
    const elseAt = body.indexOf('}else if(techList){', byRuleAt);
    expect(byRuleAt).toBeGreaterThan(-1);
    expect(elseAt).toBeGreaterThan(byRuleAt);
    const ruleBranch = body.slice(byRuleAt, elseAt);
    expect(ruleBranch).toContain(
      "card.appendChild(el('p',null,[i18n.perRecordClassification+': '+ruleNames+' · '+i18n.feedGateRule]));",
    );
    expect(ruleBranch).not.toContain('sev');
    expect(ruleBranch).not.toContain('i18n.perRecordOpinionDisclaimer');
    expect(ruleBranch).not.toContain('fw-opinion');
  });

  it('the model-reading branch is unchanged: severity and the disclaimer, inside fw-opinion', () => {
    const elseAt = body.indexOf('}else if(techList){');
    const afterAt = body.indexOf('if(!pr.ok)', elseAt);
    expect(elseAt).toBeGreaterThan(-1);
    expect(afterAt).toBeGreaterThan(elseAt);
    const opinionBranch = body.slice(elseAt, afterAt);
    expect(opinionBranch).toContain("'class':'fw-opinion'");
    expect(opinionBranch).toContain('i18n.perRecordOpinionDisclaimer');
    expect(opinionBranch).toContain('+techList+');
    expect(body).toContain("(TL[t.name]||t.name)+' (sev '+t.severity+'/10)'");
  });
});
