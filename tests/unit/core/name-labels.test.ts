// Letters for account names: the map one AI call builds, the replacement in the texts it sends,
// and the restore in what comes back. No AI call; the frozen rewrite checks are imported from
// their own modules and never edited.

import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';

import {
  authorKey,
  buildNameLabelMapForEncounter,
  buildNameLabelMapForPost,
  countIdentifierHits,
  replaceNamesInCaptionContext,
  replaceNamesInText,
  restoreNames,
  readNameLabelCounts,
  resetNameLabelCountsForTests,
  tokenFor,
  tokenForAuthor,
  BENT_FORM_SAMPLES,
  NEUTRAL_WORD,
  type NameLabelMap,
} from '../../../src/core/name-labels';
import { FORBIDDEN_META_PATTERNS, detectMetaTalk } from '../../../src/core/neutralizer';
import { validateRewrite, validateRewriteLanguage } from '../../../src/analysis/comment-rewriter';
import type { Encounter, PostNode, CommentNode } from '../../../src/types/post';

function post(handle: string, display_name?: string): PostNode {
  return {
    id: 'p1', kind: 'post', text: 'the post', metrics: {},
    author: { handle, display_name, verified: false, is_creator: false },
  };
}

function comment(handle: string, text = 'a comment', display_name?: string): CommentNode {
  return {
    id: `c-${handle}-${Math.random()}`, kind: 'top-comment', depth: 1, parent_id: 'p1', text, metrics: {},
    author: { handle, display_name, verified: false, is_pinned_by_creator: false, is_creator_hearted: false },
    render_state: 'visible-now', fw_marker_present: false,
  };
}

function encounter(p: PostNode, children: CommentNode[], ancestors: CommentNode[] = [], output_language?: string): Encounter {
  return {
    platform: 'twitter', surface: { kind: 'twitter-home-feed' }, observation_iso: '2026-09-24T00:00:00.000Z',
    encounter_id: 'enc', post: p, ancestors, focused: p, children, output_language,
  };
}

beforeEach(() => resetNameLabelCountsForTests());

describe('the map: one token per person, in order of first appearance', () => {
  it('numbers the post author first, then the thread above, then the commenters as shown', () => {
    const map = buildNameLabelMapForEncounter(encounter(
      post('creator'),
      [comment('third'), comment('fourth'), comment('third')],
      [comment('second')],
    ));
    expect(map.entries.map((e) => [e.token, e.handle])).toEqual([
      ['@user_A', 'creator'], ['@user_B', 'second'], ['@user_C', 'third'], ['@user_D', 'fourth'],
    ]);
  });

  it('gives a handle and its display name one token, and strips the leading @ the adapters add', () => {
    const map = buildNameLabelMapForEncounter(encounter(post('@pat_99', 'Pat Roe'), [comment('pat_99')]));
    expect(map.entries).toHaveLength(1);
    expect(map.entries[0]).toMatchObject({ token: '@user_A', handle: 'pat_99', displayName: 'Pat Roe' });
    expect(map.identifiers).toEqual(['@pat_99', 'Pat Roe']);
  });

  it('gives every unknown writer a token of its own, so three missing names are not one person', () => {
    const map = buildNameLabelMapForEncounter(encounter(post(''), [comment('unknown'), comment('unknown'), comment('u')]));
    expect(map.entries.map((e) => e.token)).toEqual(['@user_A', '@user_B', '@user_C', '@user_D']);
    expect(map.entries.every((e) => e.unknown)).toBe(true);
    expect(map.identifiers).toEqual([]);
  });

  it('keys the repeat-poster count the same way: @ stripped, case and accents folded, markers are nobody', () => {
    expect(authorKey('@Jess')).toBe('jess');
    expect(authorKey('jess')).toBe('jess');
    expect(authorKey('Ștefan')).toBe('stefan');
    expect(authorKey('unknown')).toBeNull();
    expect(authorKey('')).toBeNull();
    expect(authorKey('u')).toBeNull();
    expect(authorKey('corpus')).toBeNull();
  });

  it('goes on past Z: sixty people end at @user_BH and every token is distinct', () => {
    const children = Array.from({ length: 59 }, (_, i) => comment(`person${i + 1}`));
    const map = buildNameLabelMapForEncounter(encounter(post('author'), children));
    expect(map.entries).toHaveLength(60);
    expect(map.entries[25].token).toBe('@user_Z');
    expect(map.entries[26].token).toBe('@user_AA');
    expect(map.entries[59].token).toBe('@user_BH');
    expect(new Set(map.entries.map((e) => e.token)).size).toBe(60);
    expect(tokenFor(26 * 27 - 1)).toBe('@user_ZZ');
  });

  it('on the post path: the author is A and the caption context commenters follow in order', () => {
    const map = buildNameLabelMapForPost('@creator', '• @viewer1: first\n• @viewer2: second');
    expect(map.authorValue).toBe('@user_A');
    expect(map.entries.map((e) => [e.token, e.handle])).toEqual([
      ['@user_A', 'creator'], ['@user_B', 'viewer1'], ['@user_C', 'viewer2'],
    ]);
    expect(buildNameLabelMapForPost('', undefined).authorValue).toBe('unknown');
    expect(buildNameLabelMapForPost('unknown', undefined).authorValue).toBe('unknown');
  });
});

describe('replacing names in a text, on a copy', () => {
  it('uses the same token for the account line and for every @mention and bare handle in the texts', () => {
    const enc = encounter(post('creator'), [
      comment('pat_99', 'lol @pat_99 again, pat_99 never stops, and @Creator started it'),
      comment('other', 'nothing here'),
    ]);
    const map = buildNameLabelMapForEncounter(enc);
    const out = replaceNamesInText(map, enc.children[0].text);
    expect(out).toBe('lol @user_B again, @user_B never stops, and @user_A started it');
    expect(enc.children[0].text).toContain('@pat_99');
    expect(tokenForAuthor(map, enc.children[0].author)).toBe('@user_B');
    expect(readNameLabelCounts().replaced).toBe(3);
  });

  it('matches a display name whole, case and accents folded, and never a handle inside another word', () => {
    const map = buildNameLabelMapForEncounter(encounter(post('ana_m', 'Ana Măria'), [comment('ana')]));
    expect(replaceNamesInText(map, 'ANA MARIA said it; ana too; banana and ana_m_x stay')).toBe(
      '@user_A said it; @user_B too; banana and ana_m_x stay',
    );
  });

  it('a short handle is replaced only with its @, so a two-letter name does not eat ordinary words', () => {
    const map = buildNameLabelMapForEncounter(encounter(post('creator'), [comment('me')]));
    expect(replaceNamesInText(map, 'tell me @me')).toBe('tell me @user_B');
  });

  it('bends label-shaped input so it cannot pass for a label this call issued', () => {
    const map = buildNameLabelMapForEncounter(encounter(post('creator'), [comment('jess')]));
    const out = replaceNamesInText(map, 'says @user_A and user_b and @jess');
    expect(out).toBe('says @user-A and user-b and @user_B');
    expect(readNameLabelCounts().labelShapedInput).toBe(2);
    // What the model echoes back from that input is not restored to anyone.
    expect(restoreNames(map, 'attacks @user-A here', 'reason').text).toBe('attacks @user-A here');
  });

  it('counts whole-token hits of the originals, which is what the last check at the client asks', () => {
    const map = buildNameLabelMapForEncounter(encounter(post('creator', 'The Creator'), [comment('jess')]));
    expect(countIdentifierHits('by @user_A: "hi @user_B"', map.identifiers)).toBe(0);
    expect(countIdentifierHits('by @JESS: "hi" The Creator wrote', map.identifiers)).toBe(2);
    expect(countIdentifierHits('jessica @jessx the creator', map.identifiers)).toBe(0);
  });
});

describe('restoring names in what comes back', () => {
  const map = (): NameLabelMap => buildNameLabelMapForEncounter(encounter(
    post('creator'), [comment('jess'), ...Array.from({ length: 26 }, (_, i) => comment(`p${i}`))], [], 'English',
  ));

  it('restores whole tokens only: @user_A never inside @user_AA', () => {
    const m = map();
    expect(m.entries[27].token).toBe('@user_AB');
    const r = restoreNames(m, '@user_A and @user_AB and @user_B, @user_AB.', 'reason');
    expect(r.text).toBe('@creator and @p25 and @jess, @p25.');
    expect(r.counts).toEqual({ restored: 4, bent: 0, unmatched: 0 });
  });

  it('restores case, spacing and bracket variants and the bare @A, and counts them as bent', () => {
    const r = restoreNames(map(), '@USER_B, [user_B], @ user_A, @user B, user B and @B', 'reason');
    expect(r.text).toBe('@jess, @jess, @creator, @jess, @jess and @jess');
    expect(r.counts).toEqual({ restored: 0, bent: 6, unmatched: 0 });
  });

  it('restores the bent forms of each language', () => {
    const cases: Array<[string, string, string]> = [
      ['English', "user B's reply and @user_A's post", "@jess's reply and @creator's post"],
      ['Spanish', 'El usuario B se burla de @user_A', 'El @jess se burla de @creator'],
      ['Portuguese', 'O usuário B zomba, a usuária A responde', 'O @jess zomba, a @creator responde'],
      ['Romanian', 'Utilizatorul B și utilizatoarea A; lui @user_B; @user_A-ului', '@jess și @creator; lui @jess; @creator'],
    ];
    for (const [language, input, expected] of cases) {
      const m = { ...map(), outputLanguage: language };
      expect(restoreNames(m, input, 'reason').text, language).toBe(expected);
    }
  });

  it('puts the neutral word of the answer language in a reason for a token nobody issued', () => {
    const m = buildNameLabelMapForEncounter(encounter(post('creator'), [comment('jess')]));
    expect(restoreNames({ ...m, outputLanguage: 'English' }, '@user_Q mocks @user_B', 'reason').text)
      .toBe('someone mocks @jess');
    expect(restoreNames({ ...m, outputLanguage: 'Romanian' }, '@user_Q îl atacă pe @user_B', 'reason').text)
      .toBe('cineva îl atacă pe @jess');
    expect(restoreNames({ ...m, outputLanguage: 'Spanish' }, '@user_Q ataca', 'reason').text).toBe('alguien ataca');
    expect(restoreNames({ ...m, outputLanguage: 'Portuguese' }, 'user_Q ataca', 'reason').text).toBe('alguém ataca');
    expect(restoreNames(m, 'Utilizatorul @user_Q nu are dreptate și nici nu îi pasă', 'reason').text)
      .toBe('Utilizatorul cineva nu are dreptate și nici nu îi pasă');
    expect(readNameLabelCounts().unmatched).toBe(5);
  });

  it('drops a rewrite that still holds a token nobody issued, and counts the drop', () => {
    const m = buildNameLabelMapForEncounter(encounter(post('creator'), [comment('jess')]));
    const r = restoreNames(m, 'I disagree with @user_B and with user_C here.', 'rewrite');
    expect(r.text).toBeNull();
    expect(r.counts.unmatched).toBe(1);
    expect(readNameLabelCounts().droppedRewrites).toBe(1);
    expect(restoreNames(m, 'I disagree with @user_B here.', 'rewrite').text).toBe('I disagree with @jess here.');
  });

  it('gives an unknown writer the neutral word and a shown name with spaces its own form', () => {
    const m = buildNameLabelMapForEncounter(encounter(post('Jane Doe'), [comment('unknown')]));
    expect(restoreNames({ ...m, outputLanguage: 'English' }, '@user_B replies to @user_A', 'reason').text)
      .toBe('someone replies to Jane Doe');
  });
});

describe('which form comes back: the one the item itself wrote', () => {
  it('a display name or a bare handle comes back as written, not as the account line\'s @handle', () => {
    const m = buildNameLabelMapForEncounter(encounter(
      post('ssample99', 'Sam Sample'), [comment('bob'), comment('hopeful', 'a comment', 'Hope')],
    ));
    const own = 'Sam Sample is a liar and ssample99 knows it';
    expect(replaceNamesInText(m, own)).toBe('@user_A is a liar and @user_A knows it');
    expect(restoreNames(m, 'I think @user_A is wrong and @user_A knows it', 'rewrite', own).text)
      .toBe('I think Sam Sample is wrong and ssample99 knows it');
    const hope = 'I hope you fail, loser';
    expect(replaceNamesInText(m, hope)).toBe('I @user_C you fail, loser');
    expect(restoreNames(m, 'I @user_C you reconsider', 'rewrite', hope).text).toBe('I hope you reconsider');
    // A person the item never named comes back as the account line gives them.
    expect(restoreNames(m, '@user_B replies to @user_A', 'reason', own).text).toBe('@bob replies to Sam Sample');
  });

  it('an ordinary word that is someone\'s display name keeps its own spelling in every place', () => {
    const m = buildNameLabelMapForEncounter(encounter(post('liberty_now_88', 'Freedom'), [comment('bob')]));
    const own = 'freedom of speech is not freedom from consequences #Freedom';
    const sent = replaceNamesInText(m, own);
    expect(sent).toBe('@user_A of speech is not @user_A from consequences #@user_A');
    expect(restoreNames(m, sent, 'rewrite', own).text).toBe(own);
  });

  it('a caption that names its author bare gets the bare name back', () => {
    const m = buildNameLabelMapForPost('@dancequeen', undefined);
    const own = 'dancequeen here, and you are all losers';
    expect(replaceNamesInText(m, own)).toBe('@user_A here, and you are all losers');
    expect(restoreNames(m, '@user_A here, and I disagree with you all', 'rewrite', own).text)
      .toBe('dancequeen here, and I disagree with you all');
  });
});

describe('ordinary words are not labels', () => {
  const ten = (): NameLabelMap => buildNameLabelMapForEncounter(encounter(
    post('creator'), Array.from({ length: 9 }, (_, i) => comment(`p${i}`)),
  ));

  it('"user I" and "User ID" in a reply with no label are left as they are', () => {
    const m = buildNameLabelMapForPost('@the_sharer', '• @viewer_one: first');
    expect(restoreNames(m, 'As a user I find this app disappointing.', 'rewrite').text)
      .toBe('As a user I find this app disappointing.');
    expect(restoreNames(m, 'Your User ID is not the problem here.', 'rewrite').text)
      .toBe('Your User ID is not the problem here.');
    expect(restoreNames(m, 'The user I replied to was rude.', 'reason').text).toBe('The user I replied to was rude.');
    expect(readNameLabelCounts().unmatched).toBe(0);
  });

  it('with nine or more people "user I" still does not become the ninth person', () => {
    const m = ten();
    expect(m.entries[8].token).toBe('@user_I');
    expect(restoreNames(m, 'As a user I think anyone who backs this plan is mistaken.', 'rewrite').text)
      .toBe('As a user I think anyone who backs this plan is mistaken.');
    // The label itself still comes back.
    expect(restoreNames(m, 'I think @user_I is mistaken.', 'rewrite').text).toBe('I think @p7 is mistaken.');
  });
});

describe('the bent forms of every language, whatever language the call was told', () => {
  it('on the post path, with no output language, Spanish and Portuguese forms are restored', () => {
    const m = buildNameLabelMapForPost('@creador_mx', '• @vecino: primera reacción');
    expect(m.outputLanguage).toBeUndefined();
    expect(restoreNames(m, 'El usuario A se burla del resto del hilo.', 'rewrite').text)
      .toBe('El @creador_mx se burla del resto del hilo.');
    expect(restoreNames(m, 'O usuário A zomba do resto da conversa.', 'rewrite').text)
      .toBe('O @creador_mx zomba do resto da conversa.');
    expect(restoreNames(m, 'El usuario B se burla de @user_A', 'reason').text).toBe('El @vecino se burla de @creador_mx');
  });

  it('a Spanish or Portuguese form of a letter nobody got drops the rewrite and is neutral in a reason', () => {
    const m = buildNameLabelMapForPost('@creador_mx', undefined);
    expect(restoreNames(m, 'El usuario Q se burla del resto del hilo.', 'rewrite').text).toBeNull();
    expect(restoreNames({ ...m, outputLanguage: 'Portuguese' }, 'O usuário Q zomba de @user_A', 'reason').text)
      .toBe('O alguém zomba de @creador_mx');
  });
});

describe('a restored name is never read again as a label', () => {
  it('a real handle shaped like a label stays the person it belongs to', () => {
    const m = buildNameLabelMapForEncounter(encounter(post('creator'), [comment('bob'), comment('user_a')]));
    expect(m.entries.map((e) => e.handle)).toEqual(['creator', 'bob', 'user_a']);
    expect(restoreNames(m, '@user_C insults @user_B', 'reason').text).toBe('@user_a insults @bob');
    expect(restoreNames(m, 'I disagree with @user_C here', 'rewrite').text).toBe('I disagree with @user_a here');
    const x = buildNameLabelMapForEncounter(encounter(post('creator'), [comment('bob'), comment('user_x')]));
    expect(restoreNames(x, '@user_C insults @user_B', 'reason').text).toBe('@user_x insults @bob');
    expect(restoreNames(x, 'I disagree with @user_C here', 'rewrite').text).toBe('I disagree with @user_x here');
  });

  it('the last check at the client does not count an issued label as that handle', () => {
    const m = buildNameLabelMapForEncounter(encounter(post('creator'), [comment('bob'), comment('user_a')]));
    expect(countIdentifierHits('by @user_A: "hi @user_B", by @user_C', m.identifiers)).toBe(0);
    expect(countIdentifierHits('by @user_a: "hi"', m.identifiers)).toBe(1);
  });
});

describe('rule 8: every label and its bent forms pass the checks a rewrite must pass, in four languages', () => {
  const letters = ['A', 'B', 'Z', 'AA', 'AB'];
  const originals: Record<'en' | 'es' | 'pt' | 'ro', string> = {
    en: 'you are worthless and everyone in this thread knows it, @user_A',
    es: 'eres un inútil y todos en este hilo lo saben, @user_A',
    pt: 'você é um inútil e todo mundo nesta conversa sabe disso, @user_A',
    ro: 'ești un nimic și toată lumea din firul ăsta știe asta, @user_A',
  };

  it('no token or bent form trips FORBIDDEN_META_PATTERNS or detectMetaTalk', () => {
    for (const lang of ['en', 'es', 'pt', 'ro'] as const) {
      for (const l of letters) {
        const sentences = [`@user_${l} is wrong about this.`, ...BENT_FORM_SAMPLES[lang].map((s) => s(l))];
        for (const s of sentences) {
          for (const p of FORBIDDEN_META_PATTERNS) expect(p.test(s), `${lang}: ${s}`).toBe(false);
          expect(detectMetaTalk(s), `${lang}: ${s}`).toBeNull();
        }
      }
    }
  });

  it('validateRewrite accepts a rewrite built on each form, against an original in the same language', () => {
    for (const lang of ['en', 'es', 'pt', 'ro'] as const) {
      for (const l of ['A', 'AB']) {
        for (const sample of BENT_FORM_SAMPLES[lang]) {
          const rewrite = sample(l);
          const v = validateRewrite(rewrite, originals[lang]);
          expect(v.valid, `${lang}: ${rewrite} -> ${v.reason ?? ''} ${v.detail ?? ''}`).toBe(true);
        }
      }
    }
  });

  it('the language checks read a token as no language, so a rewrite keeps its own', () => {
    expect(validateRewriteLanguage('I think @user_A has a point and the rest of you are piling on.', 'en')).toBe(true);
    expect(validateRewriteLanguage('Cred că @user_A are dreptate și nu e nevoie de atacuri.', 'ro')).toBe(true);
    expect(validateRewriteLanguage('Creo que @user_A tiene razón y no hace falta atacar.', 'es')).toBe(true);
    expect(validateRewriteLanguage('Acho que @user_A tem razão e não precisa atacar.', 'pt')).toBe(true);
  });

  it('records the forms the frozen checks reject at the start of a rewrite: "The user A" and "Utilizatorul A spune"', () => {
    // These drop the rewrite before any restore (the frozen checks run first on the Teen and Child
    // path), which the measurement counts under its dropped-rewrite mark.
    expect(detectMetaTalk('The user A said something unkind.')).not.toBeNull();
    expect(detectMetaTalk('Utilizatorul A spune ceva nepoliticos.')).not.toBeNull();
    expect(NEUTRAL_WORD).toEqual({ en: 'someone', es: 'alguien', pt: 'alguém', ro: 'cineva' });
  });
});

describe('the switch is the runners\' alone', () => {
  it('no file under src calls setNameLabelStep except the module that defines it', () => {
    const root = process.cwd();
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else if (['.ts', '.tsx'].includes(extname(e.name))) files.push(abs);
      }
    };
    walk(join(root, 'src'));
    expect(files.length).toBeGreaterThan(300);
    const callers = files.filter((f) => {
      const text = readFileSync(f, 'utf8');
      return /\bsetNameLabelStep\s*\(/.test(text) && !f.replace(/\\/g, '/').endsWith('src/core/name-labels.ts');
    });
    expect(callers).toEqual([]);
  });
});

describe('an emoji before a name moves nothing', () => {
  const batch = (): NameLabelMap => buildNameLabelMapForEncounter(encounter(post('creator'), [comment('bob'), comment('jess')]));

  it('the name after one or many emoji is replaced whole, and the words around it stay', () => {
    const m = batch();
    expect(replaceNamesInText(m, '\u{1F602}\u{1F602} @jess you are wrong')).toBe('\u{1F602}\u{1F602} @user_C you are wrong');
    expect(replaceNamesInText(m, '\u{1F602}'.repeat(10) + ' @jess is a clown')).toBe('\u{1F602}'.repeat(10) + ' @user_C is a clown');
    expect(replaceNamesInText(buildNameLabelMapForPost('@creator', undefined), '\u{1F480} lol @creator'))
      .toBe('\u{1F480} lol @user_A');
  });

  it('the restore takes the name as the item wrote it, past the emoji', () => {
    expect(restoreNames(batch(), '@user_C mocks @user_B', 'reason', '\u{1F602}\u{1F602} @jess you are wrong').text)
      .toBe('@jess mocks @bob');
  });
});

describe('the TikTok caption context: shown names with spaces, and a name cut at 280', () => {
  const context = [
    '• @\u{1F422} Example Name \u{1F422} ❤️: this is so fake',
    '• @Jess Smith: agreed with @viewer_two',
    '• @viewer_two: Jess Smith you are wrong',
  ].join('\n');

  it('a shown name with spaces or emoji before the colon is a person present', () => {
    const m = buildNameLabelMapForPost('@creator', context);
    expect(m.entries.map((e) => e.handle)).toEqual([
      'creator', '\u{1F422} Example Name \u{1F422} ❤️', 'Jess Smith', 'viewer_two',
    ]);
    expect(replaceNamesInCaptionContext(m, context)).toBe([
      '• @user_B: this is so fake',
      '• @user_C: agreed with @user_D',
      '• @user_D: @user_C you are wrong',
    ].join('\n'));
  });

  it('a present name cut at the end of a 280-character comment is replaced by its prefix', () => {
    const cutHandle = ('a '.repeat(135) + '@viewer_two thanks').slice(0, 280);
    const cutName = ('a '.repeat(136) + 'Jess Smith agreed').slice(0, 280);
    expect(cutHandle.endsWith('@viewer_tw')).toBe(true);
    expect(cutName.endsWith('Jess Smi')).toBe(true);
    const ctx = `• @viewer_two: hi\n• @Jess Smith: ${cutHandle}\n• @jo: ${cutName}`;
    const m = buildNameLabelMapForPost('@creator', ctx);
    const out = replaceNamesInCaptionContext(m, ctx);
    expect(out).not.toContain('viewer_t');
    expect(out).not.toContain('Jess S');
    const lines = out.split('\n');
    expect(lines[1].endsWith(' @user_B')).toBe(true);
    expect(lines[2].endsWith(' @user_C')).toBe(true);
  });

  it('a short comment that merely ends in the first letters of a name is left alone', () => {
    const ctx = '• @viewer_two: hi\n• @jo: I like vie';
    const m = buildNameLabelMapForPost('@creator', ctx);
    expect(replaceNamesInCaptionContext(m, ctx)).toBe('• @user_B: hi\n• @user_C: I like vie');
  });
});

describe('the writer\'s own words are not labels', () => {
  const m = (): NameLabelMap => buildNameLabelMapForEncounter(encounter(post('creator'), [comment('bob')]));

  it('"USER A" quoted from the comment itself stays as the comment wrote it', () => {
    expect(restoreNames(m(), 'Mocks another commenter: "IS THIS USER A BOT"', 'reason', 'IS THIS USER A BOT LMAO').text)
      .toBe('Mocks another commenter: "IS THIS USER A BOT"');
    expect(restoreNames(m(), 'The comment "THIS USER IS A BOT" targets @user_B', 'reason', 'THIS USER IS A BOT').text)
      .toBe('The comment "THIS USER IS A BOT" targets @bob');
  });

  it('a rewrite that keeps the writer\'s "user A/B" or "USER IS" is kept, not dropped', () => {
    expect(restoreNames(m(), 'our user A/B test went badly', 'rewrite', 'our user A/B test was garbage, idiots').text)
      .toBe('our user A/B test went badly');
    expect(restoreNames(m(), 'I wonder if this user is a bot, USER IS not clear',
      'rewrite', 'I wonder if this user is a bot, USER IS not clear, moron').text)
      .toBe('I wonder if this user is a bot, USER IS not clear');
    expect(readNameLabelCounts().droppedRewrites).toBe(0);
  });

  it('a spaced label the writer never wrote still comes back as the person', () => {
    expect(restoreNames(m(), 'user B is mocking the thread', 'reason', 'lol whatever').text).toBe('@bob is mocking the thread');
  });
});
