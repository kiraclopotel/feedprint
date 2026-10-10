// The standby reader cannot be switched on without the privacy page saying so.
//
// The proxy can fall back to the same gpt-oss weights run by Cloudflare on Workers AI
// (worker/src/ai-fallback.ts). It is one environment variable away from live, and until
// 2026-09-21 the privacy page did not name Cloudflare as a reader of post text at all.
// A scout found that on 2026-09-19 and wrote it down as a decision to make "before that
// variable is ever flipped, so the decision is not made by accident at the moment
// somebody is fixing an outage".
//
// A note in a folder is not a mechanism, which is this repository's oldest lesson. This
// file is the mechanism. Two locks:
//
//   1. While the capability exists in the Worker, both privacy pages name Cloudflare.
//      Delete the disclosure and this fails.
//   2. The flag is pinned off. Turning it on fails the suite on purpose, with the
//      instruction in the failure message, at the moment somebody is reaching for it
//      during an outage and is least inclined to read a policy page.
//
// Neither lock reaches a value set straight into the Cloudflare dashboard instead of
// wrangler.toml, because nothing in this repository can see that. What it does reach is
// every route that goes through a commit, which is every route anyone has used so far.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { REPO_ROOT as ROOT } from '../helpers/repo-root';

const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const PRIVACY_PAGES = ['landing/privacy.html', 'landing/privacy-ro.html'];

describe('the standby AI reader is disclosed before it can be used', () => {
  it('the capability still exists, so this test still has a job', () => {
    const fallback = read('worker/src/ai-fallback.ts');
    expect(fallback).toContain('fallbackEnabled');
    expect(fallback).toContain('@cf/openai/gpt-oss-120b');
    const toml = read('worker/wrangler.toml');
    expect(toml).toMatch(/AI_FALLBACK\s*=/);
  });

  it('names Cloudflare as a reader of post text on every privacy page', () => {
    const missing = PRIVACY_PAGES.filter((page) => {
      const text = read(page);
      return !text.includes('Cloudflare Workers AI') || !text.includes('cloudflare.com/privacypolicy');
    });
    expect(
      missing,
      'The proxy can route post text to Cloudflare Workers AI. Every privacy page must '
        + 'name Cloudflare and link its policy, in every language, for as long as that code '
        + 'path exists. Remove the code path or restore the disclosure.',
    ).toEqual([]);
  });

  it('turning the standby on is a decision, not a config tweak', () => {
    const toml = read('worker/wrangler.toml');
    const value = /AI_FALLBACK\s*=\s*"([^"]*)"/.exec(toml)?.[1];
    expect(
      value,
      'AI_FALLBACK is no longer "off". That routes readers\' post text to Cloudflare, and '
        + 'the privacy pages currently describe it as switched off and never used, which '
        + 'would stop being true the moment this deploys. Before changing it: rewrite that '
        + 'paragraph in landing/privacy.html AND landing/privacy-ro.html to say it is live, '
        + 'deploy the site first, then change this expectation in the same commit so the '
        + 'next person meets the same gate. If this is an outage and that feels slow, it is '
        + 'the point: the page is what a reader was promised.',
    ).toBe('off');
  });
});
