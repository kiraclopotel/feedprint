// GET /v1/repairs: the signed repair file (11 Oct 2026).
//
// The extension's finders read their selectors and word lists through named families, and a repair file signed with our
// key may change them (src/core/repairs/ in the extension). Feedprint asks this route for the current file every few
// hours. The route trusts nothing and proves nothing: it hands back the stored wrapper as text, and the extension checks
// the signature against the public key it carries. A relay that is down, hacked or wrong cannot make a bad file count.
//
// The file lives in the licence namespace under `cfg:repairs` (the licence listings read the `fw-` and `owed:` prefixes
// only, so this key is never listed with them). No file means 204: nothing newer than what the extension was built with.
// Publishing is a single KV write of an already signed wrapper (worker/scripts/publish-repairs.mjs checks it first).
//
// Nothing about the caller is read or kept: no key, no cookie, no body. The answer is the same for everyone and may be
// cached for a quarter of an hour.

import type { Env } from './proxy';

export const REPAIRS_KV_KEY = 'cfg:repairs';
/** The extension refuses more than this, so the route never serves more. */
export const REPAIRS_MAX_CHARS = 80_000;

export async function handleRepairs(_request: Request, env: Pick<Env, 'LICENSES'>): Promise<Response> {
  let stored: string | null = null;
  try {
    stored = await env.LICENSES.get(REPAIRS_KV_KEY);
  } catch {
    stored = null;
  }
  if (!stored || stored.length > REPAIRS_MAX_CHARS) return new Response(null, { status: 204, headers: { 'cache-control': 'public, max-age=900' } });
  return new Response(stored, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=900',
      'x-content-type-options': 'nosniff',
    },
  });
}
