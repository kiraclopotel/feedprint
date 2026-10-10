/** @vitest-environment jsdom */
//
// The Add button did nothing, silently, for any accented word.
//
// `addHashtag` validated with `/^[a-z0-9_-]+$/`, which rejects every letter
// with a diacritic, and the refusal was a bare `return`: the draft stayed in
// the box, no message appeared, and the button stayed lit and coloured. So on a
// product that ships in Romanian, Spanish and Brazilian Portuguese, a parent
// typing the tag they can see on the page pressed a working-looking button as
// many times as they cared to, and nothing happened.
//
// The page side could not have matched it either. `captionHashtags` in
// ai-content-blocker.ts read `/#\w+/g`, and `\w` without the `u` flag is
// `[A-Za-z0-9_]`, so `#geração` was read as `gera`. Both halves are here,
// because widening only the box would accept a word the filter can never act
// on, and widening only the filter would leave the box refusing it.
//
// Found 2026-09-19.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../../../helpers/repo-root';
import { PT_BR } from '../../../../src/i18n/popup/pt-br';
import { EN } from '../../../../src/i18n/popup/en';
import { RO } from '../../../../src/i18n/popup/ro';
import { ES } from '../../../../src/i18n/popup/es';

/** The rule the popup applies, as the popup applies it. */
const ACCEPTED = /^[\p{L}\p{N}_-]+$/u;

/** The rule the page applies, as ai-content-blocker.ts applies it. */
const CAPTION = /#[\p{L}\p{N}_]+/gu;

const normalize = (raw: string): string => raw.trim().replace(/^#+/, '').toLowerCase();

describe('a hashtag can have an accent (2026-09-19)', () => {
  it('the box takes the words the shipped languages are written in', () => {
    for (const tag of ['geração', 'înșelătorie', 'niño', 'sănătate', 'coração', 'être']) {
      expect(ACCEPTED.test(normalize(tag)), `${tag} is a word`).toBe(true);
    }
  });

  it('and still takes the plain ones, which is what it accepted before', () => {
    for (const tag of ['#AiFruit', 'ai_slop', 'brain-rot', 'fyp2026']) {
      expect(ACCEPTED.test(normalize(tag)), `${tag} is still a word`).toBe(true);
    }
  });

  it('and still refuses what is not one word', () => {
    // A rule that accepted everything would be the same defect pointing the
    // other way: a chip nobody can explain, matching nothing.
    for (const bad of ['two words', 'a/b', 'hash tag!', '']) {
      expect(ACCEPTED.test(normalize(bad)), `${bad || '(empty)'} is not one word`).toBe(false);
    }
  });

  it('the page reads an accented hashtag out of a caption, which it could not before', () => {
    const caption = 'olha isso #geração #ai_slop e mais #înșelătorie';
    const found = (caption.match(CAPTION) ?? []).map(normalize);
    expect(found).toContain('geração');
    expect(found).toContain('înșelătorie');
    expect(found).toContain('ai_slop');
    // What the old pattern did, stated rather than described: it stopped at the
    // first accent, so the parent's tag and the caption's tag never met.
    const old = (caption.match(/#\w+/g) ?? []).map(normalize);
    expect(old, 'the old pattern truncated at the accent').toContain('gera');
    expect(old).not.toContain('geração');
  });

  it('a refusal has a sentence, in all four languages', () => {
    // The half that is not about accents at all: the old refusal said nothing.
    for (const [lang, table] of [['en', EN], ['ro', RO], ['es', ES], ['pt-BR', PT_BR]] as const) {
      expect(table.hashtagNotAWord, `${lang} has the sentence`).toBeTruthy();
      expect(table.hashtagNotAWord.length, `${lang} says more than a word`).toBeGreaterThan(20);
    }
  });

  it('the popup clears the sentence as soon as the box is retyped', () => {
    // A message that outlives the thing it describes is its own small lie.
    const src = readKeysTab();
    expect(src).toContain('if (hashtagError) setHashtagError(\'\')');
    expect(src, 'and the refusal sets it').toContain('setHashtagError(t.hashtagNotAWord)');
  });
});

function readKeysTab(): string {
  return readFileSync(join(REPO_ROOT, 'src/ui/popup/BlockAiHashtagEditor.tsx'), 'utf8');
}
