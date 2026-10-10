/** @vitest-environment jsdom */
//
// The same "edited" label set isEdited on two platforms and not on the third.
//
// twitter.ts declared EDIT_MARKER_REGEX at the top of the file, covering
// Edited, Editat, Editado, Modifié, Bearbeitet, Modificato and Изменено, and
// never called it. Grep found the declaration and no use. extractIsXEdited
// instead tested the English literal /\bLast edited\b/i, under a comment that
// called itself the "localized text fallback".
//
// facebook.ts and instagram.ts both call their identical copies of that regex.
// So a Romanian, Spanish, French, German, Italian or Russian edit label on X
// left isEdited false while the same label on the other two set it, in a field
// every surface downstream reads as one thing.
//
// The scoping is unchanged and is the part X already had right: only the
// time-stamp's own area is read, never the tweet body. That is the mistake the
// Facebook comment signals were making until the same night, and the reason
// each case below puts the marker in the header and keeps the body clean.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TwitterAdapter } from '../../../../src/content/platforms/twitter';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../../helpers/repo-root';

function setLocation(href: string): void {
  Object.defineProperty(window, 'location', {
    value: new URL(href), writable: true, configurable: true,
  });
}

/** One tweet, its header carrying whatever the platform drew beside the time. */
function tweet(headerExtra: string, body = 'an ordinary tweet with nothing special in it'): void {
  document.body.innerHTML = `
    <div>
      <article data-testid="tweet">
        <div data-testid="User-Name"><a href="/someone" role="link"><span>Someone</span></a>
          <a href="/someone/status/1900000000000000001" role="link">
            <time datetime="2026-07-01T10:00:00.000Z">Jul 1</time>${headerExtra}
          </a>
        </div>
        <div data-testid="tweetText">${body}</div>
      </article>
    </div>`;
}

function isEdited(): boolean | undefined {
  const posts = new TwitterAdapter().extractPosts(document.body.childNodes);
  const p = posts[0];
  if (!p || p.platform_specific?.platform !== 'twitter') return undefined;
  return (p.platform_specific as { isEdited?: boolean }).isEdited;
}

beforeEach(() => {
  setLocation('https://x.com/home');
  document.body.innerHTML = '';
});
afterEach(() => { document.body.innerHTML = ''; });

describe('X reads the edit marker in every language it declares (2026-09-19)', () => {
  it.each([
    ['Last edited', 'English, the one that already worked'],
    ['Editat', 'Romanian'],
    ['Editado', 'Spanish and Portuguese'],
    ['Modifié', 'French'],
    ['Bearbeitet', 'German'],
    ['Modificato', 'Italian'],
    ['Изменено', 'Russian'],
  ])('reads %s beside the timestamp (%s)', (label) => {
    tweet(`<span> · ${label}</span>`);
    expect(isEdited()).toBe(true);
  });

  it('an ordinary tweet is not edited', () => {
    tweet('');
    expect(isEdited()).toBe(false);
  });

  it('the word in the tweet body is not a marker', () => {
    // The scoping X already had. A person writing about something being edited
    // has not edited their tweet, and this is the failure mode found on
    // 2026-09-19 in Facebook's comment signals, where the body WAS the text
    // scanned.
    tweet('', 'the article was Editat after they published it, apparently');
    expect(isEdited()).toBe(false);
  });

  it('still prefers the structural marker when X provides one', () => {
    document.body.innerHTML = `
      <div>
        <article data-testid="tweet">
          <div data-testid="User-Name"><a href="/someone" role="link"><span>Someone</span></a>
            <a href="/someone/status/1900000000000000002" role="link">
              <time datetime="2026-07-01T10:00:00.000Z">Jul 1</time>
            </a>
          </div>
          <div data-testid="lastEditedTimestamp">edit history</div>
          <div data-testid="tweetText">an ordinary tweet with nothing special in it</div>
        </article>
      </div>`;
    expect(isEdited()).toBe(true);
  });
});

describe('and the two non-ASCII languages were never read on any platform', () => {
  // The bigger half of this. The list declares seven languages; two of them,
  // French and Russian, were refused by all three copies of the regex, the two
  // that were being called included. \b is defined by \w, which is
  // [A-Za-z0-9_] and contains neither e-acute nor Cyrillic, so after matching
  // the label the trailing \b saw a non-word character on both sides.
  //
  // Measured before the change: "Modifie" without the accent matched and
  // "Modifie" with it did not, which is the whole proof in one pair.
  //
  // Same shape as the donation check's identifier class, found on the same
  // day: a character class that excludes the characters the rule is about.
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
  const literal = (rel: string, decl: string): RegExp => {
    const line = read(rel).split('\n').map((l) => l.replace(/\r$/, '')).find((l) => l.startsWith(decl));
    expect(line, `${decl} still declared on one line in ${rel}`).toBeTruthy();
    const src = line!.slice(line!.indexOf('/') + 1, line!.lastIndexOf('/'));
    const flags = line!.slice(line!.lastIndexOf('/') + 1).replace(';', '');
    return new RegExp(src, flags);
  };

  const COPIES: ReadonlyArray<[string, string]> = [
    ['src/content/platforms/facebook.ts', 'const FB_EDIT_MARKER_REGEX'],
    ['src/content/platforms/instagram.ts', 'const IG_EDIT_MARKER_REGEX'],
    ['src/content/platforms/twitter.ts', 'const EDIT_MARKER_REGEX'],
  ];

  it.each(COPIES)('%s reads every language it declares', (rel, decl) => {
    const re = literal(rel, decl);
    for (const label of ['Edited', 'Editat', 'Editado', 'Modifié', 'Bearbeitet', 'Modificato', 'Изменено']) {
      expect(re.test(`Jul 1 · ${label}`), `${rel} on ${label}`).toBe(true);
    }
  });

  it.each(COPIES)('%s stays quiet on a longer word that merely contains one', (rel, decl) => {
    const re = literal(rel, decl);
    for (const near of ['Editadores', 'Reeditado', 'Bearbeitetes', 'Modificatore', 'Изменённый']) {
      expect(re.test(near), `${rel} on ${near}`).toBe(false);
    }
  });

  it('the three copies are still the same rule', () => {
    const [a, b, c] = COPIES.map(([rel, decl]) => literal(rel, decl).source);
    expect(b, 'instagram matches facebook').toBe(a);
    expect(c, 'and so does twitter').toBe(a);
  });
});
