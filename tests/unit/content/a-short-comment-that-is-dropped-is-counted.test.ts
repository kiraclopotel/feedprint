// @vitest-environment jsdom
//
// Nine places dropped a real short comment and said nothing.
//
// Every platform adapter reimplements "is this text real content or UI noise"
// with its own length floor. Facebook's modern comment walker drops on its
// floor and records it, with noteCommentDrop and fbDroppedShort. The others
// did not: Facebook's own legacy list fallback, TikTok's comment path, eight
// candidate loops in Instagram, and a twenty-character floor on YouTube
// community posts that is this helper's generic default, taken as-is with no
// measurement behind it, unlike every other length constant in that file.
//
// So "lol", "ok", an emoji, "AMA time", "New video out now" were
// indistinguishable from UI noise: absent from the record, and absent from
// every counter, which is the part that makes it invisible rather than merely
// incomplete. A recorder whose gaps cannot be measured cannot say how complete
// it is, and saying that is the whole product.
//
// What this commit does NOT do: change a floor. Choosing a number by feel at
// the moment of noticing is how the existing ones got here, including the
// twenty. The hole is made measurable so the number can be chosen from what it
// actually drops.
//
// Three of the nine are counted here, each under its own surface's name so no
// reader can mistake one for a total across platforms. Instagram's eight are
// not done and are open in the findings.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT as ROOT } from '../../helpers/repo-root';
import {
  _resetDiagnosticsForTesting,
  _getDiagnosticCountersForTesting,
} from '../../../src/diagnostics/diagnostics';
import { YoutubeAdapter } from '../../../src/content/platforms/youtube';

beforeEach(() => { _resetDiagnosticsForTesting(); document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

describe('a short comment that is dropped is counted (2026-09-19)', () => {
  it('YouTube: a community post under the floor leaves a count behind it', () => {
    document.body.innerHTML = `
      <ytd-backstage-post-renderer>
        <div id="content-text"><yt-attributed-string>AMA time</yt-attributed-string></div>
      </ytd-backstage-post-renderer>`;
    const nodes = document.querySelectorAll('ytd-backstage-post-renderer');

    const posts = new YoutubeAdapter().extractPosts(nodes);

    // The drop itself is unchanged: the floor still refuses it.
    expect(posts, 'still dropped, on purpose').toHaveLength(0);
    // What changed is that it is no longer invisible.
    expect(
      _getDiagnosticCountersForTesting()['shortDrop.youtube.community'],
      'and no longer silent',
    ).toBe(1);
  });

  it('YouTube: an empty container is not counted as a drop, because nothing was there', () => {
    document.body.innerHTML = `
      <ytd-backstage-post-renderer><div id="content-text"></div></ytd-backstage-post-renderer>`;
    const nodes = document.querySelectorAll('ytd-backstage-post-renderer');

    new YoutubeAdapter().extractPosts(nodes);

    expect(_getDiagnosticCountersForTesting()['shortDrop.youtube.community']).toBeUndefined();
  });

  it('counts under the surface that dropped it, never under one name for all of them', () => {
    // A single shared counter would read as a total and would be wrong the
    // moment one platform is counted and another is not, which is exactly the
    // state this leaves Instagram in.
    const keys = ['shortDrop.youtube.community', 'shortDrop.facebook.legacy', 'shortDrop.tiktok.comment'];
    for (const k of keys) expect(k.includes('.'), `${k} names its surface`).toBe(true);
    expect(new Set(keys).size, 'three surfaces, three counters').toBe(3);
  });
});

describe('the drops that are still silent are named, not forgotten', () => {
  // Source text rather than behaviour: the point is the count of sites that
  // still drop without counting, so that finishing the job is visible as a
  // number going down rather than as a feeling.
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  it('Instagram still has candidate loops that drop short text uncounted', () => {
    const ig = read('src/content/platforms/instagram.ts');
    const floors = [...ig.matchAll(/\.length\s*<\s*[25]\b/g)].length;
    // Not an assertion that this is fine. It is the number to drive down, held
    // here so a later commit that counts them has something to change.
    expect(floors, 'if this moved, update the findings entry with it').toBeGreaterThan(0);
  });

  it('the three that were done stay done', () => {
    expect(read('src/content/platforms/youtube.ts')).toContain('shortDrop.youtube.community');
    expect(read('src/content/platforms/facebook.ts')).toContain('shortDrop.facebook.legacy');
    expect(read('src/content/platforms/tiktok.ts')).toContain('shortDrop.tiktok.comment');
  });
});
