// A call is metered at the price of the model that answered it (PLAN-2026-09-16 item 6.9).
//
// chatTokenEquivalents takes the model and weighs the 120b judge higher, because that is what it
// costs; the client called it without the model, so every 120b call was counted too cheaply on the
// device. The proxy always weighed by model, so the popup showed room the proxy had already spent,
// and a parent could be refused with the popup still saying there was headroom.
//
// The judge used to cost exactly twice the 20b, and this file used to assert that "twice". That was
// never a property of this system, only of Groq's price list, and it stopped being true on
// 2026-09-21 when inference moved to DeepInfra (120b is about 1.2x the 20b there, not 2x). What is
// locked now is the thing the bug was actually about: a judge call must meter strictly HIGHER than
// the same tokens on the 20b, in both directions. The exact prices are pinned separately below, so
// an accidental edit to a rate still fails something.
//
// Two locks: the arithmetic (the weights themselves), and the wiring (the client hands the model
// over). The wiring half is a source scan, because the call sits inside a fetch path that a unit
// test cannot reach without standing up the whole proxy handshake.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  chatTokenEquivalents,
  costToTokenEquivalents,
  UPSTREAM_COST_SANITY_CEILING,
  meteredTokenEquivalents,
  CHAT_120B_MODEL,
  CHAT_PROMPT_RATE_PER_1M_USD,
  CHAT_COMPLETION_RATE_PER_1M_USD,
  CHAT_120B_PROMPT_RATE_PER_1M_USD,
  CHAT_120B_COMPLETION_RATE_PER_1M_USD,
} from '../../../src/storage/usage-weights';

import { REPO_ROOT as ROOT } from '../../helpers/repo-root';

describe('AI usage is weighed by the model that answered', () => {
  it('the 120b judge weighs strictly more than the 20b, in both directions', () => {
    const small = chatTokenEquivalents(6000, 150);
    const large = chatTokenEquivalents(6000, 150, CHAT_120B_MODEL);
    expect(CHAT_120B_PROMPT_RATE_PER_1M_USD).toBeGreaterThan(CHAT_PROMPT_RATE_PER_1M_USD);
    expect(CHAT_120B_COMPLETION_RATE_PER_1M_USD).toBeGreaterThan(CHAT_COMPLETION_RATE_PER_1M_USD);
    expect(large).toBeGreaterThan(small);
  });

  it('the four live prices are the ones read off the provider, not drifted copies', () => {
    // DeepInfra, read live 2026-09-21 from its own /models metadata. If a rate is
    // edited by accident this fails; if a rate is edited on purpose, the person
    // doing it updates this line and says where the new number came from.
    expect(CHAT_PROMPT_RATE_PER_1M_USD).toBe(0.030);
    expect(CHAT_COMPLETION_RATE_PER_1M_USD).toBe(0.14);
    expect(CHAT_120B_PROMPT_RATE_PER_1M_USD).toBe(0.037);
    expect(CHAT_120B_COMPLETION_RATE_PER_1M_USD).toBe(0.17);
  });

  it('an unknown model takes the default weights rather than throwing', () => {
    expect(chatTokenEquivalents(1000, 100, 'some/other-model')).toBe(chatTokenEquivalents(1000, 100));
  });

  it('the client hands the model AND the upstream cost to the meter, not just to the record', () => {
    const src = readFileSync(join(ROOT, 'src', 'ai', 'client.ts'), 'utf8');
    expect(src).toContain('meteredTokenEquivalents(promptTokens, completionTokens, model, estimatedCost)');
    // The original bug: calling without the model metered every 120b call at half. The
    // second half of the same lock since 2026-09-21: calling without the upstream's own
    // estimated_cost means the device disagrees with the proxy the moment a price moves.
    expect(src).not.toMatch(/TokenEquivalents\(promptTokens, completionTokens\)/);
    expect(src).not.toMatch(/TokenEquivalents\(promptTokens, completionTokens, model\)/);
  });

  it('the meter bills the higher of our table and what the upstream says it charged', () => {
    // 1,000 prompt and 100 completion on the 20b is 300 + 140 = 440 by the table.
    const byTable = chatTokenEquivalents(1000, 100);
    expect(byTable).toBe(440);
    // The upstream agreeing changes nothing.
    expect(meteredTokenEquivalents(1000, 100, undefined, 440 * 1e-7)).toBe(440);
    // The upstream charging MORE than our table wins, because the monthly cap is a fuse
    // and a fuse that under-counts is not a fuse. This is what catches a price rise on
    // the day it happens rather than whenever somebody notices and edits two files.
    expect(meteredTokenEquivalents(1000, 100, undefined, 900 * 1e-7)).toBe(900);
    // The upstream charging LESS does not lower the bill below our own table.
    expect(meteredTokenEquivalents(1000, 100, undefined, 100 * 1e-7)).toBe(440);
    // Absent, zero, negative or not a number: exactly the table, as before.
    expect(meteredTokenEquivalents(1000, 100)).toBe(byTable);
    expect(meteredTokenEquivalents(1000, 100, undefined, 0)).toBe(byTable);
    expect(meteredTokenEquivalents(1000, 100, undefined, -5)).toBe(byTable);
    expect(meteredTokenEquivalents(1000, 100, undefined, Number.NaN)).toBe(byTable);
  });

  it('an upstream cost that has gone wrong is ignored, not obeyed', () => {
    // This number comes from someone else's server and decides when a paying family is
    // cut off. Just under the ceiling it is still trusted, because a real price rise
    // should be caught the day it happens.
    const byTable = chatTokenEquivalents(1000, 100);
    const justUnder = byTable * UPSTREAM_COST_SANITY_CEILING * 1e-7;
    expect(meteredTokenEquivalents(1000, 100, undefined, justUnder))
      .toBe(byTable * UPSTREAM_COST_SANITY_CEILING);
    // Past it, the table wins. A provider bug reporting an inflated cost would otherwise
    // burn a month's cap in an afternoon and refuse readings somebody had paid for, which
    // is a worse failure than the drift this feature exists to prevent.
    const absurd = byTable * (UPSTREAM_COST_SANITY_CEILING + 1) * 1e-7;
    expect(meteredTokenEquivalents(1000, 100, undefined, absurd)).toBe(byTable);
    expect(meteredTokenEquivalents(1000, 100, undefined, 1_000_000)).toBe(byTable);
  });

  it('a real upstream reply meters the same either way, which is why the max is safe', () => {
    // Probed live on 2026-09-21: 56 prompt and 16 completion tokens on gpt-oss-20b came
    // back with estimated_cost 3.92e-06. By the table that is 16.8 + 22.4 = 39.2, rounded
    // up to 40. The provider's own figure agrees to the digit, so switching the meter on
    // changed no bill; it only removed the way a stale table could be wrong in silence.
    expect(chatTokenEquivalents(56, 16)).toBe(40);
    expect(costToTokenEquivalents(3.92e-6)).toBe(40);
    expect(meteredTokenEquivalents(56, 16, undefined, 3.92e-6)).toBe(40);
  });

  it('the dollar figure is priced by the meter, not by a price table of its own', () => {
    // A second table here can only drift from what the proxy charges; the stored figure itself is
    // checked in stored-ai-cost-is-what-the-call-cost.test.ts.
    const settings = readFileSync(join(ROOT, 'src', 'storage', 'settings.ts'), 'utf8');
    expect(settings).toContain('const costUSD = (increment.tokenEquivalents / 1_000_000) * GROQ_BLENDED_RATE_PER_1M_USD;');
    expect(settings).not.toMatch(/CHAT_\w*RATE_PER_1M_USD/);
  });

  it('the licence cap converts dollars with the meter basis, not a copy of the number', () => {
    const license = readFileSync(join(ROOT, 'src', 'storage', 'license.ts'), 'utf8');
    // Matched as a pattern, not as a literal: an import line written out in this file is read by
    // the repository's resolver guard as this test's own import of a path that is not there.
    expect(license).toMatch(
      new RegExp(`import \{ GROQ_BLENDED_RATE_PER_1M_USD \} from '\./usage-weights';`),
    );
    expect(license).not.toMatch(/const GROQ_BLENDED_RATE_PER_1M\s*=/);
  });
});
