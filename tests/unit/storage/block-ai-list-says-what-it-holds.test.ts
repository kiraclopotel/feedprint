// The switch called "Block AI-generated content", and the list it actually
// carries.
//
// 36 hashtags ship with it. 16 are AI tags. The other 20 are sadbait,
// ragebait and pro-eating-disorder tags with their coded spellings. Until
// 2026-09-18 there were 39, the extra three being Romanian-diaspora targeting
// tags that shipped switched on to every install in every country; every other
// entry names a harm and those three named a people and a place, so they are
// kept in the same file under REGIONAL_TARGETING_HASHTAGS_NOT_DEFAULT with the
// reasoning, and ship to nobody. The module's own docblock says so plainly
// ("Despite the feature's name, scope spans the full harm-tag catalog"), and
// the line under the switch in the popup said "Hides posts tagged #aimade,
// #aigenerated and similar", in four languages, with the store listing draft
// saying the same in its own four.
//
// So a parent who turned the switch off to let AI art through also un-hid
// #anorexia, #skinnytok and #thinsp0, and nothing they could read told them.
// The behaviour is his 2026-05-25 decision and stands; what stops here is the
// sentence that describes it as AI only.
//
// This test is two locks. The first is on the list: if it ever became AI-only,
// the copy below would be the wrong copy, and this says so instead of leaving a
// stale sentence in four languages. The second is on the copy: no shipped
// language may describe the switch with the old AI-only claim.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_AI_BLOCKLIST_HASHTAGS,
  REGIONAL_TARGETING_HASHTAGS_NOT_DEFAULT,
} from '../../../src/storage/block-ai-defaults';
import { POPUP_STRINGS } from '../../../src/i18n/popup-strings';
import { repoPath } from '../../helpers/repo-root';

/**
 * The section comments the DEFAULT list is grouped by, and their counts.
 *
 * Scoped to the default array on purpose. The file also holds tags that are
 * researched and deliberately not shipped, and counting those against the
 * shipped list's length would compare two different things: exactly the shape
 * of mistake the rest of this file exists to catch (2026-09-18).
 */
function sections(): Map<string, number> {
  const whole = readFileSync(repoPath('src', 'storage', 'block-ai-defaults.ts'), 'utf8');
  const from = whole.indexOf('DEFAULT_AI_BLOCKLIST_HASHTAGS');
  expect(from, 'found the default list').toBeGreaterThan(-1);
  const to = whole.indexOf('];', from);
  expect(to, 'found the end of the default list').toBeGreaterThan(from);
  const src = whole.slice(from, to);
  const out = new Map<string, number>();
  let current = '';
  for (const line of src.split(/\r?\n/)) {
    const comment = line.match(/^\s*\/\/ (.+)$/);
    if (comment && /—|\+|tags/.test(comment[1])) { current = comment[1]; continue; }
    if (/^\s*'[a-z0-9]+',\s*$/.test(line) && current) out.set(current, (out.get(current) ?? 0) + 1);
  }
  return out;
}

describe('the hashtag list this switch ships with', () => {
  it('is mostly not about AI, which is why the copy may not say it is', () => {
    const counts = sections();
    const ai = [...counts.entries()].filter(([s]) => /AI-generated/.test(s)).reduce((n, [, c]) => n + c, 0);
    const total = [...counts.values()].reduce((n, c) => n + c, 0);
    expect(total, 'every default tag is inside a named section').toBe(DEFAULT_AI_BLOCKLIST_HASHTAGS.length);
    expect(ai, 'some of the list is AI tags').toBeGreaterThan(0);
    expect(total - ai, 'most of the list is not').toBeGreaterThan(ai);
  });

  it('still carries the tags a parent would be surprised to un-hide', () => {
    for (const tag of ['anorexia', 'skinnytok', 'thinsp0', 'ragebait', 'sadtok']) {
      expect(DEFAULT_AI_BLOCKLIST_HASHTAGS, tag).toContain(tag);
    }
  });
});

describe('what the popup says the switch does', () => {
  const langs = Object.keys(POPUP_STRINGS) as Array<keyof typeof POPUP_STRINGS>;

  it('never describes it as AI tags only, in any shipped language', () => {
    for (const lang of langs) {
      const desc = POPUP_STRINGS[lang].featBlockAiDesc;
      // The old sentence named two AI tags and stopped. A description that
      // mentions #aigenerated and nothing else is that sentence again.
      expect(desc.length, `${lang} says more than the tag names`).toBeGreaterThan(70);
      expect(desc, `${lang} does not end at "and similar"`).not.toMatch(/#aigenerated[^.]*\.$/);
    }
  });

  it('says it hides by hashtag rather than by what made the post', () => {
    expect(POPUP_STRINGS.en.featBlockAiDesc).toContain('hashtag');
    expect(POPUP_STRINGS.ro.featBlockAiDesc).toContain('hashtag');
    expect(POPUP_STRINGS.es.featBlockAiDesc).toContain('hashtag');
    expect(POPUP_STRINGS['pt-BR'].featBlockAiDesc).toContain('hashtag');
  });
});

// The switch hides a post for either of two reasons, a listed hashtag or a mark
// saying it was made with AI, so its name says both and claims no more.
describe('what the popup calls the switch', () => {
  const langs = Object.keys(POPUP_STRINGS) as Array<keyof typeof POPUP_STRINGS>;
  // How each table says "label", in the name and again in the description.
  const LABEL_WORD: Record<keyof typeof POPUP_STRINGS, string> = {
    en: 'label', ro: 'marcaj', es: 'etiqueta', 'pt-BR': 'rótulo',
  };
  const AI_CONTENT_CLAIM = /generated|generado|gerado|generat|AI content|contenido de IA|conteúdo de IA|conținut(ul)? AI/i;

  it('still has both rules to name', () => {
    const blocker = readFileSync(repoPath('src', 'content', 'engagement', 'ai-content-blocker.ts'), 'utf8');
    expect(blocker, 'the hashtag rule').toMatch(/reason: 'hashtag'/);
    expect(blocker, 'the AI label rule').toMatch(/reason: `ai-label:\$\{lang\}`/);
  });

  it('names the hashtag and the AI label, and the description says what the label is', () => {
    for (const lang of langs) {
      const t = POPUP_STRINGS[lang];
      expect(t.featBlockAiName, `${lang} name`).toMatch(/hashtag/i);
      expect(t.featBlockAiName, `${lang} name`).toContain(LABEL_WORD[lang]);
      expect(t.featBlockAiDesc, `${lang} description`).toContain(LABEL_WORD[lang]);
    }
  });

  it('never calls it a blocker of AI-generated content, in its row or in the Child mode line', () => {
    for (const lang of langs) {
      const t = POPUP_STRINGS[lang];
      expect(t.featBlockAiName, `${lang} name`).not.toMatch(AI_CONTENT_CLAIM);
      expect(t.levelSentenceChild, `${lang} Child mode line`).not.toMatch(AI_CONTENT_CLAIM);
    }
  });
});

// The shipped default may name harms and not people.
//
// Added 2026-09-18, after three tags naming a nationality and a country shipped
// switched on to every install for four months. Nobody put them there
// carelessly: they came out of real harm research into diaspora-targeting
// content, and they sat in a list where every neighbour was a pro-anorexia or
// rage-bait tag, so they read as belonging. That is exactly why a rule is worth
// more here than care.
//
// The list is deliberately short and deliberately not clever. It cannot detect
// the general case, and a check that pretended to would be worse than none. It
// names the shapes this product would actually reach for, in the four languages
// it ships in, and it fails loudly enough that whoever adds the next one has to
// decide on purpose rather than by habit.
describe('the default list names harms, not peoples or places', () => {
  // Nationality and ethnicity stems, plus the country and platform-venue tags
  // a regional list reaches for first. Matched as substrings, because the tags
  // are concatenated words with no separators.
  const IDENTITY_OR_PLACE = [
    'romani', 'roman', 'rroma', 'tigan', 'ungur', 'maghiar', 'evre', 'jew',
    'arab', 'musul', 'muslim', 'islam', 'crestin', 'christian', 'ortodox',
    'migrant', 'imigr', 'immigr', 'refug', 'strainatate', 'diaspora',
    'uktiktok', 'ukraini', 'rusi', 'russian', 'polski', 'polish', 'turc',
    'latino', 'hispan', 'negri', 'asian', 'chinez', 'chinese', 'indian',
  ];

  it('ships no tag naming a nationality, an ethnicity or a country', () => {
    const offenders = DEFAULT_AI_BLOCKLIST_HASHTAGS.filter(
      (tag) => IDENTITY_OR_PLACE.some((stem) => tag.includes(stem)));
    expect(
      offenders,
      'a default that hides a people rather than a harm; if the research is real, '
      + 'gate it on the reader\'s own locale the way the regional word lists are, '
      + 'and keep it out of the universal default',
    ).toEqual([]);
  });

  // A check that found nothing because it looked for nothing is worthless.
  it('would have caught the three that shipped', () => {
    const shipped = ['romaniidinstrainatate', 'romaniinuk', 'uktiktok'];
    for (const tag of shipped) {
      expect(
        IDENTITY_OR_PLACE.some((stem) => tag.includes(stem)),
        `${tag} is the shape this check exists for`,
      ).toBe(true);
    }
  });

  // And does not fire on the harms the list is for, which is the half that
  // decides whether the rule can stay.
  it('is quiet on every harm tag the list carries', () => {
    for (const tag of ['thinspo', 'anorexia', 'ragebait', 'aislop', 'skinnytok', 'sadtok']) {
      expect(
        IDENTITY_OR_PLACE.some((stem) => tag.includes(stem)),
        `${tag} is a harm and must not trip this`,
      ).toBe(false);
    }
  });

  it('keeps the research it removed, rather than deleting it', () => {
    expect(REGIONAL_TARGETING_HASHTAGS_NOT_DEFAULT).toContain('romaniidinstrainatate');
    for (const tag of REGIONAL_TARGETING_HASHTAGS_NOT_DEFAULT) {
      expect(DEFAULT_AI_BLOCKLIST_HASHTAGS, `${tag} must not be back in the default`)
        .not.toContain(tag);
    }
  });
});
